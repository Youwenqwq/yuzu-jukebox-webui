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
