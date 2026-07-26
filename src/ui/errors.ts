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
]);

/** YuzuError → i18n key（未知 code 归一到 error.unknown） */
export function errorKey(err: YuzuError): string {
  return KNOWN_CODES.has(err.code) ? `error.${err.code}` : 'error.unknown';
}
