import { wsBase } from '../config';
import { ClockSync } from './clock';
import type { AuthOk, Envelope } from './types';
import { YuzuError } from './types';

export type ConnStatus = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'offline';

export interface TransportLike {
  send(data: string): void;
  close(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onopen: ((event?: unknown) => void) | null;
  onclose: ((event?: unknown) => void) | null;
  onerror: ((event?: unknown) => void) | null;
}

export interface YuzuClientOptions {
  url?: string;
  createTransport?: (url: string) => TransportLike;
}

interface PendingRequest {
  resolve(data: unknown): void;
  reject(error: YuzuError): void;
}

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000] as const;
/** App-layer keepalive: keeps proxies from idle-closing silent WS links. */
const KEEPALIVE_INTERVAL_MS = 15_000;
const KEEPALIVE_TIMEOUT_MS = 10_000;

type TimerHandle = number | NodeJS.Timeout;

export class YuzuClient {
  private readonly url: string;
  private readonly createTransport: (url: string) => TransportLike;
  private readonly clockValue: ClockSync;
  private statusValue: ConnStatus = 'idle';
  private transport: TransportLike | null = null;
  private transportOpen = false;
  private nextRef = 1;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly statusCallbacks = new Set<(status: ConnStatus) => void>();
  private readonly broadcastCallbacks = new Map<string, Set<(data: never) => void>>();
  private readonly sessionResetCallbacks = new Set<() => void | Promise<void>>();
  private connectTask: Promise<void> | null = null;
  private abortAttempt: ((error: YuzuError) => void) | null = null;
  private reconnectTimer: TimerHandle | null = null;
  private keepaliveTimer: TimerHandle | null = null;
  private keepaliveInFlight = false;
  private reconnectStep = 0;
  private intentionallyClosed = false;

  constructor(opts: YuzuClientOptions = {}) {
    this.url = opts.url ?? `${wsBase}/ws/v1`;
    this.createTransport =
      opts.createTransport ??
      ((url) => new WebSocket(url) as unknown as TransportLike);
    this.clockValue = new ClockSync((type, data) => this.request(type, data));
  }

  get clock(): ClockSync {
    return this.clockValue;
  }

  get status(): ConnStatus {
    return this.statusValue;
  }

  onStatusChange(callback: (status: ConnStatus) => void): () => void {
    this.statusCallbacks.add(callback);
    return () => {
      this.statusCallbacks.delete(callback);
    };
  }

  connect(): Promise<void> {
    if (this.statusValue === 'online') {
      return Promise.resolve();
    }
    if (this.connectTask !== null) {
      return this.connectTask;
    }

    this.intentionallyClosed = false;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.setStatus('connecting');

    const task = this.connectInitially();
    this.connectTask = task;
    void task.then(
      () => {
        if (this.connectTask === task) {
          this.connectTask = null;
        }
      },
      () => {
        if (this.connectTask === task) {
          this.connectTask = null;
        }
      },
    );
    return task;
  }

  authGuest(name: string, password?: string): Promise<AuthOk> {
    return this.request<AuthOk>('auth', { name, password: password ?? '' });
  }

  authToken(sessionToken: string): Promise<AuthOk> {
    return this.request<AuthOk>('auth', { session_token: sessionToken });
  }

  request<T = unknown>(type: string, data?: unknown): Promise<T> {
    const transport = this.transport;
    if (transport === null || !this.transportOpen) {
      return Promise.reject(new YuzuError('internal', 'not connected'));
    }

    const ref = String(this.nextRef);
    this.nextRef += 1;
    const envelope: Envelope = { type, ref, data: data ?? {} };

    return new Promise<T>((resolve, reject) => {
      this.pending.set(ref, {
        resolve: (responseData) => {
          resolve(responseData as T);
        },
        reject,
      });

      try {
        transport.send(JSON.stringify(envelope));
      } catch (error) {
        this.pending.delete(ref);
        reject(this.asYuzuError(error, 'failed to send request'));
      }
    });
  }

  onBroadcast(type: string, callback: (data: never) => void): () => void {
    let callbacks = this.broadcastCallbacks.get(type);
    if (callbacks === undefined) {
      callbacks = new Set();
      this.broadcastCallbacks.set(type, callbacks);
    }
    callbacks.add(callback);

    return () => {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.broadcastCallbacks.delete(type);
      }
    };
  }

  onSessionReset(callback: () => void | Promise<void>): void {
    this.sessionResetCallbacks.add(callback);
  }

  close(): void {
    this.intentionallyClosed = true;
    this.reconnectStep = 0;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopKeepalive();

    const error = new YuzuError('internal', 'not connected');
    const abortAttempt = this.abortAttempt;
    this.abortAttempt = null;
    abortAttempt?.(error);

    const transport = this.transport;
    if (transport !== null) {
      this.discardTransport(transport, true);
    } else {
      this.rejectPending(error);
    }
    this.setStatus('offline');
  }

  private async connectInitially(): Promise<void> {
    try {
      const transport = await this.openAndSync();
      if (this.transport !== transport || !this.transportOpen || this.intentionallyClosed) {
        throw new YuzuError('internal', 'not connected');
      }
      this.reconnectStep = 0;
      this.setStatus('online');
    } catch (error) {
      const transport = this.transport;
      if (transport !== null) {
        this.discardTransport(transport, true);
      }
      const connectionError = this.asYuzuError(error, 'connection failed');
      if (!this.intentionallyClosed) {
        this.scheduleReconnect();
      }
      throw connectionError;
    }
  }

  private openAndSync(): Promise<TransportLike> {
    let transport: TransportLike;
    try {
      transport = this.createTransport(this.url);
    } catch (error) {
      return Promise.reject(this.asYuzuError(error, 'connection failed'));
    }

    this.transport = transport;
    this.transportOpen = false;

    return new Promise<TransportLike>((resolve, reject) => {
      let settled = false;
      let connected = false;
      let syncing = false;

      const fail = (error: YuzuError): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (this.abortAttempt === fail) {
          this.abortAttempt = null;
        }
        reject(error);
      };
      this.abortAttempt = fail;

      transport.onmessage = (event) => {
        if (this.transport === transport) {
          this.routeMessage(event.data);
        }
      };
      transport.onopen = () => {
        if (this.transport !== transport || settled || syncing) {
          return;
        }
        this.transportOpen = true;
        syncing = true;
        void this.clockValue.sync().then(
          () => {
            if (this.transport !== transport || !this.transportOpen) {
              fail(new YuzuError('internal', 'not connected'));
              return;
            }
            connected = true;
            settled = true;
            if (this.abortAttempt === fail) {
              this.abortAttempt = null;
            }
            resolve(transport);
          },
          (error: unknown) => {
            fail(this.asYuzuError(error, 'clock sync failed'));
          },
        );
      };
      transport.onerror = () => {
        if (!connected) {
          fail(new YuzuError('internal', 'connection failed'));
        }
      };
      transport.onclose = () => {
        if (this.transport !== transport) {
          return;
        }

        const wasConnected = connected;
        if (!settled) {
          fail(new YuzuError('internal', 'connection closed'));
        }
        this.detachTransport(transport);
        this.rejectPending(new YuzuError('internal', 'not connected'));

        if (wasConnected && !this.intentionallyClosed) {
          this.scheduleReconnect();
        }
      };
    });
  }

  private routeMessage(raw: unknown): void {
    let parsed: unknown;
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return;
    }

    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      !('type' in parsed) ||
      typeof parsed.type !== 'string'
    ) {
      return;
    }
    const type = parsed.type;
    const ref = 'ref' in parsed ? parsed.ref : undefined;
    const data = 'data' in parsed ? parsed.data : undefined;

    if (typeof ref === 'string') {
      const pending = this.pending.get(ref);
      if (pending !== undefined) {
        this.pending.delete(ref);
        if (type === 'error') {
          let code = 'internal';
          let message = 'request failed';
          if (data !== null && typeof data === 'object') {
            if ('code' in data && typeof data.code === 'string') {
              code = data.code;
            }
            if ('message' in data && typeof data.message === 'string') {
              message = data.message;
            }
          }
          pending.reject(new YuzuError(code, message));
        } else {
          pending.resolve(data);
        }
        return;
      }
    }

    const callbacks = this.broadcastCallbacks.get(type);
    if (callbacks === undefined) {
      return;
    }
    for (const callback of [...callbacks]) {
      callback(data as never);
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionallyClosed || this.reconnectTimer !== null) {
      return;
    }

    this.stopKeepalive();
    this.setStatus('reconnecting');
    const delayIndex = Math.min(this.reconnectStep, RECONNECT_DELAYS_MS.length - 1);
    const delay = RECONNECT_DELAYS_MS[delayIndex];
    this.reconnectStep += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnect();
    }, delay);
  }

  private async reconnect(): Promise<void> {
    if (this.intentionallyClosed) {
      return;
    }

    let failed = false;
    try {
      const transport = await this.openAndSync();
      if (this.transport !== transport || !this.transportOpen || this.intentionallyClosed) {
        throw new YuzuError('internal', 'not connected');
      }

      this.reconnectStep = 0;
      this.setStatus('online');
      for (const callback of [...this.sessionResetCallbacks]) {
        if (this.intentionallyClosed || this.transport !== transport || !this.transportOpen) {
          break;
        }
        try {
          await callback();
        } catch {
          // One failed re-auth/re-join callback must not prevent the remaining owners from resetting.
        }
      }
    } catch {
      failed = true;
      const transport = this.transport;
      if (transport !== null) {
        this.discardTransport(transport, true);
      }
    }

    if (failed && !this.intentionallyClosed) {
      this.scheduleReconnect();
    }
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      void this.keepaliveTick();
    }, KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer !== null) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    this.keepaliveInFlight = false;
  }

  private async keepaliveTick(): Promise<void> {
    if (
      this.keepaliveInFlight ||
      this.intentionallyClosed ||
      this.statusValue !== 'online' ||
      this.transport === null ||
      !this.transportOpen
    ) {
      return;
    }

    const transport = this.transport;
    this.keepaliveInFlight = true;
    try {
      await this.withTimeout(this.clockValue.sync(1), KEEPALIVE_TIMEOUT_MS);
    } catch {
      if (
        this.intentionallyClosed ||
        this.transport !== transport ||
        this.statusValue !== 'online'
      ) {
        return;
      }
      this.discardTransport(transport, true);
      this.scheduleReconnect();
    } finally {
      this.keepaliveInFlight = false;
    }
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new YuzuError('internal', 'keepalive timeout'));
      }, timeoutMs);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private discardTransport(transport: TransportLike, close: boolean): void {
    if (this.transport !== transport) {
      return;
    }
    this.detachTransport(transport);
    this.rejectPending(new YuzuError('internal', 'not connected'));
    if (close) {
      try {
        transport.close();
      } catch {
        // The transport is already detached; close failures cannot change client state.
      }
    }
  }

  private detachTransport(transport: TransportLike): void {
    if (this.transport !== transport) {
      return;
    }
    this.transport = null;
    this.transportOpen = false;
    this.abortAttempt = null;
    transport.onmessage = null;
    transport.onopen = null;
    transport.onclose = null;
    transport.onerror = null;
  }

  private rejectPending(error: YuzuError): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private setStatus(status: ConnStatus): void {
    if (this.statusValue === status) {
      return;
    }
    this.statusValue = status;
    if (status === 'online') {
      this.startKeepalive();
    } else {
      this.stopKeepalive();
    }
    for (const callback of [...this.statusCallbacks]) {
      callback(status);
    }
  }

  private asYuzuError(error: unknown, fallbackMessage: string): YuzuError {
    if (error instanceof YuzuError) {
      return error;
    }
    if (error instanceof Error && error.message !== '') {
      return new YuzuError('internal', error.message);
    }
    return new YuzuError('internal', fallbackMessage);
  }
}
