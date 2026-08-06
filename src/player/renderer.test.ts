import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClockSync } from '../protocol/clock';
import type { Playback } from '../protocol/types';

vi.mock('../config', () => ({ httpBase: 'https://jukebox.example' }));

import { AudioRenderer } from './renderer';

class FakeAudio {
  src = '';
  preload = '';
  readyState = 0;
  seeking = false;
  paused = true;
  playbackRate = 1;
  playCalls = 0;
  pauseCalls = 0;
  loadCalls = 0;
  /** 模拟 autoplay 策略拒绝 play() */
  rejectPlay = false;
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
    if (this.rejectPlay) {
      return Promise.reject(new Error('NotAllowedError'));
    }
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

  it('keeps loaded media when the same track receives a fresh stream ticket', () => {
    const audio = new FakeAudio();
    const renderer = makeRenderer(audio, new FakeClock(1_000));

    renderer.render(makePlayback({
      streamUrl: '/stream/v1/local:one?ticket=one',
    }));
    expect(audio.src).toBe(
      'https://jukebox.example/stream/v1/local:one?ticket=one',
    );
    expect(audio.loadCalls).toBe(1);
    expect(audio.playCalls).toBe(1);

    renderer.render(makePlayback({
      streamUrl: '/stream/v1/local:one?ticket=two',
      positionMs: 12_000,
      updatedAt: 2_000,
    }));
    expect(audio.src).toBe(
      'https://jukebox.example/stream/v1/local:one?ticket=one',
    );
    expect(audio.loadCalls).toBe(1);
    expect(audio.playCalls).toBe(1);
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

  it('personal pause silences rendering while the room keeps playing, then resumes aligned', () => {
    const audio = new FakeAudio();
    audio.readyState = 4;
    const clock = new FakeClock(2_000);
    const renderer = makeRenderer(audio, clock);

    renderer.render(makePlayback({ positionMs: 5_000, updatedAt: 1_000 }));
    expect(audio.playCalls).toBe(1);
    expect(audio.paused).toBe(false);

    renderer.pausePersonal();
    expect(renderer.isPersonalPaused).toBe(true);
    expect(audio.paused).toBe(true);

    // 房间继续播：新状态到来只装载（同曲目不重载），不出声。
    const playCalls = audio.playCalls;
    renderer.render(makePlayback({ positionMs: 20_000, updatedAt: 2_000 }));
    expect(audio.playCalls).toBe(playCalls);
    expect(audio.paused).toBe(true);

    // 个人暂停期间 tick 不校偏：房间位置前进不应触发 seek。
    clock.now = 3_000;
    renderer.tick();
    expect(audio.seekWrites).toEqual([]);

    // 恢复：对齐房间当前应播位置（20s + 1s 前进）并出声。
    renderer.resumePersonal();
    expect(renderer.isPersonalPaused).toBe(false);
    expect(audio.seekWrites.at(-1)).toBe(21);
    expect(audio.playCalls).toBe(playCalls + 1);
    expect(audio.paused).toBe(false);
  });

  it('personal pause across a room track change resumes into the new track', () => {
    const audio = new FakeAudio();
    audio.readyState = 4;
    const clock = new FakeClock(1_000);
    const renderer = makeRenderer(audio, clock);

    renderer.render(makePlayback({ trackRef: 'local:one' }));
    renderer.pausePersonal();

    // 暂停期间房间切歌：装载新曲，保持静默。
    const playCalls = audio.playCalls;
    renderer.render(makePlayback({
      trackRef: 'local:two',
      streamUrl: '/stream/v1/local:two?ticket=two',
      positionMs: 3_000,
      updatedAt: 1_000,
    }));
    expect(audio.src).toBe(
      'https://jukebox.example/stream/v1/local:two?ticket=two',
    );
    expect(audio.playCalls).toBe(playCalls);
    expect(audio.paused).toBe(true);

    // 恢复：新曲就绪回调把位置对齐到应播位置，然后出声。
    renderer.resumePersonal();
    expect(renderer.isPersonalPaused).toBe(false);
    expect(audio.playCalls).toBe(playCalls + 1);
    expect(audio.seekWrites.at(-1)).toBe(3);
  });

  it('resets personal pause and renders idle when leaving the room', () => {
    const audio = new FakeAudio();
    const clock = new FakeClock(1_000);
    const renderer = makeRenderer(audio, clock);

    renderer.render(makePlayback());
    renderer.pausePersonal();
    renderer.render(makePlayback({ trackRef: null }));
    expect(renderer.isPersonalPaused).toBe(false);
    expect(audio.paused).toBe(true);
  });
});

describe('AudioRenderer start-lead window', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads and stays paused, then plays at the scheduled instant', () => {
    const audio = new FakeAudio();
    audio.readyState = 4;
    const clock = new FakeClock(1_100);
    const renderer = makeRenderer(audio, clock);

    // position -600 @ updated_at 1000：预定起播在服务端时刻 1600，此刻还差 500ms。
    renderer.render(makePlayback({ positionMs: -600, updatedAt: 1_000 }));

    expect(audio.src).toBe(
      'https://jukebox.example/stream/v1/local:one?ticket=one',
    );
    expect(audio.loadCalls).toBe(1);
    expect(audio.playCalls).toBe(0);
    expect(audio.paused).toBe(true);
    expect(audio.seekWrites).toEqual([]);

    // 窗口内的周期校偏不得 seek（更不得 seek 到负位置）。
    audio.currentTime = 0;
    audio.seekWrites.length = 0;
    clock.now = 1_300;
    renderer.tick();
    expect(audio.seekWrites).toEqual([]);
    expect(audio.playCalls).toBe(0);

    clock.now = 1_600;
    vi.advanceTimersByTime(500);
    expect(audio.playCalls).toBe(1);
    expect(audio.paused).toBe(false);
    expect(audio.seekWrites).toEqual([]);
  });

  it('cancels a scheduled start when a newer playback arrives', () => {
    const audio = new FakeAudio();
    audio.readyState = 4;
    const clock = new FakeClock(1_000);
    const renderer = makeRenderer(audio, clock);

    renderer.render(makePlayback({ positionMs: -600, updatedAt: 1_000 }));
    // 连切：第二条 playback.changed 必须让第一条的定时器失效，否则叠加乱播。
    renderer.render(makePlayback({
      trackRef: 'local:two',
      streamUrl: '/stream/v1/local:two?ticket=two',
      positionMs: -600,
      updatedAt: 1_000,
    }));

    clock.now = 1_600;
    vi.advanceTimersByTime(5_000);
    expect(audio.playCalls).toBe(1);
    expect(audio.src).toBe(
      'https://jukebox.example/stream/v1/local:two?ticket=two',
    );
  });

  it('cancels a scheduled start when playback goes idle', () => {
    const audio = new FakeAudio();
    const renderer = makeRenderer(audio, new FakeClock(1_000));

    renderer.render(makePlayback({ positionMs: -600, updatedAt: 1_000 }));
    renderer.render(makePlayback({ trackRef: null, playing: false }));

    vi.advanceTimersByTime(5_000);
    expect(audio.playCalls).toBe(0);
    expect(audio.src).toBe('');
  });

  it('schedules nothing while paused inside the window and reschedules on resume', () => {
    const audio = new FakeAudio();
    const clock = new FakeClock(1_000);
    const renderer = makeRenderer(audio, clock);

    renderer.render(makePlayback({ positionMs: -600, updatedAt: 1_000, playing: false }));
    vi.advanceTimersByTime(5_000);
    expect(audio.playCalls).toBe(0);

    // resume 时服务端刷新 updated_at，窗口重新计时。
    clock.now = 5_000;
    renderer.render(makePlayback({ positionMs: -600, updatedAt: 5_000 }));
    expect(audio.playCalls).toBe(0);
    clock.now = 5_600;
    vi.advanceTimersByTime(600);
    expect(audio.playCalls).toBe(1);
  });

  it('aligns before playing when the scheduled start is throttled late', () => {
    const audio = new FakeAudio();
    audio.readyState = 4;
    const clock = new FakeClock(1_000);
    const renderer = makeRenderer(audio, clock);

    renderer.render(makePlayback({ positionMs: -600, updatedAt: 1_000 }));

    // 后台标签页节流：定时器迟到 400ms。从 0 开声会被误学成基线，先对齐。
    clock.now = 2_000;
    vi.advanceTimersByTime(1_000);
    expect(audio.seekWrites).toEqual([0.4]);
    expect(audio.playCalls).toBe(1);
  });

  it('keeps a gesture retry silent inside the window', () => {
    const audio = new FakeAudio();
    const clock = new FakeClock(1_100);
    const renderer = makeRenderer(audio, clock);

    renderer.render(makePlayback({ positionMs: -600, updatedAt: 1_000 }));
    renderer.resumeAfterGesture();
    expect(audio.playCalls).toBe(0);

    clock.now = 1_600;
    vi.advanceTimersByTime(500);
    expect(audio.playCalls).toBe(1);
  });

  it('retries a rejected play on the next gesture after the window', () => {
    const audio = new FakeAudio();
    audio.readyState = 4;
    audio.rejectPlay = true;
    const clock = new FakeClock(1_000);
    const renderer = makeRenderer(audio, clock);

    renderer.render(makePlayback({ positionMs: -600, updatedAt: 1_000 }));
    clock.now = 1_600;
    vi.advanceTimersByTime(600);
    expect(audio.playCalls).toBe(1);
    expect(audio.paused).toBe(true);

    audio.rejectPlay = false;
    renderer.resumeAfterGesture();
    expect(audio.playCalls).toBe(2);
    expect(audio.paused).toBe(false);
  });
});
