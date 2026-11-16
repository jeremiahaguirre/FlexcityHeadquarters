/**
 * Department limits hold on every route. Signed in with a role that holds every capability in the
 * catalogue but is limited to one department (Aquatics), every route the API has is called: each
 * path parameter is filled with the ids of a person in another department (Water Works) and their
 * records, plain and percent-encoded, and every route without parameters is called as is.
 *
 * It fails on any 2xx answer that
 * - holds anything of the out-of-department person (id, name, email, their records' ids), or
 * - comes from a write (anything but GET) aimed at their records, or at an organization-wide
 *   setting with no parameters,
 * unless the route is on the checked-in allow-list below with the reason it's fine. A new route
 * that leaks across departments, or a new organization-wide setting a department-limited admin can
 * change, fails here until it checks scope (assertUserInScope, peopleWhere, requireWholeOrganization).
 * The out-of-department person's rows are compared before and after as well.
 */
import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { forgetCustomPermissions } from '../../src/services/people/customRoles.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');
const server = createApp();
const SUB = 'scopesweep';
let t: Awaited<ReturnType<typeof seedTenant>>;
const tok = { limited: '', hr: '' };
const ids = { hr: '', limited: '', mine: '', theirs: '' };
const kinds: Record<string, string[]> = {};
const markers: string[] = [];

/**
 * Answers a department-limited admin may get with something of another department in it, or that
 * may succeed as a write without parameters. Each with the reason. Keep it short.
 */
const ALLOWED: Array<{ route: string; why: string }> = [
  { route: 'POST /api/kiosk/unpair', why: 'clears the calling browser’s own kiosk cookie; touches no data' },
];
const allowed = (method: string, path: string) => ALLOWED.some((x) => x.route === `${method} ${path}`);
/** The caller's own pages and sign-in: a write there changes only the caller. Answers are still checked for others' data. */
const ownPage = (path: string) => /^\/api\/(me|auth)(\/|$)/.test(path);

/** Every route as [method, path], as crossCity.test.ts finds them. */
const MOUNTS = ['/api/platform', '/api/v1', '/api'];
function routes(appOrRouter: Express): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  type Matcher = (path: string) => false | { path: string };
  const prefix = (layer: { slash?: boolean; matchers: Matcher[] }) => {
    if (layer.slash) return '';
    for (const m of MOUNTS) {
      const hit = layer.matchers[0]!(`${m}/__probe`);
      if (hit && hit.path === m) return m;
    }
    throw new Error('A router is mounted on a path scopeSweep.test.ts doesn’t know: add it to MOUNTS.');
  };
  const walk = (stack: Array<{ route?: { path: string | string[]; methods: Record<string, boolean> }; handle?: { stack?: unknown[] }; slash?: boolean; matchers: Matcher[] }>, base: string) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const p of [layer.route.path].flat()) for (const m of Object.keys(layer.route.methods)) out.push([m.toUpperCase(), `${base}${p}`]);
      } else if (layer.handle?.stack) walk(layer.handle.stack as never, base + prefix(layer));
    }
  };
  walk((appOrRouter as unknown as { router: { stack: never[] } }).router.stack, '');
  return out;
}

async function snapshot() {
  const where = { userId: ids.theirs };
  const [user, shifts, punches, timeOff, discipline, notes, events, rates, positions] = await Promise.all([
    owner.user.findUnique({ where: { id: ids.theirs } }),
    owner.shift.findMany({ where, orderBy: { id: 'asc' } }),
    owner.timePunch.findMany({ where, orderBy: { id: 'asc' } }),
    owner.timeOffRequest.findMany({ where, orderBy: { id: 'asc' } }),
    owner.disciplinaryRecord.findMany({ where, orderBy: { id: 'asc' } }),
    owner.conductNote.findMany({ where, orderBy: { id: 'asc' } }),
    owner.reliabilityEvent.findMany({ where, orderBy: { id: 'asc' } }),
    owner.payRate.findMany({ where, orderBy: { id: 'asc' } }),
    owner.userPosition.findMany({ where, orderBy: { positionId: 'asc' } }),
  ]);
  return JSON.stringify({ user, shifts, punches, timeOff, discipline, notes, events, rates, positions });
}

beforeAll(async () => {
  t = await seedTenant(SUB, 0);
  const now = Math.floor(Date.now() / 1000);
  const guard = (await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Pool Lifeguard' } })).id;
  const water = (await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Water Operator' } })).id;
  const mk = async (roles: Array<'HR_ADMIN' | 'STAFF' | 'EMPLOYEE'>, first: string, last: string, position?: string) => {
    const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles, employmentStatus: 'FULL_TIME', firstName: first, lastName: last, email: `${first.toLowerCase()}.${last.toLowerCase()}@${SUB}.test`, dateOfBirth: new Date('1990-01-01') } });
    if (position) await owner.userPosition.create({ data: { tenantId: t.tenant.id, userId: u.id, positionId: position } });
    return u.id;
  };
  ids.hr = await mk(['HR_ADMIN'], 'Hana', 'Admin');
  ids.mine = await mk(['STAFF'], 'Pat', 'Poolside', guard);
  ids.theirs = await mk(['EMPLOYEE'], 'Wendell', 'Waterworksonly', water);
  tok.hr = await signAccessToken({ sub: ids.hr, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now, mfa: true });
  const hr = (m: 'post' | 'get', p: string, b?: object) => request(server)[m](p).set('x-tenant-subdomain', SUB).auth(tok.hr, { type: 'bearer' }).send(b);
  const aquatics = (await hr('post', '/api/departments', { name: 'Aquatics', aquatic: true, positionIds: [guard] })).body.id as string;
  await hr('post', '/api/departments', { name: 'Water Works', positionIds: [water] });
  const catalog = (await hr('get', '/api/roles')).body.catalog as Record<string, string[]>;
  const role = await hr('post', '/api/roles', { name: 'Aquatics everything', permissions: Object.values(catalog).flat(), scopeDepartmentIds: [aquatics] });
  if (role.status !== 201) throw new Error(`role: ${role.status} ${JSON.stringify(role.body)}`);
  ids.limited = await mk(['EMPLOYEE'], 'Lim', 'Ited', guard);
  await owner.userCustomRole.create({ data: { tenantId: t.tenant.id, userId: ids.limited, customRoleId: role.body.id } });
  forgetCustomPermissions(t.tenant.id);
  tok.limited = await signAccessToken({ sub: ids.limited, tid: t.tenant.id, roles: ['EMPLOYEE'], aat: now, mfa: true });

  // The Water Works person's records, whose ids fill every path.
  const shift = await owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: water, userId: ids.theirs, startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000), status: 'PUBLISHED' } });
  const punch = await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: ids.theirs, facilityId: t.facility.id, positionId: water, clockIn: new Date(Date.now() - 3 * 3_600_000), clockOut: new Date(Date.now() - 3_600_000), status: 'PENDING' } });
  const timeOff = await owner.timeOffRequest.create({ data: { tenantId: t.tenant.id, userId: ids.theirs, startsAt: new Date(Date.now() + 5 * 86_400_000), endsAt: new Date(Date.now() + 6 * 86_400_000), type: 'VACATION', note: 'Waterworks-only trip' } });
  const note = await owner.conductNote.create({ data: { tenantId: t.tenant.id, userId: ids.theirs, recordedById: ids.hr, category: 'CONDUCT', summary: 'Waterworks-only conduct note text.', occurredAt: new Date() } });
  await owner.payRate.create({ data: { tenantId: t.tenant.id, userId: ids.theirs, positionId: water, hourlyRate: 47.13, effectiveFrom: new Date('2025-01-01') } });
  Object.assign(kinds, { user: [ids.theirs], shift: [shift.id], punch: [punch.id], other: [timeOff.id, note.id] });
  markers.push(ids.theirs, shift.id, punch.id, timeOff.id, note.id, 'Waterworksonly', `wendell.waterworksonly@${SUB}.test`, 'Waterworks-only');
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('department limits hold on every route', () => {
  it('a department-limited role with every capability reaches no one outside its department, and no organization-wide setting', async () => {
    const before = await snapshot();
    // Live streams stay open by design; the console, the public API (keys, not sessions) and marketing aren't the city app.
    const all = routes(server as unknown as Express).filter(([, p]) => p.startsWith('/api/') && !/^\/api\/(platform|v1|marketing|public)(\/|$)/.test(p) && !p.includes('stream'));
    expect(all.length).toBeGreaterThan(300);
    const encode = (id: string) => `%${id.charCodeAt(0).toString(16)}${id.slice(1)}`;
    const candidates = (param: string) => {
      const p = param.slice(1).toLowerCase();
      for (const k of ['user', 'shift', 'punch']) if (p.startsWith(k)) return kinds[k]!;
      return Object.values(kinds).flat();
    };
    const jobs: Array<{ method: string; path: string; url: string; aimed: boolean }> = [];
    for (const [method, path] of all) {
      const params = path.match(/:\w+/g) ?? [];
      if (!params.length) {
        jobs.push({ method, path, url: path, aimed: false });
        continue;
      }
      const [first, ...rest] = params;
      for (const id of candidates(first!)) {
        for (const form of [id, encode(id)]) {
          let url = path.replace(first!, form);
          for (const r of rest) url = url.replace(r, candidates(r)[0]!);
          jobs.push({ method, path, url: url.replace(/\(\.\*\)|\*/g, ''), aimed: true });
        }
      }
    }
    const problems: string[] = [];
    const slow: string[] = [];
    let i = 0;
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (i < jobs.length) {
        const j = jobs[i++]!;
        const req = request(server)[j.method.toLowerCase() as 'get'](j.url).set('x-tenant-subdomain', SUB).auth(tok.limited, { type: 'bearer' }).timeout(15_000);
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
        if (r.status < 200 || r.status >= 300 || allowed(j.method, j.path)) continue;
        const text = String(r.body ?? '');
        const hit = markers.find((m) => text.includes(m));
        if (hit) problems.push(`${j.method} ${j.url} → ${r.status} holds ${hit}`);
        else if (j.method !== 'GET' && !(ownPage(j.path) && !j.aimed)) problems.push(`${j.method} ${j.url} → ${r.status} (${j.aimed ? 'a write aimed at another department' : 'an organization-wide write'})`);
      }
    }));
    console.log(`department sweep: ${jobs.length} requests over ${all.length} routes; no answer within 15 s: ${slow.length ? slow.join('; ') : 'none'}`);
    expect(problems.sort()).toEqual([]);
    expect(await snapshot()).toBe(before);
  }, 900_000);
});
