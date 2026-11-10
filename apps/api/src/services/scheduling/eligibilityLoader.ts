/**
 * Loads everything evaluateCandidate() needs from the database.
 *
 * SQL does the coarse, index-friendly filtering (active, qualified for the
 * position, holds every required cert, no overlapping shift, no overlapping
 * approved time off); the pure evaluator then makes the final decision and
 * explains every rejection.
 */
import type { Prisma, Province } from '@prisma/client';
import { dec } from '../../lib/money.js';
import type { Tx } from '../../lib/db.js';
import { localDate } from '../../lib/time.js';
import { type ProvinceRules, resolveRules } from '../compliance/provincialRules.js';
import { buildSchoolCalendar } from '../compliance/schoolCalendar.js';
import { blockingItemsForPosition } from '../people/onboarding.js';
import { type CandidateContext, type EvaluateOptions, type PositionSpec, type SchoolCalendar, type ShiftSpec, parseHoursOfService } from './eligibility.js';

const NEIGHBOURHOOD_MS = 8 * 86_400_000; // enough for rest + weekly checks

export interface ShiftBundle {
  shift: ShiftSpec & { tenantId: string; facilityId: string; userId: string | null; version: number; status: string };
  position: PositionSpec;
  province: Province;
  rules: ProvinceRules;
  payWeekStartDay: number;
  schoolCalendar: SchoolCalendar;
}

/** Evaluation options for a shift — every caller uses this so none forgets a rule input. */
export function evalOpts(bundle: ShiftBundle, requireAvailability = false): EvaluateOptions {
  return { rules: bundle.rules, payWeekStartDay: bundle.payWeekStartDay, requireAvailability, schoolCalendar: bundle.schoolCalendar };
}

export async function loadShiftBundle(tx: Tx, shiftId: string): Promise<ShiftBundle | null> {
  const s = await tx.shift.findUnique({
    where: { id: shiftId },
    include: {
      facility: { include: { tenant: { include: { ruleOverrides: true } } } },
      position: { include: { requirements: { include: { certification: { include: { prerequisites: true } } } } } },
    },
  });
  if (!s) return null;
  const tz = s.facility.timezone;
  const onDate = localDate(s.startsAt, tz);
  const rules = resolveRules(
    s.facility.province,
    onDate,
    s.facility.tenant.ruleOverrides.map((o) => ({
      province: o.province,
      ruleKey: o.ruleKey,
      value: o.value,
      effectiveFrom: o.effectiveFrom.toISOString().slice(0, 10),
      effectiveTo: o.effectiveTo?.toISOString().slice(0, 10) ?? null,
    })),
  );
  const periods = await tx.schoolCalendarPeriod.findMany();
  const schoolCalendar = buildSchoolCalendar(
    periods.map((x) => ({ kind: x.kind, startsOn: x.startsOn.toISOString().slice(0, 10), endsOn: x.endsOn.toISOString().slice(0, 10) })),
  );
  const prerequisites = new Map<string, string[]>();
  for (const r of s.position.requirements) {
    prerequisites.set(r.certificationId, r.certification.prerequisites.map((p) => p.requiresId));
  }
  return {
    shift: {
      id: s.id,
      tenantId: s.tenantId,
      facilityId: s.facilityId,
      positionId: s.positionId,
      userId: s.userId,
      version: s.version,
      status: s.status,
      start: s.startsAt,
      end: s.endsAt,
      timezone: tz,
    },
    position: {
      id: s.positionId,
      minimumAge: s.position.minimumAge,
      requiredCertIds: s.position.requirements.map((r) => r.certificationId),
      prerequisites,
      blockingOnboarding: await blockingItemsForPosition(tx, s.positionId),
      hoursOfService: parseHoursOfService(s.position.hoursOfService),
    },
    province: s.facility.province,
    rules,
    payWeekStartDay: s.facility.tenant.payWeekStartDay,
    schoolCalendar,
  };
}

/** Candidates that pass the coarse SQL filter, with full context for evaluation. */
export async function loadCandidates(
  tx: Tx,
  bundle: ShiftBundle,
  opts: { onlyUserIds?: string[] } = {},
): Promise<CandidateContext[]> {
  const { shift, position } = bundle;
  const shiftEndDate = new Date(shift.end);

  const where: Prisma.UserWhereInput = {
    status: 'ACTIVE',
    anonymizedAt: null,
    processingRestrictedAt: null,
    positions: { some: { positionId: shift.positionId } },
    // Each required cert must be held — one `some` per cert (NOT `every`).
    AND: position.requiredCertIds.map((certificationId) => ({
      certifications: {
        some: { certificationId, verifiedAt: { not: null }, OR: [{ expiryDate: null }, { expiryDate: { gte: shiftEndDate } }] },
      },
    })),
    shifts: { none: { status: { not: 'CANCELLED' }, startsAt: { lt: shift.end }, endsAt: { gt: shift.start } } },
    timeOffRequests: { none: { status: 'APPROVED', startsAt: { lt: shift.end }, endsAt: { gt: shift.start } } },
    ...(opts.onlyUserIds ? { id: { in: opts.onlyUserIds } } : {}),
  };

  const from = new Date(shift.start.getTime() - NEIGHBOURHOOD_MS);
  const to = new Date(shift.end.getTime() + NEIGHBOURHOOD_MS);
  const users = await tx.user.findMany({
    where,
    include: {
      positions: true,
      certifications: true,
      onboarding: { orderBy: { recordedAt: 'desc' } },
      accommodations: { where: { status: 'ACTIVE' } },
      availability: true,
      shifts: { where: { status: { not: 'CANCELLED' }, startsAt: { lt: to }, endsAt: { gt: from } } },
      timeOffRequests: { where: { status: 'APPROVED', startsAt: { lt: to }, endsAt: { gt: from } } },
    },
  });
  return users.map(toCandidateContext);
}

/** Build a context for one specific user, skipping the coarse filter (for claims). */
export async function loadCandidate(tx: Tx, bundle: ShiftBundle, userId: string): Promise<CandidateContext | null> {
  const from = new Date(bundle.shift.start.getTime() - NEIGHBOURHOOD_MS);
  const to = new Date(bundle.shift.end.getTime() + NEIGHBOURHOOD_MS);
  const u = await tx.user.findUnique({
    where: { id: userId },
    include: {
      positions: true,
      certifications: true,
      onboarding: { orderBy: { recordedAt: 'desc' } },
      accommodations: { where: { status: 'ACTIVE' } },
      availability: true,
      shifts: { where: { status: { not: 'CANCELLED' }, startsAt: { lt: to }, endsAt: { gt: from }, id: { not: bundle.shift.id } } },
      timeOffRequests: { where: { status: 'APPROVED', startsAt: { lt: to }, endsAt: { gt: from } } },
    },
  });
  return u ? toCandidateContext(u) : null;
}

type LoadedUser = Prisma.UserGetPayload<{
  include: { positions: true; certifications: true; availability: true; shifts: true; timeOffRequests: true; onboarding: true; accommodations: true };
}>;

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function toCandidateContext(u: LoadedUser): CandidateContext {
  // Keep the LATEST expiry per certification (renewals add new rows).
  const certExpiry = new Map<string, string | null>();
  // Only certifications a supervisor has verified count toward eligibility.
  for (const c of u.certifications.filter((x) => x.verifiedAt !== null)) {
    const exp = isoDate(c.expiryDate);
    const prev = certExpiry.get(c.certificationId);
    if (!certExpiry.has(c.certificationId) || exp === null || (prev !== null && prev !== undefined && exp > prev)) {
      certExpiry.set(c.certificationId, exp);
    }
  }
  // Latest record per onboarding item: waived = no expiry.
  const onboardingValid = new Map<string, string | null>();
  for (const r of [...u.onboarding].sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())) {
    if (!onboardingValid.has(r.itemId)) onboardingValid.set(r.itemId, r.status === 'WAIVED' ? null : isoDate(r.expiresOn));
  }
  return {
    userId: u.id,
    status: u.status,
    onboardingValid,
    restrictions: u.accommodations.map((r) => ({
      startsOn: isoDate(r.startsOn)!,
      endsOn: isoDate(r.endsOn),
      maxShiftHours: r.maxShiftHours ? Number(r.maxShiftHours) : null,
      maxWeeklyHours: r.maxWeeklyHours ? Number(r.maxWeeklyHours) : null,
      noStartBefore: r.noStartBefore,
      noEndAfter: r.noEndAfter,
      daysOff: r.daysOff,
      excludedPositionIds: r.excludedPositionIds,
    })),
    dateOfBirth: isoDate(u.dateOfBirth),
    weeklyMaxHours: u.weeklyMaxHours ? dec(u.weeklyMaxHours) : null,
    qualifiedPositionIds: new Set(u.positions.map((p) => p.positionId)),
    certExpiry,
    existingShifts: u.shifts.map((s) => ({ start: s.startsAt, end: s.endsAt, positionId: s.positionId })),
    approvedTimeOff: u.timeOffRequests.map((t) => ({ start: t.startsAt, end: t.endsAt })),
    availability: u.availability.map((a) => ({
      dayOfWeek: a.dayOfWeek,
      startMinute: a.startMinute,
      endMinute: a.endMinute,
      effectiveFrom: isoDate(a.effectiveFrom)!,
      effectiveTo: isoDate(a.effectiveTo),
    })),
  };
}

/** All active staff with context covering [from, to] — for the scheduling assistant. */
export async function loadAssistantCandidates(tx: Tx, from: Date, to: Date) {
  const lo = new Date(from.getTime() - NEIGHBOURHOOD_MS);
  const hi = new Date(to.getTime() + NEIGHBOURHOOD_MS);
  const users = await tx.user.findMany({
    where: { status: 'ACTIVE', anonymizedAt: null, processingRestrictedAt: null },
    include: {
      positions: true,
      certifications: true,
      onboarding: { orderBy: { recordedAt: 'desc' } },
      accommodations: { where: { status: 'ACTIVE' } },
      availability: true,
      shifts: { where: { status: { not: 'CANCELLED' }, startsAt: { lt: hi }, endsAt: { gt: lo } } },
      timeOffRequests: { where: { status: 'APPROVED', startsAt: { lt: hi }, endsAt: { gt: lo } } },
    },
  });
  return users.map((u) => ({
    ...toCandidateContext(u),
    employmentStatus: u.employmentStatus,
    shadowTier: u.shadowTier,
    seniorityDate: isoDate(u.seniorityDate),
    seniorityHours: dec(u.seniorityHours),
    weeklyMinHours: u.weeklyMinHours ? dec(u.weeklyMinHours) : null,
  }));
}
