/**
 * FH Dev console: set up a city's in-app payroll for them, so pay goes from the city's bank account
 * straight to its staff by direct deposit, with no payroll provider: the deposit file's details from
 * the city's bank, its returns account, and the connection that sends the file. Secrets are sealed
 * with the city's key as soon as they arrive; every change is in the platform audit log.
 */
import { Router } from 'express';
import { z } from 'zod';
import { platformOf, requirePlatformStepUp } from '../../auth/platform.js';
import { db, withTenant } from '../../lib/db.js';
import { HttpError, notFound } from '../../lib/errors.js';
import { linkView, testBankLink } from '../../services/payroll/bankLink.js';
import { type PayrollSettings, readSettings } from '../../services/payroll/payRuns.js';
import { providerView } from '../../services/payroll/providers.js';
import { applyDeposit, bankLinkBody, buildBankLink, depositBody, depositReadiness } from '../../services/payroll/setup.js';
import { hasModule } from '../../services/billing/entitlements.js';
import { tenantSettings } from '../../services/platform/features.js';
import { h } from '../context.js';

export const platformPayrollRouter = Router();
const uuid = z.string().uuid();
type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];
const audit = (adminId: string, tenantId: string, action: string, detail?: object) =>
  db().platformAudit.create({ data: { adminId, tenantId, action, detail: detail ? JSON.parse(JSON.stringify(detail)) : undefined } });
const read = async (tx: Tx) => readSettings((await tx.tenant.findFirstOrThrow({ select: { payrollSettings: true } })).payrollSettings);
const write = (tx: Tx, tenantId: string, s: PayrollSettings) => tx.tenant.update({ where: { id: tenantId }, data: { payrollSettings: JSON.parse(JSON.stringify(s)) } });

async function view(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!t) throw notFound('Organization');
    const s = await read(tx);
    const staffWithDeposit = (await tx.bankAccount.groupBy({ by: ['userId'], where: { status: 'ACTIVE' } })).length;
    return {
      mode: s.payrollProvider?.mode ?? 'in_app',
      provider: providerView(s.payrollProvider),
      deposit: {
        businessNumber: s.businessNumber ?? null,
        originatorId: s.originatorId ?? null,
        originatorShortName: s.originatorShortName ?? null,
        originatorLongName: s.originatorLongName ?? null,
        destinationDataCentre: s.destinationDataCentre ?? null,
        returnsInstitution: s.returnsInstitution ?? null,
        returnsTransit: s.returnsTransit ?? null,
        returnsAccount: s.returnsAccount ? `••••${s.returnsAccount.last4}` : null,
      },
      bank: linkView(s.bank),
      readiness: depositReadiness(s),
      staffWithDeposit,
      bankConnectionInPlan: hasModule((await tenantSettings(tenantId)).billing, 'bankConnection'),
    };
  });
}
platformPayrollRouter.get(
  '/tenants/:id/payroll',
  h(async (req, res) => {
    res.json(await view(uuid.parse(req.params.id)));
  }),
);

/** In-app payroll on (no provider), with the city's deposit details from its bank. */
platformPayrollRouter.put(
  '/tenants/:id/payroll',
  requirePlatformStepUp,
  h(async (req, res) => {
    const p = platformOf(req);
    const tenantId = uuid.parse(req.params.id);
    const b = depositBody.extend({ inApp: z.boolean().optional() }).parse(req.body);
    const { inApp, ...deposit } = b;
    await withTenant(tenantId, async (tx) => {
      if (!(await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true } }))) throw notFound('Organization');
      const s = await read(tx);
      let next = await applyDeposit(tenantId, s, deposit);
      if (inApp) next = { ...next, payrollProvider: { ...(next.payrollProvider ?? {}), mode: 'in_app' } };
      await write(tx, tenantId, next);
    });
    await audit(p.adminId, tenantId, 'payroll.setup', { ...deposit, returnsAccount: deposit.returnsAccount ? `••••${deposit.returnsAccount.slice(-4)}` : undefined, inApp });
    res.json(await view(tenantId));
  }),
);

platformPayrollRouter.put(
  '/tenants/:id/payroll/bank',
  requirePlatformStepUp,
  h(async (req, res) => {
    const p = platformOf(req);
    const tenantId = uuid.parse(req.params.id);
    const b = bankLinkBody.parse(req.body);
    const changed = await withTenant(tenantId, async (tx) => {
      if (!(await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true } }))) throw notFound('Organization');
      const s = await read(tx);
      const { link, credentialChanged } = await buildBankLink(tenantId, b, s.bank);
      await write(tx, tenantId, { ...s, bank: link });
      return { link, credentialChanged };
    });
    await audit(p.adminId, tenantId, 'payroll.bank_connection', { ...linkView(changed.link), credentialChanged: changed.credentialChanged });
    res.json(await view(tenantId));
  }),
);

platformPayrollRouter.delete(
  '/tenants/:id/payroll/bank',
  requirePlatformStepUp,
  h(async (req, res) => {
    const p = platformOf(req);
    const tenantId = uuid.parse(req.params.id);
    await withTenant(tenantId, async (tx) => {
      const { bank: _gone, ...rest } = await read(tx);
      await write(tx, tenantId, rest);
    });
    await audit(p.adminId, tenantId, 'payroll.bank_connection.remove');
    res.json(await view(tenantId));
  }),
);

platformPayrollRouter.post(
  '/tenants/:id/payroll/bank/test',
  h(async (req, res) => {
    const p = platformOf(req);
    const tenantId = uuid.parse(req.params.id);
    const s = await withTenant(tenantId, read);
    if (!s.bank) throw new HttpError(409, 'BANK_NOT_CONNECTED', 'Set up the bank connection first.');
    const r = await testBankLink(tenantId, s.bank);
    await audit(p.adminId, tenantId, 'payroll.bank_connection.test');
    res.json(r);
  }),
);
