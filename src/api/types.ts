import type { Contributor } from '../protocol/types';

/**
 * 房间治理策略。服务端存的是整块 JSON（`rooms.policy_json`），PATCH 的 `policy`
 * 是**整体替换**——服务端认识的键多于本前端（如 `start_lead_ms`），因此未知键
 * 必须原样带回，不能靠重建对象提交。合并规则见 `api/policy.ts`。
 */
export interface RoomPolicy {
  max_queue?: number;
  queue_limits?: Record<string, number>;
  member_player_volume?: boolean;
  /** 电台启停授权："controller"（缺省）| "requester"（任何点歌人可启停） */
  radio_control?: 'controller' | 'requester';
  /** 服务端权威的其它策略键（本前端不解释，只负责原样往返）。 */
  [key: string]: unknown;
}

export interface RoomNowPlaying {
  title: string;
  artist: string;
  duration_ms: number;
  cover_url?: string;
  /** 与房内五元组同语义：切歌起播提前量窗口内为负，渲染前钳到 0（见 protocol/types Playback） */
  position_ms: number;
  updated_at: number;
  playing: boolean;
  rate: number;
}

export type RoomAccessMode = 'open' | 'static_password' | 'rotating_code';

export interface RoomGuestAccess {
  mode: RoomAccessMode;
  /** Present only when mode is rotating_code. */
  code_period_seconds?: number;
  trusted_roles: string[];
}

export interface RoomAccessCode {
  code: string;
  period_seconds: number;
  valid_from: number;
  expires_at: number;
}

export interface RoomInfo {
  id: string;
  name: string;
  policy: RoomPolicy;
  guest_access: RoomGuestAccess;
  listener_count: number;
  now_playing: RoomNowPlaying | null;
}

export interface CreateRoomInput {
  id?: string;
  name: string;
  guest_password?: string;
  guest_access_mode?: RoomAccessMode;
  guest_code_period_seconds?: number;
  trusted_roles?: string[];
  policy?: RoomPolicy;
}

export interface UpdateRoomInput {
  name?: string;
  guest_password?: string;
  guest_access_mode?: RoomAccessMode;
  guest_code_period_seconds?: number;
  trusted_roles?: string[];
  policy?: RoomPolicy;
}

export interface RoomMutationResult {
  id: string;
  name: string;
  guest_access?: RoomGuestAccess;
}

export interface HistoryEntry {
  /** 个人历史（?requester=me）跨房间返回时标识来源房间 */
  room_id?: string;
  track_ref: string;
  title: string;
  requested_by: string;
  started_at: number;
  ended_at: number;
  end_reason: string;
}

export interface StatsEntry {
  track_ref: string;
  title: string;
  play_count: number;
  first_played_at: number;
  last_played_at: number;
}

export interface SearchTrack {
  track_ref: string;
  title: string;
  artist: string;
  duration_ms: number;
  album?: string;
  cover_url?: string;
  source_url?: string;
  contributors?: Contributor[];
}

/** 电台源规格（spec §6.2.1）：spec 不含 provider 前缀；finite=false 不适用 shuffle/once。 */
export interface RadioSourceInfo {
  spec: string;
  /** 参数语义，如 "track_id"；空 = 无参 */
  arg?: string;
  name?: string;
  finite: boolean;
}

export type SearchCategory = 'song' | 'artist' | 'album' | 'playlist';

export interface ProviderCapabilities {
  /** 账号写白名单子集："play_report" | "like" | "playlist_add" */
  account_write?: string[];
  radio_sources?: RadioSourceInfo[];
  search_categories?: SearchCategory[];
}

export interface ProviderInfo {
  id: string;
  credential_status?: string;
  /** 按当前请求 Principal 计算（是否凭据 owner）——不得跨用户缓存。 */
  owned?: boolean;
  capabilities?: ProviderCapabilities;
}

/** 分类检索的判别实体（spec §6.2.2）：type=song 时 track 非空可直接入队。 */
export interface SearchEntity {
  type: SearchCategory;
  track?: SearchTrack;
  /** 钻取（artist/album）或导入（playlist）键 */
  entity_id?: string;
  name?: string;
  /** 次要文本：专辑歌手 / 歌单曲目数 / UP主签名等 */
  detail?: string;
  cover_url?: string;
}

/** 全局热门条目（跨房间 play_history 聚合；与 queue.add ref 体系兼容）。 */
export interface HotTrack {
  track_ref: string;
  title: string;
  play_count: number;
  last_played_at: number;
}

export interface PlaylistInfo {
  id: string;
  name: string;
  description: string;
  created_by: string;
  created_at: number;
  updated_at: number;
  track_count: number;
  /** Provider 绑定歌单：跟随外部歌单、yuzu 侧只读（items 变更 409 playlist_bound） */
  bound_provider?: string;
  bound_remote_id?: string;
  last_sync_at?: number;
  last_sync_error?: string;
}

/** 凭据账号的歌单（owner 专用枚举，playlist-add 的目标）。 */
export interface AccountPlaylist {
  id: string;
  name: string;
  cover_url?: string;
  track_count: number;
}

export interface PlaylistItem {
  ord: number;
  track_ref: string;
  title: string;
  artist: string;
  duration_ms: number;
  added_at: number;
}

export interface PlaylistDetail {
  playlist: PlaylistInfo;
  items: PlaylistItem[];
  offset: number;
  limit: number;
}

export interface CreatePlaylistInput {
  name: string;
  description?: string;
}

export interface AddPlaylistItemsResult {
  added: number;
}

export interface DeletePlaylistItemResult {
  deleted: number;
}

export interface MovePlaylistItemResult {
  moved: number;
  to_ord: number;
}

export interface ImportPlaylistInput {
  provider?: string;
  playlist_id?: string;
  source?: string;
  name?: string;
}

export interface UploadMediaMeta {
  title?: string;
  artist?: string;
  duration_ms?: number;
}

export interface LocalMediaInfo {
  track_ref: string;
  title: string;
  artist: string;
  duration_ms: number;
  size_bytes: number;
  uploaded_by: string;
  created_at: number;
}

export interface CacheEntry {
  track_ref: string;
  file_path: string;
  size_bytes: number;
  bitrate_kbps: number;
  last_accessed_at: number;
  created_at: number;
}

export interface DownloadStatus {
  track_ref: string;
  fetched_bytes: number;
  total_bytes: number;
  started_at: number;
  finished_at?: number;
  status: 'downloading' | 'ok' | 'failed';
  error?: string;
}

export interface CacheOverview {
  entries: CacheEntry[];
  downloads: DownloadStatus[];
  history: DownloadStatus[];
  total_bytes: number;
  max_bytes: number;
}

export interface PruneResult {
  evicted: number;
  freed_bytes: number;
}

export interface CredentialResult {
  provider: string;
  status: 'ok';
}

export interface QrLoginStartResult {
  key: string;
  qr_content: string;
}

export interface QrLoginPollResult {
  status: 'waiting' | 'scanned' | 'ok' | 'expired';
  message: string;
}

/**
 * 加速资源的缓存模式（服务端 `accelerations.cache_mode`）。
 *
 * - `prefetch`：只缓存各房间队列视界内的待播曲目，工作集 = 房间数 × prefetch_horizon，
 *   有上界；其余曲目回源。此模式下待播可以用满预算，prefetch_share_percent 不生效。
 * - `prefetch_and_heat`：视界之外还缓存被播放过的热曲目。待播优先且不可驱逐，
 *   但占用不超过 prefetch_share_percent，剩下的份额归热度曲目。
 */
export type AccelerationCacheMode = 'prefetch' | 'prefetch_and_heat';

export interface AccelerationInfo {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  cache_mode: AccelerationCacheMode;
  prefetch_horizon: number;
  prefetch_share_percent: number;
  control_base_url: string;
  backend_base_url: string;
  lease_ttl_seconds: number;
  upload_rate_bytes_per_second: number;
  max_object_bytes: number;
  storage_budget_bytes: number;
  storage_high_watermark_percent: number;
  storage_low_watermark_percent: number;
  inventory_interval_seconds: number;
  inventory_stale_after_seconds: number;
  publisher_credential_configured: boolean;
  delivery_credential_configured: boolean;
  backend_credential_configured: boolean;
  publisher_credential_pending: boolean;
  delivery_credential_pending: boolean;
  backend_credential_pending: boolean;
  control_healthy?: boolean;
  backend_healthy?: boolean;
  health_error?: string;
  last_health_at?: number;
  created_at: number;
  updated_at: number;
}

export interface CreateAccelerationInput {
  id: string;
  name: string;
  kind?: string;
  control_base_url: string;
  backend_base_url: string;
  cache_mode?: AccelerationCacheMode;
  prefetch_horizon?: number;
  prefetch_share_percent?: number;
  lease_ttl_seconds?: number;
  upload_rate_bytes_per_second?: number;
  max_object_bytes?: number;
  storage_budget_bytes?: number;
  storage_high_watermark_percent?: number;
  storage_low_watermark_percent?: number;
  inventory_interval_seconds?: number;
  inventory_stale_after_seconds?: number;
}

export interface UpdateAccelerationInput {
  name?: string;
  enabled?: boolean;
  cache_mode?: AccelerationCacheMode;
  prefetch_horizon?: number;
  prefetch_share_percent?: number;
  control_base_url?: string;
  backend_base_url?: string;
  lease_ttl_seconds?: number;
  upload_rate_bytes_per_second?: number;
  max_object_bytes?: number;
  storage_budget_bytes?: number;
  storage_high_watermark_percent?: number;
  storage_low_watermark_percent?: number;
  inventory_interval_seconds?: number;
  inventory_stale_after_seconds?: number;
}

export interface AccelerationCredentialResult {
  acceleration: AccelerationInfo;
  token: string;
}

export interface AccelerationPublisherInfo {
  owner: string;
  version: string;
  state: string;
  online: boolean;
  lease_id: string;
  track_ref: string;
  capabilities: string[];
  backend_healthy: boolean;
  last_error: string;
  last_seen_at: number;
}

export interface DistributionAttempt {
  lease_id: string;
  acceleration_id: string;
  track_ref: string;
  owner: string;
  phase: string;
  source_bytes: number;
  upload_bytes: number;
  total_bytes: number;
  status: string;
  last_error?: string;
  started_at: number;
  updated_at: number;
  finished_at?: number;
}

export interface DistributionRequest {
  acceleration_id: string;
  track_ref: string;
  state: 'queued' | 'leased' | 'retry_wait' | 'cancel_requested' | 'ready' | 'canceled' | string;
  pending_reason?: string;
  requested_at: number;
  updated_at: number;
  next_attempt_at: number;
  attempts: number;
  last_error?: string;
  cancel_requested_at?: number;
  canceled_at?: number;
  lease?: {
    id: string;
    cancel_requested?: boolean;
    acceleration_id: string;
    track_ref: string;
    owner: string;
    expires_at: number;
    created_at: number;
  };
  candidate?: {
    acceleration_id: string;
    track_ref: string;
    content_version: string;
    locator: string;
    layout: string;
    size_bytes: number;
    content_type: string;
    etag?: string;
    created_at: number;
    updated_at: number;
  };
  progress?: DistributionAttempt;
}

export interface AccelerationInventoryScan {
  id: string;
  acceleration_id: string;
  owner?: string;
  state: string;
  attempts: number;
  lease_expires_at?: number;
  observed_at?: number;
  last_error?: string;
  requested_at: number;
  started_at?: number;
  completed_at?: number;
  updated_at: number;
}

export interface AccelerationStorageStatus {
  managed: boolean;
  budget_bytes: number;
  high_watermark_percent: number;
  low_watermark_percent: number;
  accounted_bytes: number;
  reserved_bytes: number;
  observed_bytes: number;
  managed_object_count: number;
  observed_object_count: number;
  orphan_count: number;
  missing_count: number;
  pending_deletion_count: number;
  observed_at?: number;
  stale_after_seconds?: number;
  stale?: boolean;
  reconciliation_error?: string;
  pressure: string;
}

export interface AccelerationStatus {
  acceleration: AccelerationInfo;
  summary: {
    requested: number;
    queued: number;
    leased: number;
    retry_wait: number;
    cancel_requested: number;
    ready: number;
    canceled: number;
    oldest_queued_at?: number;
  };
  storage: AccelerationStorageStatus;
  inventory_scan?: AccelerationInventoryScan | null;
  publishers: AccelerationPublisherInfo[];
  active: DistributionAttempt[];
  counters: Record<string, number>;
  last_24_hours: Record<string, number>;
}

export interface AccelerationRequestsResult {
  requests: DistributionRequest[];
}
export interface AccelerationInventoryStatus {
  storage: AccelerationStorageStatus;
  scan?: AccelerationInventoryScan | null;
}

export interface AccelerationCredentialActivationResult {
  acceleration: AccelerationInfo;
}

/** Persistent Player resource merged with online runtime state. */
export interface PlayerInfo {
  id: string;
  name: string;
  active: boolean;
  key_configured: boolean;
  online: boolean;
  room_id?: string;
  device?: string;
  version?: string;
  caps: string[];
  volume?: number;
  muted?: boolean;
  created_at: number;
  updated_at: number;
  last_seen_at?: number | null;
  connected_at?: number;
}

export interface PlayerCredentialResult {
  player: PlayerInfo;
  key: string;
}

export interface CreatePlayerInput {
  id: string;
  name: string;
}

export interface UpdatePlayerInput {
  name?: string;
  active?: boolean;
}

export interface RoomPlayerInfo {
  id: string;
  name: string;
  active: boolean;
  bound: boolean;
  online: boolean;
  device?: string;
  room_id?: string;
  volume: number;
  muted: boolean;
}

export interface RoomOutput {
  volume: number | null;
  updated_at?: number;
}

export interface RoomOutputUpdate {
  output: RoomOutput;
  delivery: {
    commands_sent: number;
  };
}

export type PlayerCommandOp = 'set_volume' | 'set_mute';

export interface PlayerCommandResult {
  ok: true;
}

export interface RoomCapabilities {
  controller: boolean;
  /** 电台启停授权（按 policy.radio_control 推导，spec §4.7） */
  radio: boolean;
}

export interface IntegrationInfo {
  id: string;
  name: string;
  active: boolean;
  created_at: number;
  updated_at: number;
  last_used_at?: number;
}

export interface IntegrationCredentialResult {
  integration: IntegrationInfo;
  token: string;
}

export interface UpdateIntegrationRequest {
  name?: string;
  active?: boolean;
}

export interface IntegrationScopeBinding {
  adapter_id: string;
  scope_type: string;
  scope_id: string;
  room_id: string;
}

export interface IntegrationScopeBindingInfo extends IntegrationScopeBinding {
  integration_id: string;
}

export interface IntegrationSubjectLink {
  adapter_id: string;
  scope_type: string;
  scope_id: string;
  subject_id: string;
  principal_id: string;
}

export interface IntegrationSubjectLinkInfo extends IntegrationSubjectLink {
  integration_id: string;
}

export interface PrincipalInfo {
  id: string;
  name: string;
  kind: string;
  roles: string[];
  active: boolean;
}

export interface RoomControllerGrant {
  room_id: string;
  principal_id: string;
  capability: 'controller';
}

export interface LyricsResult {
  type: 'lrc';
  lrc: string;
  tlrc?: string;
}

export interface ExternalBindingCode {
  code: string;
  expires_at: number;
}

export interface OidcConfig {
  issuer: string;
  client_id: string;
  client_ids?: string[];
}
