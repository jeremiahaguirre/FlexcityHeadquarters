/**
 * Records the API responses the web app asks for, per demo role, by browsing
 * every screen against a running local stack (seeded "kelowna" tenant). The
 * static GitHub Pages demo replays them in the browser (src/lib/demoApi.ts).
 *
 *   npm run build && npm start            (web on :3000; API on :4000 with PLATFORM_MFA=off,
 *                                         since the script signs in to the Dev console with a password)
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

const iso = (d) => d.toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + n * 86_400_000);
const nextDow = (dow, from = 7) => {
  const d = plusDays(from);
  while (d.getDay() !== dow) d.setDate(d.getDate() + 1);
  return iso(d);
};

/** Programs, member services, prices, bookings, coverage, fleet, injuries, winter and lone work. */
async function prepareCityWorks() {
  const sup = await apiAs('supervisor');
  const hr = await apiAs('hr');
  const desk = await apiAs('frontdesk');
  const water = await apiAs('waterworks');
  const [facility] = await sup.call('GET', '/api/facilities');
  const positions = await sup.call('GET', '/api/positions');
  const instructor = positions.find((p) => /instructor/i.test(p.name)) ?? positions[0];

  if (!(await sup.call('GET', '/api/swim-levels')).length) {
    await sup.call('POST', '/api/swim-levels/presets', { preset: 'LIFESAVING', advanced: true });
    await sup.call('POST', '/api/swim-levels/presets', { preset: 'CANSKATE' });
  }
  if (!(await sup.call('GET', '/api/campaigns')).length) {
    const levels = await sup.call('GET', '/api/swim-levels');
    const lvl = (n) => levels.find((l) => l.name === n)?.id ?? null;
    const startsOn = nextDow(1);
    const { id } = await sup.call('POST', '/api/campaigns', { name: 'Winter swim lessons 2027', nameFr: 'Cours de natation d’hiver 2027', kind: 'LESSONS', startsOn, endsOn: iso(new Date(new Date(startsOn).getTime() + 70 * 86_400_000)), registrationOpensAt: new Date(Date.now() - 86_400_000).toISOString() });
    const base = { facilityId: facility.id, positionId: instructor.id, priceCents: 9500, memberPriceCents: 8000 };
    const set = (level, daysOfWeek, start, weeks, extra = {}) =>
      sup.call('POST', `/api/campaigns/${id}/sets`, { ...base, levelId: lvl(level), daysOfWeek, startMinute: start, endMinute: start + 30, startsOn, endsOn: iso(new Date(new Date(startsOn).getTime() + (weeks * 7 - 1) * 86_400_000)), ...extra });
    await set('Parent & Tot 1', [0], 9 * 60 + 30, 8, { priceCents: 7500, memberPriceCents: 6500 });
    await set('Preschool 2', [6], 10 * 60, 8);
    await set('Preschool 2', [1, 2, 3, 4, 5], 9 * 60, 2, { name: 'Preschool 2 (March break)' });
    await set('Swimmer 3', [2, 4], 17 * 60, 6, { endMinute: 17 * 60 + 45, priceCents: 12000, memberPriceCents: 10500 });
    await set('Bronze Medallion', [1, 2, 3, 4, 5], 13 * 60, 2, { endMinute: 15 * 60, priceCents: 22500, memberPriceCents: null });
    await sup.call('POST', `/api/campaigns/${id}/publish`);
  }
  if (!(await sup.call('GET', '/api/fees')).length) {
    for (const f of [
      { kind: 'MEMBERSHIP', period: 'YEAR', ageGroup: 'FAMILY', name: 'Family annual', nameFr: 'Famille, annuel', priceCents: 52000 },
      { kind: 'MEMBERSHIP', period: 'YEAR', ageGroup: 'ADULT', name: 'Adult annual', nameFr: 'Adulte, annuel', priceCents: 34000 },
      { kind: 'MEMBERSHIP', period: 'MONTH', ageGroup: 'ADULT', name: 'Adult monthly', nameFr: 'Adulte, mensuel', priceCents: 5500 },
      { kind: 'MEMBERSHIP', period: 'MONTH', ageGroup: 'SENIOR', name: 'Senior monthly', nameFr: 'Aîné, mensuel', priceCents: 3800 },
      { kind: 'DROP_IN', period: 'VISIT', ageGroup: 'ADULT', name: 'Adult swim drop-in', nameFr: 'Bain libre adulte', priceCents: 650 },
      { kind: 'DROP_IN', period: 'VISIT', ageGroup: 'CHILD', name: 'Child swim drop-in', nameFr: 'Bain libre enfant', priceCents: 375 },
      { kind: 'DROP_IN', period: 'VISIT', ageGroup: 'ALL', name: 'Public skate', nameFr: 'Patinage libre', priceCents: 450 },
      { kind: 'PASS', period: 'NONE', ageGroup: 'ADULT', name: 'Adult 10-visit pass', nameFr: 'Carte 10 visites adulte', priceCents: 5800, visits: 10 },
    ]) await sup.call('POST', '/api/fees', f);
  }
  const settings = await sup.call('GET', '/api/signup/settings');
  if (!settings.enabled) {
    await sup.call('PUT', '/api/signup/settings', {
      enabled: true,
      terms: 'Participants follow instructors’ and lifeguards’ directions at all times.\nA full refund is available before the second class; after that, credits only for medical reasons.\nParents or guardians of children under 7 stay on site during lessons.',
      termsFr: 'Les participants suivent en tout temps les consignes des moniteurs et des sauveteurs.\nUn remboursement complet est offert avant le deuxième cours; ensuite, des crédits seulement pour raisons médicales.\nLes parents ou tuteurs des enfants de moins de 7 ans restent sur place pendant les cours.',
      payment: 'Pay at the front desk or by phone within 3 days to keep your spot.',
      paymentFr: 'Payez à l’accueil ou par téléphone d’ici 3 jours pour garder votre place.',
      privacyContact: 'privacy@demo.flexcity',
    });
  }
  if (!(await sup.call('GET', '/api/bookable-services')).length) {
    await sup.call('POST', '/api/bookable-services', { facilityId: facility.id, name: 'Party room', nameFr: 'Salle de fête', description: 'Two hours in the party room after a public swim. Tables and chairs for 20.', durationMinutes: 120, priceCents: 15000, capacity: 1, maxPartySize: 20, daysOfWeek: [0, 6], openMinute: 10 * 60, closeMinute: 18 * 60, leadDays: 3 });
    await sup.call('POST', '/api/bookable-services', { facilityId: facility.id, name: 'Lane rental', nameFr: 'Location de couloir', description: 'One 25 m lane for a team or club.', durationMinutes: 60, priceCents: 4500, capacity: 2, maxPartySize: 10, daysOfWeek: [1, 2, 3, 4, 5], openMinute: 6 * 60, closeMinute: 9 * 60, leadDays: 2 });
  }
  if (!(await sup.call('GET', '/api/bookings')).length) {
    const [room] = await sup.call('GET', '/api/bookable-services');
    const date = nextDow(6, 5);
    await fetch(`${API}/api/public/bookings`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-subdomain': 'kelowna' }, body: JSON.stringify({ serviceId: room.id, date, startMinute: 12 * 60, partySize: 14, contact: { name: 'Sam Lee', email: 'sam.lee@example.ca', phone: '250-555-0177' }, notes: 'Birthday party, turning 7', consents: { terms: true, privacy: true }, startedAt: Date.now() - 60_000 }) });
  }
  if (!(await desk.call('GET', '/api/households?q=')).length) {
    const years = (y) => iso(new Date(Date.now() - y * 365.25 * 86_400_000));
    const { id } = await desk.call('POST', '/api/households', {
      name: 'Tremblay', emergencyName: 'Luc Tremblay', emergencyPhone: '250-555-0123',
      members: [
        { role: 'GUARDIAN', firstName: 'Marie', lastName: 'Tremblay', phone: '250-555-0199', email: 'marie.tremblay@example.ca' },
        { role: 'CHILD', firstName: 'Léa', lastName: 'Tremblay', dateOfBirth: years(4.4), safetyNote: 'Asthma: inhaler in swim bag' },
        { role: 'CHILD', firstName: 'Noé', lastName: 'Tremblay', dateOfBirth: years(0.6) },
      ],
    });
    await desk.call('POST', '/api/households', { name: 'Singh', members: [{ role: 'GUARDIAN', firstName: 'Priya', lastName: 'Singh', phone: '250-555-0144' }, { role: 'CHILD', firstName: 'Arjun', lastName: 'Singh', dateOfBirth: years(7.2) }] });
    const fees = await desk.call('GET', '/api/fees');
    await desk.call('POST', '/api/sales', { feeId: fees.find((f) => f.name === 'Family annual').id, householdId: id, paymentMethod: 'DEBIT' });
    const fam = await desk.call('GET', `/api/households/${id}`);
    const offers = await desk.call('GET', `/api/offerings?memberId=${fam.members.find((m) => m.firstName === 'Léa').id}`);
    const pre = offers[0].sets.find((x) => x.name === 'Preschool 2');
    await desk.call('POST', '/api/registrations', { setId: pre.id, memberId: fam.members.find((m) => m.firstName === 'Léa').id, paymentMethod: 'DEBIT' });
    const fees2 = fees.find((f) => f.name === 'Child swim drop-in');
    await desk.call('POST', '/api/sales', { feeId: fees2.id, paymentMethod: 'CASH' });
  }
  if (!(await sup.call('GET', '/api/coverage/rules')).length) {
    const certs = await sup.call('GET', '/api/certifications');
    const nl = certs.find((c) => /national lifeguard|nls/i.test(c.name)) ?? certs[0];
    await sup.call('POST', '/api/coverage/rules', { facilityId: facility.id, name: 'Certified lifeguard on deck', certificationId: nl.id, minCount: 2, daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startMinute: 6 * 60, endMinute: 21 * 60, note: 'Facility safety plan: two NL guards whenever the pool is open.' });
  }
  if (!(await hr.call('GET', '/api/vehicles')).vehicles.length) {
    await hr.call('POST', '/api/vehicles', { unit: 'P-12', description: 'Tandem plow truck', plate: 'KJ 4471' });
    await hr.call('POST', '/api/vehicles', { unit: 'T-3', description: 'Water service pickup', plate: 'LM 2208' });
    await hr.call('POST', '/api/vehicles', { unit: 'Z-1', description: 'Ice resurfacer' });
    const vs = (await water.call('GET', '/api/vehicles')).vehicles;
    const items = ['BRAKES', 'STEERING', 'LIGHTS', 'TIRES_WHEELS', 'HORN', 'WIPERS_WASHERS', 'MIRRORS_WINDOWS', 'FLUID_LEAKS'].map((item) => ({ item, ok: true }));
    await water.call('POST', `/api/vehicles/${vs.find((v) => v.unit === 'T-3').id}/inspections`, { odometerKm: 84213, items });
  }
  if (!(await hr.call('GET', '/api/injury-claims')).claims.length) {
    const users = await hr.call('GET', '/api/users');
    const who = users.find((u) => /maintenance/i.test(u.email)) ?? users[0];
    await hr.call('POST', '/api/injury-claims', { userId: who.id, facilityId: facility.id, occurredAt: new Date(Date.now() - 26 * 3_600_000).toISOString(), learnedAt: new Date(Date.now() - 25 * 3_600_000).toISOString(), lostTime: true, healthCare: true, description: 'Strained lower back lifting a pool cover reel' });
  }
  const winter = await hr.call('GET', '/api/winter/settings');
  if (!winter.callOutsOn) {
    await hr.call('PUT', '/api/winter/settings', { callOutsOn: true, patrolsOn: true, season: { start: '11-01', end: '04-15' }, callOuts: { responseMinutes: 15, minRestHours: 8 }, patrols: { graceMinutes: 60 } });
    await hr.call('POST', '/api/winter/routes', { name: 'Route 7: Hillside Dr', roadClass: '3', intervalHours: 24 });
    await hr.call('POST', '/api/winter/routes', { name: 'Route 2: Lakeshore Rd', roadClass: '2', intervalHours: 8 });
  }
  if (!(await water.call('GET', '/api/me/lone-work'))) {
    await water.call('POST', '/api/me/lone-work', { location: 'Pump station 4, lower level', task: 'Valve inspection', intervalMinutes: 60 });
  }
  await prepareHr(hr, sup);
}

/** HR departments: training courses and records, a review in progress, a grievance, leave entitlements. */
async function prepareHr(hr, sup) {
  const guard = await apiAs('guard');
  const positions = await hr.call('GET', '/api/positions');
  const guardPos = positions.find((p) => p.name === 'Lifeguard');
  const training = await hr.call('GET', '/api/training');
  if (!training.courses.length) {
    const sfa = await hr.call('POST', '/api/training/courses', { name: 'Standard First Aid recertification', nameFr: 'Recertification en secourisme général', hours: 8, mandatory: true, renewMonths: 36, positionIds: guardPos ? [guardPos.id] : [] });
    await hr.call('POST', '/api/training/courses', { name: 'WHMIS 2015', nameFr: 'SIMDUT 2015', hours: 2, mandatory: true, renewMonths: 12 });
    await hr.call('POST', '/api/training/courses', { name: 'Respectful workplace', nameFr: 'Milieu de travail respectueux', hours: 1.5 });
    await sup.call('POST', '/api/training/records', { courseId: sfa.id, userIds: [guard.user.id], completedOn: iso(plusDays(-200)), trainer: 'Lifesaving Society' });
  }
  if (!(await hr.call('GET', '/api/reviews')).length) {
    await hr.call('POST', '/api/reviews', { userId: guard.user.id, reviewerId: sup.user.id, cycle: `${new Date().getFullYear()} season review`, dueOn: iso(plusDays(21)), goals: ['Recertify National Lifeguard before it lapses', 'Lead two in-service sessions', 'Mentor a new guard'] });
    const [r] = await guard.call('GET', '/api/me/reviews');
    if (r) await guard.call('PUT', `/api/reviews/${r.id}/self`, { selfComments: 'A busy summer. I ran the July in-service on spinal management and covered most of the early opens. I would like support getting my instructor certification next year.' });
  }
  if (!(await hr.call('GET', '/api/grievances')).length) {
    await hr.call('POST', '/api/grievances', { userId: guard.user.id, kind: 'INDIVIDUAL', title: 'Split shifts scheduled without the agreed notice', articles: '14.02, 14.05', filedOn: iso(plusDays(-10)), dueOn: iso(plusDays(4)) });
    await hr.call('POST', '/api/grievances', { userId: null, kind: 'POLICY', title: 'Overtime offered outside seniority order', articles: '18.03', filedOn: iso(plusDays(-40)), dueOn: iso(plusDays(12)) });
  }
  const year = new Date().getFullYear();
  await hr.call('PUT', `/api/users/${guard.user.id}/leave`, { year, type: 'VACATION', hours: 80, carryover: 16, note: 'Article 21.01' });
}

/** Sample activity so screens aren't empty: a union discussion, a record to sign, a time-off request. */
async function prepare() {
  await prepareCityWorks();
  // The demo city's (placeholder) logo, uploaded through the Dev console API.
  const login = await fetch(`${API}/api/platform/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-fh-platform': '1' }, body: JSON.stringify({ email: 'dev@flexcity.dev', password: PASSWORD }) });
  const cookie = String(login.headers.get('set-cookie')).split(';')[0];
  const dev = (method, path, body) => fetch(`${API}/api/platform${path}`, { method, headers: { 'content-type': 'application/json', 'x-fh-platform': '1', cookie }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
  const city = (await dev('GET', '/tenants')).find((c) => c.subdomain === 'kelowna');
  // Pre-authorized debit for the demo city's plan, and FH's (placeholder) bank details.
  if (city && !(await dev('GET', `/billing/pad/${city.id}`)).active && (await dev('GET', `/billing/accounts/${city.id}`)).account) {
    await dev('PUT', '/billing/pad-originator', { originatorId: 'DEMO000001', dataCentre: '00000', shortName: 'FLEXCITY HQ', longName: 'FLEXCITYHEADQUARTERS (DEMO)', returns: { institution: '000', transit: '00000', account: '0000000' } });
    await dev('POST', `/billing/pad/${city.id}`, { payorName: 'City of Kelowna (demo)', signerName: 'Alex Morgan', signerTitle: 'Director of Finance', institution: '001', transit: '00011', account: '1234567', waivedPreNotice: false, agree: true, formOnFile: true });
  }
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
    // Never record files or secrets: the bank deposit file, payroll register, CSV exports or a full SIN.
    if (u.pathname.startsWith('/api/notifications/stream') || /\/(deposit-file|register\.csv|export|sin)$/.test(u.pathname)) return;
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
    // The department tab is remembered across pages: put it back on "All departments".
    if (await page.locator('main [role=radiogroup][aria-label="Department"]').count()) {
      await page.locator('main [role=radiogroup][aria-label="Department"] [role=radio]').first().click().catch(() => {});
      await page.waitForTimeout(700);
    }
    if (href === '/manage/payroll') {
      // Open a pay run and one person's statement, then the other tabs.
      await page.locator('main [role=radiogroup] [role=radio]').first().click().catch(() => {});
      await page.waitForTimeout(800);
      await page.locator('main table button').first().click().catch(() => {});
      await page.waitForTimeout(1500);
      await page.locator('dialog[open] table button').first().click().catch(() => {});
      await page.waitForTimeout(1200);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
    if (href === '/union') {
      await page.locator('main [role=radiogroup] [role=radio]').first().click().catch(() => {});
      await page.locator('main button:has(span.text-body-strong)').first().waitFor({ timeout: 10000 }).catch(() => {});
      await clickAll('main button:has(span.text-body-strong)', 3);
      await page.waitForTimeout(1000);
    }
  }
  // Detail pages reached by links, not the menu.
  for (const [list, link] of [['/manage/programs', 'main a[href*="/manage/programs?id="]'], ['/members', 'main a[href*="/members?id="]']]) {
    if (!hrefs.includes(list)) continue;
    await visit(list);
    const links = await page.$$eval(link, (as) => [...new Set(as.map((a) => a.getAttribute('href')))]).catch(() => []);
    for (const href of links.slice(0, 4)) {
      await visit(href);
      // Dialogs that load their own data: registering a child, a set's class list.
      for (const name of ['Register', 'Class list']) {
        const n = Math.min(await page.getByRole('button', { name, exact: true }).count(), 3);
        for (let i = 0; i < n; i++) {
          await page.getByRole('button', { name, exact: true }).nth(i).click().catch(() => {});
          await page.waitForTimeout(900);
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);
        }
      }
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
    // Every tab that loads its own data (menus and access, pools, roles, billing…).
    const tabs = await page.locator('main [role=radiogroup] [role=radio]').allInnerTexts().catch(() => []);
    for (const name of tabs) {
      await page.locator('main [role=radiogroup] [role=radio]', { hasText: name }).first().click().catch(() => {});
      await page.waitForTimeout(700);
    }
  }
  // Billing, pre-authorized debits, FH's books (every tab) and payroll tax tables.
  for (const path of ['/platform/billing', '/platform/debits', '/platform/books', '/platform/payroll-tax']) {
    await page.goto(`${CONSOLE}${path}`);
    await page.locator('main h1').first().waitFor();
    await page.waitForTimeout(1200);
    const tabs = await page.locator('main [role=radiogroup] [role=radio]').allInnerTexts().catch(() => []);
    for (const name of tabs) {
      await page.locator('main [role=radiogroup] [role=radio]', { hasText: name }).first().click().catch(() => {});
      await page.waitForTimeout(1200);
    }
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
  // Public sign-up page (no sign-in), with a sample of open times for each bookable space.
  const signup = await fetch(`${API}/api/public/signup`, { headers: { 'x-tenant-subdomain': 'kelowna' } }).then((r) => r.json());
  const slots = {};
  for (const v of signup.services ?? []) {
    for (let d = v.leadDays; d < v.leadDays + 14; d++) {
      const date = iso(plusDays(d));
      const list = await fetch(`${API}/api/public/services/${v.id}/slots?date=${date}`, { headers: { 'x-tenant-subdomain': 'kelowna' } }).then((r) => r.json());
      if (list.length) {
        slots[v.id] = list;
        break;
      }
    }
  }
  writeFileSync(join(OUT, 'public.json'), rename(JSON.stringify({ capturedOn: new Date().toISOString().slice(0, 10), responses: { '/api/public/jobs': jobs, '/api/public/signup': signup, slots } })));
  // The Dev console is FH's own tool and isn't part of the public demo.
  await browser.close();
})();
