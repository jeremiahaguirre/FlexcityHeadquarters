/**
 * Shift preferences: what a person would like to work ("prefer") or would rather not ("avoid") — days,
 * a time window, a position, a facility — and the most hours or days a week they'd like. Separate from
 * availability: availability says when someone CAN work (a hard rule in Fill the schedule);
 * a preference says what they'd LIKE (a soft weight, never overriding a rule, fairness, seniority where
 * it's on, or overtime limits). Fill the schedule's explanation says when a preference was honoured or not.
 *
 * Privacy: seen by the person and by the schedulers of their department (department scope), nobody
 * else. Kept while the person works here (seasonal staff away keep theirs); deleted when they're
 * anonymized, and by the retention job PREFERENCES_INACTIVE_DAYS after someone who left last changed them.
 */
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { Tx } from '../../lib/db.js';
import { badRequest } from '../../lib/errors.js';

export const MAX_PREFERENCES = 20;
/** People who left (terminated): their preferences go this long after the last change to them or their record. */
export const PREFERENCES_INACTIVE_DAYS = 90;

export const preferenceBody = z
  .object({
    kind: z.enum(['PREFER', 'AVOID']),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    startMinute: z.number().int().min(0).max(1439).nullable().default(null),
    endMinute: z.number().int().min(1).max(1440).nullable().default(null),
    positionId: z.string().uuid().nullable().default(null),
    facilityId: z.string().uuid().nullable().default(null),
    note: z.string().trim().max(200).nullable().default(null),
  })
  .refine((p) => (p.startMinute === null) === (p.endMinute === null), { message: 'Give both a start and an end, or neither.', path: ['endMinute'] })
  .refine((p) => p.startMinute === null || p.endMinute! > p.startMinute, { message: 'The window must end after it starts.', path: ['endMinute'] });
export const preferencesBody = z.object({
  preferences: z.array(preferenceBody).max(MAX_PREFERENCES),
  maxWeeklyHours: z.number().min(1).max(80).nullable().default(null),
  maxDaysPerWeek: z.number().int().min(1).max(7).nullable().default(null),
});
export type PreferenceInput = z.infer<typeof preferenceBody>;

export interface PreferenceWindow { kind: 'PREFER' | 'AVOID'; daysOfWeek: number[]; startMinute: number | null; endMinute: number | null; positionId: string | null; facilityId: string | null }
export interface StatedPreferences { windows: PreferenceWindow[]; maxWeeklyHours: number | null; maxDaysPerWeek: number | null }

/** Does a shift (its local weekday and start minute) fall in a window? A shift matches when it starts inside it. */
export function windowMatches(w: PreferenceWindow, s: { dow: number; startMinute: number; positionId: string; facilityId: string }): boolean {
  if (w.daysOfWeek.length && !w.daysOfWeek.includes(s.dow)) return false;
  if (w.startMinute !== null && w.endMinute !== null && (s.startMinute < w.startMinute || s.startMinute >= w.endMinute)) return false;
  if (w.positionId && w.positionId !== s.positionId) return false;
  if (w.facilityId && w.facilityId !== s.facilityId) return false;
  return true;
}

/** +1 the person prefers shifts like this, −1 they'd rather avoid it (avoid wins), 0 neither. */
export function preferenceScore(p: StatedPreferences | undefined, s: { dow: number; startMinute: number; positionId: string; facilityId: string }): -1 | 0 | 1 {
  if (!p) return 0;
  if (p.windows.some((w) => w.kind === 'AVOID' && windowMatches(w, s))) return -1;
  if (p.windows.some((w) => w.kind === 'PREFER' && windowMatches(w, s))) return 1;
  return 0;
}

export const hasStated = (p: StatedPreferences | undefined) => !!p && (p.windows.length > 0 || p.maxWeeklyHours !== null || p.maxDaysPerWeek !== null);

/** Each person's stated preferences, for the solver and the planner. */
export async function loadPreferences(tx: Tx, userIds: string[]): Promise<Map<string, StatedPreferences>> {
  if (!userIds.length) return new Map();
  const [rows, limits] = await Promise.all([
    tx.shiftPreference.findMany({ where: { userId: { in: userIds } }, orderBy: { createdAt: 'asc' } }),
    tx.shiftPreferenceLimit.findMany({ where: { userId: { in: userIds } } }),
  ]);
  const out = new Map<string, StatedPreferences>();
  const of = (id: string) => {
    let v = out.get(id);
    if (!v) out.set(id, (v = { windows: [], maxWeeklyHours: null, maxDaysPerWeek: null }));
    return v;
  };
  for (const r of rows) of(r.userId).windows.push({ kind: r.kind, daysOfWeek: r.daysOfWeek, startMinute: r.startMinute, endMinute: r.endMinute, positionId: r.positionId, facilityId: r.facilityId });
  for (const l of limits) {
    const v = of(l.userId);
    v.maxWeeklyHours = l.maxWeeklyHours ? Number(l.maxWeeklyHours) : null;
    v.maxDaysPerWeek = l.maxDaysPerWeek;
  }
  return out;
}

type Row = Prisma.ShiftPreferenceGetPayload<object>;
const view = (r: Row) => ({ id: r.id, kind: r.kind, daysOfWeek: r.daysOfWeek, startMinute: r.startMinute, endMinute: r.endMinute, positionId: r.positionId, facilityId: r.facilityId, note: r.note });

/** One person's preferences, as they and their schedulers see them. */
export async function readPreferences(tx: Tx, userId: string) {
  const [rows, limit] = await Promise.all([
    tx.shiftPreference.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    tx.shiftPreferenceLimit.findUnique({ where: { userId } }),
  ]);
  return {
    preferences: rows.map(view),
    maxWeeklyHours: limit?.maxWeeklyHours ? Number(limit.maxWeeklyHours) : null,
    maxDaysPerWeek: limit?.maxDaysPerWeek ?? null,
    updatedAt: [limit?.updatedAt, ...rows.map((r) => r.updatedAt)].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0]?.toISOString() ?? null,
  };
}

/** Replaces the person's preferences as a whole (positions they hold, facilities that exist). */
export async function replacePreferences(tx: Tx, tenantId: string, userId: string, body: z.infer<typeof preferencesBody>) {
  const positionIds = [...new Set(body.preferences.map((p) => p.positionId).filter((x): x is string => !!x))];
  if (positionIds.length && (await tx.userPosition.count({ where: { userId, positionId: { in: positionIds } } })) !== positionIds.length) throw badRequest('Choose one of your own positions.');
  const facilityIds = [...new Set(body.preferences.map((p) => p.facilityId).filter((x): x is string => !!x))];
  if (facilityIds.length && (await tx.facility.count({ where: { id: { in: facilityIds } } })) !== facilityIds.length) throw badRequest('Choose a facility from the list.');
  await tx.shiftPreference.deleteMany({ where: { userId } });
  if (body.preferences.length) {
    await tx.shiftPreference.createMany({ data: body.preferences.map((p) => ({ tenantId, userId, kind: p.kind, daysOfWeek: [...new Set(p.daysOfWeek)].sort(), startMinute: p.startMinute, endMinute: p.endMinute, positionId: p.positionId, facilityId: p.facilityId, note: p.note || null })) });
  }
  if (body.maxWeeklyHours === null && body.maxDaysPerWeek === null) await tx.shiftPreferenceLimit.deleteMany({ where: { userId } });
  else {
    const data = { maxWeeklyHours: body.maxWeeklyHours, maxDaysPerWeek: body.maxDaysPerWeek };
    await tx.shiftPreferenceLimit.upsert({ where: { userId }, create: { userId, tenantId, ...data }, update: data });
  }
  return readPreferences(tx, userId);
}

/** Deletes a person's preferences (anonymization). */
export async function forgetPreferences(tx: Tx, userId: string) {
  await tx.shiftPreference.deleteMany({ where: { userId } });
  await tx.shiftPreferenceLimit.deleteMany({ where: { userId } });
}

/** Retention: preferences of people who left (or were anonymized), untouched for PREFERENCES_INACTIVE_DAYS. */
export async function purgeInactivePreferences(tx: Tx, now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - PREFERENCES_INACTIVE_DAYS * 86_400_000);
  const gone = await tx.user.findMany({ where: { OR: [{ status: 'TERMINATED' }, { anonymizedAt: { not: null } }], updatedAt: { lt: before } }, select: { id: true } });
  if (!gone.length) return 0;
  const ids = gone.map((u) => u.id);
  const a = await tx.shiftPreference.deleteMany({ where: { userId: { in: ids }, updatedAt: { lt: before } } });
  const b = await tx.shiftPreferenceLimit.deleteMany({ where: { userId: { in: ids }, updatedAt: { lt: before } } });
  return a.count + b.count;
}
