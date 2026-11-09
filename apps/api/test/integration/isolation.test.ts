import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/lib/db.js';
import { app, owner, seedTenant } from './fixtures.js';

let a: Awaited<ReturnType<typeof seedTenant>>;
let b: Awaited<ReturnType<typeof seedTenant>>;

beforeAll(async () => {
  a = await seedTenant('alpha', 2);
  b = await seedTenant('beta', 2);
});
afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

describe('row-level security', () => {
  it('only returns the current tenant’s rows', async () => {
    const users = await withTenant(a.tenant.id, (tx) => tx.user.findMany(), { prisma: app });
    expect(users).toHaveLength(2);
    expect(users.every((u) => u.tenantId === a.tenant.id)).toBe(true);
  });

  it('returns nothing when no tenant context is set (fails closed)', async () => {
    expect(await app.user.findMany()).toHaveLength(0);
    expect(await app.tenant.findMany()).toHaveLength(0);
  });

  it('cannot read another tenant’s row even by id', async () => {
    const found = await withTenant(a.tenant.id, (tx) => tx.user.findUnique({ where: { id: b.users[0]!.id } }), { prisma: app });
    expect(found).toBeNull();
  });

  it('cannot write a row into another tenant', async () => {
    await expect(
      withTenant(
        a.tenant.id,
        (tx) => tx.position.create({ data: { tenantId: b.tenant.id, name: 'Smuggled' } }),
        { prisma: app },
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('cannot update another tenant’s rows', async () => {
    const res = await withTenant(a.tenant.id, (tx) => tx.user.updateMany({ where: { tenantId: b.tenant.id }, data: { firstName: 'X' } }), {
      prisma: app,
    });
    expect(res.count).toBe(0);
  });

  it('denies DELETE on payroll-bearing tables to the app role', async () => {
    await expect(
      withTenant(a.tenant.id, (tx) => tx.$executeRaw`DELETE FROM "TimePunch"`, { prisma: app }),
    ).rejects.toThrow(/permission denied/);
  });

  it('shares global certifications but isolates tenant ones', async () => {
    await owner.certification.create({ data: { name: 'Standard First Aid', issuingBody: 'Canadian Red Cross' } });
    const certs = await withTenant(a.tenant.id, (tx) => tx.certification.findMany(), { prisma: app });
    expect(certs.map((c) => c.name).sort()).toEqual(['NLS-alpha', 'Standard First Aid']);
  });
});

describe('union information wall', () => {
  it('the app role cannot read union_hub at all', async () => {
    const c = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });
    await c.connect();
    await expect(c.query('SELECT * FROM union_hub.message')).rejects.toThrow(/permission denied/);
    await c.end();
  });

  it('the union role cannot read the main schema directly', async () => {
    const url = process.env.APP_DATABASE_URL!.replace('flexcity_app', 'flexcity_union');
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    await expect(c.query('SELECT * FROM public."User"')).rejects.toThrow(/permission denied/);
    // …but sees its tenant's directory through the view
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [a.tenant.id]);
    const r = await c.query('SELECT tenant_id FROM union_hub.staff_directory');
    await c.query('COMMIT');
    expect(r.rows.every((row) => row.tenant_id === a.tenant.id)).toBe(true);
    expect(r.rowCount).toBe(2);
    await c.end();
  });
});
