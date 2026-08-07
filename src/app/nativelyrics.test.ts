import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LyricsResult } from '../api/types';
import type { CurrentTrack } from '../protocol/types';
import { buildLyricInfo, createNativeLyricsSync } from './nativelyrics';

function fakePlugin() {
  return {
    plugin: {
      setLyricInfo: vi.fn(async (_options: { lyricInfo: string | null }) => {}),
    },
  };
}

function makeTrack(overrides: Partial<CurrentTrack> = {}): CurrentTrack {
  return {
    entry_id: 'entry-one',
    track_ref: overrides.track_ref ?? 'ncm:2707450677',
    title: overrides.title ?? 'クリームで会いにいけますか',
    artist: overrides.artist ?? 'ずっと真夜中でいいのに。',
    duration_ms: overrides.duration_ms ?? 234_000,
    requested_by: 'user-one',
    added_at: 500,
    ...overrides,
  };
}

function makeLyrics(overrides: Partial<LyricsResult> = {}): LyricsResult {
  return {
    type: 'lrc',
    lrc: '[00:00.00]第一行\n[00:05.20]第二行',
    tlrc: '[00:00.00]译文一\n[00:05.20]译文二',
    ...overrides,
  };
}

describe('buildLyricInfo', () => {
  it('builds the lyricInfo JSON from track and raw LRC tracks', () => {
    const json = buildLyricInfo(makeTrack(), makeLyrics());
    expect(json).not.toBeNull();
    expect(JSON.parse(json!)).toEqual({
      songName: 'クリームで会いにいけますか',
      artist: 'ずっと真夜中でいいのに。',
      songId: 'ncm:2707450677',
      lyric: '[00:00.00]第一行\n[00:05.20]第二行',
      translationLyric: '[00:00.00]译文一\n[00:05.20]译文二',
    });
  });

  it('omits translationLyric when the track has none', () => {
    const json = buildLyricInfo(makeTrack(), makeLyrics({ tlrc: undefined }));
    expect(JSON.parse(json!)).not.toHaveProperty('translationLyric');
  });

  it('returns null for null lyrics or LRC without timestamps', () => {
    expect(buildLyricInfo(makeTrack(), null)).toBeNull();
    expect(buildLyricInfo(makeTrack(), makeLyrics({ lrc: 'no timestamps here' }))).toBeNull();
    expect(buildLyricInfo(makeTrack(), makeLyrics({ tlrc: 'no timestamps' }))).not.toBeNull();
  });
});

describe('createNativeLyricsSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears the previous lyric immediately on track change, then submits the new payload once', async () => {
    const { plugin } = fakePlugin();
    const fetchLyrics = vi.fn(async () => makeLyrics());
    const sync = createNativeLyricsSync(plugin, fetchLyrics);

    sync.sync(makeTrack()); // 曲目 A：先清旧词，拉取完成后推 payload
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchLyrics).toHaveBeenCalledWith('ncm:2707450677');
    expect(plugin.setLyricInfo).toHaveBeenNthCalledWith(1, { lyricInfo: null });
    expect(plugin.setLyricInfo).toHaveBeenNthCalledWith(2, {
      lyricInfo: expect.stringContaining('ncm:2707450677'),
    });

    sync.sync(makeTrack({ track_ref: 'ncm:42' })); // 切到 B：同样先清再推
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchLyrics).toHaveBeenCalledWith('ncm:42');
    expect(plugin.setLyricInfo).toHaveBeenNthCalledWith(3, { lyricInfo: null });
    expect(plugin.setLyricInfo).toHaveBeenNthCalledWith(4, {
      lyricInfo: expect.stringContaining('ncm:42'),
    });
  });

  it('is idempotent for the same track across store publishes', () => {
    const { plugin } = fakePlugin();
    const sync = createNativeLyricsSync(plugin, vi.fn(async () => makeLyrics()));

    sync.sync(makeTrack());
    sync.sync(makeTrack());
    sync.sync(makeTrack());

    expect(plugin.setLyricInfo).toHaveBeenCalledTimes(1);
  });

  it('keeps the removal state when lyrics are unavailable', async () => {
    const { plugin } = fakePlugin();
    const sync = createNativeLyricsSync(plugin, vi.fn(async () => null));

    sync.sync(makeTrack());
    await vi.advanceTimersByTimeAsync(0);

    expect(plugin.setLyricInfo).toHaveBeenCalledTimes(1);
    expect(plugin.setLyricInfo).toHaveBeenCalledWith({ lyricInfo: null });
  });

  it('does not submit stale lyrics when the track changed while fetching', async () => {
    const { plugin } = fakePlugin();
    const resolvers: Record<string, (value: LyricsResult) => void> = {};
    const fetchLyrics = vi.fn(
      (ref: string) =>
        new Promise<LyricsResult>((resolve) => {
          resolvers[ref] = resolve;
        }),
    );
    const sync = createNativeLyricsSync(plugin, fetchLyrics);

    sync.sync(makeTrack()); // 曲目 A：fetch 挂起
    sync.sync(makeTrack({ track_ref: 'ncm:42' })); // 切到 B：fetch 挂起
    resolvers['ncm:2707450677'](makeLyrics()); // A 的歌词晚到
    await vi.advanceTimersByTimeAsync(0);

    expect(plugin.setLyricInfo).toHaveBeenCalledTimes(2); // 两次移除，无 payload
    expect(plugin.setLyricInfo).toHaveBeenNthCalledWith(2, { lyricInfo: null });
  });

  it('retries once after 800ms when the first submit lands in the debounce window', async () => {
    const { plugin } = fakePlugin();
    const sync = createNativeLyricsSync(plugin, vi.fn(async () => makeLyrics()));

    sync.sync(makeTrack());
    await vi.advanceTimersByTimeAsync(0);
    expect(plugin.setLyricInfo).toHaveBeenCalledTimes(2); // 清 + 首提

    await vi.advanceTimersByTimeAsync(800);
    expect(plugin.setLyricInfo).toHaveBeenCalledTimes(3); // 幂等补交一次
    expect(plugin.setLyricInfo).toHaveBeenNthCalledWith(3, {
      lyricInfo: expect.stringContaining('クリームで会いにいけますか'),
    });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(plugin.setLyricInfo).toHaveBeenCalledTimes(3); // 只补一次
  });

  it('cancels the previous retry when the track changes before 800ms', async () => {
    const { plugin } = fakePlugin();
    const sync = createNativeLyricsSync(plugin, vi.fn(async () => makeLyrics()));

    sync.sync(makeTrack());
    await vi.advanceTimersByTimeAsync(0);
    sync.sync(makeTrack({ track_ref: 'ncm:42' })); // A 的补交未触发即切歌
    await vi.advanceTimersByTimeAsync(800);

    const payloads = plugin.setLyricInfo.mock.calls
      .filter(([o]) => o.lyricInfo !== null)
      .map(([o]) => o.lyricInfo as string);
    // A 首提 + B 首提 + B 补交；A 的补交已被取消
    expect(payloads.length).toBe(3);
    expect(payloads[0]).toContain('ncm:2707450677');
    expect(payloads[1]).toContain('ncm:42');
    expect(payloads[2]).toContain('ncm:42');
  });
});
