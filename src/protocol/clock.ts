import { YuzuError } from './types';


export type ClockRequest = (type: string, data?: unknown) => Promise<unknown>;

/** Estimates server wall-clock time from the lowest-latency ping sample. */
export class ClockSync {
  private offsetMs = 0;
  private hasSynced = false;

  constructor(
    private readonly sendRequest: ClockRequest,
    private readonly now: () => number = Date.now,
  ) {}

  get offset(): number {
    return this.offsetMs;
  }

  get synced(): boolean {
    return this.hasSynced;
  }

  serverNow(): number {
    return this.now() + this.offsetMs;
  }

  async sync(rounds = 5): Promise<void> {
    if (!Number.isInteger(rounds) || rounds < 1) {
      throw new YuzuError('bad_request', 'clock sync rounds must be a positive integer');
    }

    let bestRtt = Number.POSITIVE_INFINITY;
    let bestOffset = 0;

    for (let round = 0; round < rounds; round += 1) {
      const clientTime = this.now();
      const raw = await this.sendRequest('ping', { client_time: clientTime });
      const receivedAt = this.now();
      if (
        raw === null ||
        typeof raw !== 'object' ||
        !('client_time' in raw) ||
        typeof raw.client_time !== 'number' ||
        !('server_time' in raw) ||
        typeof raw.server_time !== 'number'
      ) {
        throw new YuzuError('internal', 'invalid pong response');
      }

      const rtt = receivedAt - raw.client_time;
      const offset = raw.server_time + rtt / 2 - receivedAt;
      if (rtt < bestRtt) {
        bestRtt = rtt;
        bestOffset = offset;
      }
    }

    this.offsetMs = bestOffset;
    this.hasSynced = true;
  }
}
