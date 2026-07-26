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
  private mediaFailed = false;

  constructor(
    private readonly audio: HTMLAudioElement,
    private readonly clock: ClockSync,
    private readonly corrector = new DriftCorrector(),
  ) {
    this.audio.addEventListener('error', () => {
      this.mediaFailed = true;
    });
  }

  render(playback: Playback): void {
    const current = playback.current;
    const streamUrl = current?.stream_url
      ? resolveStreamUrl(current.stream_url)
      : null;
    const mediaChanged = current !== null
      && (
        current.track_ref !== this.loadedTrackRef
        || streamUrl !== this.loadedStreamUrl
        || this.mediaFailed
      );

    if (mediaChanged && current.track_ref === this.loadedTrackRef) {
      // A refreshed stream ticket reloads the same physical track. Treat the
      // reload like a fresh alignment, but never derive or retry a URL here.
      this.corrector.reset();
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
      this.audio.playbackRate = 1;
      if (hadSource) {
        this.audio.load();
      }
      return;
    }

    let needsInitialSeek = false;
    for (const intent of initialIntents) {
      if (intent.type === 'seek') {
        needsInitialSeek = true;
      } else {
        this.audio.playbackRate = intent.value;
      }
    }

    if (mediaChanged) {
      this.cancelPendingReadyHandler();
      this.loadedTrackRef = current.track_ref;
      this.loadedStreamUrl = streamUrl;
      this.mediaFailed = false;
      this.audio.playbackRate = 1;

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

  private applyIntents(intents: PlayerIntent[]): void {
    for (const intent of intents) {
      if (intent.type === 'seek') {
        this.audio.currentTime = Math.max(0, intent.ms / 1_000);
      } else {
        this.audio.playbackRate = intent.value;
      }
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
}
