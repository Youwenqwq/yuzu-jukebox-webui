import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Playback } from '../protocol/types';
import { syncMediaSession } from './mediasession';

interface FakeMetadataInit {
  title?: string;
  artist?: string;
  album?: string;
  artwork?: MediaImage[];
}

class FakeMediaMetadata {
  readonly init: FakeMetadataInit;

  constructor(init: FakeMetadataInit) {
    this.init = init;
  }
}

function playback(overrides: Partial<Playback> = {}): Playback {
  return {
    current: {
      entry_id: 'entry:one',
      track_ref: 'local:one',
      title: 'Citrus Night',
      artist: 'Yuzu',
      album: 'Orchard',
      duration_ms: 180_000,
      cover_url: '/api/v1/cover/local%3Aone',
      requested_by: 'listener:one',
      added_at: 500,
    },
    position_ms: 5_000,
    updated_at: 1_000,
    playing: true,
    rate: 1.5,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('syncMediaSession', () => {
  it('syncs metadata, playback state, live position, and injected handlers', () => {
    const setPositionState = vi.fn();
    const setActionHandler = vi.fn();
    const mediaSession = {
      metadata: null as FakeMediaMetadata | null,
      playbackState: 'none' as MediaSessionPlaybackState,
      setPositionState,
      setActionHandler,
    };
    const onPlay = vi.fn();
    const onPause = vi.fn();
    const onNextTrack = vi.fn();
    vi.stubGlobal('MediaMetadata', FakeMediaMetadata);
    vi.stubGlobal('navigator', { mediaSession });
    vi.spyOn(Date, 'now').mockReturnValue(2_000);

    syncMediaSession(playback(), 'https://jukebox.test/', {
      onPlay,
      onPause,
      onNextTrack,
    });

    expect(mediaSession.metadata?.init).toEqual({
      title: 'Citrus Night',
      artist: 'Yuzu',
      album: 'Orchard',
      artwork: [{ src: 'https://jukebox.test/api/v1/cover/local%3Aone' }],
    });
    expect(mediaSession.playbackState).toBe('playing');
    expect(setPositionState).toHaveBeenCalledWith({
      duration: 180,
      playbackRate: 1.5,
      position: 6.5,
    });
    expect(setActionHandler.mock.calls).toEqual([
      ['play', onPlay],
      ['pause', onPause],
      ['nexttrack', onNextTrack],
    ]);
  });

  it('clears track state and unused handlers when playback has no current track', () => {
    const setPositionState = vi.fn();
    const setActionHandler = vi.fn();
    const mediaSession = {
      metadata: new FakeMediaMetadata({ title: 'Old track' }) as FakeMediaMetadata | null,
      playbackState: 'playing' as MediaSessionPlaybackState,
      setPositionState,
      setActionHandler,
    };
    vi.stubGlobal('MediaMetadata', FakeMediaMetadata);
    vi.stubGlobal('navigator', { mediaSession });

    syncMediaSession(playback({ current: null, playing: false }), 'https://jukebox.test/', {});

    expect(mediaSession.metadata).toBeNull();
    expect(mediaSession.playbackState).toBe('none');
    expect(setPositionState).toHaveBeenCalledWith();
    expect(setActionHandler.mock.calls).toEqual([
      ['play', null],
      ['pause', null],
      ['nexttrack', null],
    ]);
  });

  it('is a no-op when the Media Session API is unavailable', () => {
    vi.stubGlobal('navigator', {});
    const metadata = vi.fn();
    vi.stubGlobal('MediaMetadata', metadata);

    expect(() => syncMediaSession(playback(), 'https://jukebox.test/', {})).not.toThrow();
    expect(metadata).not.toHaveBeenCalled();
  });

  // 回归：同源部署时 artworkBase 为空串，曾抛 "Invalid base URL" 阻断房间页
  it('falls back to location.origin when artworkBase is empty', () => {
    const mediaSession = {
      metadata: null as FakeMediaMetadata | null,
      playbackState: 'none' as MediaSessionPlaybackState,
      setPositionState: vi.fn(),
      setActionHandler: vi.fn(),
    };
    vi.stubGlobal('MediaMetadata', FakeMediaMetadata);
    vi.stubGlobal('navigator', { mediaSession });
    vi.stubGlobal('location', { origin: 'https://pages.test' });

    expect(() => syncMediaSession(playback(), '', {})).not.toThrow();
    expect(mediaSession.metadata?.init.artwork?.[0]?.src).toBe('https://pages.test/api/v1/cover/local%3Aone');
  });
});
