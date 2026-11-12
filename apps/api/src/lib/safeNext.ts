/**
 * Where to send someone after signing in (a `next` parameter): only a path on this same site.
 * Checking for a leading "/" isn't enough: browsers read "/\evil.example" and "/\t/evil.example"
 * (tabs and line breaks are dropped) as another site. So: no backslashes or control characters at
 * all, and the value must resolve to this origin; what comes back is its path, query and fragment.
 */
const BASE = 'https://same-origin.invalid';

export function safeNext(n: unknown): string | undefined {
  if (typeof n !== 'string' || !n.startsWith('/') || n.length >= 300) return undefined;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(n)) return undefined;
  let u: URL;
  try {
    u = new URL(n, BASE);
  } catch {
    return undefined;
  }
  if (u.origin !== BASE) return undefined;
  return `${u.pathname}${u.search}${u.hash}`;
}
