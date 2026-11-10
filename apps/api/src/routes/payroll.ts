/**
 * Payroll: pay runs per department, direct deposit, pay statements, remittances,
 * T4s and Record of Employment figures.
 *
 * Who can do what:
 * - payroll.export (HR): prepare pay runs, manage tax profiles and enter or verify banking details.
 * - payroll.approve (HR): approve and release pay runs, download bank deposit files, payroll settings.
 * - Everyone: their own pay statements, direct deposit and TD1 tax credits.
 * Releasing pay and seeing full SINs needs a recent sign-in, and by default a passkey.
 */
import { Router } from 'express';
import { z } from 'zod';
import { assertUserInScope, peopleWhere } from '../services/people/scope.js';
import { type AuthContext, authOf, requireFeature, requirePermission, requireRecentAuth, requireModule } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { CONSENT, addBankAccount, bankView, profileView, revealSin, savePayProfile, verifyBankAccount } from '../services/payroll/bank.js';
import { linkView, testBankLink } from '../services/payroll/bankLink.js';
import { bankLinkBody, buildBankLink } from '../services/payroll/setup.js';
import { type PayrollSettings, approveRun, buildRun, depositFile, prepareBankFile, readSettings, runInput, sealReturnsAccount, sendToBank } from '../services/payroll/payRuns.js';
import type { Deductions } from '../services/payroll/tax.js';
import { remittance, rl1s, roeFigures, t4s } from '../services/payroll/yearEnd.js';
import { type Person, ROE_REASONS, type Rl1Transmitter, type RoeReason, assignRl1Numbers, payPeriodType, rl1Problems, rl1Xml, roeXml, t4Problems, t4Xml } from '../services/payroll/filingXml.js';
import type { MailingAddress } from '../services/payroll/bank.js';
import { h } from './context.js';
import { csvCell } from '../services/payroll/export.js';

/** Building or approving a pay run works through every statement: it gets two minutes, not the usual 15 s. */
const payrollTx = <T>(tenantId: string, fn: (tx: Parameters<Parameters<typeof withTenant>[1]>[0]) => Promise<T>) => withTenant(tenantId, fn, { timeoutMs: 120_000 });

export const payrollRouter = Router();
payrollRouter.use(['/payroll', '/me/pay', '/me/pay-statements', '/me/bank-accounts', '/me/pay-profile'], requireFeature('payroll'));

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'] as const;

/** Releasing pay needs a passkey sign-in unless the city turned that off. */
function requirePasskey(a: AuthContext, settings: PayrollSettings) {
  if (settings.requirePasskey !== false && !a.mfa) throw new HttpError(403, 'PASSKEY_REQUIRED', 'Sign in with your passkey (Face ID, fingerprint or Windows Hello) to release pay or see banking details.');
}

/** A supervisor limited to departments can only work with runs for those departments. */
async function assertRunInScope(tx: Parameters<Parameters<typeof withTenant>[1]>[0], a: AuthContext, departmentId: string | null) {
  if (!a.scope) return;
  if (!departmentId) throw forbidden('City-wide pay runs are for HR.');
  const positions = await tx.position.findMany({ where: { departmentId }, select: { id: true } });
  if (!positions.every((p) => a.scope!.positionIds.includes(p.id))) throw notFound('Pay run');
}

const settingsOf = async (tx: Parameters<Parameters<typeof withTenant>[1]>[0]) => readSettings((await tx.tenant.findFirstOrThrow({ select: { payrollSettings: true } })).payrollSettings);

const runView = (r: { id: string; kind?: string; note?: string | null; departmentId: string | null; periodStart: Date; periodEnd: Date; payDate: Date; status: string; totals: unknown; blockers: unknown; warnings: unknown; preparedById: string; approvedById: string | null; approvedAt: Date | null; paidAt: Date | null; fileCreationNumber: number | null; depositFileSha256: string | null; createdAt: Date }) => ({
  id: r.id,
  kind: r.kind ?? 'REGULAR',
  note: r.note ?? null,
  departmentId: r.departmentId,
  periodStart: r.periodStart.toISOString().slice(0, 10),
  periodEnd: r.periodEnd.toISOString().slice(0, 10),
  payDate: r.payDate.toISOString().slice(0, 10),
  status: r.status,
  totals: r.totals,
  blockers: r.blockers,
  warnings: r.warnings,
  preparedById: r.preparedById,
  approvedById: r.approvedById,
  approvedAt: r.approvedAt,
  paidAt: r.paidAt,
  fileCreationNumber: r.fileCreationNumber,
  depositFileSha256: r.depositFileSha256,
  createdAt: r.createdAt,
});

// ------------------------------------------------------------- Pay runs
payrollRouter.get(
  '/payroll/runs',
  requirePermission('payroll.export'),
  h(async (req, res) => {
    const a = authOf(req);
    const department = z.string().uuid().optional().parse(req.query.department);
    const out = await withTenant(a.tenantId, async (tx) => {
      const runs = await tx.payRun.findMany({ where: department ? { departmentId: department } : {}, orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }], take: 100 });
      const visible = [];
      for (const r of runs) {
        try {
          await assertRunInScope(tx, a, r.departmentId);
          visible.push(runView(r));
        } catch {
          /* another department's run */
        }
      }
      return visible;
    });
    res.json(out);
  }),
);

const runBody = z.object({ departmentId: uuid.nullable(), periodStart: isoDate, weeks: z.number().int().min(1).max(5), payDate: isoDate, kind: z.enum(['REGULAR', 'OFF_CYCLE']).default('REGULAR'), note: z.string().trim().max(200).nullable().optional() });

payrollRouter.post(
  '/payroll/runs',
  requirePermission('payroll.export'),
  h(async (req, res) => {
    const a = authOf(req);
    const body = runBody.parse(req.body);
    const run = await payrollTx(a.tenantId, async (tx) => {
      await assertRunInScope(tx, a, body.departmentId);
      const r = await buildRun(tx, a.tenantId, a.userId, body);
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.run.create', entity: 'PayRun', entityId: r.id, after: body });
      return r;
    });
    res.status(201).json(runView(run));
  }),
);

payrollRouter.get(
  '/payroll/runs/:id',
  requirePermission('payroll.export'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const out = await withTenant(a.tenantId, async (tx) => {
      const run = await tx.payRun.findUnique({ where: { id } });
      if (!run) throw notFound('Pay run');
      await assertRunInScope(tx, a, run.departmentId);
      const statements = await tx.payStatement.findMany({ where: { payRunId: id }, orderBy: { net: 'desc' } });
      const transmissions = await tx.payTransmission.findMany({ where: { payRunId: id }, orderBy: { createdAt: 'desc' } });
      const [users, departments] = await Promise.all([
        tx.user.findMany({ where: { id: { in: statements.map((s) => s.userId) } }, select: { id: true, firstName: true, lastName: true, employeeNumber: true } }),
        tx.department.findMany({ select: { id: true, name: true, nameFr: true } }),
      ]);
      const byDepartment = new Map<string, { departmentId: string | null; people: number; gross: number; net: number; employerCost: number }>();
      for (const s of statements) {
        const k = s.departmentId ?? 'none';
        const row = byDepartment.get(k) ?? { departmentId: s.departmentId, people: 0, gross: 0, net: 0, employerCost: 0 };
        row.people += 1;
        row.gross += Number(s.gross);
        row.net += Number(s.net);
        row.employerCost += Number(s.gross) + Number(s.employerCpp) + Number(s.employerEi) + ((s.deductions as { employerBenefits?: number }).employerBenefits ?? 0) + ((s.deductions as { employerQpip?: number }).employerQpip ?? 0);
        byDepartment.set(k, row);
      }
      return {
        run: runView(run),
        transmissions: transmissions.map((t) => ({ id: t.id, at: t.createdAt, fileName: t.fileName, status: t.status, error: t.error, encrypted: t.encrypted, sha256: t.sha256 })),
        departments,
        byDepartment: [...byDepartment.values()].map((d) => ({ ...d, gross: Math.round(d.gross * 100) / 100, net: Math.round(d.net * 100) / 100, employerCost: Math.round(d.employerCost * 100) / 100 })),
        statements: statements.map((s) => {
          const u = users.find((x) => x.id === s.userId);
          return { id: s.id, userId: s.userId, name: u ? `${u.firstName} ${u.lastName}` : '', employeeNumber: u?.employeeNumber ?? null, departmentId: s.departmentId, province: s.province, hours: Number(s.hours), gross: Number(s.gross), deductions: s.deductions, totalDeductions: Number(s.totalDeductions), net: Number(s.net), deposit: s.depositLast4 ? `••••${s.depositLast4}` : null };
        }),
      };
    });
    res.json(out);
  }),
);

payrollRouter.post(
  '/payroll/runs/:id/recalculate',
  requirePermission('payroll.export'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const run = await payrollTx(a.tenantId, async (tx) => {
      const r = await tx.payRun.findUnique({ where: { id } });
      if (!r) throw notFound('Pay run');
      await assertRunInScope(tx, a, r.departmentId);
      if (r.status !== 'DRAFT') throw conflict('NOT_DRAFT', 'Only a draft pay run can be recalculated.');
      return buildRun(tx, a.tenantId, r.preparedById, runInput(r), r.id);
    });
    res.json(runView(run));
  }),
);

payrollRouter.post(
  '/payroll/runs/:id/approve',
  requirePermission('payroll.approve'),
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const run = await payrollTx(a.tenantId, async (tx) => {
      const settings = await settingsOf(tx);
      requirePasskey(a, settings);
      const r = await tx.payRun.findUnique({ where: { id } });
      if (!r) throw notFound('Pay run');
      await assertRunInScope(tx, a, r.departmentId);
      const approved = await approveRun(tx, a.tenantId, id, a.userId, settings);
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.run.approve', entity: 'PayRun', entityId: id, after: approved.totals as object });
      return { approved, settings };
    });
    // Connected banks can receive the file the moment a run is approved.
    const transmission = run.settings.bank?.autoSend ? await send(a, id, run.settings).catch((e: Error) => ({ status: 'FAILED' as const, error: e.message })) : null;
    res.json({ ...runView(run.approved), transmission });
  }),
);

payrollRouter.get(
  '/payroll/runs/:id/deposit-file',
  requirePermission('payroll.approve'),
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const out = await withTenant(a.tenantId, async (tx) => {
      const settings = await settingsOf(tx);
      requirePasskey(a, settings);
      const r = await tx.payRun.findUnique({ where: { id } });
      if (!r) throw notFound('Pay run');
      await assertRunInScope(tx, a, r.departmentId);
      const f = await depositFile(tx, a.tenantId, id, settings);
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.deposit_file', entity: 'PayRun', entityId: id, after: { sha256: f.sha256, fileCreationNumber: f.fileCreationNumber, deposits: f.count, totalCents: f.totalCents } });
      return f;
    });
    res.setHeader('X-Deposit-Sha256', out.sha256);
    res.type('text/plain').attachment(`deposit-${String(out.fileCreationNumber).padStart(4, '0')}.txt`).send(out.file);
  }),
);

/** Builds the file in one transaction, sends it outside it, and records the attempt in another. */
async function send(a: AuthContext, runId: string, settings: PayrollSettings) {
  const prepared = await withTenant(a.tenantId, (tx) => prepareBankFile(tx, a.tenantId, runId, settings));
  const result = await sendToBank(a.tenantId, runId, a.userId, settings, prepared, (data) =>
    withTenant(a.tenantId, async (tx) => {
      await tx.payTransmission.create({ data });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: data.status === 'SENT' ? 'payroll.bank.sent' : 'payroll.bank.failed', entity: 'PayRun', entityId: runId, after: { fileName: data.fileName, sha256: data.sha256, encrypted: data.encrypted, error: data.error } });
    }),
  );
  return result;
}

payrollRouter.post(
  '/payroll/runs/:id/send',
  requirePermission('payroll.approve'),
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const settings = await withTenant(a.tenantId, async (tx) => {
      const s = await settingsOf(tx);
      requirePasskey(a, s);
      const r = await tx.payRun.findUnique({ where: { id } });
      if (!r) throw notFound('Pay run');
      await assertRunInScope(tx, a, r.departmentId);
      return s;
    });
    const out = await send(a, id, settings);
    res.status(out.status === 'SENT' ? 200 : 502).json(out.status === 'SENT' ? out : { ...out, code: 'BANK_SEND_FAILED', message: `The bank didn’t take the file: ${(out as { error?: string }).error ?? 'no answer'}` });
  }),
);

// ------------------------------------------------------------- Bank connection
payrollRouter.put(
  '/payroll/bank-connection',
  requirePermission('payroll.approve'),
  requireModule('bankConnection'),
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    if (a.scope) throw forbidden('Payroll settings and the bank connection are for the whole organization, set by HR.');
    const b = bankLinkBody.parse(req.body);
    const out = await withTenant(a.tenantId, async (tx) => {
      const settings = await settingsOf(tx);
      requirePasskey(a, settings);
      const { link, credentialChanged } = await buildBankLink(a.tenantId, b, settings.bank);
      const secret = credentialChanged;
      await tx.tenant.update({ where: { id: a.tenantId }, data: { payrollSettings: JSON.parse(JSON.stringify({ ...settings, bank: link })) } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.bank_connection', entity: 'Tenant', entityId: a.tenantId, after: { ...linkView(link), credentialChanged: !!secret } });
      return link;
    });
    res.json(linkView(out));
  }),
);

payrollRouter.delete(
  '/payroll/bank-connection',
  requirePermission('payroll.approve'),
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    if (a.scope) throw forbidden('Payroll settings and the bank connection are for the whole organization, set by HR.');
    await withTenant(a.tenantId, async (tx) => {
      const { bank: _gone, ...rest } = await settingsOf(tx);
      await tx.tenant.update({ where: { id: a.tenantId }, data: { payrollSettings: JSON.parse(JSON.stringify(rest)) } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.bank_connection.remove', entity: 'Tenant', entityId: a.tenantId });
    });
    res.status(204).end();
  }),
);

payrollRouter.post(
  '/payroll/bank-connection/test',
  requirePermission('payroll.approve'),
  requireModule('bankConnection'),
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    if (a.scope) throw forbidden('Payroll settings and the bank connection are for the whole organization, set by HR.');
    const settings = await withTenant(a.tenantId, settingsOf);
    if (!settings.bank) throw conflict('BANK_NOT_CONNECTED', 'Connect your bank first.');
    res.json(await testBankLink(a.tenantId, settings.bank));
  }),
);

payrollRouter.post(
  '/payroll/runs/:id/paid',
  requirePermission('payroll.approve'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    await withTenant(a.tenantId, async (tx) => {
      const r = await tx.payRun.findUnique({ where: { id } });
      if (!r) throw notFound('Pay run');
      await assertRunInScope(tx, a, r.departmentId);
      if (r.status !== 'APPROVED') throw conflict('NOT_APPROVED', 'Only an approved pay run can be marked paid.');
      await tx.payRun.update({ where: { id }, data: { status: 'PAID', paidAt: new Date() } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.run.paid', entity: 'PayRun', entityId: id });
    });
    res.json({ ok: true });
  }),
);

payrollRouter.post(
  '/payroll/runs/:id/void',
  requirePermission('payroll.export'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const reason = z.object({ reason: z.string().trim().min(5).max(500) }).parse(req.body).reason;
    await withTenant(a.tenantId, async (tx) => {
      const r = await tx.payRun.findUnique({ where: { id } });
      if (!r) throw notFound('Pay run');
      await assertRunInScope(tx, a, r.departmentId);
      if (r.status === 'PAID' || r.status === 'VOID') throw conflict('CANNOT_VOID', 'A paid pay run can’t be voided; correct it in the next run.');
      if (r.status === 'APPROVED' && !a.permissions.has('payroll.approve')) throw forbidden('Only someone who approves pay runs can void an approved one.');
      await tx.payRun.update({ where: { id }, data: { status: 'VOID', voidedAt: new Date() } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.run.void', entity: 'PayRun', entityId: id, after: { reason, wasApproved: r.status === 'APPROVED', depositFileCreated: !!r.depositFileSha256 } });
    });
    res.json({ ok: true });
  }),
);

payrollRouter.get(
  '/payroll/runs/:id/register.csv',
  requirePermission('payroll.export'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const csv = await withTenant(a.tenantId, async (tx) => {
      const r = await tx.payRun.findUnique({ where: { id } });
      if (!r) throw notFound('Pay run');
      await assertRunInScope(tx, a, r.departmentId);
      const rows = await tx.payStatement.findMany({ where: { payRunId: id } });
      const users = await tx.user.findMany({ where: { id: { in: rows.map((s) => s.userId) } }, select: { id: true, firstName: true, lastName: true, employeeNumber: true } });
      const depts = await tx.department.findMany({ select: { id: true, name: true } });
      // Quoted, with spreadsheet formulas neutralised (a name like =HYPERLINK(...) stays text).
  const q = (v: unknown) => { const c = csvCell(String(v ?? '')); return c.startsWith('"') ? c : `"${c}"`; };
      const head = ['Employee number', 'Name', 'Department', 'Province', 'Hours', 'Gross', 'CPP', 'CPP2', 'EI', 'Federal tax', 'Provincial tax', 'Extra tax', 'Pension', 'Union dues', 'Other benefits', 'Total deductions', 'Net', 'Employer CPP', 'Employer EI', 'Employer benefits', 'Paid by'];
      const lines = rows.map((s) => {
        const u = users.find((x) => x.id === s.userId);
        const d = s.deductions as unknown as Deductions;
        const b = s.deductions as { rpp?: number; unionDues?: number; afterTax?: number; employerBenefits?: number };
        return [u?.employeeNumber, u ? `${u.lastName}, ${u.firstName}` : '', depts.find((x) => x.id === s.departmentId)?.name ?? '', s.province, s.hours, s.gross, d.cpp, d.cpp2, d.ei, d.federalTax, d.provincialTax, d.extraTax, b.rpp ?? 0, b.unionDues ?? 0, b.afterTax ?? 0, s.totalDeductions, s.net, s.employerCpp, s.employerEi, b.employerBenefits ?? 0, s.depositLast4 ? `Deposit ••••${s.depositLast4}` : 'Cheque']
          .map(q)
          .join(',');
      });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.register', entity: 'PayRun', entityId: id });
      return [head.map(q).join(','), ...lines].join('\r\n');
    });
    res.type('text/csv').attachment(`payroll-register-${id.slice(0, 8)}.csv`).send(csv);
  }),
);

// ------------------------------------------------------------- People: tax profiles and banking
payrollRouter.get(
  '/payroll/people',
  requirePermission('payroll.export'),
  h(async (req, res) => {
    const a = authOf(req);
    const out = await withTenant(a.tenantId, async (tx) => {
      // Tax profiles and banking: only for the people in the viewer's department, and every view is logged.
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.people.view', entity: 'Tenant', entityId: a.tenantId });
      const users = await tx.user.findMany({
        where: { status: 'ACTIVE', anonymizedAt: null, ...peopleWhere(a.scope) },
        select: { id: true, firstName: true, lastName: true, employeeNumber: true, payProfile: true, bankAccounts: { where: { status: { in: ['ACTIVE', 'PENDING'] } }, orderBy: { createdAt: 'desc' } }, positions: { select: { position: { select: { departmentId: true } } } } },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      });
      return users.map((u) => ({
        id: u.id,
        name: `${u.firstName} ${u.lastName}`,
        employeeNumber: u.employeeNumber,
        departmentIds: [...new Set(u.positions.map((p) => p.position.departmentId).filter(Boolean))],
        profile: profileView(u.payProfile),
        bankAccounts: u.bankAccounts.map(bankView),
      }));
    });
    res.json({ people: out, me: a.userId });
  }),
);

const profileBody = z.object({
  province: z.enum(PROVINCES).nullable().optional(),
  federalClaim: z.number().min(0).max(1_000_000).nullable().optional(),
  provincialClaim: z.number().min(0).max(1_000_000).nullable().optional(),
  extraTaxPerPeriod: z.number().min(0).max(10_000).optional(),
  cppExempt: z.boolean().optional(),
  eiExempt: z.boolean().optional(),
  sin: z.string().max(15).nullable().optional(),
  mailingAddress: z
    .object({
      line1: z.string().trim().min(3).max(60),
      line2: z.string().trim().max(60).nullable().optional(),
      city: z.string().trim().min(2).max(40),
      province: z.enum(PROVINCES),
      postalCode: z.string().trim().regex(/^[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d$/, 'A postal code looks like A1A 1A1.'),
    })
    .nullable()
    .optional(),
});

payrollRouter.put(
  '/users/:id/pay-profile',
  requirePermission('payroll.export'),
  h(async (req, res) => {
    const a = authOf(req);
    const userId = uuid.parse(req.params.id);
    const body = profileBody.parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      if (!(await tx.user.findUnique({ where: { id: userId } }))) throw notFound('Person');
      await savePayProfile(tx, a.tenantId, userId, body, false);
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.profile.update', entity: 'User', entityId: userId, after: { ...body, sin: body.sin ? 'changed' : undefined } });
    });
    res.json({ ok: true });
  }),
);

payrollRouter.get(
  '/users/:id/sin',
  requirePermission('payroll.export'),
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    const userId = uuid.parse(req.params.id);
    const sin = await withTenant(a.tenantId, async (tx) => {
      requirePasskey(a, await settingsOf(tx));
      const p = await tx.payProfile.findUnique({ where: { userId } });
      if (!p) throw notFound('SIN');
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.sin.view', entity: 'User', entityId: userId });
      return revealSin(a.tenantId, p);
    });
    if (!sin) throw notFound('SIN');
    res.json({ sin: `${sin.slice(0, 3)}-${sin.slice(3, 6)}-${sin.slice(6)}` });
  }),
);

const bankBody = z.object({
  holderName: z.string().trim().min(2).max(30),
  institution: z.string().trim(),
  transit: z.string().trim(),
  account: z.string().trim(),
  /** The person agreed to the direct deposit authorization. */
  agree: z.literal(true),
});

payrollRouter.post(
  '/users/:id/bank-accounts',
  requirePermission('payroll.export'),
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    const userId = uuid.parse(req.params.id);
    const body = bankBody.parse(req.body);
    const row = await withTenant(a.tenantId, async (tx) => {
      const u = await tx.user.findUnique({ where: { id: userId }, select: { locale: true } });
      if (!u) throw notFound('Person');
      const r = await addBankAccount(tx, a.tenantId, { userId, enteredById: a.userId, ...body, locale: u.locale === 'fr-CA' ? 'fr-CA' : 'en-CA' });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.bank.enter', entity: 'User', entityId: userId, after: { last4: r.last4, institution: r.institution, transit: r.transit } });
      return r;
    });
    res.status(201).json(bankView(row));
  }),
);

payrollRouter.post(
  '/bank-accounts/:id/verify',
  requirePermission('payroll.export'),
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const { approve } = z.object({ approve: z.boolean() }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const acct = await tx.bankAccount.findUnique({ where: { id }, select: { userId: true } });
      if (acct) {
        if (acct.userId === a.userId) throw forbidden('You can’t verify your own bank account.');
        await assertUserInScope(tx, a, acct.userId);
      }
      await verifyBankAccount(tx, a.tenantId, id, a.userId, approve);
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: approve ? 'payroll.bank.verify' : 'payroll.bank.reject', entity: 'BankAccount', entityId: id });
    });
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------- Documents
payrollRouter.get(
  '/payroll/remittance',
  requirePermission('payroll.export'),
  h(async (req, res) => {
    const a = authOf(req);
    const month = z.string().regex(/^\d{4}-\d{2}$/).parse(req.query.month);
    if (a.scope) throw forbidden('Remittances cover the whole city and are for HR.');
    res.json(await withTenant(a.tenantId, (tx) => remittance(tx, month)));
  }),
);

payrollRouter.get(
  '/payroll/t4',
  requirePermission('payroll.export'),
  h(async (req, res) => {
    const a = authOf(req);
    const year = z.coerce.number().int().min(2020).max(2100).parse(req.query.year);
    if (a.scope) throw forbidden('T4s cover the whole city and are for HR.');
    const out = await withTenant(a.tenantId, async (tx) => {
      const r = await t4s(tx, year);
      const settings = await settingsOf(tx);
      const tenant = await tx.tenant.findFirstOrThrow({ select: { name: true } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.t4.view', entity: 'Tenant', entityId: a.tenantId, after: { year } });
      return { ...r, employer: { name: tenant.name, businessNumber: settings.businessNumber ?? null, address: settings.employerAddress ?? null } };
    });
    res.json(out);
  }),
);

payrollRouter.get(
  '/payroll/rl1',
  requirePermission('payroll.export'),
  h(async (req, res) => {
    const a = authOf(req);
    const year = z.coerce.number().int().min(2020).max(2100).parse(req.query.year);
    if (a.scope) throw forbidden('RL-1 slips cover the whole city and are for HR.');
    const out = await withTenant(a.tenantId, async (tx) => {
      const r = await rl1s(tx, year);
      const settings = await settingsOf(tx);
      const tenant = await tx.tenant.findFirstOrThrow({ select: { name: true } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.rl1.view', entity: 'Tenant', entityId: a.tenantId, after: { year } });
      return { ...r, employer: { name: tenant.name, quebecNumber: settings.quebecNumber ?? null, address: settings.employerAddress ?? null } };
    });
    res.json(out);
  }),
);

/** The year's RL-1 slips as Revenu Québec XML. Contains full SINs: passkey and audit. */
payrollRouter.get(
  '/payroll/rl1.xml',
  requirePermission('payroll.export'),
  h(async (req, res) => {
    const a = authOf(req);
    const year = z.coerce.number().int().min(2020).max(2100).parse(req.query.year);
    const kind = z.enum(['R', 'A', 'D']).default('R').parse(req.query.type);
    if (a.scope) throw forbidden('RL-1 slips cover the whole city and are for HR.');
    const out = await withTenant(a.tenantId, async (tx) => {
      const settings = await settingsOf(tx);
      requirePasskey(a, settings);
      const r = await rl1s(tx, year);
      if (!r.slips.length) throw badRequest('Nobody was paid as a Quebec employee in that year.');
      const tenant = await tx.tenant.findFirstOrThrow({ select: { name: true } });
      const employer = filingEmployer(tenant.name, settings);
      const people = await filingPeople(tx, a.tenantId, r.slips.map((x) => x.userId));
      const transmitter = { preparerNumber: settings.rqPreparerNumber, certificationNumber: settings.rqCertificationNumber, firstSlipSequence: settings.rl1FirstSlip };
      const problems = rl1Problems({ quebecNumber: settings.quebecNumber, transmitter, employer }, people, r.slips);
      if (problems.length) throw new HttpError(400, 'FILING_INCOMPLETE', 'Some details are missing before this file can be made.', { problems });
      // Same number for the same person all year: amendments and cancellations reuse it.
      const numbers = assignRl1Numbers(r.slips.map((x) => x.userId), settings.rl1FirstSlip!, settings.rl1Numbers?.[year]);
      await tx.tenant.update({ where: { id: a.tenantId }, data: { payrollSettings: JSON.parse(JSON.stringify({ ...settings, rl1Numbers: { ...settings.rl1Numbers, [year]: numbers } })) } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.rl1.xml', entity: 'Tenant', entityId: a.tenantId, after: { year, kind, slips: r.slips.length } });
      return rl1Xml({ numbers, year, kind, quebecNumber: settings.quebecNumber!, employer, transmitter: transmitter as Rl1Transmitter, slips: r.slips, people: people as Map<string, Person>, software: { name: 'FlexcityHeadquarters', version: String(year) } });
    });
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="RL-1-${year}.xml"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(out);
  }),
);

/* Quebec workforce skills: the training spending log for the year (it reduces the WSDRF owed). */
const spendView = (x: { id: string; year: number; spentOn: Date; category: string; description: string; amountCents: number; trainingRecordId: string | null }) => ({ ...x, spentOn: x.spentOn.toISOString().slice(0, 10), amount: x.amountCents / 100 });

payrollRouter.get(
  '/payroll/quebec/training',
  requirePermission('payroll.export'),
  h(async (req, res) => {
    const a = authOf(req);
    const year = z.coerce.number().int().min(2020).max(2100).parse(req.query.year);
    if (a.scope) throw forbidden('Workforce skills figures cover the whole city.');
    const rows = await withTenant(a.tenantId, (tx) => tx.trainingSpend.findMany({ where: { year }, orderBy: { spentOn: 'desc' } }));
    res.json(rows.map(spendView));
  }),
);

payrollRouter.post(
  '/payroll/quebec/training',
  requirePermission('payroll.export'),
  h(async (req, res) => {
    const a = authOf(req);
    if (a.scope) throw forbidden('Workforce skills figures cover the whole city.');
    const b = z
      .object({
        spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        category: z.enum(['COURSE_FEES', 'TRAINER', 'WAGES_IN_TRAINING', 'TRAVEL', 'MATERIALS', 'OTHER']),
        description: z.string().trim().min(2).max(200),
        amount: z.number().positive().max(10_000_000),
        trainingRecordId: uuid.nullable().optional(),
      })
      .parse(req.body);
    const row = await withTenant(a.tenantId, async (tx) => {
      const created = await tx.trainingSpend.create({ data: { tenantId: a.tenantId, year: Number(b.spentOn.slice(0, 4)), spentOn: new Date(`${b.spentOn}T00:00:00Z`), category: b.category, description: b.description, amountCents: Math.round(b.amount * 100), trainingRecordId: b.trainingRecordId ?? null, createdById: a.userId } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.training.add', entity: 'TrainingSpend', entityId: created.id, after: b });
      return created;
    });
    res.status(201).json(spendView(row));
  }),
);

payrollRouter.delete(
  '/payroll/quebec/training/:id',
  requirePermission('payroll.export'),
  h(async (req, res) => {
    const a = authOf(req);
    if (a.scope) throw forbidden('Workforce skills figures cover the whole city.');
    const id = uuid.parse(req.params.id);
    await withTenant(a.tenantId, async (tx) => {
      const row = await tx.trainingSpend.findUnique({ where: { id } });
      if (!row) throw notFound('Training expense');
      await tx.trainingSpend.delete({ where: { id } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.training.remove', entity: 'TrainingSpend', entityId: id, before: spendView(row) });
    });
    res.status(204).end();
  }),
);

/** Each person's details for a filing file, with the full SIN (unsealed only here, for the file). */
async function filingPeople(tx: Parameters<Parameters<typeof withTenant>[1]>[0], tenantId: string, userIds: string[]) {
  const users = await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, employeeNumber: true, payProfile: true } });
  const out = new Map<string, Person | null>();
  for (const u of users) {
    const p = u.payProfile;
    const sin = p ? await revealSin(tenantId, p) : null;
    out.set(u.id, sin ? { firstName: u.firstName, lastName: u.lastName, sin, employeeNumber: u.employeeNumber, address: (p?.mailingAddress as MailingAddress | null) ?? null, cppExempt: p?.cppExempt ?? false, eiExempt: p?.eiExempt ?? false } : null);
  }
  return out;
}

function filingEmployer(name: string, s: PayrollSettings) {
  return { name, businessNumber: s.businessNumber ?? '', address: s.employerMailing ?? null, contact: s.filingContact ?? { name: '', phone: '' } };
}

/** The T4 return as CRA XML, ready for Internet File Transfer. Contains full SINs: passkey and audit. */
payrollRouter.get(
  '/payroll/t4.xml',
  requirePermission('payroll.export'),
  h(async (req, res) => {
    const a = authOf(req);
    const year = z.coerce.number().int().min(2020).max(2100).parse(req.query.year);
    const reportType = z.enum(['O', 'A']).default('O').parse(req.query.type);
    if (a.scope) throw forbidden('T4s cover the whole city and are for HR.');
    const out = await withTenant(a.tenantId, async (tx) => {
      const settings = await settingsOf(tx);
      requirePasskey(a, settings);
      const r = await t4s(tx, year);
      if (!r.slips.length) throw badRequest('Nobody was paid in that year.');
      const tenant = await tx.tenant.findFirstOrThrow({ select: { name: true } });
      const employer = filingEmployer(tenant.name, settings);
      const people = await filingPeople(tx, a.tenantId, r.slips.map((s) => s.userId));
      const problems = t4Problems(employer, people, r.slips);
      if (problems.length) throw new HttpError(400, 'FILING_INCOMPLETE', 'Some details are missing before this file can be made.', { problems });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.t4.xml', entity: 'Tenant', entityId: a.tenantId, after: { year, reportType, slips: r.slips.length } });
      const submissionRef = `T4${String(year).slice(2)}${Date.now().toString(36).slice(-4)}`.toUpperCase().slice(0, 8);
      return t4Xml({ year, employer, transmitterNumber: settings.transmitterNumber, reportType, submissionRef, slips: r.slips, people: people as Map<string, Person>, summary: r.summary });
    });
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="T4-${year}.xml"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(out);
  }),
);

/** A Record of Employment as ROE Web XML, for uploading to ROE Web. Contains the full SIN: passkey and audit. */
payrollRouter.post(
  '/payroll/roe/:userId/xml',
  requirePermission('payroll.export'),
  h(async (req, res) => {
    const a = authOf(req);
    const userId = uuid.parse(req.params.userId);
    if (a.scope) throw forbidden('Records of Employment are for HR.');
    const b = z
      .object({
        reason: z.enum(Object.keys(ROE_REASONS) as [RoeReason, ...RoeReason[]]),
        recall: z.enum(['Y', 'N', 'U']),
        recallDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        lastDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        occupation: z.string().trim().max(40).nullable().optional(),
        comments: z.string().trim().max(160).nullable().optional(),
        vacationPay: z.number().min(0).max(1_000_000).optional(),
      })
      .refine((x) => x.recall !== 'Y' || !!x.recallDate, { message: 'Give the recall date.', path: ['recallDate'] })
      .parse(req.body);
    const out = await withTenant(a.tenantId, async (tx) => {
      const settings = await settingsOf(tx);
      requirePasskey(a, settings);
      if (!(await tx.user.findUnique({ where: { id: userId }, select: { id: true } }))) throw notFound('Person');
      const f = await roeFigures(tx, userId);
      if (!f.periods.length) throw badRequest('This person has no approved pay in the last 53 weeks.');
      const tenant = await tx.tenant.findFirstOrThrow({ select: { name: true } });
      const employer = filingEmployer(tenant.name, settings);
      const person = (await filingPeople(tx, a.tenantId, [userId])).get(userId) ?? null;
      const name = await tx.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true, hireDate: true } });
      const problems = t4Problems(employer, new Map([[userId, person]]), [{ userId, name: `${name?.firstName} ${name?.lastName}` }]);
      if (problems.length) throw new HttpError(400, 'FILING_INCOMPLETE', 'Some details are missing before this file can be made.', { problems });
      const off = await tx.offboarding.findUnique({ where: { userId } });
      const first = f.periods.at(-1)!;
      const days = Math.round((Date.parse(first.periodEnd) - Date.parse(first.periodStart)) / 86_400_000) + 1;
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.roe.xml', entity: 'User', entityId: userId, after: { reason: b.reason, recall: b.recall } });
      return roeXml({
        employer,
        person: person!,
        payrollReference: person!.employeeNumber ?? userId.slice(0, 8),
        payPeriodType: payPeriodType(Math.round(days / 7)),
        firstDay: name?.hireDate ? name.hireDate.toISOString().slice(0, 10) : f.firstDay!,
        lastDayPaid: b.lastDay ?? off?.lastDay.toISOString().slice(0, 10) ?? f.lastPaidDay!,
        finalPeriodEnd: f.periods[0]!.periodEnd,
        occupation: b.occupation ?? null,
        recall: { code: b.recall, date: b.recallDate ?? null },
        totalInsurableHours: f.totalInsurableHours,
        periods: f.periods,
        reason: b.reason,
        comments: b.comments ?? null,
        vacationPay: b.vacationPay,
      });
    });
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ROE-${userId.slice(0, 8)}.xml"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(out);
  }),
);

payrollRouter.get(
  '/payroll/roe/:userId',
  requirePermission('payroll.export'),
  h(async (req, res) => {
    const a = authOf(req);
    const userId = uuid.parse(req.params.userId);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        if (!(await tx.user.findUnique({ where: { id: userId }, select: { id: true } }))) throw notFound('Person');
        await assertUserInScope(tx, a, userId);
        return roeFigures(tx, userId);
      }),
    );
  }),
);

// ------------------------------------------------------------- Settings
const settingsView = ({ bank, ...s }: PayrollSettings) => ({ ...s, bank: linkView(bank), returnsAccount: s.returnsAccount ? `••••${s.returnsAccount.last4}` : null, twoPersonApproval: s.twoPersonApproval !== false, requirePasskey: s.requirePasskey !== false });

payrollRouter.get(
  '/payroll/settings',
  requirePermission('payroll.export'),
  h(async (req, res) => {
    const a = authOf(req);
    const out = await withTenant(a.tenantId, async (tx) => ({ settings: await settingsOf(tx), payWeekStartDay: (await tx.tenant.findFirstOrThrow({ select: { payWeekStartDay: true } })).payWeekStartDay }));
    res.json({ ...settingsView(out.settings), payWeekStartDay: out.payWeekStartDay });
  }),
);

payrollRouter.put(
  '/payroll/settings',
  requirePermission('payroll.approve'),
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    if (a.scope) throw forbidden('Payroll settings and the bank connection are for the whole organization, set by HR.');
    const b = z
      .object({
        businessNumber: z.string().trim().regex(/^\d{9}RP\d{4}$/, 'A payroll account number looks like 123456789RP0001.').nullable().optional(),
        transmitterNumber: z.string().trim().regex(/^MM\d{6}$/, 'A transmitter number looks like MM123456.').nullable().optional(),
        filingContact: z.object({ name: z.string().trim().min(2).max(60), phone: z.string().trim().regex(/^\D*(\d\D*){10}$/, 'Use a 10-digit phone number.'), email: z.string().trim().email().nullable().optional() }).nullable().optional(),
        employerMailing: z.object({ line1: z.string().trim().min(3).max(60), line2: z.string().trim().max(60).nullable().optional(), city: z.string().trim().min(2).max(40), province: z.enum(PROVINCES), postalCode: z.string().trim().regex(/^[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d$/, 'A postal code looks like A1A 1A1.') }).nullable().optional(),
        quebecSector: z.enum(['public', 'private']).nullable().optional(),
        quebecNumber: z.string().trim().regex(/^\d{10}RS\d{4}$/, 'A Revenu Québec identification number looks like 1234567890RS0001.').nullable().optional(),
        rqPreparerNumber: z.string().trim().regex(/^NP\d{6}$/, 'A preparer number looks like NP123456.').nullable().optional(),
        rqCertificationNumber: z.string().trim().regex(/^RQ-\d{2}-[0-9A-Z]{2}-[0-9A-Z]{3}$/, 'An authorization number looks like RQ-25-01-ABC.').nullable().optional(),
        rl1FirstSlip: z.number().int().min(1).max(99_999_999).nullable().optional(),
        originatorId: z.string().trim().regex(/^[A-Za-z0-9]{1,10}$/).nullable().optional(),
        originatorShortName: z.string().trim().max(15).nullable().optional(),
        originatorLongName: z.string().trim().max(30).nullable().optional(),
        destinationDataCentre: z.string().trim().regex(/^\d{5}$/).nullable().optional(),
        returnsInstitution: z.string().trim().regex(/^\d{3}$/).nullable().optional(),
        returnsTransit: z.string().trim().regex(/^\d{5}$/).nullable().optional(),
        returnsAccount: z.string().trim().regex(/^\d{5,12}$/).optional(),
        employerAddress: z.string().trim().max(200).nullable().optional(),
        twoPersonApproval: z.boolean().optional(),
        requirePasskey: z.boolean().optional(),
      })
      .parse(req.body);
    const out = await withTenant(a.tenantId, async (tx) => {
      const before = await settingsOf(tx);
      // Turning off the safeguards needs a passkey sign-in itself.
      if ((b.twoPersonApproval === false && before.twoPersonApproval !== false) || (b.requirePasskey === false && before.requirePasskey !== false)) requirePasskey(a, before);
      const { returnsAccount, ...rest } = b;
      const next: PayrollSettings = { ...before, ...Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v ?? undefined])) };
      if (returnsAccount) next.returnsAccount = await sealReturnsAccount(a.tenantId, returnsAccount);
      await tx.tenant.update({ where: { id: a.tenantId }, data: { payrollSettings: JSON.parse(JSON.stringify(next)) } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.settings', entity: 'Tenant', entityId: a.tenantId, after: { ...rest, returnsAccount: returnsAccount ? `••••${returnsAccount.slice(-4)}` : undefined } });
      return next;
    });
    res.json(settingsView(out));
  }),
);

// ------------------------------------------------------------- My pay
const statementView = (s: { id: string; payDate: Date; year: number; province: string; hours: unknown; earnings: unknown; deductions: unknown; gross: unknown; totalDeductions: unknown; net: unknown; ytd: unknown; depositLast4: string | null }) => ({
  id: s.id,
  payDate: s.payDate.toISOString().slice(0, 10),
  year: s.year,
  province: s.province,
  hours: Number(s.hours),
  earnings: s.earnings,
  deductions: s.deductions,
  gross: Number(s.gross),
  totalDeductions: Number(s.totalDeductions),
  net: Number(s.net),
  ytd: s.ytd,
  deposit: s.depositLast4 ? `••••${s.depositLast4}` : null,
});

payrollRouter.get(
  '/me/pay',
  h(async (req, res) => {
    const a = authOf(req);
    const out = await withTenant(a.tenantId, async (tx) => {
      const [statements, profile, banks, me] = await Promise.all([
        tx.payStatement.findMany({ where: { userId: a.userId, payRun: { status: { in: ['APPROVED', 'PAID'] } } }, orderBy: { payDate: 'desc' }, take: 60 }),
        tx.payProfile.findUnique({ where: { userId: a.userId } }),
        tx.bankAccount.findMany({ where: { userId: a.userId, status: { in: ['ACTIVE', 'PENDING'] } }, orderBy: { createdAt: 'desc' } }),
        tx.user.findUniqueOrThrow({ where: { id: a.userId }, select: { locale: true } }),
      ]);
      return { statements: statements.map(statementView), profile: profileView(profile), bankAccounts: banks.map(bankView), consent: CONSENT[me.locale === 'fr-CA' ? 'fr-CA' : 'en-CA'] };
    });
    res.json(out);
  }),
);

/** One pay statement with everything a statement of earnings must show. People see their own; payroll staff any. */
payrollRouter.get(
  ['/me/pay-statements/:id', '/payroll/statements/:id'],
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const out = await withTenant(a.tenantId, async (tx) => {
      const s = await tx.payStatement.findUnique({ where: { id }, include: { payRun: true } });
      const staff = req.path.startsWith('/payroll') && a.permissions.has('payroll.export');
      if (!s || (!staff && s.userId !== a.userId) || (!staff && s.payRun.status !== 'APPROVED' && s.payRun.status !== 'PAID')) throw notFound('Pay statement');
      if (staff) await assertRunInScope(tx, a, s.payRun.departmentId);
      const [u, tenant, positions] = await Promise.all([
        tx.user.findUniqueOrThrow({ where: { id: s.userId }, select: { firstName: true, lastName: true, employeeNumber: true } }),
        tx.tenant.findFirstOrThrow({ select: { name: true, payrollSettings: true } }),
        tx.position.findMany({ select: { id: true, name: true, nameFr: true } }),
      ]);
      if (staff && s.userId !== a.userId) await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.statement.view', entity: 'PayStatement', entityId: id });
      return {
        ...statementView(s),
        periodStart: s.payRun.periodStart.toISOString().slice(0, 10),
        periodEnd: s.payRun.periodEnd.toISOString().slice(0, 10),
        employee: { name: `${u.firstName} ${u.lastName}`, employeeNumber: u.employeeNumber },
        employer: { name: tenant.name, address: readSettings(tenant.payrollSettings).employerAddress ?? null },
        positions,
        status: s.payRun.status,
      };
    });
    res.json(out);
  }),
);

payrollRouter.post(
  '/me/bank-accounts',
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    const body = bankBody.parse(req.body);
    const row = await withTenant(a.tenantId, async (tx) => {
      const u = await tx.user.findUniqueOrThrow({ where: { id: a.userId }, select: { locale: true } });
      const r = await addBankAccount(tx, a.tenantId, { userId: a.userId, enteredById: a.userId, ...body, locale: u.locale === 'fr-CA' ? 'fr-CA' : 'en-CA' });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.bank.enter', entity: 'User', entityId: a.userId, after: { last4: r.last4, institution: r.institution, transit: r.transit } });
      return r;
    });
    res.status(201).json(bankView(row));
  }),
);

payrollRouter.put(
  '/me/pay-profile',
  h(async (req, res) => {
    const a = authOf(req);
    // People fill in their own TD1 claims and SIN; province and exemptions are set by payroll.
    const body = profileBody.pick({ federalClaim: true, provincialClaim: true, extraTaxPerPeriod: true, sin: true, mailingAddress: true }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const existing = await tx.payProfile.findUnique({ where: { userId: a.userId }, select: { sinLast3: true } });
      // Once on file, a SIN is changed by payroll (they check the card), not in the app.
      if (body.sin && existing?.sinLast3) throw forbidden('Your SIN is already on file. Ask payroll to change it.');
      await savePayProfile(tx, a.tenantId, a.userId, body, true);
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.td1', entity: 'User', entityId: a.userId, after: { ...body, sin: body.sin ? 'added' : undefined } });
    });
    res.json({ ok: true });
  }),
);
