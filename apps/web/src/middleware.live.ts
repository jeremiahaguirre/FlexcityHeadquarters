import { NextResponse, type NextRequest } from 'next/server';

/**
 * Content Security Policy with a fresh nonce for every page: only scripts that
 * carry it (Next's own, and the colour-scheme snippet in the root layout) run,
 * plus what they load ('strict-dynamic'). An injected <script> or inline event
 * handler is refused by the browser. Next reads the nonce from this request
 * header and adds it to its scripts.
 */
export function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== 'production';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // Tenant brand colours are set as CSS variables in a style attribute.
    "style-src 'self' 'unsafe-inline'",
    // Organization logos can be hosted elsewhere (https only).
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = {
  // Pages only: not the API (its own headers), static files, or prefetches.
  matcher: [
    {
      source: '/((?!api/|_next/static|_next/image|favicon|icon|apple-icon|sw\\.js|manifest).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
