import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { mileageAmount } from '../../src/services/payroll/expenses.js';
import { ensureTaxTables } from '../../src/services/payroll/taxTables.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');
const server = createApp();
const SUB = 'claims';
let t: Awaited<ReturnType<typeof seedTenant>>;
const tok: Record<string, string> = {};
let guard = '';
const as = (who: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(tok[who]!, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(tok[who]!, { type: 'bearer' }).send(b),
});
const PNG = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]).toString('base64')}`;
const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  t = await seedTenant(SUB, 1);
  guard = t.users[0]!.id;
  await owner.tenant.update({ where: { id: t.tenant.id }, data: { payWeekStartDay: 1 } });
  const now = Math.floor(Date.now() / 1000);
  tok.guard = await signAccessToken({ sub: guard, tid: t.tenant.id, roles: ['STAFF'], aat: now });
  const mk = async (name: string, roles: ('AQUATIC_SUPERVISOR' | 'HR_ADMIN')[]) => {
    const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles, employmentStatus: 'FULL_TIME', firstName: name, lastName: 'X', email: `${name}@${SUB}.test` } });
    tok[name] = await signAccessToken({ sub: u.id, tid: t.tenant.id, roles, aat: now, mfa: true });
  };
  await mk('sup', ['AQUATIC_SUPERVISOR']);
  await mk('prep', ['HR_ADMIN']);
  await mk('approver', ['HR_ADMIN']);
  await ensureTaxTables(owner, new Date().getUTCFullYear());
  await owner.payrollTaxTable.updateMany({ data: { verifiedAt: new Date(), verifiedBy: 'test' } });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('expense and mileage claims', () => {
  it('pays mileage at the higher rate up to the yearly threshold, then the lower one', () => {
    const p = { centsPerKm: 72, centsAfter: 66, tierKm: 5000, receiptOver: 25 };
    expect(mileageAmount(0, 100, p).amount).toBe(72);
    expect(mileageAmount(4950, 100, p).amount).toBe(69); // 50 × 0.72 + 50 × 0.66
    expect(mileageAmount(6000, 100, p).amount).toBe(66);
  });

  let claimId = '';
  it('a person claims mileage and a receipt; receipts are needed above the limit', async () => {
    const noReceipt = await as('guard').post('/api/me/expenses', { title: 'Training trip', items: [{ date: today, category: 'TRAINING', description: 'NLS recert fee', amount: 120 }] });
    expect(noReceipt.body.code).toBe('RECEIPT_NEEDED');
    const r = await as('guard').post('/api/me/expenses', {
      title: 'Training trip',
      items: [
        { date: today, category: 'MILEAGE', description: 'Kelowna to Vernon and back', km: 106 },
        { date: today, category: 'TRAINING', description: 'NLS recert fee', amount: 120, salesTax: 5.71, receipt: { fileName: 'receipt.png', data: PNG } },
        { date: today, category: 'PARKING', description: 'Parking', amount: 6 },
      ],
    });
    expect(r.status).toBe(201);
    claimId = r.body.id;
    expect(r.body.total).toBe(r.body.items.reduce((s: number, i: { amount: number }) => s + i.amount, 0));
    expect(r.body.items[0]).toMatchObject({ category: 'MILEAGE', km: 106, amount: 76.32 });
    const receipt = r.body.items[1].receiptId as string;
    expect((await as('sup').get(`/api/documents/${receipt}/file`)).status).toBe(200);
  });

  it('a supervisor approves it (not their own); it’s paid untaxed on the next pay run', async () => {
    expect((await as('guard').post(`/api/expenses/${claimId}/decision`, { decision: 'APPROVE' })).status).toBe(403);
    expect((await as('sup').get('/api/expenses')).body.map((c: { id: string }) => c.id)).toEqual([claimId]);
    expect((await as('sup').post(`/api/expenses/${claimId}/decision`, { decision: 'REJECT' })).status).toBe(400);
    expect((await as('sup').post(`/api/expenses/${claimId}/decision`, { decision: 'APPROVE' })).status).toBe(200);

    const monday = new Date();
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const periodStart = monday.toISOString().slice(0, 10);
    const run = await as('prep').post('/api/payroll/runs', { departmentId: null, periodStart, weeks: 2, payDate: today < periodStart ? periodStart : new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) });
    expect(run.status).toBe(201);
    const st = await owner.payStatement.findFirstOrThrow({ where: { payRunId: run.body.id, userId: guard } });
    const d = st.deductions as { reimbursements: number; expenses: Array<{ id: string; amount: number }> };
    expect(d.expenses).toEqual([expect.objectContaining({ id: claimId, amount: 202.32 })]);
    expect(d.reimbursements).toBe(202.32);
    expect(Number(st.gross)).toBe(0);
    expect(Number(st.net)).toBe(202.32);
    expect((await as('approver').post(`/api/payroll/runs/${run.body.id}/approve`)).status).toBe(200);
    expect((await owner.expenseClaim.findUniqueOrThrow({ where: { id: claimId } })).status).toBe('PAID');
    const mine = (await as('guard').get('/api/me/expenses')).body;
    expect(mine.claims[0]).toMatchObject({ status: 'PAID', paid: true });
    expect(mine.kmThisYear).toBe(106);
  });
  it('voiding the run that paid a claim puts it back to approved, so the next run pays it', async () => {
    const run = await owner.payRun.findFirstOrThrow({ where: { tenantId: t.tenant.id, status: 'APPROVED' } });
    const v = await as('approver').post(`/api/payroll/runs/${run.id}/void`, { reason: 'Wrong pay date, rebuilding' });
    expect(v.status).toBe(200);
    expect(v.body.releasedClaims).toBe(1);
    expect(await owner.expenseClaim.findUniqueOrThrow({ where: { id: claimId } })).toMatchObject({ status: 'APPROVED', payRunId: null });
    expect((await owner.auditLog.findFirstOrThrow({ where: { action: 'payroll.run.void', entityId: run.id } })).after).toMatchObject({ releasedClaims: [claimId] });
    const again = await as('prep').post('/api/payroll/runs', { departmentId: null, periodStart: run.periodStart.toISOString().slice(0, 10), weeks: 2, payDate: run.payDate.toISOString().slice(0, 10) });
    expect(again.status).toBe(201);
    const st = await owner.payStatement.findFirstOrThrow({ where: { payRunId: again.body.id, userId: guard } });
    expect((st.deductions as { expenses: Array<{ id: string }> }).expenses.map((e) => e.id)).toEqual([claimId]);
  });

  it('a run sent to the bank can’t be voided; one whose file was downloaded keeps its claims paid', async () => {
    const draft = await owner.payRun.findFirstOrThrow({ where: { tenantId: t.tenant.id, status: 'DRAFT' } });
    expect((await as('approver').post(`/api/payroll/runs/${draft.id}/approve`)).status).toBe(200);
    expect((await owner.expenseClaim.findUniqueOrThrow({ where: { id: claimId } })).status).toBe('PAID');
    const sent = await owner.payTransmission.create({ data: { tenantId: t.tenant.id, payRunId: draft.id, method: 'SFTP', fileName: 'deposit.txt', sha256: 'x', encrypted: false, status: 'SENT' } });
    const refused = await as('approver').post(`/api/payroll/runs/${draft.id}/void`, { reason: 'Wrong pay date again' });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('RUN_SENT_TO_BANK');
    expect((await owner.payRun.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('APPROVED');

    // Only downloaded (it may be at the bank): voided, but the claim stays paid.
    await owner.payTransmission.delete({ where: { id: sent.id } });
    await owner.payRun.update({ where: { id: draft.id }, data: { depositFileSha256: 'abc' } });
    const v = await as('approver').post(`/api/payroll/runs/${draft.id}/void`, { reason: 'Wrong pay date again' });
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ releasedClaims: 0, claimsKeptPaid: 1 });
    expect((await owner.expenseClaim.findUniqueOrThrow({ where: { id: claimId } })).status).toBe('PAID');
  });

  /** Holds the run's row locked (as another request part-way through would), runs `meanwhile`, then lets go. */
  const holdingRun = (runId: string, change: string | null, meanwhile: () => Promise<void>) =>
    owner.$transaction(
      async (tx) => {
        if (change) await tx.$executeRawUnsafe(`UPDATE "PayRun" SET ${change} WHERE id = '${runId}'`);
        else await tx.$queryRawUnsafe(`SELECT id FROM "PayRun" WHERE id = '${runId}' FOR UPDATE`);
        await meanwhile();
      },
      { timeout: 20_000 },
    );
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const newRun = async () => {
    const prior = await owner.payRun.findFirstOrThrow({ where: { tenantId: t.tenant.id }, orderBy: { createdAt: 'asc' } });
    const r = await as('prep').post('/api/payroll/runs', { departmentId: null, periodStart: prior.periodStart.toISOString().slice(0, 10), weeks: 2, payDate: prior.payDate.toISOString().slice(0, 10) });
    expect(r.status).toBe(201);
    return r.body.id as string;
  };

  it('an approve and a void of the same draft: only the first one counts', async () => {
    // A claim to pay, on a fresh draft.
    const c = await owner.expenseClaim.create({ data: { tenantId: t.tenant.id, userId: guard, title: 'Parking', status: 'APPROVED', total: 9, decidedAt: new Date(Date.now() - 86_400_000) } });
    const runId = await newRun();
    let voiding!: Promise<request.Response>;
    let approving!: Promise<request.Response>;
    await holdingRun(runId, null, async () => {
      voiding = as('approver').post(`/api/payroll/runs/${runId}/void`, { reason: 'Built for the wrong period' }).then((r) => r);
      await pause(400);
      approving = as('approver').post(`/api/payroll/runs/${runId}/approve`).then((r) => r);
      await pause(400);
    });
    const [v, a] = await Promise.all([voiding, approving]);
    expect(v.status).toBe(200);
    expect(a.status).toBe(409);
    expect((await owner.payRun.findUniqueOrThrow({ where: { id: runId } })).status).toBe('VOID');
    expect(await owner.expenseClaim.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: 'APPROVED', payRunId: null });
  });

  it('a deposit file made while a void waits keeps the claims paid', async () => {
    await owner.expenseClaim.create({ data: { tenantId: t.tenant.id, userId: guard, title: 'Mileage', status: 'APPROVED', total: 14, decidedAt: new Date(Date.now() - 86_400_000) } });
    const runId = await newRun();
    expect((await as('approver').post(`/api/payroll/runs/${runId}/approve`)).status).toBe(200);
    const paid = await owner.expenseClaim.findMany({ where: { payRunId: runId, status: 'PAID' } });
    expect(paid.length).toBeGreaterThan(0);
    let voiding!: Promise<request.Response>;
    // The deposit file is being written (its hash saved) when the void arrives.
    await holdingRun(runId, `"depositFileSha256" = 'file-out'`, async () => {
      voiding = as('approver').post(`/api/payroll/runs/${runId}/void`, { reason: 'Wrong pay date again' }).then((r) => r);
      await pause(400);
    });
    const v = await voiding;
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ releasedClaims: 0, claimsKeptPaid: paid.length });
    for (const c of paid) expect((await owner.expenseClaim.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('PAID');
  });
});
