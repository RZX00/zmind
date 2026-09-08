import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseServerClient } from '@/lib/supabase/server';
import { requiredServerEnv } from '@/lib/env-utils';

export const runtime = 'nodejs';

function normalizeBackendBase(raw: string): string {
  const trimmed = raw.replace(/\/$/, '');
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
}

function resolveBackendTargets(path: string): string[] {
  const targets: string[] = [];
  const seen = new Set<string>();
  const candidates = [
    process.env.BACKEND_INTERNAL_URL,
    process.env.NEXT_PUBLIC_BACKEND_URL,
  ].filter((value): value is string => Boolean(value && value.trim()));

  for (const candidate of candidates) {
    const normalized = normalizeBackendBase(candidate.trim());
    const full = `${normalized}${path}`;
    if (seen.has(full)) continue;
    seen.add(full);
    targets.push(full);
  }

  return targets;
}

function extractNetworkErrorCode(error: unknown): string | undefined {
  const err = error as
    | {
        code?: string;
        cause?: { code?: string; errors?: Array<{ code?: string }> };
      }
    | undefined;
  if (!err) return undefined;
  if (typeof err.code === 'string') return err.code;
  if (typeof err.cause?.code === 'string') return err.cause.code;
  if (Array.isArray(err.cause?.errors)) {
    const fromAggregate = err.cause.errors.find(
      (item) => typeof item?.code === 'string',
    );
    if (fromAggregate?.code) return fromAggregate.code;
  }
  return undefined;
}

export async function POST(_request: NextRequest) {
  const adminApiKey = process.env.ZMIND_ADMIN_API_KEY;
  if (!adminApiKey) {
    return NextResponse.json(
      { success: false, error: { message: 'Admin API key not configured' } },
      { status: 500 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json(
      { success: false, error: { message: 'Unauthorized' } },
      { status: 401 },
    );
  }

  let targets = resolveBackendTargets(
    `/admin/zmind-agents/install-user/${user.id}`,
  );
  if (targets.length === 0) {
    const fallback = requiredServerEnv('BACKEND_INTERNAL_URL');
    targets = [
      normalizeBackendBase(fallback) +
        `/admin/zmind-agents/install-user/${user.id}`,
    ];
  }

  let resp: Response | null = null;
  let lastNetworkError: unknown = null;

  for (const targetUrl of targets) {
    try {
      resp = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'X-Admin-Api-Key': adminApiKey,
        },
        signal: AbortSignal.timeout(10_000),
      });
      break;
    } catch (error) {
      lastNetworkError = error;
      console.error('[install-zmind-agent] backend request failed:', {
        targetUrl,
        code: extractNetworkErrorCode(error),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!resp) {
    const errorCode = extractNetworkErrorCode(lastNetworkError);
    return NextResponse.json(
      {
        success: false,
        error: {
          message:
            'Unable to reach backend service for agent installation. Verify backend is running and BACKEND_INTERNAL_URL is reachable.',
          code: errorCode || 'BACKEND_UNREACHABLE',
        },
      },
      { status: 503 },
    );
  }

  const contentType = resp.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await resp.json().catch(() => null)
    : await resp.text().catch(() => null);

  if (!resp.ok) {
    return NextResponse.json(
      { success: false, error: payload || { message: resp.statusText } },
      { status: resp.status },
    );
  }

  return NextResponse.json(
    { success: true, data: payload },
    { status: resp.status },
  );
}
