import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { toCsv } from '../../src/services/reports/catalog.js';
import { due, sendScheduledReports } from '../../src/services/reports/scheduled.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'reports';
let t: Awaited<ReturnType<typeof seedTenant>>;
const tok: Record<string, string> = {};
const as = (who: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(tok[who]!, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(tok[who]!, { type: 'bearer' }).send(b),
});
const iso = (d: Date) => d.toISOString().slice(0, 10);

beforeAll(async () => {
  t = await seedTenant(SUB, 2);
  const now = Math.floor(Date.now() / 1000);
  tok.guard = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'], aat: now });
  const mk = async (name: string, roles: ('AQUATIC_SUPERVISOR' | 'HR_ADMIN')[]) => {
    const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles, employmentStatus: 'FULL_TIME', firstName: name, lastName: 'X', email: `${name}@${SUB}.test` } });
    tok[name] = await signAccessToken({ sub: u.id, tid: t.tenant.id, roles, aat: now });
  };
  await mk('sup', ['AQUATIC_SUPERVISOR']);
  await mk('hr', ['HR_ADMIN']);
  const start = new Date(Date.now() - 3 * 86_400_000);
  for (const u of t.users) await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: u.id, facilityId: t.facility.id, positionId: t.position.id, clockIn: start, clockOut: new Date(start.getTime() + 6.5 * 3_600_000), status: 'APPROVED' } });
  await owner.userCertification.updateMany({ where: { userId: t.users[0]!.id }, data: { expiryDate: new Date(Date.now() + 20 * 86_400_000) } });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('reports', () => {
  it('every report runs in a read-only transaction (as on the read replica)', async () => {
    for (const who of ['sup', 'hr']) {
      const keys = ((await as(who).get('/api/reports')).body as Array<{ key: string }>).map((r) => r.key);
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        const r = await as(who).get(`/api/reports/run?key=${key}`);
        expect(r.status, `${who} ${key}`).toBe(200);
      }
    }
  });

  it('a read-only transaction refuses writes, and the CSV export is still recorded', async () => {
    await expect(withTenant(t.tenant.id, (tx) => tx.savedReport.create({ data: { tenantId: t.tenant.id, ownerId: t.users[0]!.id, name: 'nope', reportKey: 'hours_worked', params: {}, schedule: 'NONE' } }), { readOnly: true })).rejects.toThrow(/read-only/);
    const before = await owner.auditLog.count({ where: { tenantId: t.tenant.id, action: 'report.export' } });
    expect((await as('sup').get('/api/reports/run.csv?key=hours_worked')).status).toBe(200);
    expect(await owner.auditLog.count({ where: { tenantId: t.tenant.id, action: 'report.export' } })).toBe(before + 1);
  });

  it('each person sees only the reports their access allows', async () => {
    expect((await as('guard').get('/api/reports')).body).toEqual([]);
    const sup = (await as('sup').get('/api/reports')).body.map((r: { key: string }) => r.key);
    expect(sup).toEqual(expect.arrayContaining(['hours_worked', 'certs_expiring', 'incidents']));
    expect(sup).not.toContain('labour_cost');
    expect((await as('guard').get('/api/reports/run?key=hours_worked')).status).toBe(403);
  });

  it('runs a report for a date range, and as a CSV', async () => {
    const r = (await as('sup').get(`/api/reports/run?key=hours_worked&from=${iso(new Date(Date.now() - 7 * 86_400_000))}&to=${iso(new Date())}`)).body;
    expect(r.columns).toEqual(['person', 'shifts', 'hours']);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].hours).toBe(6.5);
    const c = await as('sup').get(`/api/reports/run.csv?key=certs_expiring&days=30&labels=${encodeURIComponent(JSON.stringify({ person: 'Person' }))}`);
    expect(c.text).toContain('Person,certification,expires');
    expect(c.text).toContain(`Guard0 ${SUB}`);
  });

  it('CSV cells that a spreadsheet would run as formulas are neutralized; numbers are not', () => {
    expect(toCsv({ columns: ['a', 'b'], rows: [{ a: '=SUM(A1)', b: -4 }] })).toBe('a,b\n\'=SUM(A1),-4');
  });

  it('a saved weekly report is emailed to its owner, and stops if they lose access', async () => {
    expect((await as('sup').post('/api/reports/saved', { name: 'Hours this week', key: 'hours_worked', schedule: 'WEEKLY' })).status).toBe(201);
    expect((await as('guard').post('/api/reports/saved', { name: 'Mine', key: 'hours_worked', schedule: 'WEEKLY' })).status).toBe(403);
    expect(await withTenant(t.tenant.id, (tx) => sendScheduledReports(tx))).toBe(1);
    const mail = await owner.emailOutbox.findFirstOrThrow({ where: { template: 'report_ready' } });
    expect(mail.toEmail).toBe(`sup@${SUB}.test`);
    expect(await withTenant(t.tenant.id, (tx) => sendScheduledReports(tx))).toBe(0);
    expect(due('MONTHLY', new Date('2026-10-31T12:00:00Z'), new Date('2026-11-01T09:00:00Z'))).toBe(true);
    await owner.user.updateMany({ where: { email: `sup@${SUB}.test` }, data: { roles: ['STAFF'] } });
    await owner.savedReport.updateMany({ data: { lastSentAt: null } });
    expect(await withTenant(t.tenant.id, (tx) => sendScheduledReports(tx))).toBe(0);
    expect((await owner.savedReport.findFirstOrThrow()).schedule).toBe('NONE');
  });
});
