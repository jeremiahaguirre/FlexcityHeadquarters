import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { forgetFeatures } from '../../src/services/platform/features.js';
import { draftsFor, notify } from '../../src/services/notifications/notifier.js';
import { ConsoleSms, deliverSms, renderSms, toE164 } from '../../src/services/notifications/sms.js';
import { loneWorkChecks } from '../../src/services/safety/loneWork.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'texts';
type Role = 'EMPLOYEE' | 'AQUATIC_SUPERVISOR' | 'HR_ADMIN' | 'STAFF';
let t: Awaited<ReturnType<typeof seedTenant>>;
const id: Record<string, string> = {};
const tok: Record<string, string> = {};

const as = (name: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(tok[name]!, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(tok[name]!, { type: 'bearer' }).send(b),
  patch: (p: string, b: object) => request(server).patch(p).set('x-tenant-subdomain', SUB).auth(tok[name]!, { type: 'bearer' }).send(b),
  del: (p: string) => request(server).delete(p).set('x-tenant-subdomain', SUB).auth(tok[name]!, { type: 'bearer' }),
});
const lastCode = async (userId: string) => ((await owner.smsOutbox.findFirst({ where: { userId, template: 'sms_verify' }, orderBy: { createdAt: 'desc' } }))!.params as { code: string }).code;

beforeAll(async () => {
  t = await seedTenant(SUB, 1);
  const mk = async (roles: Role[], name: string, locale = 'en-CA') => {
    const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles, employmentStatus: 'FULL_TIME', firstName: name, lastName: 'X', email: `${name}@texts.test`, locale } });
    id[name] = u.id;
    tok[name] = await signAccessToken({ sub: u.id, tid: t.tenant.id, roles, aat: Math.floor(Date.now() / 1000) });
  };
  await mk(['EMPLOYEE'], 'worker');
  await mk(['AQUATIC_SUPERVISOR'], 'sup', 'fr-CA');
  await mk(['AQUATIC_SUPERVISOR'], 'sup2');
  resetLimits();
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('text and phone alerts', () => {
  it('reads North American mobile numbers', () => {
    expect(toE164('(250) 555-0101')).toBe('+12505550101');
    expect(toE164('1-250-555-0101')).toBe('+12505550101');
    expect(toE164('555-0101')).toBeNull();
    expect(toE164('050 555 0101')).toBeNull();
  });

  it('needs the city to turn text alerts on', async () => {
    const r = await as('worker').post('/api/me/sms', { phone: '250 555 0101' });
    expect(r.body.code).toBe('TEXT_ALERTS_OFF');
    expect((await as('worker').get('/api/me/sms')).body).toEqual({ enabled: false, phone: null, verified: false, urgentShifts: false });
    await owner.tenant.update({ where: { id: t.tenant.id }, data: { features: { textAlerts: true } } });
    forgetFeatures(t.tenant.id);
  });

  it('confirms a number with a texted code; a wrong code is refused', async () => {
    const r = await as('sup').post('/api/me/sms', { phone: '250 555 0102' });
    expect(r.status).toBe(202);
    expect(r.body.phone).toBe('•••-•••-0102');
    const code = await lastCode(id.sup!);
    expect(code).toMatch(/^\d{6}$/);
    expect(renderSms('sms_verify', 'fr-CA', { code })).toContain('votre code est');
    const wrong = code === '000000' ? '111111' : '000000';
    expect((await as('sup').post('/api/me/sms/verify', { phone: '250 555 0102', code: wrong })).body.code).toBe('WRONG_CODE');
    expect((await as('sup').post('/api/me/sms/verify', { phone: '250 555 0199', code })).body.code).toBe('WRONG_CODE');
    expect((await as('sup').post('/api/me/sms/verify', { phone: '(250) 555-0102', code })).status).toBe(200);
    expect((await as('sup').get('/api/me/sms')).body).toMatchObject({ enabled: true, phone: '•••-•••-0102', verified: true });
    // Used once only.
    expect((await as('sup').post('/api/me/sms/verify', { phone: '250 555 0102', code })).body.code).toBe('WRONG_CODE');
  });

  it('an escalated working-alone session calls and texts monitors with a confirmed number only', async () => {
    const s = await as('worker').post('/api/me/lone-work', { location: 'Pump station 4', intervalMinutes: 30 });
    expect(s.status).toBe(201);
    await owner.loneWorkSession.update({ where: { id: s.body.id }, data: { nextDueAt: new Date(Date.now() - 60_000) } });
    await withTenant(t.tenant.id, (tx) => loneWorkChecks(tx));
    expect(await owner.smsOutbox.count({ where: { userId: id.sup, template: 'lonework_overdue', kind: 'TEXT' } })).toBe(1);
    await owner.loneWorkSession.update({ where: { id: s.body.id }, data: { overdueAt: new Date(Date.now() - 60 * 60_000) } });
    await withTenant(t.tenant.id, (tx) => loneWorkChecks(tx));
    const esc = await owner.smsOutbox.findMany({ where: { template: 'lonework_escalated' } });
    expect(esc.map((m) => [m.userId, m.kind]).sort()).toEqual([[id.sup, 'CALL'], [id.sup, 'TEXT']]);
    expect(esc[0]!.locale).toBe('fr-CA');
    expect(await owner.smsOutbox.count({ where: { userId: id.sup2 } })).toBe(0);
  });

  it('the worker sends them, then drops the contents', async () => {
    const sender = new ConsoleSms(true);
    const r = await deliverSms(owner, sender);
    expect(r.failed).toBe(0);
    expect(sender.sent.some((m) => m.kind === 'CALL' && m.to === '+12505550102' && m.body.startsWith('URGENT, FlexcityHeadquarters. worker X (travail seul à '))).toBe(true);
    expect(await owner.smsOutbox.count({ where: { sentAt: null } })).toBe(0);
    expect((await owner.smsOutbox.findMany({ where: { template: 'lonework_escalated' } })).every((m) => JSON.stringify(m.params) === '{}')).toBe(true);
  });

  it('open shifts starting within a day text only people who asked', async () => {
    await as('sup').patch('/api/me/sms', { urgentShifts: true });
    const guard = t.users[0]!.id;
    await owner.user.update({ where: { id: guard }, data: { smsPhone: '+12505550103', smsVerifiedAt: new Date() } });
    const mkShift = (h: number) => owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: t.position.id, startsAt: new Date(Date.now() + h * 3_600_000), endsAt: new Date(Date.now() + (h + 4) * 3_600_000), status: 'PUBLISHED' } });
    const soon = await mkShift(3);
    const later = await mkShift(72);
    const ev = (shiftId: string) => ({ type: 'shift.offer.posted' as const, tenantId: t.tenant.id, offerId: shiftId, shiftId, eligibleUserIds: [guard, id.sup!] });
    const now = await withTenant(t.tenant.id, (tx) => draftsFor(tx, ev(soon.id)));
    expect(now.filter((d) => d.sms).map((d) => d.userId)).toEqual([id.sup]);
    expect(now.find((d) => d.sms)!.smsTemplate).toBe('shift_urgent');
    expect((await withTenant(t.tenant.id, (tx) => draftsFor(tx, ev(later.id)))).some((d) => d.sms)).toBe(false);
    await withTenant(t.tenant.id, (tx) => notify(tx, t.tenant.id, now));
    const text = await owner.smsOutbox.findFirstOrThrow({ where: { tenantId: t.tenant.id, template: 'shift_urgent' } });
    expect(renderSms(text.template, text.locale, text.params as Record<string, unknown>)).toMatch(/quart ouvert de Lifeguard à Rec Centre commence/);
  });

  it('nothing goes out while the city has text alerts off, and people can stop them', async () => {
    await owner.tenant.update({ where: { id: t.tenant.id }, data: { features: { textAlerts: false } } });
    const before = await owner.smsOutbox.count();
    await withTenant(t.tenant.id, (tx) => notify(tx, t.tenant.id, [{ userId: id.sup!, type: 'lonework_help', params: { name: 'A', location: 'B' }, sms: 'call' }]));
    expect(await owner.smsOutbox.count()).toBe(before);
    expect((await as('sup').del('/api/me/sms')).status).toBe(200);
    expect((await owner.user.findUniqueOrThrow({ where: { id: id.sup } })).smsPhone).toBeNull();
  });
});
