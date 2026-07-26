/**
 * Yuzu Jukebox 协议类型契约 —— 与 docs/spec-v1.md（服务端仓库）一一对应。
 * 本文件是 protocol / player / api / ui 四层的共享契约，改动需评审。
 *
 * 版本纪律（spec §0）：实现 MUST 忽略 JSON 中的未知字段；
 * 因此本文件所有接口的可选字段只增不减。
 */

// ---------- 身份 ----------

export type Role = 'listener' | 'requester' | 'room_admin' | 'media_admin';

export type IdentityKind = 'guest' | 'password' | 'oidc';

export interface Identity {
  id: string;
  name: string;
  kind: IdentityKind;
  roles: Role[];
}

// ---------- 曲目 ----------

export interface Contributor {
  role: string;
  name: string;
}

/** 曲目层元数据（入队快照，队列与播放广播都带；字段可空即降级，spec §4.1） */
export interface TrackMeta {
  entry_id: string;
  track_ref: string;
  title: string;
  artist: string;
  duration_ms: number;
  album?: string;
  cover_url?: string;
  source_url?: string;
  contributors?: Contributor[];
  requested_by: string;
  /** 点歌人显示名（入队快照；v1 后期新增，旧服务端/旧数据可能缺省 → 降级用 listeners 表或 ID） */
  requester_name?: string;
  added_at: number;
}

/** 当前播放条目：在曲目层之上附带物理层与按身份签发的 stream_url */
export interface CurrentTrack extends TrackMeta {
  size_bytes?: number;
  bitrate_kbps?: number;
  stream_url?: string;
}

export type QueueEntry = TrackMeta;

// ---------- 播放状态五元组（spec §5.1 权威状态） ----------

export interface Playback {
  current: CurrentTrack | null;
  position_ms: number;
  updated_at: number;
  playing: boolean;
  rate: number;
}

// ---------- 听众 / 电台 ----------

export interface Listener {
  id: string;
  name: string;
}

export interface RadioState {
  source: string;
  description: string;
  finite: boolean;
  shuffle: boolean;
  once: boolean;
}

// ---------- WS 信封与错误（spec §1 / §7） ----------

export interface Envelope<T = unknown> {
  type: string;
  ref?: string;
  data: T;
}

export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'bad_request'
  | 'queue_full'
  | 'quota_exceeded'
  | 'not_found'
  | 'provider_error'
  | 'internal'
  | 'rate_limited';

/** 服务端 error 消息 / REST 错误体统一塑形 */
export class YuzuError extends Error {
  constructor(
    public readonly code: ErrorCode | string,
    message: string,
  ) {
    super(message);
    this.name = 'YuzuError';
  }
}

// ---------- 广播消息 data 形状（spec §4.1 / §4.3） ----------

export interface PlaybackChanged {
  playback: Playback;
}
export interface QueueChanged {
  queue: QueueEntry[];
}
export interface ListenersChanged {
  listeners: Listener[];
}
export interface RadioChanged {
  radio: RadioState | null;
}
export interface RoomJoined {
  room_id: string;
}

export interface AuthOk {
  identity: Identity;
  session_token: string;
}

/** queue.add 成功时 ack 的 data（单条与批量同形） */
export interface QueueAddAck {
  entry_ids: string[];
}
