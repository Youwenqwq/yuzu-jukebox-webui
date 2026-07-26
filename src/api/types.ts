import type { Contributor } from '../protocol/types';

export interface RoomPolicy {
  max_queue?: number;
  queue_limits?: Record<string, number>;
}

export interface RoomInfo {
  id: string;
  name: string;
  policy: RoomPolicy;
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
