/**
 * Records the API responses the web app asks for, per demo role, by browsing
 * every screen against a running local stack (seeded "kelowna" tenant). The
 * static GitHub Pages demo replays them in the browser (src/lib/demoApi.ts).
 *
 *   npm run build && npm start            (web on :3000, API on :4000)
 *   node scripts/capture-demo.cjs
 *
 * Names are swapped for the fictional demo organization before saving.
 */
const { chromium } = require('playwright');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const BASE = process.env.CAPTURE_BASE ?? 'http://kelowna.localhost:3000';
const CONSOLE = process.env.CAPTURE_CONSOLE ?? 'http://localhost:3000';
const API = process.env.CAPTURE_API ?? 'http://localhost:4000';
const PASSWORD = 'flexcity-dev';
const OUT = join(__dirname, '../src/lib/demo-fixtures');
const ROLES = { guard: 'guard', supervisor: 'supervisor', hr: 'hr', frontdesk: 'frontdesk', steward: 'steward', waterworks: 'waterworks' };

const RENAME = [
  ['City of Kelowna (demo)', 'City of Lakeview (demo)'],
  ['Parkinson Recreation Centre', 'Lakeview Aquatic Centre'],
  ['CUPE Local 338 (demo)', 'Aquatic Workers Local 101 (demo)'],
  ['@kelowna.test', '@demo.flexcity'],
  ['Kelowna', 'Lakeview'],
  ['kelowna', 'lakeview'],
];
// Logos are served by the API, which the static demo doesn't have: the demo embeds its own.
const rename = (s) => RENAME.reduce((acc, [a, b]) => acc.split(a).join(b), s).replace(/\/api\/public\/logo\/[0-9a-f-]+\?v=[0-9a-f]+/g, '__DEMO_LOGO__');

async function apiAs(who) {
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-subdomain': 'kelowna' }, body: JSON.stringify({ email: `${who}@kelowna.test`, password: PASSWORD }) });
  const { accessToken, user } = await r.json();
  const call = async (method, path, body) => {
    const res = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json', 'x-tenant-subdomain': 'kelowna', authorization: `Bearer ${accessToken}` }, body: body ? JSON.stringify(body) : undefined });
    return res.status === 204 ? null : res.json();
  };
  return { user, call };
}

/** Sample activity so screens aren't empty: a union discussion, a record to sign, a time-off request. */
async function prepare() {
  // The demo city's (placeholder) logo, uploaded through the Dev console API.
  const login = await fetch(`${API}/api/platform/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-fh-platform': '1' }, body: JSON.stringify({ email: 'dev@flexcity.dev', password: PASSWORD }) });
  const cookie = String(login.headers.get('set-cookie')).split(';')[0];
  const dev = (method, path, body) => fetch(`${API}/api/platform${path}`, { method, headers: { 'content-type': 'application/json', 'x-fh-platform': '1', cookie }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
  const city = (await dev('GET', '/tenants')).find((c) => c.subdomain === 'kelowna');
  if (city && !city.logoUrl) {
    const png = readFileSync(join(__dirname, 'demo-city-logo.png')).toString('base64');
    await dev('PUT', `/tenants/${city.id}/logo`, { dataUrl: `data:image/png;base64,${png}` });
  }

  const steward = await apiAs('steward');
  const guard = await apiAs('guard');
  const supervisor = await apiAs('supervisor');
  const [local] = await steward.call('GET', '/api/union/locals');
  if (local && !(await steward.call('GET', `/api/union/locals/${local.id}/threads`)).length) {
    const { id } = await steward.call('POST', `/api/union/locals/${local.id}/threads`, {
      title: 'Summer split shifts',
      body: 'Several of you have raised the 6–10 a.m. / 4–8 p.m. splits on the summer schedule. Post your experience here before Thursday’s labour-management meeting.',
    });
    await guard.call('POST', `/api/union/locals/${local.id}/threads/${id}/messages`, { body: 'The gap means a 40-minute drive twice a day for me. Could the morning block move to 7–11?' });
  }
  if (!(await guard.call('GET', '/api/me/discipline')).length) {
    await supervisor.call('POST', `/api/users/${guard.user.id}/discipline`, {
      summary: 'Arrived 25 minutes late for the 6 a.m. opening shift on two days this month without calling the deck phone. Expected: call the deck phone as soon as you know you’ll be late.',
      stewardPresent: true,
    });
  }
  // A shift on now for the lifeguard, clocked in, with a pool reading and an incident logged.
  const now = new Date();
  const dayStart = new Date(now.getTime() - 12 * 3_600_000).toISOString();
  const dayEnd = new Date(now.getTime() + 12 * 3_600_000).toISOString();
  const todays = await guard.call('GET', `/api/me/shifts?from=${encodeURIComponent(dayStart)}&to=${encodeURIComponent(dayEnd)}`);
  if (!todays.length) {
    const [facility] = await supervisor.call('GET', '/api/facilities');
    const positions = await supervisor.call('GET', '/api/positions');
    const hour = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
    const shift = await supervisor.call('POST', '/api/shifts', {
      facilityId: facility.id,
      positionId: positions.find((p) => p.name === 'Lifeguard').id,
      startsAt: new Date(hour.getTime() - 3_600_000).toISOString(),
      endsAt: new Date(hour.getTime() + 4 * 3_600_000).toISOString(),
    });
    await supervisor.call('POST', `/api/shifts/${shift.id}/assign`, { userId: guard.user.id, expectedVersion: shift.version });
    await supervisor.call('POST', '/api/shifts/publish', { facilityId: facility.id, from: dayStart, to: dayEnd });
    await guard.call('POST', '/api/timeclock/in', { facilityId: facility.id, shiftId: shift.id, location: { lat: 49.8879, lon: -119.4697, accuracyM: 12 } });
    const pools = await guard.call('GET', '/api/ops/pools').catch(() => []);
    const main = (Array.isArray(pools) ? pools : []).find((p) => p.name === 'Main Tank') ?? (await supervisor.call('GET', '/api/ops/pools')).find((p) => p.name === 'Main Tank');
    await guard.call('POST', '/api/ops/readings', { poolBodyId: main.id, freeChlorinePpm: '2.1', totalChlorinePpm: '2.3', ph: '7.4', waterTempC: '27.5', batherCount: 34 });
    await guard.call('POST', '/api/incidents', {
      facilityId: facility.id,
      occurredAt: new Date(now.getTime() - 40 * 60_000).toISOString(),
      category: 'FIRST_AID',
      narrative: { summary: 'Child scraped knee on the pool deck near the slide stairs.', peopleInvolved: 'One patron, about 8 years old, with parent.', actionsTaken: 'Cleaned and bandaged; parent informed; deck checked for hazards.', emsCalled: false },
    });
  }
  if (!(await guard.call('GET', '/api/me/time-off')).length) {
    const d = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    await guard.call('POST', '/api/me/time-off', { type: 'VACATION', startsAt: `${d}T07:00:00Z`, endsAt: `${d}T23:59:00Z`, note: 'Family wedding' });
  }
}

async function capture(browser, role) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const responses = {};
  page.on('response', async (res) => {
    const u = new URL(res.url());
    if (!u.pathname.startsWith('/api/') || res.request().method() !== 'GET' || res.status() !== 200) return;
    if (u.pathname.startsWith('/api/notifications/stream') || u.pathname.startsWith('/api/payroll')) return;
    try {
      responses[u.pathname + u.search] = await res.json();
    } catch {
      /* not JSON */
    }
  });
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill(`${ROLES[role]}@kelowna.test`);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.waitForTimeout(1000);

  const visit = async (path) => {
    await page.goto(`${BASE}${path}`);
    await page.locator('main h1').first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(1200);
  };
  const clickAll = async (selector, max = 12) => {
    const n = Math.min(await page.locator(selector).count(), max);
    for (let i = 0; i < n; i++) {
      await page.locator(selector).nth(i).click().catch(() => {});
      await page.waitForTimeout(500);
    }
  };

  const hrefs = await page.$$eval('nav a[href^="/"]', (as) => [...new Set(as.map((a) => a.getAttribute('href')))]);
  for (const href of [...hrefs, '/profile']) {
    await visit(href);
    // Sub-views and tabs that load their own data.
    const tabs = await page.locator('main [role=radiogroup] [role=radio]').allInnerTexts().catch(() => []);
    for (const name of tabs) {
      await page.locator('main [role=radiogroup] [role=radio]', { hasText: name }).first().click().catch(() => {});
      await page.waitForTimeout(700);
    }
    if (href === '/union') {
      await page.locator('main [role=radiogroup] [role=radio]').first().click().catch(() => {});
      await page.locator('main button:has(span.text-body-strong)').first().waitFor({ timeout: 10000 }).catch(() => {});
      await clickAll('main button:has(span.text-body-strong)', 3);
      await page.waitForTimeout(1000);
    }
  }
  if (hrefs.includes('/manage/staff')) {
    await visit('/manage/staff');
    for (const status of ['Inactive', 'Active']) {
      await page.getByRole('radio', { name: status, exact: true }).click().catch(() => {});
      await page.waitForTimeout(600);
    }
    await page.locator('main a[href*="/manage/staff/person"]').first().waitFor({ timeout: 10000 });
    const people = await page.$$eval('main a[href*="/manage/staff/person"]', (as) => as.map((a) => a.getAttribute('href')));
    for (const href of people) await visit(href);
  }
  await page.close();

  const capturedOn = new Date().toISOString().slice(0, 10);
  const json = JSON.parse(rename(JSON.stringify({ capturedOn, responses })));
  writeFileSync(join(OUT, `${role}.json`), JSON.stringify(json));
  console.log(role, Object.keys(responses).length, 'responses');
}

/** The FH Dev console: city list, every city's tabs, and the account page. */
async function capturePlatform(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const responses = {};
  page.on('response', async (res) => {
    const u = new URL(res.url());
    if (!u.pathname.startsWith('/api/platform/') || res.request().method() !== 'GET' || res.status() !== 200) return;
    if (!(res.headers()['content-type'] ?? '').includes('json')) return;
    try {
      responses[u.pathname.slice('/api/platform'.length) + u.search] = await res.json();
    } catch {
      /* not JSON */
    }
  });
  await page.goto(`${CONSOLE}/platform/login`);
  await page.getByLabel('Email').fill('dev@flexcity.dev');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => u.pathname === '/platform');
  await page.getByRole('button', { name: 'Not now' }).click({ timeout: 3000 }).catch(() => {});
  await page.locator('main a[href*="/platform/city"]').first().waitFor();
  const cities = await page.$$eval('main a[href*="/platform/city"]', (as) => as.map((a) => a.getAttribute('href')));
  for (const href of cities) {
    await page.goto(`${CONSOLE}${href}`);
    await page.locator('main h1').first().waitFor();
    await page.waitForTimeout(800);
  }
  await page.goto(`${CONSOLE}/platform/account`);
  await page.waitForTimeout(1200);
  await page.close();
  writeFileSync(join(OUT, 'platform.json'), rename(JSON.stringify({ capturedOn: new Date().toISOString().slice(0, 10), responses })));
  console.log('platform', Object.keys(responses).length, 'responses');
}

(async () => {
  await prepare();
  const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP *.localhost 127.0.0.1'] });
  for (const role of Object.keys(ROLES)) await capture(browser, role);
  // Public careers page (no sign-in).
  const page = await browser.newPage();
  let jobs = [];
  page.on('response', async (r) => r.url().includes('/api/public/jobs') && (jobs = await r.json()));
  await page.goto(`${BASE}/jobs`);
  await page.waitForTimeout(1500);
  writeFileSync(join(OUT, 'public.json'), rename(JSON.stringify({ capturedOn: new Date().toISOString().slice(0, 10), responses: { '/api/public/jobs': jobs } })));
  await capturePlatform(browser);
  await browser.close();
})();
