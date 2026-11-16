/**
 * The path a guard should judge, written the way the router reads it. Express routes ignore letter
 * case, accept a trailing slash and decode each parameter, so a guard that tests the raw URL can be
 * walked past with `/api/Users/…`, `/api/users/%33fa…` or `/api/incidents/<id>/`. Guards match this
 * instead: the query dropped, percent-escapes decoded, lower case, repeated and trailing slashes
 * removed. Null when an escape is malformed (the router would refuse it too).
 */
export function canonicalPath(url: string): string | null {
  const raw = url.split('?')[0]!.split('#')[0]!;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const path = decoded.toLowerCase().replace(/\/{2,}/g, '/');
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}
