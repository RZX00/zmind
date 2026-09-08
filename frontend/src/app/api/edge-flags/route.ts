import { maintenanceNoticeFlag } from '@/lib/edge-flags';

// Use Node runtime to avoid edge bundling issues on some platforms
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const maintenanceNotice = await maintenanceNoticeFlag();
    return Response.json(maintenanceNotice);
  } catch (error) {
    console.error('[API] Error in edge flags route:', error);
    return Response.json({ enabled: false }, { status: 500 });
  }
}
