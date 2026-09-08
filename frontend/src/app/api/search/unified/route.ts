import { NextRequest } from 'next/server';
import { proxyBackendRequest } from '@/app/api/_shared/proxy';

export async function POST(request: NextRequest) {
  return proxyBackendRequest(request, '/search/unified', {
    method: 'POST',
    forceJsonContentType: true,
  });
}
