/**
 * Load-test data: one small city (30 workers) and many large ones (300 workers each), with two
 * weeks of published shifts, approved punches, pay rates, signed agreements and open offers.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/flexcity_load npx tsx test/load/seed.ts --cities 30 --workers 300
 *
 * Prints the tenant ids, user ids and facility ids the load run needs (test/load/plan.json).
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { CONSENT_VERSION } from '../../src/services/privacy/consent.js';

const args = Object.fromEntries(process.argv.slice(2).reduce<string[][]>((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1] ?? '']] : a), []));
const BIG = Number(args.cities ?? 30);
const WORKERS = Number(args.workers ?? 300);
const owner = new PrismaClient();
const PERIOD = '2026-03-02'; // two weeks of history to pay
const day = (n: number) => new Date(Date.UTC(2026, 2, 2 + n));

async function city(sub: string, workers: number) {
  const tenant = await owner.tenant.create({ data: { name: `City of ${sub}`, subdomain: sub, payWeekStartDay: 1 } });
  const tid = tenant.id;
  const facilities = await Promise.all([0, 1].map((i) => owner.facility.create({ data: { tenantId: tid, name: `Pool ${i + 1}`, province: 'BC', timezone: 'America/Vancouver', latitude: 49.88, longitude: -119.44 } })));
  const positions = await Promise.all(['Lifeguard', 'Instructor'].map((name) => owner.position.create({ data: { tenantId: tid, name } })));
  const hr = await owner.user.create({ data: { tenantId: tid, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Hr', lastName: sub, email: `hr@${sub}.test` } });
  const sup = await owner.user.create({ data: { tenantId: tid, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Sup', lastName: sub, email: `sup@${sub}.test` } });
  const users = Array.from({ length: workers }, (_, i) => ({ id: randomUUID(), tenantId: tid, roles: ['STAFF' as const], employmentStatus: 'PART_TIME' as const, firstName: `Worker${i}`, lastName: sub, email: `w${i}@${sub}.test`, hireDate: new Date('2024-01-01'), employeeNumber: `E${i}` }));
  await owner.user.createMany({ data: users });
  const everyone = [hr.id, sup.id, ...users.map((u) => u.id)];
  await owner.consentRecord.createMany({ data: everyone.map((userId) => ({ tenantId: tid, userId, version: CONSENT_VERSION, locale: 'en-CA', textSha256: 'load', signedName: 'Load', signature: Buffer.from('x'), signatureSha256: 'load', choices: {} })) });
  await owner.userPosition.createMany({ data: users.flatMap((u) => positions.map((p) => ({ tenantId: tid, userId: u.id, positionId: p.id }))) });
  await owner.payRate.createMany({ data: users.flatMap((u) => positions.map((p, k) => ({ tenantId: tid, userId: u.id, positionId: p.id, hourlyRate: 22 + k * 4, effectiveFrom: new Date('2025-01-01') }))) });
  // Two weeks: each worker 5 shifts a week of 7 hours, punched and approved; the second week's shifts also published ahead.
  const shifts: Array<Record<string, unknown>> = [];
  const punches: Array<Record<string, unknown>> = [];
  users.forEach((u, i) => {
    for (let d = 0; d < 14; d++) {
      if ((d + i) % 7 >= 5) continue;
      const f = facilities[i % 2]!;
      const p = positions[d % 2]!;
      const start = new Date(day(d).getTime() + (14 + (i % 3)) * 3_600_000);
      const end = new Date(start.getTime() + 7 * 3_600_000);
      const id = randomUUID();
      shifts.push({ id, tenantId: tid, facilityId: f.id, positionId: p.id, userId: u.id, startsAt: start, endsAt: end, status: 'PUBLISHED' });
      punches.push({ tenantId: tid, userId: u.id, facilityId: f.id, positionId: p.id, shiftId: id, clockIn: start, clockOut: end, status: 'APPROVED' });
    }
  });
  for (let i = 0; i < shifts.length; i += 5000) await owner.shift.createMany({ data: shifts.slice(i, i + 5000) as never });
  for (let i = 0; i < punches.length; i += 5000) await owner.timePunch.createMany({ data: punches.slice(i, i + 5000) as never });
  // Upcoming open shifts on the board (next 14 days from now), 1 per 10 workers a day.
  const now = Date.now();
  const open: Array<Record<string, unknown>> = [];
  const offers: Array<Record<string, unknown>> = [];
  for (let d = 1; d <= 14; d++) for (let k = 0; k < Math.max(1, workers / 10); k++) {
    const id = randomUUID();
    const start = new Date(now + d * 86_400_000 + k * 1_800_000);
    open.push({ id, tenantId: tid, facilityId: facilities[k % 2]!.id, positionId: positions[0]!.id, startsAt: start, endsAt: new Date(start.getTime() + 4 * 3_600_000), status: 'PUBLISHED' });
    offers.push({ tenantId: tid, shiftId: id, source: 'OPEN_SHIFT', status: 'OPEN' });
  }
  await owner.shift.createMany({ data: open as never });
  await owner.shiftOffer.createMany({ data: offers as never });
  return { sub, tenantId: tid, hr: hr.id, sup: sup.id, workers: users.map((u) => u.id), facilities: facilities.map((f) => f.id), positions: positions.map((p) => p.id), shifts: shifts.length, punches: punches.length };
}

const t0 = Date.now();
const plan = { period: PERIOD, cities: [] as Awaited<ReturnType<typeof city>>[] };
plan.cities.push(await city('loadsmall', 30));
for (let c = 0; c < BIG; c++) {
  plan.cities.push(await city(`loadbig${c}`, WORKERS));
  process.stdout.write(`\rcities ${c + 1}/${BIG}`);
}
writeFileSync(new URL('./plan.json', import.meta.url), JSON.stringify(plan));
const totals = plan.cities.reduce((a, c) => ({ workers: a.workers + c.workers.length, shifts: a.shifts + c.shifts, punches: a.punches + c.punches }), { workers: 0, shifts: 0, punches: 0 });
console.log(`\nseeded ${plan.cities.length} cities, ${totals.workers} workers, ${totals.shifts} shifts, ${totals.punches} punches in ${Math.round((Date.now() - t0) / 1000)} s`);
await owner.$disconnect();
