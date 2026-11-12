/**
 * Records the API responses the web app asks for, per demo role, by browsing
 * every screen against a running local stack (seeded "kelowna" tenant). The
 * static GitHub Pages demo replays them in the browser (src/lib/demoApi.ts).
 *
 *   npm run build && npm start            (web on :3000; API on :4000 with PLATFORM_MFA=off,
 *                                         since the script signs in to the Dev console with a password)
 *   node scripts/capture-demo.cjs
 *   node scripts/capture-demo.cjs --prepare-only   (just the sample data, nothing recorded)
 *
 * Names are swapped for the fictional demo organization before saving.
 */
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const BASE = process.env.CAPTURE_BASE ?? 'http://kelowna.localhost:3000';
const CONSOLE = process.env.CAPTURE_CONSOLE ?? 'http://localhost:3000';
const API = process.env.CAPTURE_API ?? 'http://localhost:4000';
const PASSWORD = 'flexcity-dev';
const OUT = join(__dirname, '../src/lib/demo-fixtures');
const ROLES = { guard: 'guard', supervisor: 'supervisor', hr: 'hr', frontdesk: 'frontdesk', steward: 'steward', waterworks: 'waterworks' };
/** Accounts that only answer surveys and post messages for the sample data (never recorded). */

const RENAME = [
  ['City of Kelowna (demo)', 'City of Lakeview (demo)'],
  ['Parkinson Recreation Centre', 'Lakeview Aquatic Centre'],
  ['CUPE Local 338 (demo)', 'Aquatic Workers Local 101 (demo)'],
  // Real places and addresses in the local sample data (a beach, city hall, a street, nearby towns).
  ['Rotary Beach', 'Willow Cove Beach'],
  ['1435 Water St', '100 Harbour Way'],
  ['200 Bernard Ave', '200 Orchard Ave'],
  ['V1Y 1J4', 'V9Z 9Z9'],
  ['V1Y 6N2', 'V9Z 9Z8'],
  ['Lakeshore Rd', 'Shoreline Rd'],
  ['Vernon', 'Ridgeview'],
  ['Penticton', 'Ridgeview'],
  ['@kelowna.test', '@demo.flexcity'],
  ['Kelowna', 'Lakeview'],
  ['kelowna', 'lakeview'],
  ['KELOWNA', 'LAKEVIEW'],
];
// Logos are served by the API, which the static demo doesn't have: the demo embeds its own.
const rename = (s) => RENAME.reduce((acc, [a, b]) => acc.split(a).join(b), s).replace(/\/api\/public\/logo\/[0-9a-f-]+\?v=[0-9a-f]+/g, '__DEMO_LOGO__');

/** One API session per role for the whole run (sign-ins are rate limited). */
const sessions = new Map();
function apiAs(who) {
  if (!sessions.has(who)) sessions.set(who, signIn(who));
  return sessions.get(who);
}

async function signIn(who) {
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-subdomain': 'kelowna' }, body: JSON.stringify({ email: `${who}@kelowna.test`, password: PASSWORD }) });
  const { accessToken, user } = await r.json();
  const call = async (method, path, body) => {
    const res = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json', 'x-tenant-subdomain': 'kelowna', authorization: `Bearer ${accessToken}` }, body: body ? JSON.stringify(body) : undefined });
    return res.status === 204 ? null : res.json();
  };
  // Demo accounts sign the first-sign-in agreement once, so the app (and the recorded demo) opens normally.
  const me = await call('GET', '/api/me');
  if (me?.consentRequired) {
    const c = await call('GET', '/api/me/consent?lang=en-CA');
    await call('POST', '/api/me/consent', { version: c.version, locale: 'en-CA', name: `${user.firstName} ${user.lastName}`, signature: DEMO_SIGNATURE, choices: { notifications: 'skipped', location: 'skipped' } });
  }
  return { user, call };
}
/** A small drawn line, as a PNG, for the demo accounts' signatures. */
const DEMO_SIGNATURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAAoCAIAAAC6iKlyAAAAu0lEQVR42u3YSwrDMAwFwLfvIQq9/x3bE5SAI9vCmUeWwZEmyjdfWZIgAA1aQIMGLaBBC2jQoAU0aAH9bOjX+/Nv29j8yqqyppPLfbYQr6wqU5sp7HwZ8aSqsr2Z4XOzbP2SqtKkmdnWN2fz/mintpMSptonUpOl0mGK510cMwobWzZ95uXs230aDnKfV4XCA6XnIDd5+S2kyNi300M+5wovbv86zvrXIaBBgxbQoEEjAA1aQIMGLaBPyg8+d/3H6v32KAAAAABJRU5ErkJggg==';

const iso = (d) => d.toISOString().slice(0, 10);
/** The demo city's own date (the sample data's days are its local days, whatever the clock's zone). */
const cityToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (date, n) => iso(new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000));
const mondayOf = (date) => addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
/** A wall-clock minute of a city day as an instant (DST-safe). */
function cityInstant(date, minute, tz = 'America/Vancouver') {
  const offset = (t) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t;
  };
  const guess = Date.parse(`${date}T00:00:00Z`) + minute * 60_000;
  return new Date(guess - offset(guess - offset(guess))).toISOString();
}
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

  // Opening hours for the forecast (6 a.m.–9 p.m. on weekdays, 8–8 on weekends, two guards minimum).
  if (!(await sup.call('GET', `/api/facilities/${facility.id}/hours`)).length) {
    const blocks = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, opensMinute: 360, closesMinute: 1260, minGuards: 2 })).concat([6, 0].map((d) => ({ dayOfWeek: d, opensMinute: 480, closesMinute: 1200, minGuards: 2 })));
    await sup.call('PUT', `/api/facilities/${facility.id}/hours`, { blocks });
  }
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

/**
 * Sample data for the newer screens. Shift trades, time in lieu, text alerts, job applications,
 * reporting lines, forecast events, facility kinds and integrations come from the API's own seed
 * (apps/api/prisma/seedNewScreens.ts, idempotent); contacts, announcements, logbook, a policy, a claim,
 * a contractor, a posting with an application and saved reports are added here through the API.
 */
async function prepareNewFeatures() {
  execFileSync(process.execPath, ['--env-file-if-exists=.env', '--import', 'tsx', 'prisma/seedNewScreens.ts'], { cwd: join(__dirname, '../../api'), stdio: 'inherit' });
  const guard = await apiAs('guard');
  const sup = await apiAs('supervisor');
  const hr = await apiAs('hr');
  const water = await apiAs('waterworks');
  const [facility] = await sup.call('GET', '/api/facilities');
  const positions = await sup.call('GET', '/api/positions');
  if (!(await guard.call('GET', '/api/me/emergency-contacts')).length) {
    await guard.call('PUT', '/api/me/emergency-contacts', [{ name: 'Sam Rivera', relationship: 'Partner', phone: '250-555-0101' }, { name: 'Dana Rivera', relationship: 'Parent', phone: '250-555-0102' }]);
  }
  if (!(await sup.call('GET', '/api/announcements')).length) {
    await sup.call('POST', '/api/announcements', { title: 'Annual shutdown starts Monday', body: 'The leisure pool closes Monday at 6 a.m. for two weeks of maintenance. Lane swim moves to the main tank. Check your schedule for changes.', pinned: true });
    await hr.call('POST', '/api/announcements', { title: 'Benefits enrolment closes Friday', body: 'Make your dental and health choices in the app by Friday at 4:30 p.m.' });
  }
  if (facility && !(await sup.call('GET', `/api/logbook?facilityId=${facility.id}`)).length) {
    await sup.call('POST', '/api/logbook', { facilityId: facility.id, category: 'MAINTENANCE', body: 'Waterslide closed: crack in the third flume section. Facilities work order 24-118 opened.' });
    await guard.call('POST', '/api/logbook', { facilityId: facility.id, category: 'HANDOVER', body: 'Spare rescue tubes moved to the guard room. AED pads replaced; next expiry in March.' });
    await guard.call('POST', '/api/logbook', { facilityId: facility.id, category: 'SAFETY', body: 'Wet floor by the family change room drain. Cones out, maintenance told.' });
  }
  if (!(await hr.call('GET', '/api/policies')).length) {
    const guardPos = positions.find((p) => p.name === 'Lifeguard');
    await hr.call('POST', '/api/policies', { title: 'Pool safety plan 2026', body: 'Every guard on deck carries a rescue tube and wears the guard uniform.\n\nRotate every 30 minutes; never leave a station unattended.\n\nReport every first-aid incident before the end of the shift.\n\nThe head guard checks the AED and first-aid kit at opening.', positionIds: guardPos ? [guardPos.id] : [], dueDays: 14 });
    await hr.call('POST', '/api/policies', { title: 'Respectful workplace policy', body: 'Everyone has the right to a workplace free of harassment and violence. Report concerns to your supervisor or HR; reports are handled confidentially and promptly.', positionIds: [], dueDays: 30 });
  }
  if (!(await water.call('GET', '/api/me/expenses')).claims.length) {
    const d = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    const c = await water.call('POST', '/api/me/expenses', { title: 'Water treatment course, Vernon', items: [{ date: d(9), category: 'MILEAGE', description: 'Lakeview to Vernon and back', km: 106 }, { date: d(9), category: 'MEALS', description: 'Lunch', amount: 18.5 }] });
    if (c?.id) await sup.call('POST', `/api/expenses/${c.id}/decision`, { decision: 'APPROVE' });
    await guard.call('POST', '/api/me/expenses', { title: 'First aid recertification', items: [{ date: d(3), category: 'PARKING', description: 'Parking at the training centre', amount: 12 }] });
  }
  if (!(await hr.call('GET', '/api/payees')).length) {
    const p = await hr.call('POST', '/api/payees', { kind: 'PERSON', firstName: 'Jordan', lastName: 'Lee', sin: '130 692 544', address: { line1: '1435 Water St', city: 'Kelowna', province: 'BC', postalCode: 'V1Y 1J4' } });
    const y = new Date().getFullYear();
    if (p?.id) {
      await hr.call('POST', `/api/payees/${p.id}/payments`, { paidOn: `${y}-03-15`, box: '048', amount: 450, description: 'Lifeguard instructor course, March' });
      await hr.call('POST', `/api/payees/${p.id}/payments`, { paidOn: `${y}-07-15`, box: '048', amount: 450, description: 'Lifeguard instructor course, July' });
    }
    const b = await hr.call('POST', '/api/payees', { kind: 'PERSON', firstName: 'Morgan', lastName: 'Chen', address: { line1: '200 Bernard Ave', city: 'Kelowna', province: 'BC', postalCode: 'V1Y 6N2' } });
    if (b?.id) await hr.call('POST', `/api/payees/${b.id}/payments`, { paidOn: `${y}-09-01`, box: '028', amount: 300, description: 'Parks advisory committee honorarium' });
  }
  const jobs = await hr.call('GET', '/api/jobs');
  if (!jobs.some((j) => j.applyInApp)) {
    const j = await hr.call('POST', '/api/jobs', { title: 'Lifeguard (summer)', titleFr: 'Sauveteur (été)', description: 'Guard the outdoor pool this summer. National Lifeguard and Standard First Aid required. Flexible part-time hours, evenings and weekends.', descriptionFr: 'Surveiller la piscine extérieure cet été. Sauveteur national et Secourisme général requis. Horaire à temps partiel flexible, soirs et fins de semaine.', facilityId: facility?.id ?? null, employmentStatus: 'CASUAL', payMin: '19.50', payMax: '22.00', closesOn: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), applyInApp: true, published: true });
    if (j?.id) {
      await fetch(`${API}/api/public/jobs/${j.id}/apply`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-subdomain': 'kelowna' }, body: JSON.stringify({ firstName: 'Riley', lastName: 'Chen', email: 'riley.chen@example.ca', phone: '250-555-0110', certifications: 'National Lifeguard, Standard First Aid', message: 'I guarded at the YMCA last summer and would love to join your team.', consent: true, startedAt: Date.now() - 60_000 }) });
    }
  }
  if (!(await sup.call('GET', '/api/reports/saved')).length) {
    await sup.call('POST', '/api/reports/saved', { name: 'Hours worked', key: 'hours_worked', schedule: 'WEEKLY' });
    await sup.call('POST', '/api/reports/saved', { name: 'Certifications expiring', key: 'certs_expiring', days: 60, schedule: 'MONTHLY' });
  }
}

/** Weekly shift templates (a summer week, applied to the week after next) and a guard's shift preferences. */
async function prepareTemplates() {
  const sup = await apiAs('supervisor');
  const guard = await apiAs('guard');
  const view = await sup.call('GET', '/api/schedule/templates');
  if (view?.templates && !view.templates.length) {
    const [facility] = await sup.call('GET', '/api/facilities');
    const positions = await sup.call('GET', '/api/positions');
    const guardPos = positions.find((p) => p.name === 'Lifeguard');
    const instructor = positions.find((p) => /instructor/i.test(p.name));
    if (facility && guardPos) {
      const slots = [
        { daysOfWeek: [1, 2, 3, 4, 5], startMinute: 6 * 60, endMinute: 14 * 60, facilityId: facility.id, positionId: guardPos.id, headcount: 2, unpaidBreakMinutes: 30 },
        { daysOfWeek: [1, 2, 3, 4, 5], startMinute: 14 * 60, endMinute: 21 * 60 + 30, facilityId: facility.id, positionId: guardPos.id, headcount: 2, unpaidBreakMinutes: 30 },
        { daysOfWeek: [6, 0], startMinute: 8 * 60, endMinute: 16 * 60, facilityId: facility.id, positionId: guardPos.id, headcount: 3, unpaidBreakMinutes: 30 },
        ...(instructor ? [{ daysOfWeek: [2, 4], startMinute: 16 * 60, endMinute: 19 * 60, facilityId: facility.id, positionId: instructor.id, headcount: 1, unpaidBreakMinutes: null }] : []),
      ];
      const y = new Date().getFullYear();
      await sup.call('POST', '/api/schedule/templates', { name: 'Summer', validFrom: `${y + 1}-06-29`, validTo: `${y + 1}-09-07`, slots });
      await sup.call('POST', '/api/schedule/templates', { name: 'School year', slots: slots.map((s) => (s.startMinute === 6 * 60 ? { ...s, headcount: 1 } : s)) });
      const school = (await sup.call('GET', '/api/schedule/templates')).templates.find((x) => x.name === 'School year');
      if (school) await sup.call('POST', `/api/schedule/templates/${school.id}/apply`, { from: nextDow(1, 14), to: iso(new Date(Date.parse(`${nextDow(1, 14)}T12:00:00Z`) + 7 * 86_400_000)) });
    }
  }
  const prefs = await guard.call('GET', '/api/me/preferences');
  if (prefs?.preferences && !prefs.preferences.length) {
    await guard.call('PUT', '/api/me/preferences', { preferences: [{ kind: 'PREFER', daysOfWeek: [1, 2, 3, 4, 5], startMinute: 6 * 60, endMinute: 10 * 60, note: 'Mornings work with my classes' }, { kind: 'AVOID', daysOfWeek: [0], note: 'Family day' }], maxWeeklyHours: 28, maxDaysPerWeek: 5 });
  }
}

/**
 * Team messages (a one-to-one, the aquatics department, a mentoring group with the junior guard and two
 * adults) and staff surveys (two closed pulses for the trend, one open the guard hasn't answered yet).
 * Drew and Jess get birth dates on file: without one, the rule of two treats a person as possibly a minor.
 */
async function prepareMessagesSurveys() {
  const hr = await apiAs('hr');
  const sup = await apiAs('supervisor');
  const guard = await apiAs('guard');
  const people = (await hr.call('GET', '/api/messages/people'))?.people ?? [];
  const byName = (re) => people.find((p) => re.test(p.name));
  for (const re of [/Kowalski/, /Okoye/]) {
    const p = byName(re);
    if (p && !p.direct) await hr.call('PATCH', `/api/users/${p.id}`, { dateOfBirth: re.source === 'Kowalski' ? '1986-02-11' : '1979-09-23' });
  }
  if (!(await guard.call('GET', '/api/messages/conversations')).length) {
    const supId = sup.user?.id ?? (await sup.call('GET', '/api/me')).id;
    const dm = await guard.call('POST', '/api/messages/direct', { userId: supId });
    if (dm?.id) {
      await guard.call('POST', `/api/messages/conversations/${dm.id}/messages`, { text: 'Hi! Could I swap Saturday’s 6 a.m. for the Sunday afternoon shift? My course moved.' });
      await sup.call('POST', `/api/messages/conversations/${dm.id}/messages`, { text: 'Sure. Post it on the board and I’ll approve the trade as soon as someone takes it.' });
      await guard.call('POST', `/api/messages/conversations/${dm.id}/messages`, { text: 'Posted. Thank you!' });
      await sup.call('POST', `/api/messages/conversations/${dm.id}/read`);
    }
    const dir = await sup.call('GET', '/api/messages/people');
    const aquatics = dir?.departments?.find((d) => /aquatic/i.test(d.name)) ?? dir?.departments?.[0];
    if (aquatics) {
      const dep = await sup.call('POST', '/api/messages/department', { departmentId: aquatics.id });
      if (dep?.id) {
        await sup.call('POST', `/api/messages/conversations/${dep.id}/messages`, { text: 'In-service Thursday at 7 p.m. in the deep end: spinal boarding and the new AED. Bring your rescue tube.' });
        await guard.call('POST', `/api/messages/conversations/${dep.id}/messages`, { text: 'I can set up the spinal board stations at 6:45.' });
      }
    }
    const junior = (dir?.people ?? []).find((p) => /Morgan Lee/.test(p.name)) ?? (dir?.people ?? []).find((p) => p.directBlocked);
    const head = (dir?.people ?? []).find((p) => /Avery/.test(p.name) && p.group && p.id !== junior?.id);
    const guardId = guard.user?.id ?? (await guard.call('GET', '/api/me')).id;
    if (junior && head) {
      const g = await sup.call('POST', '/api/messages/groups', { title: 'Junior guard mentoring', memberIds: [junior.id, head.id, guardId] });
      if (g?.id) {
        await sup.call('POST', `/api/messages/conversations/${g.id}/messages`, { text: 'Welcome to the team! You’ll shadow on Saturdays this month. Ask anything here.' });
        await guard.call('POST', `/api/messages/conversations/${g.id}/messages`, { text: 'See you Saturday at 8. We’ll start with the opening checklist.' });
      }
    }
  }
  if (!(await hr.call('GET', '/api/surveys')).length) {
    const Q = [
      { id: 'week', type: 'RATING', text: 'How was your work week?' },
      { id: 'safe', type: 'RATING', text: 'I feel safe raising concerns with my supervisor.' },
      { id: 'load', type: 'CHOICE', text: 'Your workload', options: ['Too light', 'About right', 'Too heavy'] },
      { id: 'note', type: 'TEXT', text: 'Anything you’d like us to know?', required: false },
    ];
    const respondents = ['guard', 'supervisor', 'frontdesk', 'head', 'casual', 'waterworks', 'maintenance'];
    const closesAt = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const runPulse = async (title, repeatOf, scores, notes, close) => {
      const d = await hr.call('POST', '/api/surveys', { kind: 'PULSE', title, intro: 'Four questions, about a minute. Anonymous: results only for groups of five or more.', questions: Q, closesAt, repeatOf });
      if (!d?.id) return null;
      await hr.call('POST', `/api/surveys/${d.id}/publish`);
      for (const [i, who] of respondents.entries()) {
        if (!close && who === 'guard') continue;
        const s = await apiAs(who).catch(() => null);
        if (!s) continue;
        await s.call('POST', `/api/me/surveys/${d.id}/answers`, { answers: { week: scores[i % scores.length], safe: Math.min(5, scores[(i + 2) % scores.length] + 1), load: i % 3 ? 'About right' : 'Too heavy', ...(notes[i] ? { note: notes[i] } : {}) } });
      }
      if (close) await hr.call('POST', `/api/surveys/${d.id}/close`);
      return d.id;
    };
    const first = await runPulse('Spring check-in', null, [3, 4, 3, 2, 4, 3, 3], ['More notice for schedule changes, please.', 'Breaks get skipped on busy Saturdays.'], true);
    const second = await runPulse('Summer check-in', first, [4, 4, 5, 3, 4, 4, 3], ['The new rotation board helps a lot.', 'Lane ropes in the main tank need replacing.', 'Great team this summer.'], true);
    await runPulse('Fall check-in', second, [4, 3, 4, 4, 5, 3, 4], [], false);
  }
}

/** Shift bidding (needs seniority, on in the demo city): a summer lines round open now, and a guard's ranking. */
async function prepareBids() {
  const sup = await apiAs('supervisor');
  const guard = await apiAs('guard');
  const list = await sup.call('GET', '/api/bids/rounds');
  if (!list?.rounds || list.rounds.length) return;
  const summer = (await sup.call('GET', '/api/schedule/templates')).templates?.find((x) => x.name === 'Summer');
  if (!summer?.validFrom || !summer.validTo) return;
  const positions = [...new Set(summer.slots.map((s) => s.positionId))];
  const to = iso(new Date(Date.parse(`${summer.validTo}T12:00:00Z`) + 86_400_000));
  const r = await sup.call('POST', '/api/bids/rounds', { name: 'Summer lines', kind: 'LINES', positionIds: positions, templateId: summer.id, from: summer.validFrom, to, opensAt: new Date(Date.now() - 3_600_000).toISOString(), closesAt: new Date(Date.now() + 10 * 86_400_000).toISOString(), maxAwardsPerPerson: 1 });
  const mine = (await guard.call('GET', '/api/me/bids')).find((x) => x.id === r?.id);
  if (mine?.items?.length) await guard.call('PUT', `/api/me/bids/${mine.id}/choices`, { itemIds: mine.items.slice(0, 3).map((i) => i.id) });
}

/**
 * Onboarding as a city that has used the app for a while: long-standing staff are done, the
 * junior instructor is part-way (the child-safety items still block instructor shifts) and one
 * newer guard still owes two forms. Without this every instructor shift stays open.
 */
async function prepareOnboarding() {
  const hr = await apiAs('hr');
  const people = await hr.call('GET', '/api/onboarding/people');
  if (!Array.isArray(people) || people.some((p) => p.outstanding === 0)) return;
  for (const p of people) {
    const detail = await hr.call('GET', `/api/onboarding/people/${p.id}`);
    const items = (detail?.items ?? []).filter((i) => i.state === 'PENDING' && i.canComplete);
    const junior = /Morgan Lee/.test(p.name);
    const newer = /Zoe Laurent/.test(p.name);
    const since = String(p.since ?? '').slice(0, 10);
    const completedOn = since && since > iso(plusDays(-300)) ? since : iso(plusDays(-120));
    for (const [n, i] of items.entries()) {
      if (junior && (i.blocksScheduling || n % 2)) continue;
      if (newer && (i.key === 'td1' || i.key === 'direct_deposit')) continue;
      await hr.call('POST', `/api/onboarding/people/${p.id}/items/${i.id}`, { action: 'complete', completedOn });
    }
  }
}

/**
 * A real working week in the schedule builder: this week and next, lifeguards in two blocks a day
 * (two on deck, as the coverage rule asks) and swim instructors for lessons. Fill the schedule
 * staffs them with the API's own rules; this week's first days are published, the rest stay
 * drafts, a few shifts stay open, and next week is only partly staffed so Fill has work to show.
 */
async function prepareWeek() {
  const sup = await apiAs('supervisor');
  const options = await sup.call('GET', '/api/schedule/fill/options');
  const departmentId = options?.defaultDepartmentId;
  const [facility] = await sup.call('GET', '/api/facilities');
  const positions = await sup.call('GET', '/api/positions');
  const guardPos = positions.find((p) => p.name === 'Lifeguard');
  const instructor = positions.find((p) => /instructor/i.test(p.name));
  if (!departmentId || !facility || !guardPos) return;
  const today = cityToday();
  const w0 = mondayOf(today);
  const w1 = addDays(w0, 7);
  const board = await sup.call('GET', `/api/schedule/planner?departmentId=${departmentId}&from=${w0}&to=${addDays(w0, 14)}`);
  if ((board?.shifts?.length ?? 0) >= 40) return;
  // Open drafts left by earlier runs (the "on now" shift of other days) make way for the plan.
  const stray = board.shifts.filter((s) => s.status === 'DRAFT' && !s.userId).map((s) => s.id);
  if (stray.length) await sup.call('POST', '/api/schedule/planner/cancel', { shiftIds: stray });
  const H = 60;
  const blocks = (dow) =>
    dow === 0 || dow === 6
      ? [[guardPos, 8 * H, 14 * H, 2], [guardPos, 14 * H, 20 * H, 2], ...(instructor && dow === 6 ? [[instructor, 9 * H, 12 * H, 1]] : [])]
      : [[guardPos, 6 * H, 13 * H + 30, 2], [guardPos, 13 * H + 30, 21 * H, 2], ...(instructor && (dow === 2 || dow === 4) ? [[instructor, 16 * H, 19 * H, 1]] : [])];
  const have = new Map();
  for (const s of board.shifts.filter((x) => !stray.includes(x.id))) {
    const k = `${s.positionId}|${Date.parse(s.localStartsAt)}`;
    have.set(k, (have.get(k) ?? 0) + 1);
  }
  for (let d = 0; d < 14; d++) {
    const date = addDays(w0, d);
    for (const [pos, start, end, count] of blocks(new Date(`${date}T12:00:00Z`).getUTCDay())) {
      const startsAt = cityInstant(date, start);
      const k = `${pos.id}|${Date.parse(startsAt)}`;
      for (let i = have.get(k) ?? 0; i < count; i++) await sup.call('POST', '/api/schedule/planner/shifts', { facilityId: facility.id, positionId: pos.id, startsAt, endsAt: cityInstant(date, end), userIds: [] });
    }
  }
  const run = (weekStart, weekIndex, carry) => sup.call('POST', '/api/schedule/fill/run', { departmentId, weekStart, horizonStart: w0, weekIndex, horizonWeeks: 2, carry, toggles: options.settings.toggles, weights: options.settings.weights, newShifts: [] });
  const accept = (week, keep) => {
    const items = week.proposals.filter(keep).map((p) => {
      const slot = week.slots.find((x) => x.id === p.slotId);
      return { shiftId: slot.id, userId: p.userId, expectedVersion: slot.version, previousUserId: slot.currentUserId };
    });
    return items.length ? sup.call('POST', '/api/schedule/fill/accept', { items, allowOvertime: false }) : null;
  };
  const dayOf = (week, slotId) => week.slots.find((x) => x.id === slotId)?.localStartsAt.slice(0, 10) ?? '';
  // This week: everything Fill proposes but every fifth late-week shift (left open on purpose).
  const first = await run(w0, 0, []);
  if (first?.proposals) {
    let n = 0;
    await accept(first, (p) => dayOf(first, p.slotId) < addDays(w0, 4) || ++n % 5 !== 0);
    // Published up to today; the rest of the week is still being worked on.
    await sup.call('POST', '/api/shifts/publish', { facilityId: facility.id, from: cityInstant(w0, 0), to: cityInstant(addDays(today, 1), 0), acknowledgeWarnings: true });
  }
  // Next week: Monday to Wednesday staffed (drafts), the rest open for Fill to propose.
  const second = await run(w1, 1, first?.carry ?? []);
  if (second?.proposals) await accept(second, (p) => dayOf(second, p.slotId) < addDays(w1, 3));
}

/**
 * Water works: the operator's own week (day shifts at the treatment plant, this week published,
 * next week's too) and a word from the lead hand; HR's inbox gets a note from the supervisor.
 */
async function prepareWaterWorks() {
  const hr = await apiAs('hr');
  const water = await apiAs('waterworks');
  const sup = await apiAs('supervisor');
  const today = cityToday();
  const w0 = mondayOf(today);
  const mine = await water.call('GET', `/api/me/shifts?from=${encodeURIComponent(cityInstant(w0, 0))}&to=${encodeURIComponent(cityInstant(addDays(w0, 14), 0))}`);
  const facilities = await hr.call('GET', '/api/facilities');
  const plant = facilities.find((f) => /treatment/i.test(f.name)) ?? facilities[0];
  const operator = (await hr.call('GET', '/api/positions')).find((p) => /water works/i.test(p.name));
  if (Array.isArray(mine) && !mine.length && plant && operator) {
    for (let d = 0; d < 14; d++) {
      const date = addDays(w0, d);
      const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
      if (dow === 0 || dow === 6) continue;
      await hr.call('POST', '/api/schedule/planner/shifts', { facilityId: plant.id, positionId: operator.id, startsAt: cityInstant(date, 7 * 60), endsAt: cityInstant(date, 15 * 60 + 30), userIds: [water.user.id] });
    }
    await hr.call('POST', '/api/shifts/publish', { facilityId: plant.id, from: cityInstant(w0, 0), to: cityInstant(addDays(w0, 14), 0), acknowledgeWarnings: true });
  }
  if (!(await water.call('GET', '/api/messages/conversations')).length) {
    const lead = await apiAs('maintenance').catch(() => null);
    if (lead) {
      const dm = await lead.call('POST', '/api/messages/direct', { userId: water.user.id });
      if (dm?.id) {
        await lead.call('POST', `/api/messages/conversations/${dm.id}/messages`, { text: 'Pump station 4 readings look good. Can you check the chlorine analyzer at the reservoir first thing tomorrow?' });
        await water.call('POST', `/api/messages/conversations/${dm.id}/messages`, { text: 'Will do, I’ll be there at 7 and send you the numbers.' });
      }
    }
  }
  if (!(await hr.call('GET', '/api/messages/conversations')).length) {
    const dm = await sup.call('POST', '/api/messages/direct', { userId: hr.user.id });
    if (dm?.id) {
      await sup.call('POST', `/api/messages/conversations/${dm.id}/messages`, { text: 'Nine guards came to Thursday’s in-service. Can their two hours go on this pay run?' });
      await hr.call('POST', `/api/messages/conversations/${dm.id}/messages`, { text: 'Yes. Send me the sign-in sheet and I’ll add them today.' });
    }
  }
}

/** Sample activity so screens aren't empty: a union discussion, a record to sign, a time-off request. */
async function prepare() {
  for (const who of Object.values(ROLES)) await apiAs(who);
  await prepareCityWorks();
  await prepareNewFeatures();
  await prepareTemplates();
  await prepareMessagesSurveys();
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
  // Shift bidding is off by default; the demo city uses seniority, so it's on there.
  if (city) {
    await dev('PATCH', `/tenants/${city.id}`, { features: { shiftBidding: true } });
    await prepareBids();
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
  await prepareOnboarding();
  await prepareWeek();
  await prepareWaterWorks();
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

  // Long menus fold into groups and sections: open them all so every screen is reached.
  for (let pass = 0; pass < 3; pass++) {
    const closed = page.locator('aside nav button[aria-expanded="false"]');
    const n = await closed.count();
    if (!n) break;
    for (let i = n - 1; i >= 0; i--) await closed.nth(i).click().catch(() => {});
    await page.waitForTimeout(300);
  }
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
      // A person's pay set-up (salary, court orders), then each payroll provider sub-tab.
      await page.locator('main [role=radiogroup] [role=radio]', { hasText: 'People' }).first().click().catch(() => {});
      await page.waitForTimeout(800);
      await page.locator('main button', { hasText: /^(Edit|Set up)$/ }).first().click().catch(() => {});
      await page.waitForTimeout(1500);
      await page.keyboard.press('Escape');
      await page.locator('main [role=radiogroup] [role=radio]', { hasText: 'Payroll provider' }).first().click().catch(() => {});
      await page.waitForTimeout(800);
      for (const name of ['ADP', 'Dayforce', 'Wagepoint', 'In the app']) {
        await page.locator('main [role=radio]', { hasText: name }).first().click().catch(() => {});
        await page.waitForTimeout(500);
      }
    }
    if (href === '/manage/compliance') {
      // The report for right now (the guard on deck, a reading and an incident).
      await page.getByRole('button', { name: 'Build report', exact: true }).click().catch(() => {});
      await page.waitForTimeout(2000);
    }
    if (href === '/manage/jobs') {
      // Each in-app posting's applications.
      const n = Math.min(await page.getByRole('button', { name: 'Applications', exact: true }).count(), 3);
      for (let i = 0; i < n; i++) {
        await page.getByRole('button', { name: 'Applications', exact: true }).nth(i).click().catch(() => {});
        await page.waitForTimeout(1200);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
    }
    if (href === '/messages') {
      // Each conversation (the page opens one by ?c=).
      const n = Math.min(await page.locator('main section[aria-label] li button').count(), 6);
      for (let i = 0; i < n; i++) {
        await page.locator('main section[aria-label] li button').nth(i).click().catch(() => {});
        await page.waitForTimeout(1200);
      }
    }
    if (href === '/manage/surveys') {
      // Each survey's results (and the pulse trend).
      const n = Math.min(await page.getByRole('button', { name: 'Results', exact: true }).count(), 4);
      for (let i = 0; i < n; i++) {
        await page.getByRole('button', { name: 'Results', exact: true }).nth(i).click().catch(() => {});
        await page.waitForTimeout(1200);
        for (const name of ['By department', 'By position', 'Everyone']) {
          await page.locator('dialog[open] [role=radio]', { hasText: name }).first().click().catch(() => {});
          await page.waitForTimeout(400);
        }
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
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
  await recordPlanner(role, responses);

  const capturedOn = cityToday();
  const json = JSON.parse(rename(JSON.stringify({ capturedOn, responses })));
  writeFileSync(join(OUT, `${role}.json`), JSON.stringify(json));
  console.log(role, Object.keys(responses).length, 'responses');
}

/**
 * The schedule builder replays one board per department covering several weeks (the demo cuts out
 * the days asked for), the batch eligibility check for it, and a Fill the schedule run for each
 * week of the longest usual horizon — the demo's Fill proposes what the API proposed.
 */
async function recordPlanner(role, responses) {
  const keys = Object.keys(responses).filter((k) => k.startsWith('/api/schedule/planner?'));
  if (!keys.length) return;
  const s = await apiAs(ROLES[role]);
  const w0 = mondayOf(cityToday());
  // The API's longest planner range (six weeks): two weeks back, four ahead.
  const from = addDays(w0, -14);
  const to = addDays(w0, 28);
  const departments = [...new Set(keys.map((k) => new URL(k, 'http://x').searchParams.get('departmentId')))];
  for (const k of keys) delete responses[k];
  for (const dep of departments) {
    const board = await s.call('GET', `/api/schedule/planner?departmentId=${dep}&from=${from}&to=${to}`);
    if (board?.shifts) responses[`/api/schedule/planner?departmentId=${dep}&from=${from}&to=${to}`] = board;
  }
  const options = await s.call('GET', '/api/schedule/fill/options');
  const dep = options?.defaultDepartmentId ?? options?.departments?.[0]?.id;
  if (!dep) return;
  const elig = await s.call('POST', '/api/schedule/planner/eligibility', { departmentId: dep, from, to, days: true });
  if (elig?.users) responses['/api/schedule/planner/eligibility'] = elig;
  let carry = [];
  for (let i = 0; i < 4; i++) {
    const w = await s.call('POST', '/api/schedule/fill/run', { departmentId: dep, weekStart: addDays(w0, i * 7), horizonStart: w0, weekIndex: i, horizonWeeks: 4, carry, toggles: options.settings.toggles, weights: options.settings.weights, newShifts: [] });
    if (!w?.slots) break;
    responses[`/api/schedule/fill/run?week=${i}`] = w;
    carry = [...carry, ...w.carry];
  }
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
  // Every city tab that loads its own data, opened by its address (the page reads ?tab=).
  const CITY_TABS = ['org', 'facilities', 'pools', 'positions', 'features', 'access', 'roles', 'import', 'billing', 'payroll', 'lifecycle', 'consents'];
  for (const href of cities) {
    for (const tab of CITY_TABS) {
      await page.goto(`${CONSOLE}${href}${href.includes('?') ? '&' : '?'}tab=${tab}`);
      await page.locator('main h1').first().waitFor();
      await page.waitForTimeout(900);
    }
  }
  // Billing, pre-authorized debits, FH's books (every tab) and payroll tax tables.
  for (const path of ['/platform/billing', '/platform/debits', '/platform/books', '/platform/enquiries', '/platform/payroll-tax']) {
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
  writeFileSync(join(OUT, 'platform.json'), rename(JSON.stringify({ capturedOn: cityToday(), responses })));
  console.log('platform', Object.keys(responses).length, 'responses');
}

(async () => {
  await prepare();
  if (process.argv.includes('--prepare-only')) return;
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
  writeFileSync(join(OUT, 'public.json'), rename(JSON.stringify({ capturedOn: cityToday(), responses: { '/api/public/jobs': jobs, '/api/public/signup': signup, slots } })));
  await capturePlatform(browser);
  await browser.close();
})();
