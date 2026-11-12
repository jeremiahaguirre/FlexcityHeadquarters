/**
 * Pressure test against a running API (LOAD_API, default http://localhost:4200) seeded by seed.ts.
 * Tokens are minted directly (same JWT_SECRET), so sign-in rate limits don't shape the numbers.
 *
 *   JWT_SECRET=… DATABASE_URL=…/flexcity_load npx tsx test/load/run.ts [--scale small|big|all] [--concurrency 200]
 *
 * Scenarios, each reported with throughput, p50/p95/p99 latency and errors by status:
 *  1. Shift change: every worker at once opens Today (me, shifts, notifications, open punch) and clocks in, then out.
 *  2. Browsing: supervisors load the week's schedule, workers the shift board.
 *  3. Claim race: ten workers grab the same open shift at the same instant (must end with exactly one taker).
 *  4. Payroll day: every city builds a two-week city-wide pay run at the same time.
 *  5. Realistic shift change: workers arriving at a steady rate (--rate per second, default 30, i.e.
 *     9,000 people over five minutes) for --seconds (default 60), to see latency when not saturated.
 */
import { readFileSync } from 'node:fs';
import { createPrismaClient } from '../../src/lib/prismaClient.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { STARTING_VALUES, ensureTaxTables } from '../../src/services/payroll/taxTables.js';

const API = process.env.LOAD_API ?? 'http://localhost:4200';
const args = Object.fromEntries(process.argv.slice(2).reduce<string[][]>((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1] ?? '']] : a), []));
const SCALE = (args.scale ?? 'all') as 'small' | 'big' | 'all';
const CONCURRENCY = Number(args.concurrency ?? 200);
const plan = JSON.parse(readFileSync(new URL('./plan.json', import.meta.url), 'utf8')) as { period: string; cities: Array<{ sub: string; tenantId: string; hr: string; sup: string; workers: string[]; facilities: string[]; positions: string[] }> };
const cities = plan.cities.filter((c) => (SCALE === 'small' ? c.sub === 'loadsmall' : SCALE === 'big' ? c.sub !== 'loadsmall' : true));
void STARTING_VALUES;

type Sample = { name: string; ms: number; status: number };
const samples: Sample[] = [];
const now = () => Math.floor(Date.now() / 1000);
async function call(name: string, sub: string, token: string, method: string, path: string, body?: unknown) {
  const t = performance.now();
  let status = 0;
  try {
    const r = await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'x-tenant-subdomain': sub, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    status = r.status;
    await r.arrayBuffer();
  } catch {
    status = -1;
  }
  samples.push({ name, ms: performance.now() - t, status });
  return status;
}
/** Runs tasks with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]!);
  }));
}
const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] ?? 0;
function report(title: string, from: number, seconds: number) {
  const mine = samples.slice(from);
  const names = [...new Set(mine.map((s) => s.name))];
  console.log(`\n## ${title} (${mine.length} requests in ${seconds.toFixed(1)} s, ${(mine.length / seconds).toFixed(0)} req/s)`);
  console.log('| Request | n | p50 ms | p95 ms | p99 ms | max ms | errors |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  for (const n of names) {
    const s = mine.filter((x) => x.name === n);
    const ms = s.map((x) => x.ms).sort((a, b) => a - b);
    const errs = s.filter((x) => x.status < 200 || x.status >= 400);
    const byStatus = [...new Set(errs.map((e) => e.status))].map((st) => `${st}×${errs.filter((e) => e.status === st).length}`).join(' ');
    console.log(`| ${n} | ${s.length} | ${pct(ms, 50).toFixed(0)} | ${pct(ms, 95).toFixed(0)} | ${pct(ms, 99).toFixed(0)} | ${ms[ms.length - 1]!.toFixed(0)} | ${byStatus || '0'} |`);
  }
}

const owner = createPrismaClient(process.env.DATABASE_URL!);
await ensureTaxTables(owner, 2026);
await owner.payrollTaxTable.updateMany({ where: { year: 2026 }, data: { verifiedAt: new Date(), verifiedBy: 'load test' } });
// Fresh state for repeat runs: no open punches, offers back on the board, no pay runs.
const ids = cities.map((c) => c.tenantId);
await owner.timePunch.deleteMany({ where: { tenantId: { in: ids }, status: 'PENDING' } });
await owner.payStatement.deleteMany({ where: { tenantId: { in: ids } } });
await owner.payRun.deleteMany({ where: { tenantId: { in: ids } } });
await owner.shiftOffer.updateMany({ where: { tenantId: { in: ids } }, data: { status: 'OPEN', claimedById: null } });
await owner.shift.updateMany({ where: { tenantId: { in: ids }, offers: { some: {} } }, data: { userId: null } });

const tokens = new Map<string, string>();
const tokenFor = async (c: (typeof cities)[number], userId: string, roles: string[], mfa = false) => {
  const k = `${c.tenantId}:${userId}`;
  if (!tokens.has(k)) tokens.set(k, await signAccessToken({ sub: userId, tid: c.tenantId, roles: roles as never, aat: now(), ...(mfa ? { mfa: true } : {}) }));
  return tokens.get(k)!;
};
const workers = cities.flatMap((c) => c.workers.map((w, i) => ({ c, w, i })));
console.log(`# Load run: ${cities.length} cities, ${workers.length} workers, ${CONCURRENCY} requests in flight at most, against ${API}`);

// 1. Shift change.
let mark = samples.length;
let t0 = performance.now();
const from = new Date(Date.now() - 86_400_000).toISOString();
const to = new Date(Date.now() + 7 * 86_400_000).toISOString();
await pool(workers, CONCURRENCY, async ({ c, w, i }) => {
  const tok = await tokenFor(c, w, ['STAFF']);
  await Promise.all([
    call('GET /me', c.sub, tok, 'GET', '/api/me'),
    call('GET /me/shifts', c.sub, tok, 'GET', `/api/me/shifts?from=${from}&to=${to}`),
    call('GET /notifications', c.sub, tok, 'GET', '/api/notifications'),
    call('GET /me/punch/open', c.sub, tok, 'GET', '/api/me/punch/open'),
  ]);
  await call('POST /timeclock/in', c.sub, tok, 'POST', '/api/timeclock/in', { facilityId: c.facilities[i % 2], positionId: c.positions[0], location: { lat: 49.88, lon: -119.44, accuracyM: 10 } });
  await call('POST /timeclock/out', c.sub, tok, 'POST', '/api/timeclock/out');
});
report('1. Shift change: every worker opens Today and clocks in and out', mark, (performance.now() - t0) / 1000);

// 2. Browsing.
mark = samples.length;
t0 = performance.now();
const weekFrom = new Date(Date.now() - 86_400_000).toISOString();
const weekTo = new Date(Date.now() + 6 * 86_400_000).toISOString();
const browse = [
  ...cities.flatMap((c) => Array.from({ length: 10 }, () => ({ c, kind: 'schedule' as const }))),
  ...workers.filter((x) => x.i % 3 === 0).map((x) => ({ c: x.c, w: x.w, kind: 'board' as const })),
];
await pool(browse, CONCURRENCY, async (b) => {
  if (b.kind === 'schedule') {
    const tok = await tokenFor(b.c, b.c.sup, ['AQUATIC_SUPERVISOR']);
    await call('GET /shifts (week)', b.c.sub, tok, 'GET', `/api/shifts?from=${weekFrom}&to=${weekTo}&facilityId=${b.c.facilities[0]}`);
    await call('GET /punches (review)', b.c.sub, tok, 'GET', '/api/punches?status=PENDING');
  } else {
    const tok = await tokenFor(b.c, (b as { w: string }).w, ['STAFF']);
    await call('GET /shiftboard/offers', b.c.sub, tok, 'GET', '/api/shiftboard/offers');
  }
});
report('2. Browsing: schedules and the shift board', mark, (performance.now() - t0) / 1000);

// 3. Claim race.
mark = samples.length;
t0 = performance.now();
let doubleBooked = 0;
for (const c of cities.slice(0, 10)) {
  const offer = await owner.shiftOffer.findFirst({ where: { tenantId: c.tenantId, status: 'OPEN' }, select: { id: true, shiftId: true } });
  if (!offer) continue;
  const racers = c.workers.slice(0, 10);
  await Promise.all(racers.map(async (w) => call('POST /offers/:id/claim (race)', c.sub, await tokenFor(c, w, ['STAFF']), 'POST', `/api/offers/${offer.id}/claim`, {})));
  const after = await owner.shiftOffer.findUnique({ where: { id: offer.id }, select: { claimedById: true } });
  const shift = await owner.shift.findUnique({ where: { id: offer.shiftId }, select: { userId: true } });
  if (after?.claimedById && shift?.userId && after.claimedById !== shift.userId) doubleBooked++;
}
report('3. Claim race: ten workers take the same open shift at once (10 cities)', mark, (performance.now() - t0) / 1000);
const claimed = samples.slice(mark).filter((s) => s.status >= 200 && s.status < 300).length;
console.log(`claims accepted: ${claimed} for ${Math.min(10, cities.length)} shifts (expect one each); mismatched assignments: ${doubleBooked}`);

// 4. Payroll day.
mark = samples.length;
t0 = performance.now();
await pool(cities, CONCURRENCY, async (c) => {
  const tok = await tokenFor(c, c.hr, ['HR_ADMIN'], true);
  await call('POST /payroll/runs (2 weeks, city-wide)', c.sub, tok, 'POST', '/api/payroll/runs', { departmentId: null, periodStart: plan.period, weeks: 2, payDate: '2026-03-20' });
});
report('4. Payroll day: every city builds its pay run at once', mark, (performance.now() - t0) / 1000);
const runs = await owner.payRun.findMany({ where: { tenantId: { in: ids } }, select: { totals: true } });
const people = runs.reduce((a, r) => a + ((r.totals as { people?: number }).people ?? 0), 0);
console.log(`pay runs built: ${runs.length}, statements: ${people}`);

// 5. Realistic pace.
const RATE = Number(args.rate ?? 30);
const SECONDS = Number(args.seconds ?? 60);
mark = samples.length;
t0 = performance.now();
const arrivals = workers.slice(0, RATE * SECONDS);
await Promise.all(arrivals.map(async ({ c, w }, k) => {
  await new Promise((r) => setTimeout(r, (k / RATE) * 1000));
  const tok = await tokenFor(c, w, ['STAFF']);
  await Promise.all([
    call('GET /me', c.sub, tok, 'GET', '/api/me'),
    call('GET /me/shifts', c.sub, tok, 'GET', `/api/me/shifts?from=${from}&to=${to}`),
    call('GET /notifications', c.sub, tok, 'GET', '/api/notifications'),
    call('GET /shiftboard/offers', c.sub, tok, 'GET', '/api/shiftboard/offers'),
  ]);
}));
report(`5. Realistic shift change: ${RATE} workers a second for ${SECONDS} s`, mark, (performance.now() - t0) / 1000);
await owner.$disconnect();
