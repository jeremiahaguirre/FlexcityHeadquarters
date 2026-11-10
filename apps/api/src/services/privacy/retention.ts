/**
 * Routine records aren't kept forever. Each organization sets how long; these are the defaults.
 * - In-app notifications: 2 years.
 * - The email log (who was sent which kind of email, never the contents): 90 days.
 * - Ended sign-in sessions and used or expired one-time links: 30 days (not configurable).
 * The audit log is kept for the life of the account (it's append-only, and part of the
 * organization's records); offboarding deletes it with everything else.
 */
import type { Tx } from '../../lib/db.js';

export const RETENTION_DEFAULTS = { notificationsDays: 730, emailLogDays: 90 } as const;
export const RETENTION_LIMITS = { notificationsDays: [90, 3650], emailLogDays: [30, 3650] } as const;
export type Retention = { notificationsDays: number; emailLogDays: number };

export function readRetention(raw: unknown): Retention {
  const r = raw && typeof raw === 'object' ? (raw as Partial<Retention>) : {};
  const pick = (k: keyof Retention) => {
    const v = Number(r[k]);
    const [lo, hi] = RETENTION_LIMITS[k];
    return Number.isFinite(v) && v >= lo && v <= hi ? v : RETENTION_DEFAULTS[k];
  };
  return { notificationsDays: pick('notificationsDays'), emailLogDays: pick('emailLogDays') };
}

const ago = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);

/** Runs inside one organization's context (the worker calls it for each). Returns rows removed. */
export async function applyRetention(tx: Tx, now = new Date()): Promise<number> {
  const t = await tx.tenant.findFirst({ select: { retentionSettings: true } });
  if (!t) return 0;
  const r = readRetention(t.retentionSettings);
  const n = await tx.notification.deleteMany({ where: { createdAt: { lt: ago(now, r.notificationsDays) } } });
  // Only finished emails: anything still waiting to go out stays.
  const e = await tx.emailOutbox.deleteMany({ where: { createdAt: { lt: ago(now, r.emailLogDays) }, OR: [{ sentAt: { not: null } }, { attempts: { gte: 5 } }] } });
  const old = ago(now, 30);
  const s = await tx.refreshToken.deleteMany({ where: { OR: [{ expiresAt: { lt: old } }, { revokedAt: { lt: old } }] } });
  const l = await tx.authToken.deleteMany({ where: { OR: [{ expiresAt: { lt: old } }, { usedAt: { lt: old } }] } });
  return n.count + e.count + s.count + l.count;
}
