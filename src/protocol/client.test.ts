import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Envelope } from './types';
import { YuzuError } from './types';

vi.mock('../config', () => ({ wsBase: 'ws://default.test' }));

import type { TransportLike } from './client';
import { YuzuClient } from './client';

class MockTransport implements TransportLike {
  readonly sent: Envelope[] = [];
  closeCalls = 0;
  onSend: ((envelope: Envelope) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onopen: ((event?: unknown) => void) | null = null;
  onclose: ((event?: unknown) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;

  send(data: string): void {
    const envelope = JSON.parse(data) as Envelope;
    this.sent.push(envelope);
    this.onSend?.(envelope);
  }

  close(): void {
    this.closeCalls += 1;
  }

  open(): void {
    this.onopen?.();
  }

  receive(envelope: Envelope): void {
    this.onmessage?.({ data: JSON.stringify(envelope) });
  }

  disconnect(): void {
    this.onclose?.();
  }

  fail(): void {
    this.onerror?.();
  }
}

function answerPings(transport: MockTransport): void {
  transport.onSend = (envelope) => {
    if (envelope.type !== 'ping') {
      return;
    }
    const data = envelope.data;
    if (
      data === null ||
      typeof data !== 'object' ||
      !('client_time' in data) ||
      typeof data.client_time !== 'number'
    ) {
      throw new Error('invalid ping');
    }
    transport.receive({
      type: 'pong',
      ref: envelope.ref,
      data: { client_time: data.client_time, server_time: data.client_time },
    });
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 12; turn += 1) {
    await Promise.resolve();
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('YuzuClient', () => {
  it('routes responses by ref, rejects protocol errors, and dispatches broadcasts', async () => {
    const transport = new MockTransport();
    answerPings(transport);
    const client = new YuzuClient({
      url: 'ws://unit.test/ws/v1',
      createTransport: () => transport,
    });
    const statuses: string[] = [];
    client.onStatusChange((status) => {
      statuses.push(status);
    });

    const connecting = client.connect();
    expect(client.status).toBe('connecting');
    transport.open();
    await connecting;
    expect(client.clock.synced).toBe(true);
    expect(client.status).toBe('online');
    expect(statuses).toEqual(['connecting', 'online']);

    transport.onSend = null;
    const first = client.request<{ result: number }>('first');
    const second = client.request<{ result: number }>('second', { value: 2 });
    const firstEnvelope = transport.sent.at(-2);
    const secondEnvelope = transport.sent.at(-1);
    expect(firstEnvelope).toEqual({ type: 'first', ref: '6', data: {} });
    expect(secondEnvelope).toEqual({ type: 'second', ref: '7', data: { value: 2 } });

    transport.receive({ type: 'ack', ref: secondEnvelope?.ref, data: { result: 22 } });
    transport.receive({ type: 'ack', ref: firstEnvelope?.ref, data: { result: 11 } });
    await expect(first).resolves.toEqual({ result: 11 });
    await expect(second).resolves.toEqual({ result: 22 });

    const rejected = client.request('will.fail');
    const rejectedEnvelope = transport.sent.at(-1);
    transport.receive({
      type: 'error',
      ref: rejectedEnvelope?.ref,
      data: { code: 'forbidden', message: 'denied' },
    });
    await expect(rejected).rejects.toEqual(
      expect.objectContaining<Partial<YuzuError>>({
        name: 'YuzuError',
        code: 'forbidden',
        message: 'denied',
      }),
    );

    const broadcasts: unknown[] = [];
    const unsubscribe = client.onBroadcast('queue.snapshot', (data) => {
      broadcasts.push(data);
    });
    transport.receive({ type: 'queue.snapshot', data: { revision: 1, part: 0, items: [], done: true } });
    transport.receive({
      type: 'queue.snapshot',
      ref: 'unknown',
      data: { revision: 1, part: 0, items: [], done: true },
    });
    unsubscribe();
    transport.receive({ type: 'queue.snapshot', data: { revision: 2, part: 0, items: [], done: true } });
    expect(broadcasts).toEqual([
      { revision: 1, part: 0, items: [], done: true },
      { revision: 1, part: 0, items: [], done: true },
    ]);

    client.close();
    expect(client.status).toBe('offline');
    expect(transport.closeCalls).toBe(1);
  });

  it('rejects requests immediately until the socket is open', async () => {
    const client = new YuzuClient({
      url: 'ws://unit.test/ws/v1',
      createTransport: () => new MockTransport(),
    });

    await expect(client.request('anything')).rejects.toEqual(
      expect.objectContaining<Partial<YuzuError>>({
        code: 'internal',
        message: 'not connected',
      }),
    );
  });

  it('authenticates through both supported websocket payloads', async () => {
    const transport = new MockTransport();
    answerPings(transport);
    const client = new YuzuClient({ createTransport: () => transport });
    const connecting = client.connect();
    transport.open();
    await connecting;
    transport.onSend = null;

    const guest = client.authGuest('Yuzu');
    const guestEnvelope = transport.sent.at(-1);
    expect(guestEnvelope?.data).toEqual({ name: 'Yuzu', password: '' });
    transport.receive({
      type: 'auth.ok',
      ref: guestEnvelope?.ref,
      data: {
        identity: {
          id: 'g_1',
          name: 'Yuzu',
          kind: 'guest',
          roles: ['listener', 'requester'],
        },
        session_token: 'guest-token',
      },
    });
    await expect(guest).resolves.toEqual(expect.objectContaining({ session_token: 'guest-token' }));

    const token = client.authToken('existing-token');
    const tokenEnvelope = transport.sent.at(-1);
    expect(tokenEnvelope?.data).toEqual({ session_token: 'existing-token' });
    transport.receive({
      type: 'auth.ok',
      ref: tokenEnvelope?.ref,
      data: {
        identity: {
          id: 'o_1',
          name: 'Owner',
          kind: 'oidc',
          roles: ['listener'],
        },
        session_token: 'existing-token',
      },
    });
    await expect(token).resolves.toEqual(expect.objectContaining({ session_token: 'existing-token' }));
    client.close();
  });

  it('backs off at 1s, 2s, 5s, then 10s and resets the session after syncing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const transports: MockTransport[] = [];
    const client = new YuzuClient({
      createTransport: () => {
        const transport = new MockTransport();
        answerPings(transport);
        transports.push(transport);
        return transport;
      },
    });
    const statuses: string[] = [];
    client.onStatusChange((status) => {
      statuses.push(status);
    });
    const sessionReset = vi.fn();
    let finishReset!: () => void;
    const didReset = new Promise<void>((resolve) => {
      finishReset = resolve;
    });
    client.onSessionReset(() => {
      sessionReset();
      finishReset();
    });

    const connecting = client.connect();
    transports[0]?.open();
    await connecting;
    transports[0]?.disconnect();
    expect(client.status).toBe('reconnecting');

    await vi.advanceTimersByTimeAsync(999);
    expect(transports).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(transports).toHaveLength(2);
    transports[1]?.fail();
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(1_999);
    expect(transports).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(transports).toHaveLength(3);
    transports[2]?.fail();
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(4_999);
    expect(transports).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(transports).toHaveLength(4);
    transports[3]?.fail();
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(9_999);
    expect(transports).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(transports).toHaveLength(5);
    transports[4]?.fail();
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(transports).toHaveLength(6);
    transports[5]?.open();
    await didReset;

    expect(client.status).toBe('online');
    expect(sessionReset).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(['connecting', 'online', 'reconnecting', 'online']);
    client.close();
  });

  it('sends periodic keepalive pings and reconnects after a keepalive failure', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const transports: MockTransport[] = [];
    const client = new YuzuClient({
      createTransport: () => {
        const transport = new MockTransport();
        answerPings(transport);
        transports.push(transport);
        return transport;
      },
    });

    const connecting = client.connect();
    transports[0]?.open();
    await connecting;
    const afterSync = transports[0]?.sent.length ?? 0;

    await vi.advanceTimersByTimeAsync(14_999);
    expect(transports[0]?.sent.length).toBe(afterSync);

    await vi.advanceTimersByTimeAsync(1);
    expect(transports[0]?.sent.length).toBe(afterSync + 1);
    expect(transports[0]?.sent.at(-1)?.type).toBe('ping');
    expect(client.status).toBe('online');

    transports[0]!.onSend = (envelope) => {
      if (envelope.type === 'ping') {
        // Drop keepalive replies so the timeout forces a reconnect.
      }
    };
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(10_000);
    await flushMicrotasks();

    expect(client.status).toBe('reconnecting');
    expect(transports[0]?.closeCalls).toBe(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(transports).toHaveLength(2);
    transports[1]?.open();
    await flushMicrotasks();
    expect(client.status).toBe('online');
    client.close();
  });
});
