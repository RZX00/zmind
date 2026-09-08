import {NextResponse} from 'next/server';
import type {NextRequest} from 'next/server';

// Exclude API, Next internals, and static assets
export const config = {
  matcher: [
    '/((?!api|_next|_vercel|.*\\..*).*)'
  ]
};

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only keep legacy zh-CN redirect; do not rewrite /zh anymore
  if (pathname.startsWith('/zh-CN')) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.replace(/^\/zh-CN/, '/zh');
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}
