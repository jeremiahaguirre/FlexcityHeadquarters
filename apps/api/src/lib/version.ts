/**
 * Which build is running, and which web builds it still serves (docs/RELEASES.md).
 *
 * - Every answer carries `X-FH-Version: <release>` (RELEASE, the image tag; "dev" locally). The
 *   web app compares it with its own release and, when they differ, checks /version.json on the
 *   web tier to see whether a newer web build is really being served (lib/appUpdate.ts there).
 * - GET /api/version: { version, minWebVersion }.
 * - The web app sends `X-FH-Client: web/<version id>`, where a version id is
 *   "<UTC build time YYYYMMDDHHmm>.<release>". With MIN_WEB_VERSION set, a build older than it
 *   gets 426 CLIENT_OUTDATED (no work done) and reloads itself; its offline punches stay queued on
 *   the phone and go out from the new build. Clients that send no header (scripts, the public API,
 *   older builds from before this check) and "dev" builds are never refused.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { config } from '../config.js';

export const VERSION_HEADER = 'X-FH-Version';
export const CLIENT_HEADER = 'x-fh-client';

export function apiVersion(): string {
  return config().RELEASE || 'dev';
}

/** "202611121530.abc1234" → "202611121530"; null for ids without a build time ("dev"). */
export function buildStamp(version: string): string | null {
  const m = /^(\d{4,12})(?:\.|$)/.exec(version.trim());
  return m ? m[1]! : null;
}

/**
 * Whether a client build is older than the minimum. Build times compare as text once padded to
 * minutes ("20261112" means 2026-11-12 00:00 UTC). Unknown or unstamped versions are never too old.
 */
export function isOutdated(clientVersion: string | null | undefined, minVersion: string | null | undefined): boolean {
  if (!clientVersion || !minVersion) return false;
  const c = buildStamp(clientVersion);
  const m = buildStamp(minVersion);
  if (!c || !m) return false;
  return c.padEnd(12, '0') < m.padEnd(12, '0');
}

/** "web/202611121530.abc1234" → "202611121530.abc1234"; null when absent or not a web client. */
export function webClientVersion(header: string | undefined): string | null {
  const m = /^web\/([\w.-]{1,80})$/.exec((header ?? '').trim());
  return m ? m[1]! : null;
}

/** Every answer says which build sent it. */
export function versionHeader(_req: Request, res: Response, next: NextFunction) {
  res.setHeader(VERSION_HEADER, apiVersion());
  next();
}

/** Paths an outdated build may still reach: this check itself and its error reports. */
const OPEN = new Set(['/version', '/client-errors']);

/** Mounted on /api: refuses web builds older than MIN_WEB_VERSION. */
export function clientVersionGate(req: Request, res: Response, next: NextFunction) {
  const min = config().MIN_WEB_VERSION;
  if (!min || OPEN.has(req.path)) return next();
  const client = webClientVersion(req.header(CLIENT_HEADER));
  if (!isOutdated(client, min)) return next();
  res.status(426).setHeader('Upgrade', 'web-app').json({ code: 'CLIENT_OUTDATED', message: 'This version of the app is out of date. Reload to get the new one.', minWebVersion: min, requestId: req.id });
}

export const versionRouter = Router();
versionRouter.get('/version', (_req, res) => {
  res.json({ version: apiVersion(), minWebVersion: config().MIN_WEB_VERSION ?? null });
});
