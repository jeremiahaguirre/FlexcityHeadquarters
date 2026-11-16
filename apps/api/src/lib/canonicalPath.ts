import type { NextFunction, Request, Response } from 'express';

/**
 * The path a guard should judge, written the way the router reads it. Express routes ignore letter
 * case, accept a trailing slash and decode each parameter, so a guard that tests the raw URL can be
 * walked past with `/api/Users/…`, `/api/users/%33fa…` or `/api/incidents/<id>/`. Guards match this
 * instead: the query dropped, percent-escapes decoded, lower case, repeated and trailing slashes
 * removed. An absolute-form target (`http://host/api/…`, which Node leaves in req.url and Express
 * still routes on its pathname) is reduced to its pathname. Null when an escape is malformed (the
 * router would refuse it too).
 */
export function canonicalPath(url: string): string | null {
  let raw = url.split('?')[0]!.split('#')[0]!;
  if (!raw.startsWith('/')) {
    try {
      raw = new URL(url).pathname;
    } catch {
      return null;
    }
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const path = decoded.toLowerCase().replace(/\/{2,}/g, '/');
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/**
 * The pathname the router is matching this request on: the mount path plus the path below it, both
 * parsed from the request target by Express. Never the raw req.originalUrl, which keeps an
 * absolute-form target (`GET http://host/api/… HTTP/1.1`) as sent.
 */
export const routedPath = (req: { baseUrl: string; path: string }) => req.baseUrl + req.path;

/**
 * Only origin-form request targets (`/api/…`). Browsers and the load balancer never send anything
 * else; an absolute-form target leaves req.originalUrl unlike the path being routed, so a check on
 * it could be walked past. 400 BAD_REQUEST before anything else runs.
 */
export function originFormOnly(req: Request, res: Response, next: NextFunction) {
  if (req.url.startsWith('/')) return next();
  res.status(400).json({ code: 'BAD_REQUEST', message: 'Send the request with a path, not a full address.' });
}
