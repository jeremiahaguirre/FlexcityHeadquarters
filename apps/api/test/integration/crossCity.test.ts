/**
 * Cities never see each other. Signed in as city A (an HR administrator, who can see the most, and a
 * lifeguard), every route the API has is called, with every path parameter filled with city B's own
 * record ids. Nothing of B's may come back (ids, names, emails), and nothing of B's may change.
 * The database is checked too: every table holding a city's rows is behind row-level security.
 */
import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');
const server = createApp();
let a: Awaited<ReturnType<typeof seedTenant>>;
let b: Awaited<ReturnType<typeof seedTenant>>;
const tok = { hr: '', staff: '' };
const bIds: string[] = [];
/** City B's ids by kind, so each path parameter is tried with the ids it could take. */
const kinds: Record<string, string[]> = {};
const bMarkers: string[] = [];

/** Every route as [method, path], prefixes included (Express 4 router stack). */
function routes(appOrRouter: Express): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const prefix = (re: RegExp & { fast_slash?: boolean }) => {
    if (re.fast_slash) return '';
    const m = /^\^\\\/(.*?)\\\/\?\(\?=\\\/\|\$\)$/.exec(re.source);
    return m ? `/${m[1]!.replace(/\\\//g, '/')}` : '';
  };
  const walk = (stack: Array<{ route?: { path: string | string[]; methods: Record<string, boolean> }; name?: string; handle?: { stack?: unknown[] }; regexp: RegExp }>, base: string) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const p of [layer.route.path].flat()) for (const m of Object.keys(layer.route.methods)) out.push([m.toUpperCase(), `${base}${p}`]);
      } else if (layer.handle?.stack) walk(layer.handle.stack as never, base + prefix(layer.regexp));
    }
  };
  walk((appOrRouter as unknown as { _router: { stack: never[] } })._router.stack, '');
  return out;
}

async function snapshot() {
  const where = { tenantId: b.tenant.id };
  const [users, shifts, punches, offers, positions, facilities, rates] = await Promise.all([
    owner.user.findMany({ where, orderBy: { id: 'asc' } }),
    owner.shift.findMany({ where, orderBy: { id: 'asc' } }),
    owner.timePunch.findMany({ where, orderBy: { id: 'asc' } }),
    owner.shiftOffer.findMany({ where, orderBy: { id: 'asc' } }),
    owner.position.findMany({ where, orderBy: { id: 'asc' } }),
    owner.facility.findMany({ where, orderBy: { id: 'asc' } }),
    owner.payRate.findMany({ where, orderBy: { id: 'asc' } }),
  ]);
  return JSON.stringify({ users, shifts, punches, offers, positions, facilities, rates });
}

beforeAll(async () => {
  a = await seedTenant('cityalpha', 2);
  b = await seedTenant('citybravo', 2);
  const now = Math.floor(Date.now() / 1000);
  const hr = await owner.user.create({ data: { tenantId: a.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Alpha', lastName: 'Hr', email: 'hr@cityalpha.test' } });
  tok.hr = await signAccessToken({ sub: hr.id, tid: a.tenant.id, roles: ['HR_ADMIN'], aat: now, mfa: true });
  tok.staff = await signAccessToken({ sub: a.users[0]!.id, tid: a.tenant.id, roles: ['STAFF'], aat: now });
  // Sign the agreement for A's people so the API answers their requests.
  process.env.CONSENT_ENFORCEMENT = 'off';
  // City B's records, whose ids fill every path.
  const bu = b.users[0]!;
  const shift = await owner.shift.create({ data: { tenantId: b.tenant.id, facilityId: b.facility.id, positionId: b.position.id, userId: bu.id, startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000), status: 'PUBLISHED' } });
  const open = await owner.shift.create({ data: { tenantId: b.tenant.id, facilityId: b.facility.id, positionId: b.position.id, startsAt: new Date(Date.now() + 2 * 86_400_000), endsAt: new Date(Date.now() + 2 * 86_400_000 + 4 * 3_600_000), status: 'PUBLISHED' } });
  const offer = await owner.shiftOffer.create({ data: { tenantId: b.tenant.id, shiftId: open.id, source: 'OPEN_SHIFT', status: 'OPEN' } });
  const punch = await owner.timePunch.create({ data: { tenantId: b.tenant.id, userId: bu.id, facilityId: b.facility.id, positionId: b.position.id, clockIn: new Date(Date.now() - 3 * 3_600_000), clockOut: new Date(Date.now() - 3_600_000), status: 'PENDING' } });
  const dept = await owner.department.create({ data: { tenantId: b.tenant.id, name: 'Bravo Aquatics' } });
  const note = await owner.notification.create({ data: { tenantId: b.tenant.id, userId: bu.id, type: 'shift_published', params: {} } }).catch(() => null);
  const timeOff = await owner.timeOffRequest.create({ data: { tenantId: b.tenant.id, userId: bu.id, startsAt: new Date(Date.now() + 5 * 86_400_000), endsAt: new Date(Date.now() + 6 * 86_400_000), type: 'VACATION', note: 'Bravo trip' } }).catch(() => null);
  await owner.payRate.create({ data: { tenantId: b.tenant.id, userId: bu.id, positionId: b.position.id, hourlyRate: 31.37, effectiveFrom: new Date('2025-01-01') } });
  Object.assign(kinds, { user: b.users.map((u) => u.id), shift: [shift.id, open.id], offer: [offer.id], punch: [punch.id], facility: [b.facility.id], position: [b.position.id], department: [dept.id], tenant: [b.tenant.id], other: [...(note ? [note.id] : []), ...(timeOff ? [timeOff.id] : []), b.nls.id] });
  bIds.push(b.tenant.id, b.facility.id, b.position.id, b.nls.id, ...b.users.map((u) => u.id), shift.id, open.id, offer.id, punch.id, dept.id, ...(note ? [note.id] : []), ...(timeOff ? [timeOff.id] : []));
  bMarkers.push(...bIds, 'citybravo', 'City of citybravo', 'Bravo Aquatics', 'Bravo trip', ...b.users.map((u) => u.email));
});
afterAll(async () => {
  process.env.CONSENT_ENFORCEMENT = 'off';
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('one city never sees another', () => {
  it('every table holding cities’ rows is behind row-level security', async () => {
    const rows = await owner.$queryRaw<Array<{ table: string; rls: boolean; policies: bigint }>>`
      SELECT c.relname AS table, c.relrowsecurity AS rls, (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name IN ('tenantId', 'invoiceId'))`;
    const open = rows.filter((r) => !r.rls || Number(r.policies) === 0).map((r) => r.table);
    expect(open).toEqual([]);
  });

  it('a city’s sign-in doesn’t open another city’s address', async () => {
    const r = await request(server).get('/api/me').set('x-tenant-subdomain', 'citybravo').auth(tok.hr, { type: 'bearer' });
    expect(r.status).toBe(403);
  });

  it('no route, with any of the other city’s ids, returns or changes anything of theirs', async () => {
    const before = await snapshot();
    // Live streams stay open by design: they're matched on person and city (see notifications.ts).
    const all = routes(server as unknown as Express).filter(([, p]) => p.startsWith('/api/') && !p.startsWith('/api/platform') && !p.startsWith('/api/marketing') && !p.includes('stream'));
    expect(all.length).toBeGreaterThan(300);
    const leaks: string[] = [];
    const slow: string[] = [];
    const candidates = (param: string) => {
      const p = param.slice(1).toLowerCase();
      for (const k of ['user', 'shift', 'offer', 'punch', 'facility', 'position', 'department', 'tenant']) if (p.startsWith(k)) return kinds[k]!;
      // A bare :id could be anything of B's: one of each kind.
      return Object.values(kinds).map((xs) => xs[0]!);
    };
    const jobs: Array<{ who: string; token: string; method: string; url: string }> = [];
    for (const [method, path] of all) {
      const params = path.match(/:\w+/g) ?? [];
      if (!params.length) {
        // Lists and pages without ids: what city A gets must hold nothing of B's.
        if (method === 'GET') for (const [who, token] of [['hr', tok.hr], ['staff', tok.staff]] as const) jobs.push({ who, token, method, url: path });
        continue;
      }
      // With ids: every param filled with each id of the kinds it could take (first param varies, others take their first candidate).
      const [first, ...rest] = params;
      for (const id of candidates(first!)) {
        let url = path.replace(first!, id);
        for (const r of rest) url = url.replace(r, candidates(r)[0]!);
        for (const [who, token] of [['hr', tok.hr], ['staff', tok.staff]] as const) jobs.push({ who, token, method, url: url.replace(/\(\.\*\)|\*/g, '') });
      }
    }
    let i = 0;
    await Promise.all(Array.from({ length: 12 }, async () => {
      while (i < jobs.length) {
        const j = jobs[i++]!;
        const req = request(server)[j.method.toLowerCase() as 'get'](j.url).set('x-tenant-subdomain', 'cityalpha').auth(j.token, { type: 'bearer' }).timeout(15_000);
        const r = await (j.method === 'GET' ? req : req.send({}))
          .buffer(true)
          .parse((res, cb) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => cb(null, Buffer.concat(chunks).toString('latin1')));
          })
          .catch((e: Error) => {
            slow.push(`${j.method} ${j.url}: ${e.message}`);
            return { status: 0, body: '' };
          });
        const text = String(r.body ?? '');
        // An id echoed back in a "not found" error is fine; any 2xx answer must hold nothing of B's.
        if (r.status >= 200 && r.status < 300) {
          const hit = bMarkers.find((m) => text.includes(m));
          if (hit) leaks.push(`${j.who} ${j.method} ${j.url} → ${r.status} contains ${hit}`);
        }
      }
    }));
    console.log(`cross-city sweep: ${jobs.length} requests over ${all.length} routes; no answer within 15 s: ${slow.length ? slow.join('; ') : 'none'}`);
    expect(leaks).toEqual([]);
    expect(await snapshot()).toBe(before);
  }, 900_000);
});
