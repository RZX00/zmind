import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseServerClient } from '@/lib/supabase/server';
import { requiredServerEnv } from '@/lib/env-utils';

async function proxy(request: NextRequest, path: string) {
  const backend = requiredServerEnv('BACKEND_INTERNAL_URL');
  const url = `${backend}${path}`;

  const headers: Record<string, string> = {};
  const auth = request.headers.get('authorization');
  if (auth) {
    headers['authorization'] = auth;
  } else {
    try {
      const supabase = await createSupabaseServerClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) headers['authorization'] = `Bearer ${session.access_token}`;
    } catch {}
  }

  const cookie = request.headers.get('cookie');
  if (cookie) headers['cookie'] = cookie;

  const contentType = request.headers.get('content-type');
  if (contentType) headers['content-type'] = contentType;

  const workspaceHeader = request.headers.get('x-workspace-id');
  if (workspaceHeader) headers['x-workspace-id'] = workspaceHeader;

  const body = await request.text();
  const resp = await fetch(url, { method: request.method, headers, body });

  const resHeaders = new Headers();
  const ct = resp.headers.get('content-type');
  if (ct) resHeaders.set('content-type', ct);

  const data = await resp.arrayBuffer();
  return new NextResponse(data, { status: resp.status, headers: resHeaders });
}

export async function POST(request: NextRequest) {
  return proxy(request, '/search/nodes');
}
