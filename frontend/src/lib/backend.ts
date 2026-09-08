import { requiredEnv, requiredServerEnv } from '@/lib/env-utils';

/**
 * Resolve the backend base URL in a consistent way across server and client.
 * - Server: use BACKEND_INTERNAL_URL
 * - Client: use NEXT_PUBLIC_BACKEND_URL
 * - Ensure the returned URL ends with a single `/api` segment (no double or missing /api)
 */
export function resolveBackendBase(): string {
  const base = typeof window === 'undefined'
    ? requiredServerEnv('BACKEND_INTERNAL_URL')
    : requiredEnv('NEXT_PUBLIC_BACKEND_URL');
  const trimmed = base.replace(/\/$/, '');
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
}
