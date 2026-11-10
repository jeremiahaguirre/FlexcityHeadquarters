/**
 * The public sign-up portal, on each organization's own address, with no
 * account: families register for published programs and request facility
 * bookings. Staff then take payment and confirm bookings.
 *
 * Protections: per-IP rate limits, a hidden field bots fill in, a minimum
 * time to fill the form, consent to the organization's terms and privacy
 * notice, and no information about other families is ever returned.
 */
import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import { allow } from '../auth/rateLimit.js';
import { type Tx, audit, withTenant } from '../lib/db.js';
import { HttpError, conflict, notFound } from '../lib/errors.js';
import { notify, usersWithPermission } from '../services/notifications/notifier.js';
import { ageInMonths, fitsAge } from '../services/programs/levels.js';
import { sessionDates } from '../services/lessons/lessons.js';
import { h } from './context.js';

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const reference = (prefix: string) => `${prefix}-${[...randomBytes(6)].map((b) => ALPHABET[b % ALPHABET.length]).join('')}`;

export interface SignupSettings { enabled: boolean; terms: string; termsFr: string; payment: string; paymentFr: string; privacyContact: string }
export function parseSignup(stored: unknown): SignupSettings {
  const s = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  const str = (k: string) => (typeof s[k] === 'string' ? (s[k] as string) : '');
  return { enabled: s.enabled === true, terms: str('terms'), termsFr: str('termsFr'), payment: str('payment'), paymentFr: str('paymentFr'), privacyContact: str('privacyContact') };
}

async function settingsOf(tx: Tx) {
  const t = await tx.tenant.findFirstOrThrow({ select: { name: true, signupSettings: true, defaultLocale: true, timeFormat: true } });
  return { name: t.name, locale: t.defaultLocale, timeFormat: t.timeFormat, ...parseSignup(t.signupSettings) };
}

/** Bots fill hidden fields and submit instantly; people don't. */
const humanCheck = z.object({ website: z.string().max(500).optional().default(''), startedAt: z.number().int() });
function assertHuman(b: { website?: string; startedAt: number }) {
  if (b.website) throw new HttpError(400, 'REJECTED', 'This form couldn’t be sent.');
  if (Date.now() - b.startedAt < 3000) throw new HttpError(400, 'TOO_FAST', 'Please take a moment to check the form, then send it again.');
}
async function rate(req: { ip?: string; tenantId?: string }, what: string, limit: number) {
  if (!(await allow(`public-${what}:${req.ip}:${req.tenantId}`, limit, 60 * 60_000))) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many sign-ups from here. Please call the facility.');
}

// ------------------------------------------------------------------- Public
export const publicSignupRouter = Router();
publicSignupRouter.use('/public/signup', requireFeature('registration'));

/** Everything a family can sign up for right now, and the organization's terms. */
publicSignupRouter.get(
  '/public/signup',
  h(async (req, res) => {
    const out = await withTenant(req.tenantId!, async (tx) => {
      const s = await settingsOf(tx);
      if (!s.enabled) return { enabled: false };
      const now = new Date();
      const campaigns = await tx.lessonCampaign.findMany({ where: { status: 'PUBLISHED', endsOn: { gte: new Date(today()) } }, orderBy: { startsOn: 'asc' } });
      const sets = await tx.lessonClass.findMany({ where: { campaignId: { in: campaigns.map((c) => c.id) } }, orderBy: [{ startsOn: 'asc' }, { startMinute: 'asc' }] });
      const counts = await tx.lessonEnrollment.groupBy({ by: ['classId'], where: { classId: { in: sets.map((x) => x.id) }, status: 'ENROLLED' }, _count: true });
      const [facilities, services] = await Promise.all([
        tx.facility.findMany({ select: { id: true, name: true } }),
        tx.bookableService.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
      ]);
      const fac = (id: string) => facilities.find((f) => f.id === id)?.name ?? '';
      return {
        enabled: true,
        organization: s.name,
        timeFormat: s.timeFormat,
        terms: s.terms,
        termsFr: s.termsFr,
        payment: s.payment,
        paymentFr: s.paymentFr,
        privacyContact: s.privacyContact,
        programs: campaigns.map((c) => ({
          id: c.id,
          name: c.name,
          nameFr: c.nameFr,
          kind: c.kind,
          open: (!c.registrationOpensAt || c.registrationOpensAt <= now) && (!c.registrationClosesAt || c.registrationClosesAt > now),
          opensAt: c.registrationOpensAt,
          closesAt: c.registrationClosesAt,
          sets: sets
            .filter((x) => x.campaignId === c.id)
            .map((x) => {
              const enrolled = counts.find((k) => k.classId === x.id)?._count ?? 0;
              return {
                id: x.id,
                name: x.name,
                facility: fac(x.facilityId),
                daysOfWeek: x.daysOfWeek.length ? x.daysOfWeek : [x.dayOfWeek],
                startMinute: x.startMinute,
                endMinute: x.endMinute,
                startsOn: iso(x.startsOn),
                endsOn: iso(x.endsOn),
                sessions: sessionDates(x, iso(x.startsOn), iso(x.endsOn), c.skipDates.map(iso)).length,
                minAgeMonths: x.minAgeMonths,
                maxAgeMonths: x.maxAgeMonths,
                priceCents: x.priceCents,
                memberPriceCents: x.memberPriceCents,
                // Enough to decide; never who is registered.
                spotsLeft: Math.max(0, x.maxSwimmers - enrolled),
              };
            }),
        })),
        services: services.map((v) => ({ id: v.id, name: v.name, nameFr: v.nameFr, description: v.description, descriptionFr: v.descriptionFr, facility: fac(v.facilityId), durationMinutes: v.durationMinutes, priceCents: v.priceCents, maxPartySize: v.maxPartySize, daysOfWeek: v.daysOfWeek, leadDays: v.leadDays })),
      };
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json(out);
  }),
);

const person = { firstName: z.string().trim().min(1).max(60), lastName: z.string().trim().min(1).max(60) };
const registrationBody = humanCheck.extend({
  setId: uuid,
  guardian: z.object({ ...person, email: z.string().email().max(160), phone: z.string().trim().min(7).max(30) }),
  address: z.string().trim().max(200).optional().default(''),
  emergency: z.object({ name: z.string().trim().min(2).max(80), phone: z.string().trim().min(7).max(30) }),
  /** The person taking part: a child, or the adult registering themself. */
  participant: z.object({ ...person, dateOfBirth: isoDate, safetyNote: z.string().trim().max(200).optional().default(''), self: z.boolean().default(false) }),
  consents: z.object({ terms: z.literal(true), privacy: z.literal(true), photo: z.boolean().default(false) }),
  locale: z.enum(['en-CA', 'fr-CA']).default('en-CA'),
});

publicSignupRouter.post(
  '/public/registrations',
  requireFeature('registration'),
  h(async (req, res) => {
    const b = registrationBody.parse(req.body);
    assertHuman(b);
    await rate(req, 'register', 10);
    const out = await withTenant(req.tenantId!, async (tx) => {
      const s = await settingsOf(tx);
      if (!s.enabled) throw notFound('Sign-up');
      const set = await tx.lessonClass.findUnique({ where: { id: b.setId } });
      const c = set?.campaignId ? await tx.lessonCampaign.findUnique({ where: { id: set.campaignId } }) : null;
      if (!set || !c || c.status !== 'PUBLISHED') throw notFound('Program');
      const now = new Date();
      if ((c.registrationOpensAt && c.registrationOpensAt > now) || (c.registrationClosesAt && c.registrationClosesAt <= now)) throw conflict('REGISTRATION_CLOSED', 'Registration for this program isn’t open.');
      const age = ageInMonths(b.participant.dateOfBirth, iso(set.startsOn));
      if (age < 0) throw new HttpError(400, 'BAD_BIRTH_DATE', 'Check the birth date.');
      if (!fitsAge(age, set.minAgeMonths, set.maxAgeMonths)) throw new HttpError(409, 'AGE_OUTSIDE_LEVEL', 'The participant’s age doesn’t fit this program. Pick another, or call the facility.');
      // The same person in the same program twice (a double click, a second parent).
      const swimmerName = `${b.participant.firstName} ${b.participant.lastName}`;
      const dup = await tx.lessonEnrollment.findFirst({ where: { classId: set.id, swimmerName: { equals: swimmerName, mode: 'insensitive' }, status: { not: 'CANCELLED' }, source: 'ONLINE' } });
      if (dup) throw conflict('ALREADY_REGISTERED', 'This person is already signed up for this program.');
      const household = await tx.household.create({
        data: { tenantId: req.tenantId!, name: b.guardian.lastName, address: b.address || null, emergencyName: b.emergency.name, emergencyPhone: b.emergency.phone, source: 'ONLINE', notes: `Signed up online ${now.toISOString().slice(0, 10)}; terms and privacy accepted${b.consents.photo ? '; photo consent given' : ''}.` },
      });
      const guardian = await tx.member.create({ data: { tenantId: req.tenantId!, householdId: household.id, role: b.participant.self ? 'ADULT' : 'GUARDIAN', firstName: b.guardian.firstName, lastName: b.guardian.lastName, email: b.guardian.email.toLowerCase(), phone: b.guardian.phone, ...(b.participant.self ? { dateOfBirth: new Date(b.participant.dateOfBirth), safetyNote: b.participant.safetyNote || null, photoConsent: b.consents.photo } : {}) } });
      const participant = b.participant.self
        ? guardian
        : await tx.member.create({ data: { tenantId: req.tenantId!, householdId: household.id, role: 'CHILD', firstName: b.participant.firstName, lastName: b.participant.lastName, dateOfBirth: new Date(b.participant.dateOfBirth), safetyNote: b.participant.safetyNote || null, photoConsent: b.consents.photo } });
      const enrolled = await tx.lessonEnrollment.count({ where: { classId: set.id, status: 'ENROLLED' } });
      const full = enrolled >= set.maxSwimmers;
      const ref = reference('R');
      const e = await tx.lessonEnrollment.create({
        data: { tenantId: req.tenantId!, classId: set.id, memberId: participant.id, householdId: household.id, swimmerName, safetyNote: b.participant.safetyNote || null, status: full ? 'WAITLISTED' : 'ENROLLED', active: !full, priceCents: set.priceCents ?? 0, source: 'ONLINE', reference: ref },
      });
      const fr = b.locale === 'fr-CA';
      const dow = (d: number) => new Intl.DateTimeFormat(b.locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 1 + d)));
      const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const days = set.daysOfWeek.length ? set.daysOfWeek : [set.dayOfWeek];
      await tx.emailOutbox.create({
        data: {
          tenantId: req.tenantId!,
          toEmail: b.guardian.email.toLowerCase(),
          template: 'signup_confirmation',
          locale: b.locale,
          params: {
            organization: s.name,
            reference: ref,
            participant: swimmerName,
            set: set.name,
            campaign: fr && c.nameFr ? c.nameFr : c.name,
            when: `${days.map(dow).join(', ')} ${hhmm(set.startMinute)}–${hhmm(set.endMinute)}, ${iso(set.startsOn)} – ${iso(set.endsOn)}`,
            price: new Intl.NumberFormat(b.locale, { style: 'currency', currency: 'CAD' }).format((set.priceCents ?? 0) / 100),
            payment: fr ? s.paymentFr || s.payment : s.payment,
            status: e.status,
          },
        },
      });
      await audit(tx, { tenantId: req.tenantId!, actorId: null, action: 'registration.online', entity: 'LessonEnrollment', entityId: e.id, after: { setId: set.id, status: e.status, consents: b.consents } });
      return { reference: ref, status: e.status, priceCents: set.priceCents ?? 0 };
    });
    res.status(201).json(out);
  }),
);

/** Start times still free on a day, in the facility's time zone. */
async function freeSlots(tx: Tx, serviceId: string, date: string) {
  const v = await tx.bookableService.findUnique({ where: { id: serviceId } });
  if (!v || !v.active) throw notFound('Service');
  const f = await tx.facility.findUniqueOrThrow({ where: { id: v.facilityId }, select: { timezone: true } });
  const day = DateTime.fromISO(date, { zone: f.timezone });
  const earliest = DateTime.now().setZone(f.timezone).startOf('day').plus({ days: v.leadDays });
  if (!day.isValid || day < earliest || !v.daysOfWeek.includes(day.weekday % 7)) return { service: v, timezone: f.timezone, slots: [] as Array<{ startMinute: number; startsAt: Date; endsAt: Date }> };
  const taken = await tx.bookingRequest.findMany({ where: { serviceId, status: { in: ['REQUESTED', 'CONFIRMED'] }, startsAt: { lt: day.endOf('day').toJSDate() }, endsAt: { gt: day.startOf('day').toJSDate() } } });
  const slots = [];
  for (let m = v.openMinute; m + v.durationMinutes <= v.closeMinute; m += v.durationMinutes) {
    const startsAt = day.startOf('day').plus({ minutes: m }).toJSDate();
    const endsAt = day.startOf('day').plus({ minutes: m + v.durationMinutes }).toJSDate();
    const overlapping = taken.filter((t) => t.startsAt < endsAt && t.endsAt > startsAt).length;
    if (overlapping < v.capacity) slots.push({ startMinute: m, startsAt, endsAt });
  }
  return { service: v, timezone: f.timezone, slots };
}

publicSignupRouter.get(
  '/public/services/:id/slots',
  requireFeature('registration'),
  h(async (req, res) => {
    const { date } = z.object({ date: isoDate }).parse(req.query);
    const out = await withTenant(req.tenantId!, async (tx) => {
      if (!(await settingsOf(tx)).enabled) throw notFound('Sign-up');
      return (await freeSlots(tx, uuid.parse(req.params.id), date)).slots.map((s) => ({ startMinute: s.startMinute }));
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json(out);
  }),
);

publicSignupRouter.post(
  '/public/bookings',
  requireFeature('registration'),
  h(async (req, res) => {
    const b = humanCheck
      .extend({
        serviceId: uuid,
        date: isoDate,
        startMinute: z.number().int().min(0).max(1439),
        partySize: z.number().int().min(1).max(1000).optional(),
        contact: z.object({ name: z.string().trim().min(2).max(80), email: z.string().email().max(160), phone: z.string().trim().min(7).max(30) }),
        organization: z.string().trim().max(120).optional().default(''),
        notes: z.string().trim().max(1000).optional().default(''),
        consents: z.object({ terms: z.literal(true), privacy: z.literal(true) }),
        locale: z.enum(['en-CA', 'fr-CA']).default('en-CA'),
      })
      .parse(req.body);
    assertHuman(b);
    await rate(req, 'book', 10);
    const out = await withTenant(req.tenantId!, async (tx) => {
      if (!(await settingsOf(tx)).enabled) throw notFound('Sign-up');
      const { service, slots, timezone } = await freeSlots(tx, b.serviceId, b.date);
      const slot = slots.find((s) => s.startMinute === b.startMinute);
      if (!slot) throw conflict('SLOT_TAKEN', 'That time isn’t available any more. Pick another.');
      if (service.maxPartySize && b.partySize && b.partySize > service.maxPartySize) throw new HttpError(400, 'PARTY_TOO_BIG', `This booking is for up to ${service.maxPartySize} people.`);
      const ref = reference('B');
      const r = await tx.bookingRequest.create({
        data: { tenantId: req.tenantId!, serviceId: service.id, startsAt: slot.startsAt, endsAt: slot.endsAt, partySize: b.partySize ?? null, name: b.contact.name, email: b.contact.email.toLowerCase(), phone: b.contact.phone, organization: b.organization || null, notes: b.notes || null, reference: ref },
      });
      const when = DateTime.fromJSDate(slot.startsAt, { zone: timezone }).setLocale(b.locale).toLocaleString(DateTime.DATETIME_MED);
      const name = b.locale === 'fr-CA' && service.nameFr ? service.nameFr : service.name;
      await tx.emailOutbox.create({ data: { tenantId: req.tenantId!, toEmail: r.email, template: 'booking_received', locale: b.locale, params: { service: name, when, reference: ref } } });
      const staff = await usersWithPermission(tx, req.tenantId!, 'bookings.manage');
      await notify(tx, req.tenantId!, staff.map((userId) => ({ userId, type: 'booking_requested', params: { service: service.name, when, name: b.contact.name }, link: '/manage/bookings' })));
      return { reference: ref };
    });
    res.status(201).json(out);
  }),
);

// -------------------------------------------------------------------- Staff
export const signupRouter = Router();
signupRouter.use(['/signup', '/bookable-services', '/bookings', '/online-registrations'], requireFeature('registration'));

const settingsBody = z.object({
  enabled: z.boolean(),
  terms: z.string().trim().max(5000),
  termsFr: z.string().trim().max(5000).optional().default(''),
  payment: z.string().trim().max(1000),
  paymentFr: z.string().trim().max(1000).optional().default(''),
  privacyContact: z.string().trim().max(300).optional().default(''),
});

signupRouter.get(
  '/signup/settings',
  requirePermission('bookings.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await withTenant(a.tenantId, async (tx) => parseSignup((await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { signupSettings: true } })).signupSettings)));
  }),
);

signupRouter.put(
  '/signup/settings',
  requirePermission('bookings.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = settingsBody.parse(req.body);
    if (b.enabled && !b.terms) throw new HttpError(400, 'NEEDS_TERMS', 'Add your registration terms before opening sign-up.');
    await withTenant(a.tenantId, async (tx) => {
      await tx.tenant.update({ where: { id: a.tenantId }, data: { signupSettings: b } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'signup.settings', entity: 'Tenant', entityId: a.tenantId, after: { enabled: b.enabled } });
    });
    res.json({ ok: true });
  }),
);

const serviceBody = z.object({
  facilityId: uuid,
  name: z.string().trim().min(2).max(80),
  nameFr: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  descriptionFr: z.string().trim().max(1000).nullable().optional(),
  durationMinutes: z.number().int().min(15).max(720),
  priceCents: z.number().int().min(0).max(10_000_000),
  capacity: z.number().int().min(1).max(50),
  maxPartySize: z.number().int().min(1).max(1000).nullable().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  openMinute: z.number().int().min(0).max(1439),
  closeMinute: z.number().int().min(1).max(1440),
  leadDays: z.number().int().min(0).max(365),
  active: z.boolean().optional(),
});

signupRouter.get(
  '/bookable-services',
  requirePermission('bookings.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await withTenant(a.tenantId, (tx) => tx.bookableService.findMany({ orderBy: { name: 'asc' } })));
  }),
);

signupRouter.post(
  '/bookable-services',
  requirePermission('bookings.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = serviceBody.parse(req.body);
    if (b.closeMinute <= b.openMinute) throw new HttpError(400, 'BAD_TIMES', 'Closing time must be after opening time.');
    const v = await withTenant(a.tenantId, (tx) => tx.bookableService.create({ data: { ...b, tenantId: a.tenantId } }));
    res.status(201).json(v);
  }),
);

signupRouter.patch(
  '/bookable-services/:id',
  requirePermission('bookings.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const b = serviceBody.partial().parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      if (!(await tx.bookableService.findUnique({ where: { id } }))) throw notFound('Service');
      await tx.bookableService.update({ where: { id }, data: b });
    });
    res.json({ ok: true });
  }),
);

signupRouter.get(
  '/bookings',
  requirePermission('bookings.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const out = await withTenant(a.tenantId, async (tx) => {
      const list = await tx.bookingRequest.findMany({ where: { OR: [{ status: 'REQUESTED' }, { startsAt: { gte: new Date(Date.now() - 86_400_000) } }] }, orderBy: [{ status: 'desc' }, { startsAt: 'asc' }], take: 200 });
      const services = await tx.bookableService.findMany({ select: { id: true, name: true, facilityId: true } });
      const facilities = await tx.facility.findMany({ select: { id: true, timezone: true } });
      return list.map((r) => {
        const v = services.find((s) => s.id === r.serviceId);
        // Times read in the facility's own time zone, wherever staff sit.
        return { ...r, service: v?.name ?? '', timezone: facilities.find((f) => f.id === v?.facilityId)?.timezone ?? 'America/Toronto' };
      });
    });
    res.json(out);
  }),
);

signupRouter.post(
  '/bookings/:id/decide',
  requirePermission('bookings.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ decision: z.enum(['CONFIRMED', 'DECLINED', 'CANCELLED']), note: z.string().trim().max(500).optional().default('') }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const r = await tx.bookingRequest.findUnique({ where: { id: uuid.parse(req.params.id) } });
      if (!r) throw notFound('Booking');
      if (r.status !== 'REQUESTED' && !(r.status === 'CONFIRMED' && b.decision === 'CANCELLED')) throw conflict('ALREADY_DECIDED', 'This booking was already handled.');
      await tx.bookingRequest.update({ where: { id: r.id }, data: { status: b.decision, decidedById: a.userId, decidedAt: new Date(), decisionNote: b.note || null } });
      const v = await tx.bookableService.findUniqueOrThrow({ where: { id: r.serviceId } });
      const f = await tx.facility.findUniqueOrThrow({ where: { id: v.facilityId }, select: { timezone: true } });
      const when = DateTime.fromJSDate(r.startsAt, { zone: f.timezone }).setLocale('en-CA').toLocaleString(DateTime.DATETIME_MED);
      await tx.emailOutbox.create({ data: { tenantId: a.tenantId, toEmail: r.email, template: 'booking_decided', locale: 'en-CA', params: { service: v.name, when, reference: r.reference, confirmed: b.decision === 'CONFIRMED', note: b.note } } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: `booking.${b.decision.toLowerCase()}`, entity: 'BookingRequest', entityId: r.id });
    });
    res.json({ ok: true });
  }),
);

/** Online sign-ups that still need payment taken (registered, not waitlisted). */
signupRouter.get(
  '/online-registrations',
  requirePermission('members.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const out = await withTenant(a.tenantId, async (tx) => {
      const list = await tx.lessonEnrollment.findMany({ where: { source: 'ONLINE', status: { not: 'CANCELLED' } }, include: { lessonClass: true }, orderBy: { createdAt: 'desc' }, take: 200 });
      const paid = await tx.sale.findMany({ where: { enrollmentId: { in: list.map((e) => e.id) }, refundedAt: null }, select: { enrollmentId: true } });
      return list.map((e) => ({ id: e.id, reference: e.reference, swimmerName: e.swimmerName, householdId: e.householdId, status: e.status, priceCents: e.priceCents, set: e.lessonClass.name, createdAt: e.createdAt, paid: paid.some((p) => p.enrollmentId === e.id) }));
    });
    res.json(out);
  }),
);

signupRouter.post(
  '/online-registrations/:id/pay',
  requirePermission('members.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const { paymentMethod } = z.object({ paymentMethod: z.enum(['CASH', 'DEBIT', 'CREDIT', 'ON_ACCOUNT', 'COMPLIMENTARY']) }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const e = await tx.lessonEnrollment.findUnique({ where: { id: uuid.parse(req.params.id) }, include: { lessonClass: true } });
      if (!e || e.status !== 'ENROLLED') throw conflict('NOT_PAYABLE', 'Only confirmed spots are paid for.');
      if (await tx.sale.count({ where: { enrollmentId: e.id, refundedAt: null } })) throw conflict('ALREADY_PAID', 'Already paid.');
      await tx.sale.create({ data: { tenantId: a.tenantId, householdId: e.householdId, memberId: e.memberId, enrollmentId: e.id, facilityId: e.lessonClass.facilityId, description: `L: ${e.lessonClass.name} (online ${e.reference ?? ''})`, priceCents: e.priceCents ?? 0, paymentMethod, soldById: a.userId } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'registration.paid', entity: 'LessonEnrollment', entityId: e.id });
    });
    res.json({ ok: true });
  }),
);
