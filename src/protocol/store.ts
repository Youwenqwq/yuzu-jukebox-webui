import type { YuzuClient } from './client';
import { QueueReplica, type QueuePatchPart, type QueueSnapshotPart } from './queue_protocol';
import type {
  Listener,
  ListenersChanged,
  Playback,
  QueueAddAck,
  QueueEntry,
  RadioChanged,
  RadioState,
  RoomJoined,
} from './types';
import { YuzuError } from './types';

export interface RoomState {
  roomId: string | null;
  playback: Playback;
  queue: QueueEntry[];
  queueRevision: number | null;
  listeners: Listener[];
  radio: RadioState | null;
}

type SnapshotType =
  | 'playback.changed'
  | 'queue.snapshot'
  | 'radio.changed'
  | 'listeners.changed';

type BufferedSnapshot =
  | { type: 'playback.changed'; data: Playback }
  | { type: 'queue.snapshot'; data: QueueSnapshotPart }
  | { type: 'queue.patch'; data: QueuePatchPart }
  | { type: 'radio.changed'; data: RadioChanged }
  | { type: 'listeners.changed'; data: ListenersChanged };

interface JoinTracker {
  joined: boolean;
  received: Set<SnapshotType>;
  buffered: BufferedSnapshot[];
  completion: Promise<void>;
  finish(): void;
  aborted: Promise<never>;
  abort(error: YuzuError): void;
}


export class SessionStore {
  private state: RoomState = {
    roomId: null,
    playback: {
      current: null,
      position_ms: 0,
      updated_at: 0,
      playing: false,
      rate: 1,
    },
    queue: [],
    queueRevision: null,
    listeners: [],
    radio: null,
  };
  private readonly subscribers = new Set<() => void>();
  private readonly queueReplica = new QueueReplica();
  private joining: JoinTracker | null = null;
  private queueSyncInFlight = false;

  constructor(private readonly client: YuzuClient) {
    client.onBroadcast('playback.changed', (data) => {
      this.applyPlayback(data as Playback);
    });
    client.onBroadcast('queue.snapshot', (data) => {
      this.applyQueueSnapshot(data as QueueSnapshotPart);
    });
    client.onBroadcast('queue.patch', (data) => {
      this.applyQueuePatch(data as QueuePatchPart);
    });
    client.onBroadcast('radio.changed', (data) => {
      this.applyRadio(data as RadioChanged);
    });
    client.onBroadcast('listeners.changed', (data) => {
      this.applyListeners(data as ListenersChanged);
    });
    client.onStatusChange((status) => {
      if (status === 'offline') {
        // Intentional close / logout: drop room state. Transient reconnects keep
        // the last snapshot so audio can keep playing until rejoin refreshes it.
        this.resetRoom(new YuzuError('internal', 'connection lost'));
      } else if (status === 'reconnecting') {
        // Abort an in-flight join, but leave roomId/playback/queue intact.
        const tracker = this.joining;
        this.joining = null;
        tracker?.abort(new YuzuError('internal', 'connection lost'));
      }
    });
  }

  getState(): RoomState {
    return this.state;
  }

  subscribe(callback: () => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  async join(roomId: string, password?: string): Promise<void> {
    if (this.joining !== null) {
      this.joining.abort(new YuzuError('internal', 'join superseded'));
    }

    let finish!: () => void;
    const completion = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let abort!: (error: YuzuError) => void;
    const aborted = new Promise<never>((_, reject) => {
      abort = reject;
    });
    const tracker: JoinTracker = {
      joined: false,
      received: new Set(),
      buffered: [],
      completion,
      finish,
      aborted,
      abort,
    };
    this.joining = tracker;
    this.queueReplica.beginJoin();

    try {
      const data = password ? { room_id: roomId, password } : { room_id: roomId };
      const joined = await Promise.race([
        this.client.request<RoomJoined>('room.join', data),
        tracker.aborted,
      ]);
      if (this.joining !== tracker) {
        throw new YuzuError('internal', 'join superseded');
      }

      this.enterRoom(joined.room_id);
      tracker.joined = true;
      const buffered = tracker.buffered;
      tracker.buffered = [];
      for (const snapshot of buffered) {
        switch (snapshot.type) {
          case 'playback.changed':
            this.applyPlayback(snapshot.data);
            break;
          case 'queue.snapshot':
            this.applyQueueSnapshot(snapshot.data);
            break;
          case 'queue.patch':
            this.applyQueuePatch(snapshot.data);
            break;
          case 'radio.changed':
            this.applyRadio(snapshot.data);
            break;
          case 'listeners.changed':
            this.applyListeners(snapshot.data);
            break;
        }
      }
      await Promise.race([tracker.completion, tracker.aborted]);
    } catch (error) {
      if (this.joining === tracker) {
        this.joining = null;
      }
      throw error;
    }
  }

  async leave(): Promise<void> {
    const roomId = this.requireRoom();
    await this.client.request<void>('room.leave', { room_id: roomId });
    this.resetRoom(new YuzuError('internal', 'room left'));
  }

  async addQueue(refs: string[]): Promise<string[]> {
    const roomId = this.requireRoom();
    const data =
      refs.length === 1
        ? { room_id: roomId, track_ref: refs[0] }
        : { room_id: roomId, track_refs: refs };
    const response = await this.client.request<QueueAddAck>('queue.add', data);
    return response.entry_ids;
  }

  async removeQueue(entryId: string): Promise<void> {
    const roomId = this.requireRoom();
    await this.client.request<void>('queue.remove', { room_id: roomId, entry_id: entryId });
  }

  async moveQueue(entryId: string, toIndex: number): Promise<void> {
    const roomId = this.requireRoom();
    await this.client.request<void>('queue.move', {
      room_id: roomId,
      entry_id: entryId,
      to_index: toIndex,
    });
  }

  async clearQueue(): Promise<void> {
    const roomId = this.requireRoom();
    await this.client.request<void>('queue.clear', { room_id: roomId });
  }

  async pause(): Promise<void> {
    const roomId = this.requireRoom();
    await this.client.request<void>('playback.pause', { room_id: roomId });
  }

  async resume(): Promise<void> {
    const roomId = this.requireRoom();
    await this.client.request<void>('playback.resume', { room_id: roomId });
  }

  async seek(positionMs: number): Promise<void> {
    const roomId = this.requireRoom();
    await this.client.request<void>('playback.seek', {
      room_id: roomId,
      position_ms: positionMs,
    });
  }

  async skip(): Promise<void> {
    const roomId = this.requireRoom();
    await this.client.request<void>('playback.skip', { room_id: roomId });
  }

  async radioPlay(source: string, shuffle = false, once = false): Promise<void> {
    const roomId = this.requireRoom();
    await this.client.request<void>('radio.play', {
      room_id: roomId,
      source,
      shuffle,
      once,
    });
  }

  async radioStop(): Promise<void> {
    const roomId = this.requireRoom();
    await this.client.request<void>('radio.stop', { room_id: roomId });
  }

  private applyPlayback(playback: Playback): void {
    if (this.joining !== null && !this.joining.joined) {
      this.joining.buffered.push({ type: 'playback.changed', data: playback });
      return;
    }
    if (this.state.roomId === null) return;
    this.publish({ ...this.state, playback });
    this.advanceJoin('playback.changed');
  }

  private applyQueueSnapshot(data: QueueSnapshotPart): void {
    if (this.joining !== null && !this.joining.joined) {
      this.joining.buffered.push({ type: 'queue.snapshot', data });
      return;
    }
    if (this.state.roomId === null) return;
    try {
      if (!this.queueReplica.acceptSnapshot(data)) return;
    } catch {
      this.queueReplica.markResyncRequired();
      this.requestQueueSync();
      return;
    }
    const queue = this.queueReplica.state;
    this.publish({ ...this.state, queue: queue.items, queueRevision: queue.revision });
    this.advanceJoin('queue.snapshot');
  }

  private applyQueuePatch(data: QueuePatchPart): void {
    if (this.joining !== null && !this.joining.joined) {
      this.joining.buffered.push({ type: 'queue.patch', data });
      return;
    }
    if (this.state.roomId === null) return;
    try {
      if (!this.queueReplica.acceptPatch(data)) return;
    } catch {
      this.queueReplica.markResyncRequired();
      this.requestQueueSync();
      return;
    }
    const queue = this.queueReplica.state;
    this.publish({ ...this.state, queue: queue.items, queueRevision: queue.revision });
  }

  private requestQueueSync(): void {
    const roomId = this.state.roomId;
    if (roomId === null || this.queueSyncInFlight) return;
    this.queueSyncInFlight = true;
    void this.client
      .request<void>('queue.sync', { room_id: roomId })
      .catch(() => {
        this.queueReplica.markResyncRequired();
      })
      .finally(() => {
        this.queueSyncInFlight = false;
      });
  }

  private applyRadio(data: RadioChanged): void {
    if (this.joining !== null && !this.joining.joined) {
      this.joining.buffered.push({ type: 'radio.changed', data });
      return;
    }
    if (this.state.roomId === null) return;
    this.publish({ ...this.state, radio: data.radio });
    this.advanceJoin('radio.changed');
  }

  private applyListeners(data: ListenersChanged): void {
    if (this.joining !== null && !this.joining.joined) {
      this.joining.buffered.push({ type: 'listeners.changed', data });
      return;
    }
    if (this.state.roomId === null) return;
    this.publish({ ...this.state, listeners: data.listeners });
    this.advanceJoin('listeners.changed');
  }

  private advanceJoin(type: SnapshotType): void {
    const tracker = this.joining;
    if (tracker === null || !tracker.joined) return;
    tracker.received.add(type);
    if (tracker.received.size === 4) {
      this.joining = null;
      tracker.finish();
    }
  }

  private enterRoom(roomId: string): void {
    // Soft rejoin after reconnect: keep the last state until the new
    // playback/queue/radio/listener snapshots arrive.
    if (this.state.roomId === roomId) {
      this.publish({ ...this.state, roomId });
      return;
    }

    this.queueReplica.reset();
    const playback =
      this.state.playback.current === null &&
      this.state.playback.position_ms === 0 &&
      this.state.playback.updated_at === 0 &&
      !this.state.playback.playing &&
      this.state.playback.rate === 1
        ? this.state.playback
        : {
            current: null,
            position_ms: 0,
            updated_at: 0,
            playing: false,
            rate: 1,
          };
    this.publish({
      roomId,
      playback,
      queue: [],
      queueRevision: null,
      listeners: [],
      radio: null,
    });
  }

  private resetRoom(error: YuzuError): void {
    const tracker = this.joining;
    this.joining = null;
    tracker?.abort(error);
    this.queueReplica.reset();

    const playbackIsIdle =
      this.state.playback.current === null &&
      this.state.playback.position_ms === 0 &&
      this.state.playback.updated_at === 0 &&
      !this.state.playback.playing &&
      this.state.playback.rate === 1;
    const nextState: RoomState = {
      roomId: null,
      playback: playbackIsIdle
        ? this.state.playback
        : {
            current: null,
            position_ms: 0,
            updated_at: 0,
            playing: false,
            rate: 1,
          },
      queue: [],
      queueRevision: null,
      listeners: [],
      radio: null,
    };

    if (
      this.state.roomId !== null ||
      nextState.playback !== this.state.playback ||
      this.state.queue.length > 0 ||
      this.state.queueRevision !== null ||
      this.state.listeners.length > 0 ||
      this.state.radio !== null
    ) {
      this.publish(nextState);
    }
  }

  private requireRoom(): string {
    if (this.state.roomId === null) {
      throw new YuzuError('bad_request', 'not in a room');
    }
    return this.state.roomId;
  }

  private publish(state: RoomState): void {
    this.state = state;
    for (const subscriber of [...this.subscribers]) {
      subscriber();
    }
  }
}
