/**
 * Load-test data for team messaging and staff surveys, added to the database seed.ts made.
 *
 *   DATABASE_URL=…/flexcity_load npx tsx test/load/seed-comms.ts [--pulse 3000]
 *
 * - Rebuilds test/load/plan.json from the database when it's missing or empty (it's git-ignored).
 * - Every load city: everyone gets a birth date (adults, so the rule of two leaves conversations
 *   open), six departments with one position each, worker i in department i % 6 (about 50 each).
 * - A separate organization, "loadpulse", with --pulse workers (default 3,000) in twelve departments
 *   of very different sizes (600 down to 5), for an organization-wide pulse survey with a breakdown.
 * Writes test/load/comms-plan.json for comms.ts. Safe to run again: it only adds what's missing.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createPrismaClient } from '../../src/lib/prismaClient.js';
import { CONSENT_VERSION } from '../../src/services/privacy/consent.js';

const args = Object.fromEntries(process.argv.slice(2).reduce<string[][]>((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1] ?? '']] : a), []));
const PULSE = Number(args.pulse ?? 3000);
const owner = createPrismaClient(process.env.DATABASE_URL!);
const PLAN = new URL('./plan.json', import.meta.url);
const DEPTS = 6;
const ADULT = new Date('1990-06-15');

type City = { sub: string; tenantId: string; hr: string; sup: string; workers: string[]; facilities: string[]; positions: string[] };

/** plan.json from the database (same shape seed.ts writes). */
async function rebuildPlan(): Promise<{ period: string; cities: City[] }> {
  const tenants = await owner.tenant.findMany({ where: { OR: [{ subdomain: 'loadsmall' }, { subdomain: { startsWith: 'loadbig' } }] }, select: { id: true, subdomain: true } });
  const order = (s: string) => (s === 'loadsmall' ? -1 : Number(s.slice(7)));
  tenants.sort((a, b) => order(a.subdomain) - order(b.subdomain));
  const cities: City[] = [];
  for (const t of tenants) {
    const users = await owner.user.findMany({ where: { tenantId: t.id }, select: { id: true, roles: true, employeeNumber: true } });
    const workers = users.filter((u) => u.employeeNumber?.startsWith('E')).sort((a, b) => Number(a.employeeNumber!.slice(1)) - Number(b.employeeNumber!.slice(1)));
    const facilities = await owner.facility.findMany({ where: { tenantId: t.id }, orderBy: { name: 'asc' }, select: { id: true } });
    const positions = await owner.position.findMany({ where: { tenantId: t.id, name: { in: ['Lifeguard', 'Instructor'] } }, select: { id: true, name: true } });
    positions.sort((a, b) => (a.name === 'Lifeguard' ? -1 : b.name === 'Lifeguard' ? 1 : 0));
    cities.push({
      sub: t.subdomain,
      tenantId: t.id,
      hr: users.find((u) => u.roles.includes('HR_ADMIN'))!.id,
      sup: users.find((u) => u.roles.includes('AQUATIC_SUPERVISOR'))!.id,
      workers: workers.map((w) => w.id),
      facilities: facilities.map((f) => f.id),
      positions: positions.map((p) => p.id),
    });
  }
  return { period: '2026-03-02', cities };
}

function readPlan() {
  try {
    const raw = readFileSync(PLAN, 'utf8');
    if (raw.trim()) return JSON.parse(raw) as { period: string; cities: City[] };
  } catch {
    /* rebuilt below */
  }
  return null;
}

const t0 = Date.now();
let plan = readPlan();
if (!plan || !plan.cities.length) {
  plan = await rebuildPlan();
  writeFileSync(PLAN, JSON.stringify(plan));
  console.log(`rebuilt plan.json: ${plan.cities.length} cities`);
}

const comms: { cities: Array<{ sub: string; tenantId: string; departments: string[]; deptOf: number[] }>; pulse: { sub: string; tenantId: string; hr: string; workers: string[]; departments: Array<{ id: string; size: number }> } | null } = { cities: [], pulse: null };

for (const c of plan.cities) {
  await owner.user.updateMany({ where: { tenantId: c.tenantId, dateOfBirth: null }, data: { dateOfBirth: ADULT } });
  let depts = await owner.department.findMany({ where: { tenantId: c.tenantId, name: { startsWith: 'Team ' } }, orderBy: { name: 'asc' }, select: { id: true } });
  if (depts.length < DEPTS) {
    for (let d = depts.length; d < DEPTS; d++) {
      const dep = await owner.department.create({ data: { tenantId: c.tenantId, name: `Team ${d + 1}` } });
      const pos = await owner.position.create({ data: { tenantId: c.tenantId, name: `Team ${d + 1} staff`, departmentId: dep.id } });
      const members = c.workers.filter((_, i) => i % DEPTS === d);
      await owner.userPosition.createMany({ data: members.map((userId) => ({ tenantId: c.tenantId, userId, positionId: pos.id })), skipDuplicates: true });
    }
    depts = await owner.department.findMany({ where: { tenantId: c.tenantId, name: { startsWith: 'Team ' } }, orderBy: { name: 'asc' }, select: { id: true } });
  }
  comms.cities.push({ sub: c.sub, tenantId: c.tenantId, departments: depts.map((d) => d.id), deptOf: c.workers.map((_, i) => i % DEPTS) });
}

// The pulse organization.
const SIZES = [600, 500, 400, 400, 300, 300, 200, 150, 100, 30, 15, 5];
const scale = PULSE / SIZES.reduce((a, b) => a + b, 0);
const sizes = SIZES.map((s) => Math.max(5, Math.round(s * scale)));
let pt = await owner.tenant.findUnique({ where: { subdomain: 'loadpulse' }, select: { id: true } });
if (!pt) {
  const tenant = await owner.tenant.create({ data: { name: 'City of loadpulse', subdomain: 'loadpulse', payWeekStartDay: 1 } });
  const tid = tenant.id;
  await owner.facility.create({ data: { tenantId: tid, name: 'City hall', province: 'BC', timezone: 'America/Vancouver', latitude: 49.88, longitude: -119.44 } });
  const hr = await owner.user.create({ data: { tenantId: tid, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Hr', lastName: 'loadpulse', email: 'hr@loadpulse.test', dateOfBirth: ADULT } });
  let n = 0;
  for (let d = 0; d < sizes.length; d++) {
    const dep = await owner.department.create({ data: { tenantId: tid, name: `Department ${String(d + 1).padStart(2, '0')}` } });
    const pos = await owner.position.create({ data: { tenantId: tid, name: `Department ${String(d + 1).padStart(2, '0')} staff`, departmentId: dep.id } });
    const users = Array.from({ length: sizes[d]! }, () => ({ id: randomUUID(), tenantId: tid, roles: ['STAFF' as const], employmentStatus: 'PART_TIME' as const, firstName: `Worker${n}`, lastName: 'loadpulse', email: `w${n}@loadpulse.test`, hireDate: new Date('2024-01-01'), employeeNumber: `E${n++}`, dateOfBirth: ADULT }));
    await owner.user.createMany({ data: users });
    await owner.userPosition.createMany({ data: users.map((u) => ({ tenantId: tid, userId: u.id, positionId: pos.id })) });
  }
  const everyone = await owner.user.findMany({ where: { tenantId: tid }, select: { id: true } });
  await owner.consentRecord.createMany({ data: everyone.map((u) => ({ tenantId: tid, userId: u.id, version: CONSENT_VERSION, locale: 'en-CA', textSha256: 'load', signedName: 'Load', signature: Buffer.from('x'), signatureSha256: 'load', choices: {} })) });
  void hr;
  pt = { id: tid };
}
const pulseUsers = await owner.user.findMany({ where: { tenantId: pt.id }, select: { id: true, roles: true, employeeNumber: true } });
const deptRows = await owner.department.findMany({ where: { tenantId: pt.id }, orderBy: { name: 'asc' }, select: { id: true } });
comms.pulse = {
  sub: 'loadpulse',
  tenantId: pt.id,
  hr: pulseUsers.find((u) => u.roles.includes('HR_ADMIN'))!.id,
  workers: pulseUsers.filter((u) => u.employeeNumber?.startsWith('E')).sort((a, b) => Number(a.employeeNumber!.slice(1)) - Number(b.employeeNumber!.slice(1))).map((u) => u.id),
  departments: deptRows.map((d, i) => ({ id: d.id, size: sizes[i] ?? 0 })),
};
writeFileSync(new URL('./comms-plan.json', import.meta.url), JSON.stringify(comms));
console.log(`comms seed: ${comms.cities.length} cities with ${DEPTS} departments each; pulse organization with ${comms.pulse.workers.length} workers in ${comms.pulse.departments.length} departments (${Math.round((Date.now() - t0) / 1000)} s)`);
await owner.$disconnect();
