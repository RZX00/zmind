import { NextRequest } from 'next/server';
import { createClient as createSupabaseServerClient } from '@/lib/supabase/server';
import { proxyCanvasRequest } from '../../_proxy';

export async function GET(request: NextRequest, ctx: { params: Promise<{ canvas_id: string }> }) {
  const { canvas_id } = await ctx.params;
  // Also attach token as query param for compatibility
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { session } } = await supabase.auth.getSession();
    const tokenParam = session?.access_token ? `?token=${encodeURIComponent(session.access_token)}` : '';
    return proxyCanvasRequest(request, `/canvases/${canvas_id}/thread${tokenParam}`, {
      method: 'GET',
      allow204: true,
    });
  } catch {
    return proxyCanvasRequest(request, `/canvases/${canvas_id}/thread`, {
      method: 'GET',
      allow204: true,
    });
  }
}
