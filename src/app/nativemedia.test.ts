import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Playback } from '../protocol/types';
import { createNativeMediaSync, type YuzuMediaPluginHandle } from './nativemedia';

type ActionListener = (event: { action: string; positionMs?: number }) => void;

function fakePlugin() {
  const listeners: ActionListener[] = [];
  const plugin: YuzuMediaPluginHandle = {
    setMetadata: vi.fn(async () => {}),
    setPlaybackState: vi.fn(async () => {}),
    clearSession: vi.fn(async () => {}),
    startKeepAlive: vi.fn(async () => {}),
    stopKeepAlive: vi.fn(async () => {}),
    isIgnoringBatteryOptimizations: vi.fn(async () => ({ granted: true })),
    requestIgnoreBatteryOptimizations: vi.fn(async () => {}),
    addListener: vi.fn(async (_event: 'action', listener: ActionListener) => {
      listeners.push(listener);
      return { remove: async () => {} };
    }),
  };
  return {
    plugin,
    emit: (action: string, positionMs?: number) =>
      listeners.forEach((listener) => listener({ action, positionMs })),
  };
}

function makePlayback(overrides: Partial<{
  playing: boolean;
  positionMs: number;
  updatedAt: number;
  rate: number;
  trackRef: string;
  durationMs: number;
  coverUrl: string | undefined;
}> = {}): Playback {
  return {
    current: {
      entry_id: 'entry-one',
      track_ref: overrides.trackRef ?? 'local:one',
      title: 'Song',
      artist: 'Artist',
      album: 'Album',
      duration_ms: overrides.durationMs ?? 60_000,
      cover_url: overrides.coverUrl === undefined ? '/api/v1/cover/local%3Aone' : overrides.coverUrl,
      stream_url: '/stream/v1/local:one?ticket=one',
      requested_by: 'user-one',
      added_at: 500,
    },
    position_ms: overrides.positionMs ?? 10_000,
    updated_at: overrides.updatedAt ?? 1_000,
    playing: overrides.playing ?? true,
    rate: overrides.rate ?? 1,
  };
}

const BASE = 'https://jukebox.example';

describe('createNativeMediaSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(4_000);
  });

  it('pushes metadata, computed position, and starts keep-alive on first track', async () => {
    const { plugin } = fakePlugin();
    const sync = createNativeMediaSync(plugin);

    sync.sync(makePlayback(), BASE, {});
    await vi.advanceTimersByTimeAsync(0);

    expect(plugin.startKeepAlive).toHaveBeenCalledTimes(1);
    expect(plugin.setMetadata).toHaveBeenCalledWith({
      title: 'Song',
      artist: 'Artist',
      album: 'Album',
      artworkUrl: 'https://jukebox.example/api/v1/cover/local%3Aone',
      durationMs: 60_000,
    });
    // position = 10_000 + (4_000 - 1_000) * 1
    expect(plugin.setPlaybackState).toHaveBeenCalledWith({
      playing: true,
      positionMs: 13_000,
      rate: 1,
    });
    expect(plugin.addListener).toHaveBeenCalledTimes(1);
  });

  it('does not re-push unchanged metadata or restart keep-alive', async () => {
    const { plugin } = fakePlugin();
    const sync = createNativeMediaSync(plugin);

    sync.sync(makePlayback(), BASE, {});
    sync.sync(makePlayback({ positionMs: 11_000 }), BASE, {});
    await vi.advanceTimersByTimeAsync(0);

    expect(plugin.setMetadata).toHaveBeenCalledTimes(1);
    expect(plugin.startKeepAlive).toHaveBeenCalledTimes(1);
    expect(plugin.setPlaybackState).toHaveBeenCalledTimes(2);
  });

  it('clamps negative lead position to 0 and caps at duration', async () => {
    const { plugin } = fakePlugin();
    const sync = createNativeMediaSync(plugin);

    sync.sync(makePlayback({ positionMs: -600, updatedAt: 4_000 }), BASE, {});
    sync.sync(makePlayback({ positionMs: 65_000, updatedAt: 4_000 }), BASE, {});
    await vi.advanceTimersByTimeAsync(0);

    expect(plugin.setPlaybackState).toHaveBeenNthCalledWith(1, {
      playing: true,
      positionMs: 0,
      rate: 1,
    });
    expect(plugin.setPlaybackState).toHaveBeenNthCalledWith(2, {
      playing: true,
      positionMs: 60_000,
      rate: 1,
    });
  });

  it('paused playback reports position without elapsed advance', async () => {
    const { plugin } = fakePlugin();
    const sync = createNativeMediaSync(plugin);

    sync.sync(makePlayback({ playing: false }), BASE, {});
    await vi.advanceTimersByTimeAsync(0);

    expect(plugin.setPlaybackState).toHaveBeenCalledWith({
      playing: false,
      positionMs: 10_000,
      rate: 1,
    });
  });

  it('idle clears session and stops keep-alive exactly once', async () => {
    const { plugin } = fakePlugin();
    const sync = createNativeMediaSync(plugin);
    const idle: Playback = { current: null, position_ms: 0, updated_at: 0, playing: false, rate: 1 };

    sync.sync(makePlayback(), BASE, {});
    sync.sync(idle, BASE, {});
    sync.sync(idle, BASE, {});
    await vi.advanceTimersByTimeAsync(0);

    expect(plugin.stopKeepAlive).toHaveBeenCalledTimes(1);
    expect(plugin.clearSession).toHaveBeenCalledTimes(1);
  });

  it('routes native actions to the latest injected handlers', async () => {
    const { plugin, emit } = fakePlugin();
    const sync = createNativeMediaSync(plugin);
    const first = { onPlay: vi.fn(), onNextTrack: vi.fn() };
    const second = { onPlay: vi.fn(), onPause: vi.fn(), onSeek: vi.fn() };

    sync.sync(makePlayback(), BASE, first);
    sync.sync(makePlayback({ positionMs: 11_000 }), BASE, second);
    await vi.advanceTimersByTimeAsync(0);

    emit('play');
    emit('pause');
    emit('next');
    emit('seek', 42_000);
    emit('seek'); // 无 positionMs 的 seek 不派发

    expect(first.onPlay).not.toHaveBeenCalled();
    expect(second.onPlay).toHaveBeenCalledTimes(1);
    expect(second.onPause).toHaveBeenCalledTimes(1);
    expect(first.onNextTrack).not.toHaveBeenCalled();
    expect(second).not.toHaveProperty('onNextTrack');
    expect(second.onSeek).toHaveBeenCalledWith(42_000);
    expect(second.onSeek).toHaveBeenCalledTimes(1);
  });

  it('retries keep-alive on the next sync after a rejected start', async () => {
    const { plugin } = fakePlugin();
    vi.mocked(plugin.startKeepAlive).mockRejectedValueOnce(new Error('background start'));
    const sync = createNativeMediaSync(plugin);

    sync.sync(makePlayback(), BASE, {});
    await vi.advanceTimersByTimeAsync(0);
    sync.sync(makePlayback({ positionMs: 11_000 }), BASE, {});
    await vi.advanceTimersByTimeAsync(0);

    expect(plugin.startKeepAlive).toHaveBeenCalledTimes(2);
  });
});
