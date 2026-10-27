import { NextResponse, type NextRequest } from 'next/server';
import { GAME_SERVER_PORT } from '@icebreaker/shared';
import { contentSecurityPolicy, gameServerSources } from '@/lib/csp';
import { BASE_PATH } from '@/lib/paths';

/** Every page gets a Content Security Policy with its own nonce, which Next.js reads back off the request. */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const policy = contentSecurityPolicy({
    nonce,
    dev: process.env.NODE_ENV === 'development',
    connect: gameServerSources(request.headers.get('host') ?? '', {
      serverUrl: process.env.NEXT_PUBLIC_GAME_SERVER_URL,
      basePath: BASE_PATH,
      port: process.env.NEXT_PUBLIC_GAME_PORT || String(GAME_SERVER_PORT),
    }),
  });
  const headers = new Headers(request.headers);
  headers.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

// matchers must be literals: Next.js reads them at build time
export const config = {
  matcher: [
    // the home page on its own: under a base path the pattern below needs a slash after /icebreaker
    {
      source: '/',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
    // pages only: the API answers with JSON, and the files under _next/static carry no scripts of their own
    {
      source: '/((?!api/|_next/static|_next/image|icon.svg|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
