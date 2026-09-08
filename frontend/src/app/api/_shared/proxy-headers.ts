import { NextRequest } from 'next/server';
import type { ForwardProxyHeaderOptions } from './proxy-types';

const BASE_PROXY_HEADER_KEYS = [
  'x-workspace-id',
  'x-client-request-id',
  'idempotency-key',
  'x-canvas-session-id',
  'x-client-session-id',
] as const;

export const forwardProxyHeaders = (
  request: NextRequest,
  headers: Record<string, string>,
  options: ForwardProxyHeaderOptions = {},
) => {
  const keys = new Set<string>(BASE_PROXY_HEADER_KEYS);
  if (options.includeIfMatch) keys.add('if-match');
  if (options.includeIfNoneMatch) keys.add('if-none-match');

  for (const extra of options.extraRequestHeaders || []) {
    if (extra) keys.add(extra.toLowerCase());
  }

  for (const key of keys) {
    const value = request.headers.get(key);
    if (value) {
      headers[key] = value;
    }
  }
};
