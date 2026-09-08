import { NextRequest } from 'next/server';
import { createClient as createSupabaseServerClient } from '@/lib/supabase/server';
import { proxyCanvasRequest } from '../../_proxy';

export async function POST(request: NextRequest, ctx: { params: Promise<{ canvas_id: string }> }) {
  const { canvas_id } = await ctx.params;
  const incomingSearch = new URL(request.url).search || '';
  const basePath = `/canvases/${canvas_id}/ensure-thread`
  // Prefer server-side token; otherwise, preserve incoming query (may already contain ?token=...)
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { session } } = await supabase.auth.getSession();
    const tokenParam = session?.access_token ? `?token=${encodeURIComponent(session.access_token)}` : '';
    if (tokenParam) {
      return proxyCanvasRequest(request, `${basePath}${tokenParam}`);
    }
  } catch {}
  // Fallback: forward existing query string if present
  return proxyCanvasRequest(request, `${basePath}${incomingSearch}`);
}
