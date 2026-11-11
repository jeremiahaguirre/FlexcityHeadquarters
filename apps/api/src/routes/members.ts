/**
 * Member services: families on file, registering children (or adults) into
 * published lessons and swim club sets, memberships, drop-ins and passes.
 * Children's records hold only what's needed: name, birth date, a short safety
 * note for the instructor, and the guardians' contacts.
 */
import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { HttpError, conflict, notFound } from '../lib/errors.js';
import { ageInMonths, fitsAge } from '../services/programs/levels.js';
import { setView } from './programs.js';
import { h } from './context.js';

export const membersRouter = Router();
membersRouter.use(['/households', '/registrations', '/offerings', '/fees', '/sales'], requireFeature('registration'));
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const today = () => new Date().toISOString().slice(0, 10);
const PAYMENT = z.enum(['CASH', 'DEBIT', 'CREDIT', 'ON_ACCOUNT', 'COMPLIMENTARY']);

const memberBody = z.object({
  role: z.enum(['GUARDIAN', 'CHILD', 'ADULT']),
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  dateOfBirth: isoDate.nullable().optional(),
  email: z.string().email().max(160).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  safetyNote: z.string().trim().max(200).nullable().optional(),
  photoConsent: z.boolean().optional(),
});
const memberData = (b: Partial<z.infer<typeof memberBody>>) => ({ ...b, ...(b.dateOfBirth !== undefined ? { dateOfBirth: b.dateOfBirth ? new Date(b.dateOfBirth) : null } : {}), ...(b.email ? { email: b.email.toLowerCase() } : {}) });

// ----------------------------------------------------------------- Families
membersRouter.get(
  '/households',
  requirePermission('members.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const { q } = z.object({ q: z.string().trim().max(80).default('') }).parse(req.query);
    const out = await withTenant(a.tenantId, async (tx) => {
      const where: Prisma.HouseholdWhereInput = q
        ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { members: { some: { OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] } } }] }
        : {};
      const list = await tx.household.findMany({ where, include: { members: { orderBy: [{ role: 'asc' }, { firstName: 'asc' }] } }, orderBy: { name: 'asc' }, take: 50 });
      return list.map((h) => ({ id: h.id, name: h.name, members: h.members.map((m) => ({ id: m.id, role: m.role, name: `${m.firstName} ${m.lastName}`, ageMonths: m.dateOfBirth ? ageInMonths(iso(m.dateOfBirth)!, today()) : null, phone: m.phone })) }));
    });
    res.json(out);
  }),
);

membersRouter.post(
  '/households',
  requirePermission('members.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = z
      .object({
        name: z.string().trim().min(2).max(80),
        address: z.string().trim().max(200).nullable().optional(),
        emergencyName: z.string().trim().max(80).nullable().optional(),
        emergencyPhone: z.string().trim().max(30).nullable().optional(),
        members: z.array(memberBody).min(1).max(12),
      })
      .parse(req.body);
    if (!b.members.some((m) => m.role !== 'CHILD')) throw new HttpError(400, 'NEEDS_GUARDIAN', 'Add at least one parent, guardian or adult.');
    const hh = await withTenant(a.tenantId, async (tx) => {
      const created = await tx.household.create({ data: { tenantId: a.tenantId, name: b.name, address: b.address ?? null, emergencyName: b.emergencyName ?? null, emergencyPhone: b.emergencyPhone ?? null } });
      for (const m of b.members) await tx.member.create({ data: { ...memberData(m), role: m.role, firstName: m.firstName, lastName: m.lastName, tenantId: a.tenantId, householdId: created.id } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'household.create', entity: 'Household', entityId: created.id });
      return created;
    });
    res.status(201).json({ id: hh.id });
  }),
);

membersRouter.get(
  '/households/:id',
  requirePermission('members.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const out = await withTenant(a.tenantId, async (tx) => {
      const hh = await tx.household.findUnique({ where: { id }, include: { members: { orderBy: [{ role: 'asc' }, { firstName: 'asc' }] } } });
      if (!hh) throw notFound('Family');
      // Children's details and health notes: every opening of a family's file is on record.
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'household.view', entity: 'Household', entityId: id });
      const [enrollments, sales] = await Promise.all([
        tx.lessonEnrollment.findMany({ where: { householdId: id }, include: { lessonClass: true }, orderBy: { createdAt: 'desc' } }),
        tx.sale.findMany({ where: { householdId: id }, orderBy: { createdAt: 'desc' }, take: 100 }),
      ]);
      const t = today();
      return {
        ...hh,
        members: hh.members.map((m) => ({ ...m, dateOfBirth: iso(m.dateOfBirth), ageMonths: m.dateOfBirth ? ageInMonths(iso(m.dateOfBirth)!, t) : null })),
        enrollments: enrollments.map((e) => ({
          id: e.id,
          memberId: e.memberId,
          swimmerName: e.swimmerName,
          status: e.status,
          priceCents: e.priceCents,
          set: { id: e.lessonClass.id, name: e.lessonClass.name, startsOn: iso(e.lessonClass.startsOn), endsOn: iso(e.lessonClass.endsOn), daysOfWeek: e.lessonClass.daysOfWeek.length ? e.lessonClass.daysOfWeek : [e.lessonClass.dayOfWeek], startMinute: e.lessonClass.startMinute },
        })),
        sales: sales.map((s) => ({ ...s, validFrom: iso(s.validFrom), validTo: iso(s.validTo) })),
        // A household is a member while any membership sale covers today.
        memberUntil: sales.filter((s) => !s.refundedAt && s.feeId && s.validTo && iso(s.validTo)! >= t && s.description.startsWith('M:')).map((s) => iso(s.validTo)).sort().pop() ?? null,
      };
    });
    res.json(out);
  }),
);

membersRouter.post(
  '/households/:id/members',
  requirePermission('members.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const householdId = uuid.parse(req.params.id);
    const b = memberBody.parse(req.body);
    const m = await withTenant(a.tenantId, async (tx) => {
      if (!(await tx.household.findUnique({ where: { id: householdId } }))) throw notFound('Family');
      return tx.member.create({ data: { ...memberData(b), role: b.role, firstName: b.firstName, lastName: b.lastName, tenantId: a.tenantId, householdId } });
    });
    res.status(201).json({ id: m.id });
  }),
);

membersRouter.patch(
  '/households/:id/members/:memberId',
  requirePermission('members.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = memberBody.partial().parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const m = await tx.member.findFirst({ where: { id: uuid.parse(req.params.memberId), householdId: uuid.parse(req.params.id) } });
      if (!m) throw notFound('Member');
      await tx.member.update({ where: { id: m.id }, data: memberData(b) });
      // The instructor's list shows the latest safety note.
      if (b.safetyNote !== undefined) await tx.lessonEnrollment.updateMany({ where: { memberId: m.id, active: true }, data: { safetyNote: b.safetyNote } });
    });
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------ Registration
/** Published sets a person can join, with whether their age fits and spots left. */
membersRouter.get(
  '/offerings',
  requirePermission('members.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const { memberId } = z.object({ memberId: uuid.optional() }).parse(req.query);
    const out = await withTenant(a.tenantId, async (tx) => {
      const member = memberId ? await tx.member.findUnique({ where: { id: memberId } }) : null;
      const campaigns = await tx.lessonCampaign.findMany({ where: { status: 'PUBLISHED', endsOn: { gte: new Date(today()) } }, orderBy: { startsOn: 'asc' } });
      const sets = await tx.lessonClass.findMany({ where: { campaignId: { in: campaigns.map((c) => c.id) } }, orderBy: [{ startsOn: 'asc' }, { startMinute: 'asc' }] });
      const counts = await tx.lessonEnrollment.groupBy({ by: ['classId', 'status'], where: { classId: { in: sets.map((s) => s.id) } }, _count: true });
      const n = (classId: string, status: string) => counts.find((x) => x.classId === classId && x.status === status)?._count ?? 0;
      const facilities = await tx.facility.findMany({ select: { id: true, name: true } });
      const now = new Date();
      return campaigns.map((c) => ({
        id: c.id,
        name: c.name,
        nameFr: c.nameFr,
        kind: c.kind,
        registrationOpen: (!c.registrationOpensAt || c.registrationOpensAt <= now) && (!c.registrationClosesAt || c.registrationClosesAt > now),
        registrationOpensAt: c.registrationOpensAt,
        sets: sets
          .filter((s) => s.campaignId === c.id)
          .map((s) => {
            const v = setView(s, n(s.id, 'ENROLLED'), n(s.id, 'WAITLISTED'), c.skipDates.map((d) => iso(d)!));
            const age = member?.dateOfBirth ? ageInMonths(iso(member.dateOfBirth)!, iso(s.startsOn)!) : null;
            return { ...v, facility: facilities.find((f) => f.id === s.facilityId)?.name ?? '', ageFits: age === null ? null : fitsAge(age, s.minAgeMonths, s.maxAgeMonths), ageAtStartMonths: age };
          }),
      }));
    });
    res.json(out);
  }),
);

membersRouter.post(
  '/registrations',
  requirePermission('members.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = z
      .object({
        setId: uuid,
        memberId: uuid,
        paymentMethod: PAYMENT,
        /** Register even though the age doesn't fit; the reason is kept. */
        ageOverride: z.string().trim().min(3).max(200).optional(),
        /** Staff can register before registration opens (e.g. returning swimmers). */
        early: z.boolean().optional(),
      })
      .parse(req.body);
    const out = await withTenant(a.tenantId, async (tx) => {
      const [set, member] = await Promise.all([tx.lessonClass.findUnique({ where: { id: b.setId } }), tx.member.findUnique({ where: { id: b.memberId } })]);
      if (!set || !set.campaignId) throw notFound('Set');
      if (!member) throw notFound('Member');
      const c = await tx.lessonCampaign.findUniqueOrThrow({ where: { id: set.campaignId } });
      if (c.status !== 'PUBLISHED') throw conflict('NOT_OPEN', 'This program isn’t open for registration.');
      const now = new Date();
      if (c.registrationClosesAt && c.registrationClosesAt <= now) throw conflict('REGISTRATION_CLOSED', 'Registration for this program has closed.');
      if (c.registrationOpensAt && c.registrationOpensAt > now && !b.early) throw conflict('NOT_OPEN_YET', 'Registration hasn’t opened yet.');
      if (await tx.lessonEnrollment.findFirst({ where: { classId: set.id, memberId: member.id, status: { not: 'CANCELLED' } } })) throw conflict('ALREADY_REGISTERED', 'Already registered in this set.');
      // Age at the first lesson.
      if (set.minAgeMonths !== null || set.maxAgeMonths !== null) {
        if (!member.dateOfBirth && !b.ageOverride) throw new HttpError(400, 'NEEDS_BIRTH_DATE', 'Add a birth date to check the age for this level.');
        const age = member.dateOfBirth ? ageInMonths(iso(member.dateOfBirth)!, iso(set.startsOn)!) : null;
        if (age !== null && !fitsAge(age, set.minAgeMonths, set.maxAgeMonths) && !b.ageOverride) {
          throw new HttpError(409, 'AGE_OUTSIDE_LEVEL', 'This participant’s age is outside this level.', { ageMonths: age, minAgeMonths: set.minAgeMonths, maxAgeMonths: set.maxAgeMonths });
        }
      }
      const enrolled = await tx.lessonEnrollment.count({ where: { classId: set.id, status: 'ENROLLED' } });
      const full = enrolled >= set.maxSwimmers;
      const isMember = await tx.sale.count({ where: { householdId: member.householdId, refundedAt: null, validTo: { gte: new Date(today()) }, description: { startsWith: 'M:' } } });
      const price = isMember && set.memberPriceCents !== null ? set.memberPriceCents : set.priceCents ?? 0;
      const e = await tx.lessonEnrollment.create({
        data: {
          tenantId: a.tenantId,
          classId: set.id,
          memberId: member.id,
          householdId: member.householdId,
          swimmerName: `${member.firstName} ${member.lastName}`,
          safetyNote: member.safetyNote,
          status: full ? 'WAITLISTED' : 'ENROLLED',
          active: !full,
          priceCents: price,
          registeredById: a.userId,
          ageOverride: b.ageOverride ?? null,
        },
      });
      // Waitlisted families pay when a spot opens.
      if (!full) {
        await tx.sale.create({ data: { tenantId: a.tenantId, householdId: member.householdId, memberId: member.id, enrollmentId: e.id, facilityId: set.facilityId, description: `L: ${set.name} (${c.name})`, priceCents: price, paymentMethod: b.paymentMethod, soldById: a.userId } });
      }
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: full ? 'registration.waitlist' : 'registration.create', entity: 'LessonEnrollment', entityId: e.id, after: { setId: set.id, memberId: member.id, ageOverride: b.ageOverride ?? null } });
      return { id: e.id, status: e.status, priceCents: price };
    });
    res.status(201).json(out);
  }),
);

/** Cancel a registration (refunding it if paid); the first person waiting gets the spot. */
membersRouter.post(
  '/registrations/:id/cancel',
  requirePermission('members.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const { refund } = z.object({ refund: z.boolean().default(true) }).parse(req.body ?? {});
    const promoted = await withTenant(a.tenantId, async (tx) => {
      const e = await tx.lessonEnrollment.findUnique({ where: { id: uuid.parse(req.params.id) } });
      if (!e) throw notFound('Registration');
      if (e.status === 'CANCELLED') throw conflict('ALREADY_CANCELLED', 'Already cancelled.');
      await tx.lessonEnrollment.update({ where: { id: e.id }, data: { status: 'CANCELLED', active: false } });
      if (refund) await tx.sale.updateMany({ where: { enrollmentId: e.id, refundedAt: null }, data: { refundedAt: new Date(), refundedById: a.userId } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'registration.cancel', entity: 'LessonEnrollment', entityId: e.id, after: { refund } });
      if (e.status !== 'ENROLLED') return null;
      const next = await tx.lessonEnrollment.findFirst({ where: { classId: e.classId, status: 'WAITLISTED' }, orderBy: { createdAt: 'asc' } });
      if (!next) return null;
      await tx.lessonEnrollment.update({ where: { id: next.id }, data: { status: 'ENROLLED', active: true } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'registration.promote', entity: 'LessonEnrollment', entityId: next.id });
      return { id: next.id, swimmerName: next.swimmerName, householdId: next.householdId };
    });
    // Member services call the family and take payment for the promoted spot.
    res.json({ ok: true, promoted });
  }),
);

/** A set's class list for planners and member services. */
membersRouter.get(
  '/registrations',
  (req, res, next) => (req.auth?.permissions.has('members.manage') || req.auth?.permissions.has('lessons.plan') ? next() : next(notFound('Page'))),
  h(async (req, res) => {
    const a = authOf(req);
    const { setId } = z.object({ setId: uuid }).parse(req.query);
    const list = await withTenant(a.tenantId, (tx) => tx.lessonEnrollment.findMany({ where: { classId: setId, status: { not: 'CANCELLED' } }, orderBy: [{ status: 'asc' }, { createdAt: 'asc' }] }));
    res.json(list.map((e) => ({ id: e.id, swimmerName: e.swimmerName, status: e.status, householdId: e.householdId, ageOverride: e.ageOverride, safetyNote: e.safetyNote })));
  }),
);

// ---------------------------------------------------------------- Price list
const feeBody = z.object({
  facilityId: uuid.nullable().optional(),
  kind: z.enum(['MEMBERSHIP', 'DROP_IN', 'PASS', 'PROGRAM']),
  period: z.enum(['YEAR', 'MONTH', 'VISIT', 'NONE']),
  ageGroup: z.enum(['ALL', 'ADULT', 'YOUTH', 'CHILD', 'SENIOR', 'FAMILY', 'STUDENT']),
  name: z.string().trim().min(2).max(80),
  nameFr: z.string().trim().max(80).nullable().optional(),
  priceCents: z.number().int().min(0).max(10_000_000),
  visits: z.number().int().min(1).max(200).nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

membersRouter.get(
  '/fees',
  (req, res, next) => (req.auth?.permissions.has('fees.manage') || req.auth?.permissions.has('members.manage') ? next() : next(notFound('Page'))),
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await withTenant(a.tenantId, (tx) => tx.feeItem.findMany({ orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }] })));
  }),
);

membersRouter.post(
  '/fees',
  requirePermission('fees.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = feeBody.parse(req.body);
    const f = await withTenant(a.tenantId, async (tx) => {
      const created = await tx.feeItem.create({ data: { ...b, tenantId: a.tenantId, facilityId: b.facilityId ?? null, nameFr: b.nameFr ?? null, visits: b.visits ?? null } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'fee.create', entity: 'FeeItem', entityId: created.id, after: b });
      return created;
    });
    res.status(201).json(f);
  }),
);

membersRouter.patch(
  '/fees/:id',
  requirePermission('fees.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const b = feeBody.partial().parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const before = await tx.feeItem.findUnique({ where: { id } });
      if (!before) throw notFound('Price');
      await tx.feeItem.update({ where: { id }, data: b });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'fee.update', entity: 'FeeItem', entityId: id, before: { priceCents: before.priceCents }, after: b });
    });
    res.json({ ok: true });
  }),
);

// -------------------------------------------------------------------- Sales
const addPeriod = (from: string, period: string) => {
  const d = new Date(`${from}T12:00:00Z`);
  if (period === 'YEAR') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else if (period === 'MONTH') d.setUTCMonth(d.getUTCMonth() + 1);
  else return from;
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** Sell a membership, drop-in, pass or program fee from the price list. */
membersRouter.post(
  '/sales',
  requirePermission('members.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ feeId: uuid, householdId: uuid.nullable().optional(), memberId: uuid.nullable().optional(), startsOn: isoDate.optional(), paymentMethod: PAYMENT, facilityId: uuid.nullable().optional() }).parse(req.body);
    const sale = await withTenant(a.tenantId, async (tx) => {
      const fee = await tx.feeItem.findUnique({ where: { id: b.feeId } });
      if (!fee || !fee.active) throw notFound('Price');
      if (fee.kind === 'MEMBERSHIP' && !b.householdId) throw new HttpError(400, 'NEEDS_FAMILY', 'Memberships are sold to a family or person on file.');
      if (b.memberId && !(await tx.member.findFirst({ where: { id: b.memberId, householdId: b.householdId ?? undefined } }))) throw notFound('Member');
      const from = b.startsOn ?? today();
      // Memberships start with "M:" so a family's current membership is easy to find.
      const prefix = fee.kind === 'MEMBERSHIP' ? 'M' : fee.kind === 'PASS' ? 'P' : fee.kind === 'DROP_IN' ? 'D' : 'G';
      const created = await tx.sale.create({
        data: {
          tenantId: a.tenantId,
          householdId: b.householdId ?? null,
          memberId: b.memberId ?? null,
          feeId: fee.id,
          facilityId: b.facilityId ?? fee.facilityId,
          description: `${prefix}: ${fee.name}`,
          priceCents: fee.priceCents,
          validFrom: new Date(from),
          validTo: new Date(fee.kind === 'MEMBERSHIP' ? addPeriod(from, fee.period) : from),
          paymentMethod: b.paymentMethod,
          soldById: a.userId,
        },
      });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'sale.create', entity: 'Sale', entityId: created.id, after: { feeId: fee.id, priceCents: fee.priceCents } });
      return created;
    });
    res.status(201).json({ ...sale, validFrom: iso(sale.validFrom), validTo: iso(sale.validTo) });
  }),
);

membersRouter.post(
  '/sales/:id/refund',
  requirePermission('members.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    await withTenant(a.tenantId, async (tx) => {
      const s = await tx.sale.findUnique({ where: { id: uuid.parse(req.params.id) } });
      if (!s) throw notFound('Sale');
      if (s.refundedAt) throw conflict('ALREADY_REFUNDED', 'Already refunded.');
      await tx.sale.update({ where: { id: s.id }, data: { refundedAt: new Date(), refundedById: a.userId } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'sale.refund', entity: 'Sale', entityId: s.id });
    });
    res.json({ ok: true });
  }),
);

/** Today's (or a day's) takings by payment method, for cashing out. */
membersRouter.get(
  '/sales/summary',
  requirePermission('members.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const { day } = z.object({ day: isoDate.default(today()) }).parse(req.query);
    const from = new Date(`${day}T00:00:00Z`);
    const to = new Date(from.getTime() + 86_400_000);
    const rows = await withTenant(a.tenantId, (tx) => tx.sale.findMany({ where: { createdAt: { gte: from, lt: to }, refundedAt: null } }));
    const byMethod: Record<string, number> = {};
    for (const r of rows) byMethod[r.paymentMethod] = (byMethod[r.paymentMethod] ?? 0) + r.priceCents;
    res.json({ day, count: rows.length, totalCents: rows.reduce((s, r) => s + r.priceCents, 0), byMethod });
  }),
);
