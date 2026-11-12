/**
 * Where to go after signing in (the `next` parameter): only a path on this same site, else `fallback`.
 * A leading "/" isn't enough: browsers read "/\evil.example" and "/\t/evil.example" (tabs and line
 * breaks are dropped) as another site. So no backslashes or control characters, and the value must
 * resolve to this origin; the result is its path, query and fragment. The API checks the same way
 * (apps/api/src/lib/safeNext.ts) for the single sign-on round trip.
 */
export function safeNext(n: string | null | undefined, fallback = '/', origin = typeof window === 'undefined' ? 'https://same-origin.invalid' : window.location.origin): string {
  if (typeof n !== 'string' || !n.startsWith('/') || n.length >= 300) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(n)) return fallback;
  try {
    const u = new URL(n, origin);
    return u.origin === new URL(origin).origin ? `${u.pathname}${u.search}${u.hash}` : fallback;
  } catch {
    return fallback;
  }
}
