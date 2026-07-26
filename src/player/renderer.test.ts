import { describe, expect, it, vi } from 'vitest';
import type { ClockSync } from '../protocol/clock';
import type { Playback } from '../protocol/types';

vi.mock('../config', () => ({ httpBase: 'https://jukebox.example' }));

import { AudioRenderer } from './renderer';

class FakeAudio {
  src = '';
  readyState = 0;
  seeking = false;
  paused = true;
  playbackRate = 1;
  playCalls = 0;
  pauseCalls = 0;
  loadCalls = 0;
  readonly seekWrites: number[] = [];

  private position = 0;
  private readonly listeners = new Map<string, Set<EventListener>>();

  get currentTime(): number {
    return this.position;
  }

  set currentTime(value: number) {
    this.position = value;
    this.seekWrites.push(value);
  }

  play(): Promise<void> {
    this.playCalls += 1;
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.pauseCalls += 1;
    this.paused = true;
  }

  load(): void {
    this.loadCalls += 1;
  }

  addEventListener(type: string, listener: EventListener): void {
    let listeners = this.listeners.get(type);
    if (listeners === undefined) {
      listeners = new Set<EventListener>();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener({ type } as Event);
    }
  }
}

class FakeClock {
  constructor(public now: number) {}

  serverNow(): number {
    return this.now;
  }
}

interface PlaybackOptions {
  trackRef?: string | null;
  streamUrl?: string;
  playing?: boolean;
  positionMs?: number;
  updatedAt?: number;
  rate?: number;
}

function makePlayback({
  trackRef = 'local:one',
  streamUrl = '/stream/v1/local:one?ticket=one',
  playing = true,
  positionMs = 10_000,
  updatedAt = 1_000,
  rate = 1,
}: PlaybackOptions = {}): Playback {
  return {
    current: trackRef === null
      ? null
      : {
          entry_id: `entry:${trackRef}`,
          track_ref: trackRef,
          title: trackRef,
          artist: 'Artist',
          duration_ms: 180_000,
          requested_by: 'listener:one',
          added_at: 500,
          stream_url: streamUrl,
        },
    position_ms: positionMs,
    updated_at: updatedAt,
    playing,
    rate,
  };
}

function makeRenderer(audio: FakeAudio, clock: FakeClock): AudioRenderer {
  return new AudioRenderer(
    audio as unknown as HTMLAudioElement,
    clock as unknown as ClockSync,
  );
}

describe('AudioRenderer', () => {
  it('loads a relative stream URL and performs one fresh initial seek when metadata is ready', () => {
    const audio = new FakeAudio();
    audio.readyState = 4;
    const clock = new FakeClock(1_200);
    const renderer = makeRenderer(audio, clock);
    const playback = makePlayback({
      positionMs: 5_000,
      updatedAt: 1_000,
      rate: 1.5,
    });

    renderer.render(playback);

    expect(audio.src).toBe(
      'https://jukebox.example/stream/v1/local:one?ticket=one',
    );
    expect(audio.loadCalls).toBe(1);
    expect(audio.playCalls).toBe(1);
    expect(audio.seekWrites).toEqual([]);

    clock.now = 1_400;
    audio.emit('canplay');
    expect(audio.seekWrites).toEqual([5.6]);

    audio.emit('loadedmetadata');
    audio.emit('canplay');
    expect(audio.seekWrites).toEqual([5.6]);
  });

  it('keeps an absolute stream URL unchanged', () => {
    const audio = new FakeAudio();
    const renderer = makeRenderer(audio, new FakeClock(1_000));

    renderer.render(makePlayback({
      streamUrl: 'https://media.example/song?ticket=absolute',
    }));

    expect(audio.src).toBe('https://media.example/song?ticket=absolute');
  });

  it('synchronizes pause and resume without reloading an unchanged track', () => {
    const audio = new FakeAudio();
    const renderer = makeRenderer(audio, new FakeClock(1_000));

    renderer.render(makePlayback());
    expect(audio.playCalls).toBe(1);
    expect(audio.loadCalls).toBe(1);

    renderer.render(makePlayback({ playing: false }));
    expect(audio.pauseCalls).toBe(1);
    expect(audio.loadCalls).toBe(1);

    renderer.render(makePlayback());
    expect(audio.playCalls).toBe(2);
    expect(audio.loadCalls).toBe(1);
  });

  it('pauses, clears the source, and cancels a pending metadata seek when current becomes null', () => {
    const audio = new FakeAudio();
    const renderer = makeRenderer(audio, new FakeClock(1_000));

    renderer.render(makePlayback());
    renderer.render(makePlayback({ trackRef: null, playing: false }));

    expect(audio.paused).toBe(true);
    expect(audio.src).toBe('');
    expect(audio.loadCalls).toBe(2);
    expect(audio.playbackRate).toBe(1);

    audio.emit('loadedmetadata');
    audio.emit('canplay');
    expect(audio.seekWrites).toEqual([]);
  });

  it('runs drift correction at the end of every same-track render', () => {
    const audio = new FakeAudio();
    audio.readyState = 4;
    const clock = new FakeClock(1_000);
    const renderer = makeRenderer(audio, clock);
    const playback = makePlayback();

    renderer.render(playback);
    audio.emit('loadedmetadata');
    audio.currentTime = 9.8;
    audio.seekWrites.length = 0;
    renderer.tick();

    audio.currentTime = 10;
    audio.seekWrites.length = 0;
    renderer.render(playback);

    expect(audio.seekWrites).toEqual([9.8]);
  });

  it('only lets tick sample after seeking ends with future data buffered', () => {
    const audio = new FakeAudio();
    audio.readyState = 4;
    const renderer = makeRenderer(audio, new FakeClock(1_000));
    const playback = makePlayback();

    renderer.render(playback);
    audio.emit('canplay');
    audio.currentTime = 9.8;
    audio.seekWrites.length = 0;
    renderer.tick();

    audio.currentTime = 10;
    audio.seekWrites.length = 0;
    audio.seeking = true;
    renderer.tick();
    expect(audio.seekWrites).toEqual([]);

    audio.seeking = false;
    audio.readyState = 2;
    renderer.tick();
    expect(audio.seekWrites).toEqual([]);

    audio.readyState = 3;
    renderer.tick();
    expect(audio.seekWrites).toEqual([9.8]);
  });

  it('does nothing on an audio error and retries only from the next supplied render', () => {
    const audio = new FakeAudio();
    const renderer = makeRenderer(audio, new FakeClock(1_000));
    const playback = makePlayback();

    renderer.render(playback);
    const loadCalls = audio.loadCalls;
    const playCalls = audio.playCalls;
    const pauseCalls = audio.pauseCalls;
    const source = audio.src;

    audio.emit('error');
    expect(audio.loadCalls).toBe(loadCalls);
    expect(audio.playCalls).toBe(playCalls);
    expect(audio.pauseCalls).toBe(pauseCalls);
    expect(audio.src).toBe(source);
    expect(audio.seekWrites).toEqual([]);

    renderer.render(playback);
    expect(audio.loadCalls).toBe(loadCalls + 1);
    expect(audio.src).toBe(source);
  });
});
