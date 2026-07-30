import type { Playback } from '../protocol/types';

const SEEK_THRESHOLD_MS = 150;
const UNCALIBRATED_DRIFT_MS = 1_000;

/**
 * 纯 seek，不调速（spec §2.2 / §9.2，与 yuzu-agent 一致）：变速会改变音高与听感，
 * 代价高于一次 150ms 以上的跳转。
 */
export type PlayerIntent = { type: 'seek'; ms: number };

/**
 * Returns the authoritative playback position at a server-clock instant.
 *
 * A negative result is the start-lead window: the track has not begun yet and
 * starts in `-result` ms. Callers MUST NOT seek there — the renderer holds the
 * media loaded and paused at 0 until the scheduled instant.
 */
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

  onPlayback(playback: Playback, serverNowMs: number): PlayerIntent[] {
    const nextTrackRef = playback.current?.track_ref ?? null;
    const trackChanged = nextTrackRef !== this.trackRef;

    this.playback = playback;

    if (!trackChanged) {
      return [];
    }

    this.trackRef = nextTrackRef;
    this.baselineMs = null;

    if (nextTrackRef === null || !playback.playing) {
      return [];
    }

    const shouldBeMs = shouldBePositionMs(playback, serverNowMs);
    if (shouldBeMs < 0) {
      // 起播提前量窗口：曲目还没开始，没有可对齐的位置。
      // 装载待命与到点出声由 AudioRenderer 负责。
      return [];
    }

    return [{ type: 'seek', ms: shouldBeMs }];
  }

  sample(positionMs: number, settled: boolean, serverNowMs: number): PlayerIntent[] {
    const playback = this.playback;
    if (playback?.current === null || playback === null || !playback.playing || !settled) {
      return [];
    }

    const shouldBeMs = shouldBePositionMs(playback, serverNowMs);
    if (shouldBeMs < 0) {
      // 起播提前量窗口内曲目未出声：既不纠正也不学基线——
      // 此刻的读数（停在 0）不是设备偏置，学进去会污染整首曲子的基线。
      return [];
    }

    const driftMs = positionMs - shouldBeMs;

    if (this.baselineMs === null) {
      if (Math.abs(driftMs) > UNCALIBRATED_DRIFT_MS) {
        return [{ type: 'seek', ms: shouldBeMs }];
      }

      this.baselineMs = driftMs;
      return [];
    }

    const deviationMs = driftMs - this.baselineMs;

    if (Math.abs(deviationMs) > SEEK_THRESHOLD_MS) {
      // 纠正 seek 补上读数偏差，落地后基线作废重学（残余抖动被新基线吸收）。
      const targetMs = shouldBeMs + this.baselineMs;
      this.baselineMs = null;
      return [{ type: 'seek', ms: targetMs }];
    }

    // ≤150ms 不动：这点偏差听不出来，seek 反而是可闻的。
    return [];
  }

  reset(): void {
    this.playback = null;
    this.trackRef = null;
    this.baselineMs = null;
  }
}
