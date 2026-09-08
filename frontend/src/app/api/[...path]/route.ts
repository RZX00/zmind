import {NextRequest, NextResponse} from 'next/server';
import { requiredServerEnv } from '@/lib/env-utils';

export const runtime = 'nodejs';

// In Next.js 15, route `params` may be a Promise for dynamic APIs.
// Support both sync and async params for forward/backward compatibility.
async function proxy(
  req: NextRequest,
  context: { params: { path?: string[] } } | { params: Promise<{ path?: string[] }> }
) {
  const rawParams: any = (context as any)?.params;
  const params: { path?: string[] } = rawParams && typeof rawParams.then === 'function'
    ? await rawParams
    : rawParams || {};
  const base = requiredServerEnv('BACKEND_INTERNAL_URL').replace(/\/$/, '');

  const path = Array.isArray(params.path) ? params.path.join('/') : String(params.path || '');
  const prefix = base.match(/\/(api)(\/)?$/) ? '' : '/api';
  const targetUrl = `${base}${prefix}/${path}${req.nextUrl.search}`;

  // Clone headers; strip problematic ones for proxies
  const headers = new Headers(req.headers);
  headers.delete('host');
  headers.delete('x-forwarded-host');
  headers.delete('x-forwarded-proto');
  headers.delete('content-length');

  const method = req.method.toUpperCase();
  let body: BodyInit | undefined = undefined;
  if (!['GET', 'HEAD'].includes(method)) {
    // Preserve raw body for any content-type
    const ab = await req.arrayBuffer();
    body = ab as any;
  }

  const res = await fetch(targetUrl, {
    method,
    headers,
    body,
    redirect: 'manual',
  });

  // Proxy response headers back
  const respHeaders = new Headers(res.headers);
  // Avoid invalid headers for NextResponse
  respHeaders.delete('content-encoding');
  respHeaders.delete('transfer-encoding');
  respHeaders.delete('content-length');

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, {status: res.status, headers: respHeaders});
  }
  const buf = await res.arrayBuffer();
  return new NextResponse(buf, {status: res.status, headers: respHeaders});
}

export async function GET(req: NextRequest, ctx: any) { return proxy(req, ctx); }
export async function HEAD(req: NextRequest, ctx: any) { return proxy(req, ctx); }
export async function POST(req: NextRequest, ctx: any) { return proxy(req, ctx); }
export async function PUT(req: NextRequest, ctx: any) { return proxy(req, ctx); }
export async function PATCH(req: NextRequest, ctx: any) { return proxy(req, ctx); }
export async function DELETE(req: NextRequest, ctx: any) { return proxy(req, ctx); }
