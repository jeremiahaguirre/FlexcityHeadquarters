/**
 * The menu, the page guard and the API must agree: whoever is shown a menu item
 * can load that screen. Each built-in role, each switched-off feature, and a
 * custom role holding just one of the item's permissions opens every screen in
 * its menu and loads what the screen first asks for. A screen shown to people
 * whose API answers "no access" or "switched off" (a "No access" page or an
 * endless skeleton) fails here.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { MENU } from '../../src/auth/menu.js';
import type { Permission } from '../../src/auth/permissions.js';
import { ROLE_PERMISSIONS } from '../../src/auth/permissions.js';
import { ALLOWED_CUSTOM_PERMISSIONS } from '../../src/services/people/customRoles.js';
import { FEATURE_KEYS, forgetFeatures } from '../../src/services/platform/features.js';
import type { AccessRole } from '../../src/generated/prisma/client.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'menuaccess';
const FROM = '2026-06-01T00:00:00.000Z';
const TO = '2026-06-08T00:00:00.000Z';

/**
 * What each screen asks for when it opens. A [path, permissions] pair is asked
 * for only by people holding one of those permissions (the screen checks first).
 * Every menu item needs an entry, so a new screen can't skip this check.
 */
type Call = string | [string, Permission[]];
const LANDING: Record<string, Call[]> = {
  '/today': [`/api/me/shifts?from=${FROM}&to=${TO}`, ['/api/shiftboard/offers', ['shiftboard.claim']], ['/api/offers/pending', ['shiftboard.approve']], ['/api/time-off', ['timeoff.approve']], ['/api/punches', ['timeclock.review']], ['/api/ops/status', ['ops.status.read']]],
  '/schedule': [`/api/me/shifts?from=${FROM}&to=${TO}`],
  '/board': ['/api/shiftboard/offers'],
  '/timeclock': [`/api/me/punches?from=${FROM}&to=${TO}`],
  '/time-off': ['/api/me/time-off'],
  '/availability': ['/api/me/availability'],
  '/preferences': ['/api/me/preferences'],
  '/bids': ['/api/me/bids'],
  '/lessons': ['/api/me/lessons?from=2026-06-01&to=2026-06-09'],
  '/alone': ['/api/me/lone-work'],
  '/patrol': ['/api/me/patrols', '/api/winter/routes'],
  '/pretrip': ['/api/vehicles'],
  '/pay': ['/api/me/pay'],
  '/expenses': ['/api/me/expenses'],
  '/logbook': ['/api/facilities'],
  '/messages': ['/api/messages/conversations'],
  '/headcount': ['/api/ops/headcounts/current'],
  '/deck': ['/api/facilities'],
  '/status': ['/api/ops/pools'],
  '/ops': ['/api/ops/headcounts/current', `/api/ops/readings?from=${FROM}&to=${TO}`],
  '/incidents': [['/api/incidents?from=' + FROM + '&to=' + TO, ['incidents.read']]],
  '/manage/hr': ['/api/hr/overview'],
  '/members': ['/api/fees'],
  '/manage/programs': ['/api/campaigns', '/api/swim-levels'],
  '/manage/schedule': ['/api/schedule/fill/options'],
  '/manage/forecast': ['/api/facilities'],
  '/manage/approvals': [['/api/offers/pending', ['shiftboard.approve']], ['/api/time-off', ['timeoff.approve']], ['/api/punches', ['timeclock.review']], ['/api/trades', ['shiftboard.approve']]],
  '/manage/staff': ['/api/users?status=ACTIVE', '/api/positions'],
  '/manage/overtime': ['/api/positions', '/api/overtime/policy'],
  '/manage/onboarding': ['/api/onboarding/people'],
  '/manage/training': ['/api/training'],
  '/manage/injuries': ['/api/injury-claims'],
  '/manage/care': ['/api/care/checkins'],
  '/manage/lone-work': ['/api/lone-work'],
  '/manage/call-outs': ['/api/call-outs'],
  '/manage/winter': ['/api/winter/settings', '/api/winter/routes'],
  '/manage/rotations': ['/api/schedule/rotations', '/api/facilities'],
  '/manage/shift-templates': ['/api/schedule/templates'],
  '/manage/bids': ['/api/bids/rounds'],
  '/manage/on-call': [`/api/schedule/on-call?from=${FROM}&to=${TO}`, '/api/positions'],
  '/manage/work-rules': [[`/api/schedule/changes?from=${FROM}&to=${TO}`, ['schedule.write', 'payroll.export']], '/api/schedule/work-rules'],
  '/manage/people': ['/api/people/review'],
  '/manage/org-chart': ['/api/org-chart'],
  '/manage/compliance': ['/api/facilities'],
  '/manage/fleet': ['/api/vehicles'],
  '/manage/coverage': ['/api/coverage/rules', '/api/coverage/gaps?from=2026-06-01&days=7'],
  '/manage/benchmarks': ['/api/benchmarks'],
  '/manage/certifications': ['/api/certifications/unverified'],
  '/manage/jobs': ['/api/jobs'],
  '/manage/payroll': ['/api/payroll/runs'],
  '/manage/expenses': ['/api/expenses?status=SUBMITTED'],
  '/manage/benefits': ['/api/benefits'],
  '/manage/accounting': ['/api/accounting/labour-cost?year=2026'],
  '/manage/fees': ['/api/fees'],
  '/manage/bookings': ['/api/bookable-services', '/api/bookings'],
  '/manage/reports': ['/api/reports', '/api/reports/saved'],
  '/manage/announcements': ['/api/announcements'],
  '/manage/messages': ['/api/messages-admin/reports'],
  '/manage/surveys': ['/api/surveys'],
  '/manage/roles': ['/api/roles'],
  '/manage/billing': ['/api/billing?lang=en-CA'],
  '/manage/settings': [['/api/settings', ['tenant.configure']], ['/api/ops/pools?all=1', ['ops.configure']]],
  '/union': ['/api/union/locals'],
  '/union/bids': ['/api/bids/rounds'],
  '/surveys': ['/api/me/surveys'],
};

let tenantId: string;
const tokens = new Map<string, string>();

async function tokenFor(key: string, roles: AccessRole[], customPerms?: Permission[]): Promise<string> {
  const hit = tokens.get(key);
  if (hit) return hit;
  const u = await owner.user.create({ data: { tenantId, roles, employmentStatus: 'FULL_TIME', firstName: 'Menu', lastName: key.replace(/[^a-z]/gi, ''), email: `${key.replace(/[^a-z0-9]/gi, '-')}@${SUB}.test` } });
  if (customPerms) {
    const r = await owner.customRole.create({ data: { tenantId, name: key, permissions: customPerms } });
    await owner.userCustomRole.create({ data: { tenantId, userId: u.id, customRoleId: r.id } });
  }
  const token = await signAccessToken({ sub: u.id, tid: tenantId, roles });
  tokens.set(key, token);
  return token;
}

const get = (token: string, path: string) => request(server).get(path).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' });

/** The menu as the app shows it (apps/web/src/lib/nav.ts visibleNav), from /api/me. */
async function menuOf(token: string) {
  const me = (await get(token, '/api/me')).body as { permissions: string[]; hiddenMenu: string[]; features: Record<string, boolean> };
  const can = (p: string) => me.permissions.includes(p);
  return { can, items: MENU.filter((m) => !me.hiddenMenu.includes(m.href) && m.permissions.some(can) && !(m.feature && me.features[m.feature] === false)) };
}

/** Opens every screen in the person's menu; returns the screens whose first requests failed. */
async function brokenScreens(token: string): Promise<string[]> {
  const { can, items } = await menuOf(token);
  const broken: string[] = [];
  for (const m of items) {
    for (const c of LANDING[m.href] ?? []) {
      const [path, only] = typeof c === 'string' ? [c, null] : c;
      if (only && !only.some(can)) continue;
      const res = await get(token, path);
      if (res.status >= 400) broken.push(`${m.href} → GET ${path}: ${res.status} ${res.body?.code ?? ''}`);
    }
  }
  return broken;
}

beforeAll(async () => {
  const t = await seedTenant(SUB, 0);
  tenantId = t.tenant.id;
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

const ROLES = Object.keys(ROLE_PERMISSIONS) as AccessRole[];

describe('menu, page guard and API agree', () => {
  it('every menu item says what its screen loads first', () => {
    expect(MENU.filter((m) => !LANDING[m.href]).map((m) => m.href)).toEqual([]);
  });

  it.each(ROLES)('%s: every screen in the menu loads', async (role) => {
    expect((await brokenScreens(await tokenFor(`role-${role}`, [role]))).join('\n')).toBe('');
  });

  it.each(FEATURE_KEYS.filter((f) => f !== 'union'))('with %s switched off, every role’s menu still loads', async (feature) => {
    await owner.tenant.update({ where: { id: tenantId }, data: { features: { [feature]: false } } });
    forgetFeatures(tenantId);
    try {
      const broken: string[] = [];
      for (const role of ROLES) broken.push(...(await brokenScreens(await tokenFor(`role-${role}`, [role]))).map((b) => `${role}: ${b}`));
      expect(broken.join('\n')).toBe('');
    } finally {
      await owner.tenant.update({ where: { id: tenantId }, data: { features: {} } });
      forgetFeatures(tenantId);
    }
  });

  it('My pay follows the payroll switch, not the timeclock, and salaried HR has it too', async () => {
    const hrefs = async (role: AccessRole) => (await menuOf(await tokenFor(`role-${role}`, [role]))).items.map((m) => m.href);
    expect(await hrefs('HR_ADMIN')).toContain('/pay');
    await owner.tenant.update({ where: { id: tenantId }, data: { features: { timeclock: false } } });
    forgetFeatures(tenantId);
    try {
      for (const role of ['STAFF', 'FRONT_DESK', 'EMPLOYEE', 'HR_ADMIN'] as const) expect(await hrefs(role), role).toContain('/pay');
      await owner.tenant.update({ where: { id: tenantId }, data: { features: { payroll: false } } });
      forgetFeatures(tenantId);
      for (const role of ROLES) expect(await hrefs(role), role).not.toContain('/pay');
    } finally {
      await owner.tenant.update({ where: { id: tenantId }, data: { features: {} } });
      forgetFeatures(tenantId);
    }
  });

  // One custom role per menu permission a city can give: the screen it shows must load with only that capability.
  const single = [...new Set(MENU.flatMap((m) => m.permissions))].filter((p) => ALLOWED_CUSTOM_PERMISSIONS.has(p));
  it.each(single)('a custom role holding only %s', async (p) => {
    expect((await brokenScreens(await tokenFor(`only-${p}`, [], [p]))).join('\n')).toBe('');
  });
});
