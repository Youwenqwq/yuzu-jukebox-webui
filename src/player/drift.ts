import type { Playback } from '../protocol/types';

const SEEK_THRESHOLD_MS = 150;
const RATE_THRESHOLD_MS = 30;
const UNCALIBRATED_DRIFT_MS = 1_000;
const MAX_RATE_ADJUSTMENT = 0.02;
const MIN_PLAYBACK_RATE = 0.98;
const MAX_PLAYBACK_RATE = 1.02;

export type PlayerIntent =
  | { type: 'seek'; ms: number }
  | { type: 'rate'; value: number };

/** Returns the authoritative playback position at a server-clock instant. */
export function shouldBePositionMs(playback: Playback, serverNowMs: number): number {
  if (!playback.playing) {
    return playback.position_ms;
  }

  return playback.position_ms + (serverNowMs - playback.updated_at) * playback.rate;
}

/**
 * Learns the audio device's stable position-reporting bias and corrects only
 * drift beyond that bias.
 */
export class DriftCorrector {
  private playback: Playback | null = null;
  private trackRef: string | null = null;
  private baselineMs: number | null = null;
  private correctionRate = 1;

  onPlayback(playback: Playback, serverNowMs: number): PlayerIntent[] {
    const nextTrackRef = playback.current?.track_ref ?? null;
    const trackChanged = nextTrackRef !== this.trackRef;

    this.playback = playback;

    if (!trackChanged) {
      return [];
    }

    this.trackRef = nextTrackRef;
    this.baselineMs = null;
    this.correctionRate = 1;

    if (nextTrackRef === null || !playback.playing) {
      return [];
    }

    return [{ type: 'seek', ms: shouldBePositionMs(playback, serverNowMs) }];
  }

  sample(positionMs: number, settled: boolean, serverNowMs: number): PlayerIntent[] {
    const playback = this.playback;
    if (playback?.current === null || playback === null || !playback.playing || !settled) {
      return [];
    }

    const shouldBeMs = shouldBePositionMs(playback, serverNowMs);
    const driftMs = positionMs - shouldBeMs;

    if (this.baselineMs === null) {
      if (Math.abs(driftMs) > UNCALIBRATED_DRIFT_MS) {
        return [{ type: 'seek', ms: shouldBeMs }];
      }

      this.baselineMs = driftMs;
      return [];
    }

    const deviationMs = driftMs - this.baselineMs;
    const absoluteDeviationMs = Math.abs(deviationMs);

    if (absoluteDeviationMs > SEEK_THRESHOLD_MS) {
      const intents: PlayerIntent[] = [
        { type: 'seek', ms: shouldBeMs + this.baselineMs },
      ];
      this.baselineMs = null;
      this.restoreNormalRate(intents);
      return intents;
    }

    if (absoluteDeviationMs >= RATE_THRESHOLD_MS) {
      const desiredRate = Math.min(
        MAX_PLAYBACK_RATE,
        Math.max(
          MIN_PLAYBACK_RATE,
          1 - (deviationMs / SEEK_THRESHOLD_MS) * MAX_RATE_ADJUSTMENT,
        ),
      );
      if (desiredRate === this.correctionRate) {
        return [];
      }

      this.correctionRate = desiredRate;
      return [{ type: 'rate', value: desiredRate }];
    }

    const intents: PlayerIntent[] = [];
    this.restoreNormalRate(intents);
    return intents;
  }

  reset(): void {
    this.playback = null;
    this.trackRef = null;
    this.baselineMs = null;
    this.correctionRate = 1;
  }

  private restoreNormalRate(intents: PlayerIntent[]): void {
    if (this.correctionRate === 1) {
      return;
    }

    this.correctionRate = 1;
    intents.push({ type: 'rate', value: 1 });
  }
}
