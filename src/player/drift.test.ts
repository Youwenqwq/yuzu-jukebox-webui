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

  it('maps medium deviations linearly in the chasing direction and restores rate 1 once', () => {
    const corrector = new DriftCorrector();
    corrector.onPlayback(makePlayback(), 1_000);
    corrector.sample(10_000, true, 1_000);

    expect(corrector.sample(10_075, true, 1_000)).toEqual([
      { type: 'rate', value: 0.99 },
    ]);
    expect(corrector.sample(10_075, true, 1_000)).toEqual([]);
    expect(corrector.sample(9_925, true, 1_000)).toEqual([
      { type: 'rate', value: 1.01 },
    ]);
    expect(corrector.sample(10_020, true, 1_000)).toEqual([
      { type: 'rate', value: 1 },
    ]);
    expect(corrector.sample(10_020, true, 1_000)).toEqual([]);

    expect(corrector.sample(10_150, true, 1_000)).toEqual([
      { type: 'rate', value: 0.98 },
    ]);
    expect(corrector.sample(9_850, true, 1_000)).toEqual([
      { type: 'rate', value: 1.02 },
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
});
