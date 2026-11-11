/**
 * Required coverage: for each rule and day, the stretches of its window where
 * fewer people holding the certificate (verified, valid that day) are
 * scheduled at the facility than the rule needs.
 */
import type { CoverageRule } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { Tx } from '../../lib/db.js';
import { wallClock } from '../scheduling/eligibility.js';
import { addDays, dayOfWeek, localIso } from '../../lib/time.js';
import { notify, usersWithPermission } from '../notifications/notifier.js';

/** `localFrom`/`localTo`: facility-local times with offset (what screens show). */
export interface Gap { ruleId: string; rule: string; facilityId: string; date: string; from: string; to: string; have: number; need: number; localFrom?: string; localTo?: string }

/**
 * `asIfPublished`: also count these draft shifts (the ones about to be published), so the publish
 * dialog can warn about the gaps the schedule would leave.
 */
export async function coverageGaps(tx: Tx, from: string, days: number, facilityId?: string, asIfPublished: Prisma.ShiftWhereInput | null = null): Promise<Gap[]> {
  const rules = await tx.coverageRule.findMany({ where: { active: true, ...(facilityId ? { facilityId } : {}) } });
  if (!rules.length) return [];
  const facilities = await tx.facility.findMany({ where: { id: { in: [...new Set(rules.map((r) => r.facilityId))] } }, select: { id: true, timezone: true } });
  const out: Gap[] = [];
  for (const rule of rules) {
    const tz = facilities.find((f) => f.id === rule.facilityId)?.timezone ?? 'America/Toronto';
    for (let i = 0; i < days; i++) {
      const date = addDays(from, i);
      if (!rule.daysOfWeek.includes(dayOfWeek(date))) continue;
      out.push(...(await gapsOn(tx, rule, date, tz, asIfPublished)));
    }
  }
  return out.sort((a, b) => a.from.localeCompare(b.from));
}

async function gapsOn(tx: Tx, rule: CoverageRule, date: string, tz: string, asIfPublished: Prisma.ShiftWhereInput | null): Promise<Gap[]> {
  // Wall-clock window (DST-correct; past 1440 runs into the next morning).
  const start = wallClock(date, rule.startMinute, tz);
  const end = wallClock(date, rule.endMinute, tz);
  const shifts = await tx.shift.findMany({
    where: { facilityId: rule.facilityId, userId: { not: null }, startsAt: { lt: end }, endsAt: { gt: start }, OR: [{ status: 'PUBLISHED' }, ...(asIfPublished ? [{ AND: [asIfPublished, { status: 'DRAFT' as const }] }] : [])] },
    select: { userId: true, startsAt: true, endsAt: true },
  });
  const holders = new Set(
    (
      await tx.userCertification.findMany({
        where: { certificationId: rule.certificationId, userId: { in: [...new Set(shifts.map((s) => s.userId!))] }, verifiedAt: { not: null }, OR: [{ expiryDate: null }, { expiryDate: { gte: new Date(`${date}T00:00:00Z`) } }] },
        select: { userId: true },
      })
    ).map((c) => c.userId),
  );
  // Sweep the window: count qualified people on at each moment.
  const cover = shifts.filter((s) => holders.has(s.userId!)).map((s) => ({ a: Math.max(s.startsAt.getTime(), start.getTime()), b: Math.min(s.endsAt.getTime(), end.getTime()) }));
  const points = [...new Set([start.getTime(), end.getTime(), ...cover.flatMap((c) => [c.a, c.b])])].filter((p) => p >= start.getTime() && p <= end.getTime()).sort((x, y) => x - y);
  const gaps: Gap[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const have = cover.filter((c) => c.a <= a && c.b >= b).length;
    if (have >= rule.minCount) continue;
    const last = gaps.at(-1);
    // Merge touching stretches with the same count.
    if (last && last.to === new Date(a).toISOString() && last.have === have) last.to = new Date(b).toISOString();
    else gaps.push({ ruleId: rule.id, rule: rule.name, facilityId: rule.facilityId, date, from: new Date(a).toISOString(), to: new Date(b).toISOString(), have, need: rule.minCount });
  }
  return gaps.map((g) => ({ ...g, localFrom: localIso(new Date(g.from), tz), localTo: localIso(new Date(g.to), tz) }));
}

/** Hourly: gaps in the next two days, once a day per rule, to whoever keeps coverage. */
export async function coverageAlerts(tx: Tx, now = new Date()): Promise<number> {
  const gaps = await coverageGaps(tx, now.toISOString().slice(0, 10), 3);
  const soon = gaps.filter((g) => new Date(g.from).getTime() < now.getTime() + 48 * 3_600_000 && new Date(g.to).getTime() > now.getTime());
  if (!soon.length) return 0;
  const t = await tx.tenant.findFirstOrThrow({ select: { id: true } });
  const to = await usersWithPermission(tx, t.id, 'coverage.manage');
  let n = 0;
  for (const ruleId of [...new Set(soon.map((g) => g.ruleId))]) {
    const claimed = await tx.coverageRule.updateMany({ where: { id: ruleId, OR: [{ lastAlertedAt: null }, { lastAlertedAt: { lt: new Date(now.getTime() - 20 * 3_600_000) } }] }, data: { lastAlertedAt: now } });
    if (!claimed.count) continue;
    const first = soon.find((g) => g.ruleId === ruleId)!;
    await notify(tx, t.id, to.map((userId) => ({ userId, type: 'coverage_gap', params: { rule: first.rule, from: first.from, count: soon.filter((g) => g.ruleId === ruleId).length }, link: '/manage/coverage', email: 'coverage_gap' })));
    n++;
  }
  return n;
}
