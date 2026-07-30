import { describe, expect, it } from 'vitest';
import type { Playback } from '../protocol/types';
import { DriftCorrector, shouldBePositionMs } from './drift';

interface PlaybackOptions {
  trackRef?: string | null;
  playing?: boolean;
  positionMs?: number;
  updatedAt?: number;
  rate?: number;
}

function makePlayback({
  trackRef = 'local:one',
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
          stream_url: `/stream/v1/${trackRef}`,
        },
    position_ms: positionMs,
    updated_at: updatedAt,
    playing,
    rate,
  };
}

describe('shouldBePositionMs', () => {
  it('advances a playing position by server time and the authoritative rate', () => {
    const playback = makePlayback({
      positionMs: 5_000,
      updatedAt: 1_000,
      rate: 1.5,
    });

    expect(shouldBePositionMs(playback, 1_400)).toBe(5_600);
  });

  it('keeps a paused position fixed regardless of elapsed server time', () => {
    const playback = makePlayback({
      playing: false,
      positionMs: 5_000,
      updatedAt: 1_000,
      rate: 1.5,
    });

    expect(shouldBePositionMs(playback, 50_000)).toBe(5_000);
  });

  it('stays negative inside the start-lead window and crosses zero at the scheduled instant', () => {
    const playback = makePlayback({ positionMs: -600, updatedAt: 1_000 });

    expect(shouldBePositionMs(playback, 1_000)).toBe(-600);
    expect(shouldBePositionMs(playback, 1_400)).toBe(-200);
    expect(shouldBePositionMs(playback, 1_600)).toBe(0);
    expect(shouldBePositionMs(playback, 1_900)).toBe(300);
  });
});

describe('DriftCorrector', () => {
  it('returns the initial alignment seek when a playing track changes', () => {
    const corrector = new DriftCorrector();
    const playback = makePlayback({
      positionMs: 5_000,
      updatedAt: 1_000,
      rate: 1.5,
    });

    expect(corrector.onPlayback(playback, 1_400)).toEqual([
      { type: 'seek', ms: 5_600 },
    ]);
  });

  it('does not learn from an unsettled sample', () => {
    const corrector = new DriftCorrector();
    const playback = makePlayback();
    corrector.onPlayback(playback, 1_000);

    expect(corrector.sample(9_800, false, 1_000)).toEqual([]);
    expect(corrector.sample(9_500, true, 1_000)).toEqual([]);
    expect(corrector.sample(9_700, true, 1_000)).toEqual([
      { type: 'seek', ms: 9_500 },
    ]);
  });

  it('realigns an unlearned drift over one second and remains pending learning', () => {
    const corrector = new DriftCorrector();
    const playback = makePlayback();
    corrector.onPlayback(playback, 1_000);

    expect(corrector.sample(8_500, true, 1_000)).toEqual([
      { type: 'seek', ms: 10_000 },
    ]);
    expect(corrector.sample(9_700, true, 1_000)).toEqual([]);
    expect(corrector.sample(9_900, true, 1_000)).toEqual([
      { type: 'seek', ms: 9_700 },
    ]);
  });

  it('seeks with the learned baseline and relearns after the correction settles', () => {
    const corrector = new DriftCorrector();
    const playback = makePlayback();
    corrector.onPlayback(playback, 1_000);

    expect(corrector.sample(9_800, true, 1_000)).toEqual([]);
    expect(corrector.sample(10_000, true, 1_000)).toEqual([
      { type: 'seek', ms: 9_800 },
    ]);

    expect(corrector.sample(9_500, false, 1_000)).toEqual([]);
    expect(corrector.sample(9_700, true, 1_000)).toEqual([]);
    expect(corrector.sample(9_900, true, 1_000)).toEqual([
      { type: 'seek', ms: 9_700 },
    ]);
  });

  it('clears the learned baseline when track_ref changes', () => {
    const corrector = new DriftCorrector();
    corrector.onPlayback(makePlayback({ trackRef: 'local:one' }), 1_000);
    expect(corrector.sample(9_800, true, 1_000)).toEqual([]);

    const next = makePlayback({
      trackRef: 'local:two',
      positionMs: 20_000,
    });
    expect(corrector.onPlayback(next, 1_000)).toEqual([
      { type: 'seek', ms: 20_000 },
    ]);
    expect(corrector.sample(19_500, true, 1_000)).toEqual([]);
    expect(corrector.sample(19_700, true, 1_000)).toEqual([
      { type: 'seek', ms: 19_500 },
    ]);
  });

  it('leaves deviations within the 150ms band untouched and never changes rate', () => {
    const corrector = new DriftCorrector();
    corrector.onPlayback(makePlayback(), 1_000);
    // 基线 = 0（读数与应播位置一致）。
    corrector.sample(10_000, true, 1_000);

    // 纯 seek，不调速（spec §2.2/§9.2）：150ms 以内一个 intent 都不发。
    expect(corrector.sample(10_075, true, 1_000)).toEqual([]);
    expect(corrector.sample(9_925, true, 1_000)).toEqual([]);
    expect(corrector.sample(10_150, true, 1_000)).toEqual([]);
    expect(corrector.sample(9_850, true, 1_000)).toEqual([]);

    // 越过 150ms 才动，且是 seek 到 should_be + 基线。
    expect(corrector.sample(10_151, true, 1_000)).toEqual([
      { type: 'seek', ms: 10_000 },
    ]);
  });

  it('seeks in both directions once past the band, with the baseline applied', () => {
    const corrector = new DriftCorrector();
    corrector.onPlayback(makePlayback(), 1_000);
    // 基线 = -300ms（蓝牙等输出链路的读数少报）。
    expect(corrector.sample(9_700, true, 1_000)).toEqual([]);

    // 落后超出基线 200ms：seek 目标补上基线，听觉位置一次到位。
    expect(corrector.sample(9_500, true, 1_000)).toEqual([
      { type: 'seek', ms: 9_700 },
    ]);
  });

  it('produces no intents while paused or without a current track', () => {
    const corrector = new DriftCorrector();
    const playing = makePlayback();
    corrector.onPlayback(playing, 1_000);
    corrector.sample(10_000, true, 1_000);
    corrector.sample(10_075, true, 1_000);

    expect(corrector.onPlayback(
      makePlayback({ playing: false }),
      50_000,
    )).toEqual([]);
    expect(corrector.sample(999_000, true, 50_000)).toEqual([]);

    expect(corrector.onPlayback(
      makePlayback({ trackRef: null, playing: false }),
      50_000,
    )).toEqual([]);
    expect(corrector.sample(999_000, true, 50_000)).toEqual([]);
  });

  it('skips the initial alignment seek inside the start-lead window', () => {
    const corrector = new DriftCorrector();
    const playback = makePlayback({ positionMs: -600, updatedAt: 1_000 });

    expect(corrector.onPlayback(playback, 1_100)).toEqual([]);
  });

  it('neither corrects nor learns a baseline inside the start-lead window', () => {
    const corrector = new DriftCorrector();
    const playback = makePlayback({ positionMs: -600, updatedAt: 1_000 });
    corrector.onPlayback(playback, 1_000);

    // 窗口内媒体停在 0 待命：这些读数既不该触发 seek，也不该被当成设备基线。
    expect(corrector.sample(0, true, 1_000)).toEqual([]);
    expect(corrector.sample(0, true, 1_500)).toEqual([]);

    // 越过预定起播时刻后才开始学基线，学到的是真实偏置（-20ms）而非窗口静止量。
    expect(corrector.sample(180, true, 1_800)).toEqual([]);
    expect(corrector.sample(500, true, 1_800)).toEqual([
      { type: 'seek', ms: 180 },
    ]);
  });
});
