/**
 * Sample data for the newer screens in the demo city ("kelowna"), so they have
 * something to show: shift trades, time in lieu, text alerts, job applications,
 * reporting lines, special events in the forecast, facility kinds, an API key and
 * a webhook endpoint, a read-and-sign policy, an announcement and logbook entries.
 *
 * Idempotent: each part checks first and only adds what's missing. Everything is
 * fictional: names, example.ca addresses, 555-01xx phone numbers. Texts go through
 * the console SMS provider in development; nothing is sent. The webhook endpoint is
 * switched off, so no delivery is ever attempted.
 *
 *   npm run db:seed                                          (fresh database: runs with the main seed)
 *   node --env-file-if-exists=.env --import tsx prisma/seedNewScreens.ts   (an already-seeded one)
 */
import { createHash } from 'node:crypto';
import { DateTime } from 'luxon';
import PDFDocument from 'pdfkit';
import type { Prisma } from '../src/generated/prisma/client.js';
import { type Tx, withTenant } from '../src/lib/db.js';
import { keys, tenantKekId } from '../src/routes/context.js';
import { seal } from '../src/services/crypto/envelope.js';
import { newKey } from '../src/services/integrations/apiKeys.js';
import { newSigningSecret, sealSecret } from '../src/services/integrations/webhooks.js';
import { approveTrade, proposeTrade, respondTrade } from '../src/services/shiftboard/trades.js';

const ZONE = 'America/Vancouver';
const iso = (d: DateTime) => d.toISODate()!;

/** Who reports to whom (by e-mail), so the org chart has a tree. Only fills empty lines. */
const REPORTS_TO: Record<string, string> = {
  'supervisor@kelowna.test': 'hr@kelowna.test',
  'maintenance@kelowna.test': 'hr@kelowna.test',
  'steward@kelowna.test': 'hr@kelowna.test',
  'head@kelowna.test': 'supervisor@kelowna.test',
  'frontdesk@kelowna.test': 'supervisor@kelowna.test',
  'guard@kelowna.test': 'head@kelowna.test',
  'casual@kelowna.test': 'head@kelowna.test',
  'junior@kelowna.test': 'head@kelowna.test',
  'waterworks@kelowna.test': 'maintenance@kelowna.test',
};

const PENDING_NOTE = 'Could you take my evening shift? I have a night class that week.';
const APPROVED_NOTE = 'Swapping so I can make my sister’s convocation.';

async function people(tx: Tx) {
  const all = await tx.user.findMany({ where: { email: { endsWith: '@kelowna.test' } }, select: { id: true, email: true, reportsToId: true } });
  const by = (email: string) => all.find((u) => u.email === email);
  return { all, by };
}

/** A short résumé, as a real PDF, for one applicant. */
function resumePdf(name: string, lines: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 54, info: { Title: `${name} résumé` } });
    const parts: Buffer[] = [];
    doc.on('data', (b: Buffer) => parts.push(b));
    doc.on('end', () => resolve(Buffer.concat(parts)));
    doc.on('error', reject);
    doc.fontSize(20).text(name);
    doc.moveDown(0.3).fontSize(10).fillColor('#555').text('Kelowna, BC · sample résumé for the demo');
    doc.moveDown().fillColor('#000').fontSize(11);
    for (const l of lines) doc.text(l).moveDown(0.4);
    doc.end();
  });
}

async function trades(tx: Tx, tenantId: string) {
  const { by } = await people(tx);
  const guard = by('guard@kelowna.test');
  const casual = by('casual@kelowna.test');
  const head = by('head@kelowna.test');
  const sup = by('supervisor@kelowna.test');
  const facility = await tx.facility.findFirst({ where: { name: 'Parkinson Recreation Centre' } });
  const lifeguard = await tx.position.findFirst({ where: { name: 'Lifeguard' } });
  if (!guard || !casual || !head || !sup || !facility || !lifeguard) return;
  const live = async (note: string) => {
    const t = await tx.shiftTrade.findFirst({ where: { note, status: { in: ['PROPOSED', 'ACCEPTED', 'APPROVED'] } }, orderBy: { createdAt: 'desc' } });
    if (!t) return false;
    const s = await tx.shift.findUnique({ where: { id: t.fromShiftId }, select: { startsAt: true } });
    return !!s && s.startsAt > new Date();
  };
  const today = DateTime.now().setZone(ZONE).startOf('day');
  const shift = (userId: string, days: number, hour: number, hours: number) =>
    tx.shift.create({ data: { tenantId, facilityId: facility.id, positionId: lifeguard.id, userId, status: 'PUBLISHED', startsAt: today.plus({ days }).set({ hour }).toJSDate(), endsAt: today.plus({ days }).set({ hour: hour + hours }).toJSDate() } });

  // Waiting for a supervisor: both people agreed.
  if (!(await live(PENDING_NOTE))) {
    const mine = await shift(guard.id, 5, 16, 4);
    const theirs = await shift(casual.id, 6, 9, 4);
    const t = await proposeTrade(tx, tenantId, guard.id, mine.id, theirs.id, PENDING_NOTE);
    await respondTrade(tx, tenantId, casual.id, t.id, true);
  }
  // Already approved by the aquatic supervisor: the shifts swapped.
  if (!(await live(APPROVED_NOTE))) {
    const mine = await shift(head.id, 8, 6, 4);
    const theirs = await shift(guard.id, 9, 12, 4);
    const t = await proposeTrade(tx, tenantId, head.id, mine.id, theirs.id, APPROVED_NOTE);
    await respondTrade(tx, tenantId, guard.id, t.id, true);
    await approveTrade(tx, tenantId, sup.id, t.id, 'Approved. Both of you are covered.');
  }
}

async function lieuAndTexts(tx: Tx, tenantId: string) {
  const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { features: true, payrollSettings: true } });
  const features = (t.features ?? {}) as Record<string, boolean>;
  if (!features.textAlerts) await tx.tenant.update({ where: { id: tenantId }, data: { features: { ...features, textAlerts: true } } });
  const settings = (t.payrollSettings ?? {}) as Record<string, unknown>;
  if (!(settings.lieu as { enabled?: boolean } | undefined)?.enabled) {
    await tx.tenant.update({ where: { id: tenantId }, data: { payrollSettings: { ...settings, lieu: { enabled: true, capHours: 80, takeWithinMonths: 12 } } as Prisma.InputJsonValue } });
  }
  const { by } = await people(tx);
  const guard = by('guard@kelowna.test');
  const hr = by('hr@kelowna.test');
  if (!guard || !hr) return;
  // Jordan banks overtime as time off; HR entered the opening balance from the summer.
  const g = await tx.user.findUniqueOrThrow({ where: { id: guard.id }, select: { bankOvertime: true, smsPhone: true } });
  if (!g.bankOvertime) await tx.user.update({ where: { id: guard.id }, data: { bankOvertime: true, bankOvertimeAt: new Date() } });
  if (!(await tx.lieuAdjustment.count({ where: { userId: guard.id } }))) {
    await tx.lieuAdjustment.create({ data: { tenantId, userId: guard.id, hours: 7.5, note: 'Opening balance: overtime banked on the summer schedule', createdById: hr.id } });
    await tx.lieuAdjustment.create({ data: { tenantId, userId: guard.id, hours: 3, note: 'Swim meet set-up, Oct 18 (banked at 1.5×)', createdById: hr.id } });
  }
  // A confirmed (fictional) mobile number for urgent shift texts.
  if (!g.smsPhone) await tx.user.update({ where: { id: guard.id }, data: { smsPhone: '+12505550134', smsVerifiedAt: new Date(), smsUrgentShifts: true } });
}

async function reportingLines(tx: Tx) {
  const { by } = await people(tx);
  for (const [email, managerEmail] of Object.entries(REPORTS_TO)) {
    const u = by(email);
    const m = by(managerEmail);
    if (u && m && !u.reportsToId) await tx.user.update({ where: { id: u.id }, data: { reportsToId: m.id } });
  }
}

async function facilitiesAndEvents(tx: Tx, tenantId: string) {
  await tx.facility.updateMany({ where: { name: 'Water Treatment Plant', venueKind: 'POOL' }, data: { venueKind: 'OTHER' } });
  // An outdoor site, with its Environment and Climate Change Canada forecast site (Kelowna).
  if (!(await tx.facility.findFirst({ where: { name: 'Rotary Beach' } }))) {
    await tx.facility.create({ data: { tenantId, name: 'Rotary Beach', province: 'BC', timezone: ZONE, latitude: 49.8601, longitude: -119.4907, geoRadiusM: 250, costCenter: 'CC-410-BEACHES', exposure: 'OUTDOOR', venueKind: 'BEACH', weatherSite: 'bc-48' } });
  }
  const pool = await tx.facility.findFirst({ where: { name: 'Parkinson Recreation Centre' } });
  const { by } = await people(tx);
  const sup = by('supervisor@kelowna.test');
  const today = DateTime.now().setZone(ZONE).startOf('day');
  const saturday = today.plus({ days: ((6 - today.weekday + 7) % 7 || 7) });
  const friday = today.plus({ days: ((5 - today.weekday + 7) % 7 || 7) + 7 });
  const events = [
    { facilityId: pool?.id ?? null, name: 'Lakeview Regional Swim Meet', startsOn: saturday, endsOn: saturday.plus({ days: 1 }), startMinute: 7 * 60, endMinute: 18 * 60, extraPeople: 120, percent: 10, notes: 'Hosted with the Kelowna Aquajets. Main tank closed to public swim; deck and bleachers busy.' },
    { facilityId: null, name: 'Pro-D Day (Lakeview School District)', startsOn: friday, endsOn: friday, startMinute: null, endMinute: null, extraPeople: null, percent: 25, notes: 'No school: expect families from mid-morning.' },
  ];
  for (const e of events) {
    if (await tx.specialEvent.findFirst({ where: { name: e.name, endsOn: { gte: today.toJSDate() } } })) continue;
    await tx.specialEvent.create({ data: { ...e, tenantId, startsOn: new Date(`${iso(e.startsOn)}T00:00:00Z`), endsOn: new Date(`${iso(e.endsOn)}T00:00:00Z`), createdById: sup?.id ?? null } });
  }
}

async function jobsAndApplications(tx: Tx, tenantId: string) {
  let posting = await tx.jobPosting.findFirst({ where: { applyInApp: true, published: true }, orderBy: { createdAt: 'asc' } });
  const pool = await tx.facility.findFirst({ where: { name: 'Parkinson Recreation Centre' } });
  if (!posting) {
    posting = await tx.jobPosting.create({
      data: {
        tenantId, facilityId: pool?.id ?? null, title: 'Lifeguard (summer)', titleFr: 'Sauveteur (été)',
        description: 'Guard the outdoor pool this summer. National Lifeguard and Standard First Aid required. Flexible part-time hours, evenings and weekends.',
        descriptionFr: 'Surveiller la piscine extérieure cet été. Sauveteur national et Secourisme général requis. Horaire à temps partiel flexible, soirs et fins de semaine.',
        employmentStatus: 'CASUAL', payMin: 19.5, payMax: 22, closesOn: new Date(`${iso(DateTime.now().plus({ days: 30 }))}T00:00:00Z`), applyInApp: true, published: true,
      },
    });
  }
  const applicants = [
    { firstName: 'Maya', lastName: 'Desjardins', email: 'maya.desjardins@example.ca', phone: '250-555-0141', certifications: 'National Lifeguard (Pool), Standard First Aid with CPR-C, Swim Instructor', message: 'Two summers guarding at a community pool in Penticton. I’m available evenings and weekends from May.', status: 'INTERVIEW' as const, resume: ['Lifeguard, Penticton Community Centre — 2025 and 2026 seasons', 'Swim instructor, Learn to Swim levels 1–6', 'National Lifeguard (Pool), expires 2027', 'Standard First Aid with CPR-C, expires 2028'] },
    { firstName: 'Noah', lastName: 'Patel', email: 'noah.patel@example.ca', phone: '250-555-0152', certifications: 'Bronze Cross, Standard First Aid', message: 'I’m finishing my National Lifeguard course in March and would love to start this summer.', status: 'REVIEWING' as const, resume: null },
    { firstName: 'Sofia', lastName: 'Laurent', email: 'sofia.laurent@example.ca', phone: null, certifications: 'National Lifeguard (Waterfront)', message: 'Bilingual (English and French). I guarded at a lake beach in Quebec last year.', status: 'NEW' as const, resume: null },
  ];
  for (const a of applicants) {
    if (await tx.jobApplication.findFirst({ where: { postingId: posting.id, email: a.email } })) continue;
    const id = crypto.randomUUID();
    let file: Record<string, unknown> = {};
    if (a.resume) {
      const pdf = await resumePdf(`${a.firstName} ${a.lastName}`, a.resume);
      const sealed = await seal(keys(), tenantKekId(tenantId), pdf.toString('base64'), `application:${tenantId}:${id}`);
      file = { resumeName: `${a.firstName}-${a.lastName}-resume.pdf`, resumeType: 'application/pdf', resumeSize: pdf.length, resumeSha256: createHash('sha256').update(pdf).digest('hex'), ciphertext: sealed.ciphertext, iv: sealed.iv, authTag: sealed.authTag, wrappedKey: sealed.wrappedDataKey, kekId: sealed.kekId };
    }
    await tx.jobApplication.create({ data: { id, tenantId, postingId: posting.id, firstName: a.firstName, lastName: a.lastName, email: a.email, phone: a.phone, message: a.message, certifications: a.certifications, status: a.status, consentAt: new Date(), ...file } });
  }
}

async function integrations(tx: Tx, tenantId: string) {
  const { by } = await people(tx);
  const hr = by('hr@kelowna.test');
  if (!hr) return;
  if (!(await tx.apiKey.count({ where: { revokedAt: null } }))) {
    // The key itself is shown once and thrown away: only its hash is kept.
    const k = newKey();
    await tx.apiKey.create({ data: { tenantId, name: 'HRIS sync (test)', prefix: k.prefix, keyHash: k.hash, scopes: ['people:read', 'departments:read', 'positions:read'], createdById: hr.id } });
  }
  if (!(await tx.webhookEndpoint.count())) {
    const secret = await sealSecret(tenantId, newSigningSecret());
    await tx.webhookEndpoint.create({ data: { tenantId, url: 'https://example.com/hooks', description: 'Test receiver (switched off)', events: ['person.created', 'person.updated', 'shift.published'], secret: secret as unknown as Prisma.InputJsonValue, enabled: false, disabledAt: new Date(), disabledReason: 'manual', createdById: hr.id } });
  }
}

async function noticesAndPolicy(tx: Tx, tenantId: string) {
  const { by } = await people(tx);
  const hr = by('hr@kelowna.test');
  const sup = by('supervisor@kelowna.test');
  const guard = by('guard@kelowna.test');
  const pool = await tx.facility.findFirst({ where: { name: 'Parkinson Recreation Centre' } });
  if (!hr || !sup || !guard || !pool) return;
  if (!(await tx.policy.count({ where: { retiredAt: null } }))) {
    const lifeguard = await tx.position.findFirst({ where: { name: 'Lifeguard' } });
    const title = 'Pool safety plan 2026';
    const body = 'Every guard on deck carries a rescue tube and wears the guard uniform.\n\nRotate every 30 minutes; never leave a station unattended.\n\nReport every first-aid incident before the end of the shift.\n\nThe head guard checks the AED and first-aid kit at opening.';
    await tx.policy.create({ data: { tenantId, title, body, textSha256: createHash('sha256').update(`${title}\n\n${body}`).digest('hex'), positionIds: lifeguard ? [lifeguard.id] : [], dueDays: 14, createdById: hr.id } });
  }
  if (!(await tx.announcement.count())) {
    await tx.announcement.create({ data: { tenantId, title: 'Annual shutdown starts Monday', body: 'The leisure pool closes Monday at 6 a.m. for two weeks of maintenance. Lane swim moves to the main tank. Check your schedule for changes.', pinned: true, authorId: sup.id } });
  }
  if (!(await tx.logEntry.count({ where: { facilityId: pool.id } }))) {
    await tx.logEntry.createMany({
      data: [
        { tenantId, facilityId: pool.id, authorId: sup.id, category: 'MAINTENANCE', body: 'Waterslide closed: crack in the third flume section. Facilities work order 24-118 opened.' },
        { tenantId, facilityId: pool.id, authorId: guard.id, category: 'HANDOVER', body: 'Spare rescue tubes moved to the guard room. AED pads replaced; next expiry in March.' },
      ],
    });
  }
}

/**
 * More of the pool crew, so the schedule builder's week looks like a real one: five more guards
 * and instructors (fictional names, no sign-in), with certifications and availability that differ
 * (early birds, evenings, weekends only). Adds only those missing, by e-mail.
 */
const CREW = [
  { email: 'crew1@kelowna.test', firstName: 'Noah', lastName: 'Gagnon', status: 'PART_TIME', positions: ['Lifeguard', 'Swim Instructor'], days: [1, 2, 3, 4, 5], from: 6 * 60, to: 15 * 60 },
  { email: 'crew2@kelowna.test', firstName: 'Maya', lastName: 'Fischer', status: 'FULL_TIME', positions: ['Lifeguard'], days: [0, 1, 2, 3, 4, 5, 6], from: 6 * 60, to: 22 * 60 },
  { email: 'crew3@kelowna.test', firstName: 'Liam', lastName: 'Arsenault', status: 'PART_TIME', positions: ['Lifeguard'], days: [1, 2, 3, 4, 5], from: 13 * 60, to: 22 * 60 },
  { email: 'crew4@kelowna.test', firstName: 'Zoe', lastName: 'Laurent', status: 'CASUAL', positions: ['Lifeguard', 'Swim Instructor'], days: [0, 6], from: 7 * 60, to: 21 * 60 },
  { email: 'crew5@kelowna.test', firstName: 'Kai', lastName: 'Mendes', status: 'CASUAL', positions: ['Lifeguard'], days: [2, 4, 5, 6], from: 12 * 60, to: 22 * 60 },
] as const;

async function poolCrew(tx: Tx, tenantId: string) {
  const have = new Set((await tx.user.findMany({ where: { email: { in: CREW.map((c) => c.email) } }, select: { email: true } })).map((u) => u.email));
  if (have.size === CREW.length) return;
  const positions = await tx.position.findMany({ where: { name: { in: ['Lifeguard', 'Swim Instructor'] } }, select: { id: true, name: true } });
  const certs = await tx.certification.findMany({ where: { name: { in: ['Standard First Aid with CPR-C', 'National Lifeguard – Pool', 'Swim Instructor'] } }, select: { id: true, name: true } });
  const cert = (name: string) => certs.find((c) => c.name === name);
  const numbers = (await tx.user.findMany({ where: { employeeNumber: { not: null } }, select: { employeeNumber: true } })).map((u) => Number(String(u.employeeNumber).replace(/\D/g, '')) || 0);
  let n = Math.max(200, ...numbers) + 1;
  for (const [i, c] of CREW.entries()) {
    if (have.has(c.email)) continue;
    const hired = new Date(Date.UTC(2023 + (i % 3), 4 + i, 1));
    const u = await tx.user.create({
      data: { tenantId, email: c.email, firstName: c.firstName, lastName: c.lastName, roles: ['STAFF'], employmentStatus: c.status, employeeNumber: `E${n++}`, hireDate: hired, seniorityDate: hired, dateOfBirth: new Date(Date.UTC(1996 + i, i * 2, 10 + i)), unionMember: true, weeklyMinHours: c.status === 'FULL_TIME' ? 32 : null, weeklyMaxHours: c.status === 'PART_TIME' ? 28 : null },
    });
    for (const name of c.positions) {
      const pos = positions.find((p) => p.name === name);
      if (!pos) continue;
      await tx.userPosition.create({ data: { tenantId, userId: u.id, positionId: pos.id } });
      await tx.payRate.create({ data: { tenantId, userId: u.id, positionId: pos.id, hourlyRate: name === 'Lifeguard' ? 22.5 : 24.75, effectiveFrom: new Date('2026-01-01') } });
    }
    const held = ['Standard First Aid with CPR-C', 'National Lifeguard – Pool', ...(c.positions.includes('Swim Instructor' as never) ? ['Swim Instructor'] : [])];
    for (const name of held) {
      const x = cert(name);
      if (x) await tx.userCertification.create({ data: { tenantId, userId: u.id, certificationId: x.id, issueDate: new Date('2025-05-01'), expiryDate: new Date('2027-05-01'), verifiedAt: new Date() } });
    }
    await tx.availability.createMany({ data: c.days.map((dayOfWeek) => ({ tenantId, userId: u.id, dayOfWeek, startMinute: c.from, endMinute: c.to, effectiveFrom: new Date('2026-01-01') })) });
  }
}

/**
 * The water works operator's own schedule (no one in the demo schedules Water Works through the
 * app): day shifts at the treatment plant, Monday to Friday, this week and next, published.
 * Added only when the operator has nothing in those two weeks.
 */
async function waterWorksWeek(tx: Tx, tenantId: string) {
  const op = await tx.user.findFirst({ where: { email: 'waterworks@kelowna.test' }, select: { id: true } });
  const plant = await tx.facility.findFirst({ where: { name: { contains: 'Treatment' } }, select: { id: true, timezone: true } });
  const position = await tx.position.findFirst({ where: { name: 'Water Works Operator' }, select: { id: true } });
  if (!op || !plant || !position) return;
  const monday = DateTime.now().setZone(plant.timezone).startOf('week');
  const end = monday.plus({ weeks: 2 });
  if (await tx.shift.count({ where: { userId: op.id, status: { not: 'CANCELLED' }, startsAt: { gte: monday.toJSDate(), lt: end.toJSDate() } } })) return;
  const data = [];
  for (let d = 0; d < 14; d++) {
    const day = monday.plus({ days: d });
    if (day.weekday > 5) continue;
    data.push({ tenantId, facilityId: plant.id, positionId: position.id, userId: op.id, status: 'PUBLISHED' as const, startsAt: day.set({ hour: 7 }).toJSDate(), endsAt: day.set({ hour: 15, minute: 30 }).toJSDate(), unpaidBreakMinutes: 30 });
  }
  await tx.shift.createMany({ data });
}

/** Adds whatever is missing for the demo city. */
export async function seedNewScreens(tenantId: string) {
  await withTenant(tenantId, async (tx) => {
    await reportingLines(tx);
    await lieuAndTexts(tx, tenantId);
    await facilitiesAndEvents(tx, tenantId);
    await noticesAndPolicy(tx, tenantId);
    await integrations(tx, tenantId);
  });
  await withTenant(tenantId, (tx) => jobsAndApplications(tx, tenantId));
  await withTenant(tenantId, (tx) => poolCrew(tx, tenantId));
  await withTenant(tenantId, (tx) => waterWorksWeek(tx, tenantId));
  await withTenant(tenantId, (tx) => trades(tx, tenantId), { timeoutMs: 60_000 });
}

// Run directly against an existing dev database.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { createPrismaClient } = await import('../src/lib/prismaClient.js');
  const owner = createPrismaClient(process.env.DATABASE_URL!); // DATABASE_URL: finds the city; the rest runs as the app role, under row-level security
  const t = await owner.tenant.findUnique({ where: { subdomain: 'kelowna' }, select: { id: true } });
  await owner.$disconnect();
  if (!t) {
    console.log('No "kelowna" city: run npm run db:seed first.');
  } else {
    await seedNewScreens(t.id);
    console.log('Sample data for the newer screens is ready in "kelowna".');
  }
  const { db } = await import('../src/lib/db.js');
  await db().$disconnect();
}
