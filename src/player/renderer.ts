import { httpBase } from '../config';
import type { ClockSync } from '../protocol/clock';
import type { Playback } from '../protocol/types';
import {
  DriftCorrector,
  shouldBePositionMs,
  type PlayerIntent,
} from './drift';

const normalizedHttpBase = httpBase.replace(/\/$/, '');
const absoluteUrlPattern = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

/**
 * 预定起播时刻的迟到容忍。定时器在后台标签页会被节流到 ≥1s，
 * 迟到超过这个量就先对齐再出声——否则这段迟到会被 DriftCorrector
 * 当成设备基线学进去，污染整首曲子的对齐。
 */
const LEAD_START_TOLERANCE_MS = 150;

function resolveStreamUrl(streamUrl: string): string {
  if (absoluteUrlPattern.test(streamUrl) || normalizedHttpBase.length === 0) {
    return streamUrl;
  }

  return `${normalizedHttpBase}/${streamUrl.replace(/^\//, '')}`;
}

export class AudioRenderer {
  private playback: Playback | null = null;
  private loadedTrackRef: string | null = null;
  private loadedStreamUrl: string | null = null;
  private pendingReadyHandler: EventListener | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private mediaFailed = false;

  constructor(
    private readonly audio: HTMLAudioElement,
    private readonly clock: ClockSync,
    private readonly corrector = new DriftCorrector(),
  ) {
    this.audio.addEventListener('error', () => {
      this.mediaFailed = true;
    });
    // 起播提前量窗口靠预缓冲兑现：preload 必须是 auto，
    // 只取元数据的话到点仍然没有可播的数据。
    this.audio.preload = 'auto';
  }

  render(playback: Playback): void {
    // 任何新状态都作废上一条预定起播：连切时定时器叠加会让旧曲目在
    // 新曲目上开声。清理点还有 current 为 null（离房渲染空闲态）。
    this.cancelStartTimer();

    const current = playback.current;
    const streamUrl = current?.stream_url
      ? resolveStreamUrl(current.stream_url)
      : null;
    // Same physical track with a refreshed ticket: keep the loaded media.
    // Stream tickets are reusable within TTL; only a media failure forces reload.
    const mediaChanged = current !== null
      && (current.track_ref !== this.loadedTrackRef || this.mediaFailed);

    if (
      current !== null
      && streamUrl !== null
      && current.track_ref === this.loadedTrackRef
      && streamUrl !== this.loadedStreamUrl
      && !this.mediaFailed
    ) {
      // Remember the freshest ticket URL without tearing down <audio>.
      this.loadedStreamUrl = streamUrl;
    }

    const initialIntents = this.corrector.onPlayback(
      playback,
      this.clock.serverNow(),
    );
    this.playback = playback;

    if (current === null) {
      this.cancelPendingReadyHandler();
      this.loadedTrackRef = null;
      this.loadedStreamUrl = null;
      this.mediaFailed = false;
      this.audio.pause();
      const hadSource = this.audio.src.length > 0;
      this.audio.src = '';
      if (hadSource) {
        this.audio.load();
      }
      return;
    }

    let needsInitialSeek = false;
    for (const intent of initialIntents) {
      if (intent.type === 'seek') {
        needsInitialSeek = true;
      }
    }

    if (mediaChanged) {
      this.cancelPendingReadyHandler();
      this.loadedTrackRef = current.track_ref;
      this.loadedStreamUrl = streamUrl;
      this.mediaFailed = false;

      if (streamUrl === null) {
        this.audio.pause();
        const hadSource = this.audio.src.length > 0;
        this.audio.src = '';
        if (hadSource) {
          this.audio.load();
        }
      } else {
        this.audio.src = streamUrl;

        if (needsInitialSeek && playback.playing) {
          const expectedTrackRef = current.track_ref;
          const readyHandler: EventListener = () => {
            this.cancelPendingReadyHandler();
            const latest = this.playback;
            if (
              latest?.current?.track_ref !== expectedTrackRef
              || !latest.playing
            ) {
              return;
            }

            this.audio.currentTime = Math.max(
              0,
              shouldBePositionMs(latest, this.clock.serverNow()) / 1_000,
            );
          };
          this.pendingReadyHandler = readyHandler;
          this.audio.addEventListener('loadedmetadata', readyHandler);
          this.audio.addEventListener('canplay', readyHandler);
        }

        this.audio.load();
      }
    }

    // 起播提前量窗口（spec §2.2）：should_be < 0 表示本曲还有 |should_be| ms
    // 才开播。这段时间装载好、停在 0 待命，到点才出声——头部才完整。
    const shouldBeMs = shouldBePositionMs(playback, this.clock.serverNow());
    if (shouldBeMs < 0) {
      if (!this.audio.paused) {
        this.audio.pause();
      }
      // 同一 track_ref 被重新排上（电台复播）时媒体不重载，读数可能停在上一遍的尾部。
      if (this.audio.currentTime !== 0) {
        this.audio.currentTime = 0;
      }
      if (streamUrl !== null && playback.playing) {
        const expectedTrackRef = current.track_ref;
        this.startTimer = setTimeout(
          () => this.startLeadPlayback(expectedTrackRef),
          -shouldBeMs,
        );
      }
      // 窗口内不校偏：应播位置为负，无从对齐，也不能让基线学习看见这段静止。
      return;
    }

    if (streamUrl !== null && playback.playing) {
      if (mediaChanged || this.audio.paused) {
        void this.audio.play().catch(() => {
          // Autoplay and media failures are surfaced by the element. A later
          // playback render is the only source of a new stream URL.
        });
      }
    } else if (mediaChanged || !this.audio.paused) {
      this.audio.pause();
    }

    this.tick();
  }

  tick(): void {
    const playback = this.playback;
    if (playback === null) {
      return;
    }

    const settled = this.pendingReadyHandler === null
      && this.loadedStreamUrl !== null
      && !this.audio.seeking
      && this.audio.readyState >= 3;
    const intents = this.corrector.sample(
      this.audio.currentTime * 1_000,
      settled,
      this.clock.serverNow(),
    );
    this.applyIntents(intents);
  }

  /**
   * 用户手势后补一次起播：autoplay 策略拒绝 play() 的唯一恢复路径。
   * 起播提前量窗口内只保证定时器在位，不提前出声。
   */
  resumeAfterGesture(): void {
    const playback = this.playback;
    const current = playback?.current;
    if (!playback || !current || !playback.playing) {
      return;
    }
    if (this.audio.src.length === 0 || !this.audio.paused) {
      return;
    }

    const shouldBeMs = shouldBePositionMs(playback, this.clock.serverNow());
    if (shouldBeMs < 0) {
      if (this.startTimer === null) {
        const expectedTrackRef = current.track_ref;
        this.startTimer = setTimeout(
          () => this.startLeadPlayback(expectedTrackRef),
          -shouldBeMs,
        );
      }
      return;
    }

    void this.audio.play().catch(() => {
      // 手势仍被拒：下一次手势或下一条 playback.changed 再试。
    });
  }

  /** 预定起播时刻到达：曲目没换、仍在播才出声。 */
  private startLeadPlayback(expectedTrackRef: string): void {
    this.startTimer = null;
    const playback = this.playback;
    const current = playback?.current;
    if (!playback || !current || current.track_ref !== expectedTrackRef || !playback.playing) {
      return;
    }

    const shouldBeMs = shouldBePositionMs(playback, this.clock.serverNow());
    if (shouldBeMs > LEAD_START_TOLERANCE_MS) {
      this.audio.currentTime = shouldBeMs / 1_000;
    }

    void this.audio.play().catch(() => {
      // 自动播放策略拒绝：等下一次用户手势经 resumeAfterGesture 补起播。
    });
  }

  private applyIntents(intents: PlayerIntent[]): void {
    for (const intent of intents) {
      this.audio.currentTime = Math.max(0, intent.ms / 1_000);
    }
  }

  private cancelPendingReadyHandler(): void {
    const handler = this.pendingReadyHandler;
    if (handler === null) {
      return;
    }

    this.audio.removeEventListener('loadedmetadata', handler);
    this.audio.removeEventListener('canplay', handler);
    this.pendingReadyHandler = null;
  }

  private cancelStartTimer(): void {
    if (this.startTimer === null) {
      return;
    }

    clearTimeout(this.startTimer);
    this.startTimer = null;
  }
}
