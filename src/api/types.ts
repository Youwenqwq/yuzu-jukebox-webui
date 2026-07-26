import type { Contributor } from '../protocol/types';

export interface RoomPolicy {
  max_queue?: number;
  queue_limits?: Record<string, number>;
}

export interface RoomNowPlaying {
  title: string;
  artist: string;
  duration_ms: number;
  cover_url?: string;
  position_ms: number;
  updated_at: number;
  playing: boolean;
  rate: number;
}

export interface RoomInfo {
  id: string;
  name: string;
  policy: RoomPolicy;
  listener_count: number;
  now_playing: RoomNowPlaying | null;
}

export interface CreateRoomInput {
  id?: string;
  name: string;
  guest_password?: string;
  policy?: RoomPolicy;
}

export interface UpdateRoomInput {
  name?: string;
  guest_password?: string;
  policy?: RoomPolicy;
}

export interface RoomMutationResult {
  id: string;
  name: string;
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

export interface PlayerInfo {
  id: string;
  device: string;
  version?: string;
  caps: string[];
  identity_name: string;
  room_id?: string;
  volume: number;
  muted: boolean;
  connected_at: number;
}

export type PlayerCommandOp = 'set_volume' | 'set_mute' | 'join_room';

export interface PlayerCommandResult {
  ok: true;
}

export interface LyricsResult {
  type: 'lrc';
  lrc: string;
  tlrc?: string;
}

export interface OidcConfig {
  issuer: string;
  client_id: string;
  client_ids?: string[];
}
