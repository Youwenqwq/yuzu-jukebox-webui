import { YuzuError } from '../protocol/types';

const KNOWN_CODES = new Set([
  'unauthorized',
  'forbidden',
  'bad_request',
  'queue_full',
  'quota_exceeded',
  'not_found',
  'provider_error',
  'internal',
  'rate_limited',
  'acceleration_not_ready',
  'credential_not_pending',
  'credential_not_ready',
  'acceleration_not_empty',
  'acceleration_storage_full',
  'acceleration_storage_unmanaged',
  'acceleration_storage_reserved',
  'deletion_invalid',
  'request_ready',
  'cancellation_requested',
  'inventory_scan_invalid',
]);

/** YuzuError → i18n key（未知 code 归一到 error.unknown） */
export function errorKey(err: YuzuError): string {
  return KNOWN_CODES.has(err.code) ? `error.${err.code}` : 'error.unknown';
}
