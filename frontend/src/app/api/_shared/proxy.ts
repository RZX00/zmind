import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseServerClient } from '@/lib/supabase/server';
import { requiredServerEnv } from '@/lib/env-utils';
import { forwardProxyHeaders } from './proxy-headers';
import type { BackendProxyOptions } from './proxy-types';

const backendBase = requiredServerEnv('BACKEND_INTERNAL_URL');

const copyResponseHeaders = (
  source: Response,
  target: Headers,
  options: BackendProxyOptions,
) => {
  const contentType = source.headers.get('content-type');
  if (contentType) {
    target.set('content-type', contentType);
  }

  if (options.preserveEtag) {
    const etag = source.headers.get('etag');
    if (etag) {
      target.set('etag', etag);
    }
  }

  const requestId = source.headers.get('x-request-id');
  if (requestId) {
    target.set('x-request-id', requestId);
  }

  for (const headerName of options.preserveHeaders || []) {
    const normalized = headerName.toLowerCase();
    const value = source.headers.get(normalized);
    if (value) {
      target.set(normalized, value);
    }
  }
};

export async function proxyBackendRequest(
  request: NextRequest,
  path: string,
  options: BackendProxyOptions = {},
) {
  const url = `${backendBase}${path}`;
  const method = (options.method || request.method).toUpperCase();
  const headers: Record<string, string> = {};

  const auth = request.headers.get('authorization');
  if (auth) {
    headers.authorization = auth;
  } else {
    try {
      const supabase = await createSupabaseServerClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) {
        headers.authorization = `Bearer ${session.access_token}`;
      }
    } catch {}
  }

  if (options.forwardCookie !== false) {
    const cookie = request.headers.get('cookie');
    if (cookie) {
      headers.cookie = cookie;
    }
  }

  const contentType = request.headers.get('content-type');
  if (contentType) {
    headers['content-type'] = contentType;
  }
  if (options.forceJsonContentType) {
    headers['content-type'] = 'application/json';
  }

  forwardProxyHeaders(request, headers, {
    includeIfMatch: options.includeIfMatch,
    includeIfNoneMatch: options.includeIfNoneMatch,
    extraRequestHeaders: options.extraRequestHeaders,
  });

  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.text();
  const resp = await fetch(url, { method, headers, body });

  const resHeaders = new Headers();
  copyResponseHeaders(resp, resHeaders, options);

  if (options.allow304 && resp.status === 304) {
    return new NextResponse(null, { status: 304, headers: resHeaders });
  }
  if (options.allow204 && resp.status === 204) {
    return new NextResponse(null, { status: 204, headers: resHeaders });
  }
  if (method === 'HEAD') {
    return new NextResponse(null, { status: resp.status, headers: resHeaders });
  }

  const data = await resp.arrayBuffer();
  return new NextResponse(data, { status: resp.status, headers: resHeaders });
}
