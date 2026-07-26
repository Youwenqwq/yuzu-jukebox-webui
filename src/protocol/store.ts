import type { YuzuClient } from './client';
import type {
  Listener,
  ListenersChanged,
  Playback,
  QueueAddAck,
  QueueChanged,
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
  listeners: Listener[];
  radio: RadioState | null;
}

type BufferedSnapshot =
  | { type: 'playback.changed'; data: Playback }
  | { type: 'queue.changed'; data: QueueChanged }
  | { type: 'radio.changed'; data: RadioChanged }
  | { type: 'listeners.changed'; data: ListenersChanged };

const JOIN_SNAPSHOT_TYPES: ReadonlyArray<BufferedSnapshot['type']> = [
  'playback.changed',
  'queue.changed',
  'radio.changed',
  'listeners.changed',
];

interface JoinTracker {
  stage: number;
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
    listeners: [],
    radio: null,
  };
  private readonly subscribers = new Set<() => void>();
  private joining: JoinTracker | null = null;

  constructor(private readonly client: YuzuClient) {
    client.onBroadcast('playback.changed', (data) => {
      this.applyPlayback(data as Playback);
    });
    client.onBroadcast('queue.changed', (data) => {
      this.applyQueue(data as QueueChanged);
    });
    client.onBroadcast('radio.changed', (data) => {
      this.applyRadio(data as RadioChanged);
    });
    client.onBroadcast('listeners.changed', (data) => {
      this.applyListeners(data as ListenersChanged);
    });
    client.onStatusChange((status) => {
      if (status === 'reconnecting' || status === 'offline') {
        this.resetRoom(new YuzuError('internal', 'connection lost'));
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
      stage: 0,
      buffered: [],
      completion,
      finish,
      aborted,
      abort,
    };
    this.joining = tracker;

    try {
      const joined = await Promise.race([
        this.client.request<RoomJoined>('room.join', {
          room_id: roomId,
          password: password ?? '',
        }),
        tracker.aborted,
      ]);
      if (this.joining !== tracker) {
        throw new YuzuError('internal', 'join superseded');
      }

      tracker.stage = 1;
      this.enterRoom(joined.room_id);
      const buffered = tracker.buffered;
      tracker.buffered = [];
      for (const snapshot of buffered) {
        switch (snapshot.type) {
          case 'playback.changed':
            this.applyPlayback(snapshot.data);
            break;
          case 'queue.changed':
            this.applyQueue(snapshot.data);
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
    if (this.joining?.stage === 0) {
      this.joining.buffered.push({ type: 'playback.changed', data: playback });
      return;
    }
    if (this.state.roomId === null) {
      return;
    }
    this.publish({ ...this.state, playback });
    this.advanceJoin('playback.changed');
  }

  private applyQueue(data: QueueChanged): void {
    if (this.joining?.stage === 0) {
      this.joining.buffered.push({ type: 'queue.changed', data });
      return;
    }
    if (this.state.roomId === null) {
      return;
    }
    this.publish({ ...this.state, queue: data.queue });
    this.advanceJoin('queue.changed');
  }

  private applyRadio(data: RadioChanged): void {
    if (this.joining?.stage === 0) {
      this.joining.buffered.push({ type: 'radio.changed', data });
      return;
    }
    if (this.state.roomId === null) {
      return;
    }
    this.publish({ ...this.state, radio: data.radio });
    this.advanceJoin('radio.changed');
  }

  private applyListeners(data: ListenersChanged): void {
    if (this.joining?.stage === 0) {
      this.joining.buffered.push({ type: 'listeners.changed', data });
      return;
    }
    if (this.state.roomId === null) {
      return;
    }
    this.publish({ ...this.state, listeners: data.listeners });
    this.advanceJoin('listeners.changed');
  }

  private advanceJoin(type: BufferedSnapshot['type']): void {
    const tracker = this.joining;
    if (tracker === null || tracker.stage === 0) {
      return;
    }
    const expected = JOIN_SNAPSHOT_TYPES[tracker.stage - 1];
    if (type !== expected) {
      return;
    }

    tracker.stage += 1;
    if (tracker.stage === 5) {
      this.joining = null;
      tracker.finish();
    }
  }

  private enterRoom(roomId: string): void {
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
      queue: this.state.queue.length === 0 ? this.state.queue : [],
      listeners: this.state.listeners.length === 0 ? this.state.listeners : [],
      radio: null,
    });
  }

  private resetRoom(error: YuzuError): void {
    const tracker = this.joining;
    this.joining = null;
    tracker?.abort(error);

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
      queue: this.state.queue.length === 0 ? this.state.queue : [],
      listeners: this.state.listeners.length === 0 ? this.state.listeners : [],
      radio: null,
    };

    if (
      this.state.roomId !== null ||
      nextState.playback !== this.state.playback ||
      nextState.queue !== this.state.queue ||
      nextState.listeners !== this.state.listeners ||
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
