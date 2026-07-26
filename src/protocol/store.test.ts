import { describe, expect, it, vi } from 'vitest';
import type { Envelope, Playback, QueueEntry, RadioState } from './types';

vi.mock('../config', () => ({ wsBase: 'ws://default.test' }));

import type { TransportLike } from './client';
import { YuzuClient } from './client';
import { SessionStore } from './store';

class MockTransport implements TransportLike {
  readonly sent: Envelope[] = [];
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

  close(): void {}

  open(): void {
    this.onopen?.();
  }

  receive(envelope: Envelope): void {
    this.onmessage?.({ data: JSON.stringify(envelope) });
  }

  disconnect(): void {
    this.onclose?.();
  }
}

const initialPlayback: Playback = {
  current: null,
  position_ms: 0,
  updated_at: 1_000,
  playing: false,
  rate: 1,
};

const queueEntry: QueueEntry = {
  entry_id: 'entry-1',
  track_ref: 'ncm:1',
  title: 'Track One',
  artist: 'Artist',
  duration_ms: 180_000,
  requested_by: 'g_1',
  added_at: 1_000,
};

const radio: RadioState = {
  source: 'ncm:playlist:1',
  description: 'Playlist',
  finite: true,
  shuffle: false,
  once: false,
};

function answerPings(transport: MockTransport): void {
  transport.onSend = (envelope) => {
    if (envelope.type !== 'ping') {
      return;
    }
    const ping = envelope.data;
    if (
      ping === null ||
      typeof ping !== 'object' ||
      !('client_time' in ping) ||
      typeof ping.client_time !== 'number'
    ) {
      throw new Error('invalid ping');
    }
    transport.receive({
      type: 'pong',
      ref: envelope.ref,
      data: { client_time: ping.client_time, server_time: ping.client_time },
    });
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve();
  }
}

async function createConnectedStore(): Promise<{
  client: YuzuClient;
  store: SessionStore;
  transport: MockTransport;
}> {
  const transport = new MockTransport();
  answerPings(transport);
  const client = new YuzuClient({ createTransport: () => transport });
  const store = new SessionStore(client);
  const connecting = client.connect();
  transport.open();
  await connecting;
  transport.onSend = null;
  return { client, store, transport };
}

async function joinRoom(store: SessionStore, transport: MockTransport): Promise<void> {
  const joining = store.join('room-1', 'secret');
  const joinEnvelope = transport.sent.at(-1);
  transport.receive({
    type: 'room.joined',
    ref: joinEnvelope?.ref,
    data: { room_id: 'room-1' },
  });
  await flushMicrotasks();
  transport.receive({ type: 'playback.changed', data: initialPlayback });
  transport.receive({ type: 'queue.changed', data: { queue: [queueEntry] } });
  transport.receive({ type: 'radio.changed', data: { radio } });
  transport.receive({
    type: 'listeners.changed',
    data: { listeners: [{ id: 'g_1', name: 'Yuzu' }] },
  });
  await joining;
}

describe('SessionStore', () => {
  it('waits for the ordered five-message join sequence', async () => {
    const { client, store, transport } = await createConnectedStore();
    let resolved = false;
    const joining = store.join('room-1', 'secret').then(() => {
      resolved = true;
    });
    const joinEnvelope = transport.sent.at(-1);
    expect(joinEnvelope).toEqual({
      type: 'room.join',
      ref: '6',
      data: { room_id: 'room-1', password: 'secret' },
    });

    transport.receive({
      type: 'room.joined',
      ref: joinEnvelope?.ref,
      data: { room_id: 'room-1' },
    });
    await flushMicrotasks();
    expect(store.getState().roomId).toBe('room-1');
    expect(resolved).toBe(false);

    transport.receive({ type: 'playback.changed', data: initialPlayback });
    transport.receive({ type: 'queue.changed', data: { queue: [queueEntry] } });
    transport.receive({ type: 'radio.changed', data: { radio } });
    await flushMicrotasks();
    expect(resolved).toBe(false);

    transport.receive({
      type: 'listeners.changed',
      data: { listeners: [{ id: 'g_1', name: 'Yuzu' }] },
    });
    await joining;
    expect(store.getState()).toEqual({
      roomId: 'room-1',
      playback: initialPlayback,
      queue: [queueEntry],
      radio,
      listeners: [{ id: 'g_1', name: 'Yuzu' }],
    });
    client.close();
  });

  it('keeps snapshot frames delivered in the same transport turn as room.joined', async () => {
    const { client, store, transport } = await createConnectedStore();
    const joining = store.join('room-1');
    const joinEnvelope = transport.sent.at(-1);

    transport.receive({
      type: 'room.joined',
      ref: joinEnvelope?.ref,
      data: { room_id: 'room-1' },
    });
    transport.receive({ type: 'playback.changed', data: initialPlayback });
    transport.receive({ type: 'queue.changed', data: { queue: [queueEntry] } });
    transport.receive({ type: 'radio.changed', data: { radio } });
    transport.receive({
      type: 'listeners.changed',
      data: { listeners: [{ id: 'g_1', name: 'Yuzu' }] },
    });

    await joining;
    expect(store.getState().roomId).toBe('room-1');
    expect(store.getState().queue).toEqual([queueEntry]);
    expect(store.getState().listeners).toEqual([{ id: 'g_1', name: 'Yuzu' }]);
    client.close();
  });

  it('fully replaces broadcast slices without changing unrelated references', async () => {
    const { client, store, transport } = await createConnectedStore();
    await joinRoom(store, transport);
    const beforePlayback = store.getState();
    const nextPlayback: Playback = {
      ...initialPlayback,
      position_ms: 2_500,
      updated_at: 2_000,
      playing: true,
    };

    transport.receive({ type: 'playback.changed', data: nextPlayback });
    const afterPlayback = store.getState();
    expect(afterPlayback).not.toBe(beforePlayback);
    expect(afterPlayback.playback).toEqual(nextPlayback);
    expect(afterPlayback.queue).toBe(beforePlayback.queue);
    expect(afterPlayback.listeners).toBe(beforePlayback.listeners);
    expect(afterPlayback.radio).toBe(beforePlayback.radio);

    const nextQueue = [{ ...queueEntry, entry_id: 'entry-2' }];
    transport.receive({ type: 'queue.changed', data: { queue: nextQueue } });
    const afterQueue = store.getState();
    expect(afterQueue.queue).toEqual(nextQueue);
    expect(afterQueue.queue).not.toBe(afterPlayback.queue);
    expect(afterQueue.playback).toBe(afterPlayback.playback);
    expect(afterQueue.listeners).toBe(afterPlayback.listeners);
    expect(afterQueue.radio).toBe(afterPlayback.radio);

    const nextListeners = [{ id: 'g_2', name: 'Pomelo' }];
    transport.receive({ type: 'listeners.changed', data: { listeners: nextListeners } });
    const afterListeners = store.getState();
    expect(afterListeners.listeners).toEqual(nextListeners);
    expect(afterListeners.playback).toBe(afterQueue.playback);
    expect(afterListeners.queue).toBe(afterQueue.queue);
    expect(afterListeners.radio).toBe(afterQueue.radio);

    transport.receive({ type: 'radio.changed', data: { radio: null } });
    const afterRadio = store.getState();
    expect(afterRadio.radio).toBeNull();
    expect(afterRadio.playback).toBe(afterListeners.playback);
    expect(afterRadio.queue).toBe(afterListeners.queue);
    expect(afterRadio.listeners).toBe(afterListeners.listeners);
    client.close();
  });

  it('uses singular and batch queue.add payloads and returns entry ids', async () => {
    const { client, store, transport } = await createConnectedStore();
    await joinRoom(store, transport);

    const single = store.addQueue(['ncm:2']);
    const singleEnvelope = transport.sent.at(-1);
    expect(singleEnvelope?.type).toBe('queue.add');
    expect(singleEnvelope?.data).toEqual({ room_id: 'room-1', track_ref: 'ncm:2' });
    transport.receive({
      type: 'ack',
      ref: singleEnvelope?.ref,
      data: { entry_ids: ['entry-2'] },
    });
    await expect(single).resolves.toEqual(['entry-2']);

    const batch = store.addQueue(['ncm:3', 'bili:BV1']);
    const batchEnvelope = transport.sent.at(-1);
    expect(batchEnvelope?.type).toBe('queue.add');
    expect(batchEnvelope?.data).toEqual({
      room_id: 'room-1',
      track_refs: ['ncm:3', 'bili:BV1'],
    });
    transport.receive({
      type: 'ack',
      ref: batchEnvelope?.ref,
      data: { entry_ids: ['entry-3', 'entry-4'] },
    });
    await expect(batch).resolves.toEqual(['entry-3', 'entry-4']);
    client.close();
  });

  it('sends every room action with the current room id and resets after leave', async () => {
    const { client, store, transport } = await createConnectedStore();
    await joinRoom(store, transport);

    const cases: Array<{
      run(): Promise<void>;
      type: string;
      data: unknown;
    }> = [
      {
        run: () => store.removeQueue('entry-1'),
        type: 'queue.remove',
        data: { room_id: 'room-1', entry_id: 'entry-1' },
      },
      {
        run: () => store.moveQueue('entry-1', 3),
        type: 'queue.move',
        data: { room_id: 'room-1', entry_id: 'entry-1', to_index: 3 },
      },
      { run: () => store.pause(), type: 'playback.pause', data: { room_id: 'room-1' } },
      { run: () => store.resume(), type: 'playback.resume', data: { room_id: 'room-1' } },
      {
        run: () => store.seek(12_345),
        type: 'playback.seek',
        data: { room_id: 'room-1', position_ms: 12_345 },
      },
      { run: () => store.skip(), type: 'playback.skip', data: { room_id: 'room-1' } },
      {
        run: () => store.radioPlay('ncm:playlist:9', true, true),
        type: 'radio.play',
        data: {
          room_id: 'room-1',
          source: 'ncm:playlist:9',
          shuffle: true,
          once: true,
        },
      },
      { run: () => store.radioStop(), type: 'radio.stop', data: { room_id: 'room-1' } },
    ];

    for (const action of cases) {
      const operation = action.run();
      const envelope = transport.sent.at(-1);
      expect(envelope?.type).toBe(action.type);
      expect(envelope?.data).toEqual(action.data);
      transport.receive({ type: 'ack', ref: envelope?.ref, data: {} });
      await operation;
    }

    const leaving = store.leave();
    const leaveEnvelope = transport.sent.at(-1);
    expect(leaveEnvelope?.data).toEqual({ room_id: 'room-1' });
    transport.receive({ type: 'room.left', ref: leaveEnvelope?.ref, data: {} });
    await leaving;
    expect(store.getState()).toEqual({
      roomId: null,
      playback: {
        current: null,
        position_ms: 0,
        updated_at: 0,
        playing: false,
        rate: 1,
      },
      queue: [],
      listeners: [],
      radio: null,
    });
    client.close();
  });

  it('returns to the idle state as soon as the connection drops', async () => {
    vi.useFakeTimers();
    const { client, store, transport } = await createConnectedStore();
    await joinRoom(store, transport);

    transport.disconnect();

    expect(client.status).toBe('reconnecting');
    expect(store.getState()).toEqual({
      roomId: null,
      playback: {
        current: null,
        position_ms: 0,
        updated_at: 0,
        playing: false,
        rate: 1,
      },
      queue: [],
      listeners: [],
      radio: null,
    });
    client.close();
    vi.useRealTimers();
  });
});
