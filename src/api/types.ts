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

export interface ProviderInfo {
  id: string;
  credential_status?: string;
}

export interface PlaylistInfo {
  id: string;
  name: string;
  description: string;
  created_by: string;
  created_at: number;
  updated_at: number;
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

export interface AccelerationInfo {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  publish_on_cache_ready: boolean;
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
  publish_on_cache_ready?: boolean;
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
  publish_on_cache_ready?: boolean;
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
  object_count: number;
  observed_object_count: number;
  orphan_count: number;
  missing_count: number;
  pending_deletion_count: number;
  last_reconciled_at?: number;
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
