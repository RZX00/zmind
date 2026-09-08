import { NextRequest } from 'next/server';
import { proxyBackendRequest } from '@/app/api/_shared/proxy';

export async function GET(request: NextRequest) {
  return proxyBackendRequest(request, '/search/index-status', {
    method: 'GET',
  });
}
