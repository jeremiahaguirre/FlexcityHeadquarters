/** Payroll in the app, or with ADP, Dayforce or Wagepoint over their API: connect, test, send a period. */
import { createHash } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { type AuthContext, authOf, requirePermission, requireRecentAuth } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { HttpError, forbidden } from '../lib/errors.js';
import { addDays } from '../lib/time.js';
import { type PayrollSettings, readSettings } from '../services/payroll/payRuns.js';
import { runPayroll } from '../services/payroll/payrollRun.js';
import { DEFAULTS, PROVIDERS, type Provider, type ProviderSettings, checkProviderUrl, providerView, sealSecret, sendPeriod, testConnection } from '../services/payroll/providers.js';
import { h } from './context.js';

export const payrollProviderRouter = Router();
type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];
const settingsOf = async (tx: Tx) => readSettings((await tx.tenant.findFirstOrThrow({ select: { payrollSettings: true } })).payrollSettings);
const save = (tx: Tx, tenantId: string, s: PayrollSettings) => tx.tenant.update({ where: { id: tenantId }, data: { payrollSettings: JSON.parse(JSON.stringify(s)) } });
const wholeCity = (a: AuthContext) => {
  if (a.scope) throw forbidden('The payroll provider is set for the whole organization, by HR.');
};
const passkey = (a: AuthContext, s: PayrollSettings) => {
  if (s.requirePasskey !== false && !a.mfa) throw new HttpError(403, 'PASSKEY_REQUIRED', 'Sign in with your passkey to change how pay is sent.');
};
const providerParam = z.enum(PROVIDERS);

payrollProviderRouter.get(
  '/payroll/provider',
  requirePermission('payroll.export'),
  h(async (req, res) => {
    const a = authOf(req);
    wholeCity(a);
    const out = await withTenant(a.tenantId, async (tx) => ({
      settings: await settingsOf(tx),
      history: await tx.payrollSync.findMany({ orderBy: { createdAt: 'desc' }, take: 30 }),
    }));
    res.json({
      ...providerView(out.settings.payrollProvider),
      history: out.history.map((x) => ({ ...x, periodStart: x.periodStart.toISOString().slice(0, 10), periodEnd: x.periodEnd.toISOString().slice(0, 10) })),
    });
  }),
);

payrollProviderRouter.put(
  '/payroll/provider/mode',
  requirePermission('payroll.approve'),
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    wholeCity(a);
    const { mode } = z.object({ mode: z.enum(['in_app', ...PROVIDERS]) }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const s = await settingsOf(tx);
      passkey(a, s);
      const p: ProviderSettings = s.payrollProvider ?? { mode: 'in_app' };
      if (mode !== 'in_app' && !p[mode]) throw new HttpError(400, 'PROVIDER_NOT_SET', 'Connect that provider first.');
      await save(tx, a.tenantId, { ...s, payrollProvider: { ...p, mode } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.provider.mode', entity: 'Tenant', entityId: a.tenantId, before: { mode: p.mode }, after: { mode } });
    });
    res.json({ mode });
  }),
);

const secret = (min: number) => z.string().trim().min(min).max(10_000);
const bodies = {
  adp: z.object({ tokenUrl: z.string().default(DEFAULTS.adp.tokenUrl), importUrl: z.string().default(DEFAULTS.adp.importUrl), clientId: z.string().trim().min(4).max(120), clientSecret: secret(8).optional(), certificate: z.string().trim().regex(/-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/, 'Paste the certificate ADP issued, in PEM format.').optional(), privateKey: z.string().trim().regex(/-----BEGIN (RSA |EC )?PRIVATE KEY-----[\s\S]+-----END (RSA |EC )?PRIVATE KEY-----/, 'Paste the certificate’s private key, in PEM format.').optional(), companyCode: z.string().trim().regex(/^[A-Za-z0-9]{3}$/, 'ADP company codes are three letters or numbers.'), batchId: z.string().trim().max(10).nullable().optional() }),
  dayforce: z.object({ tokenUrl: z.string().default(DEFAULTS.dayforce.tokenUrl), importUrl: z.string().default(DEFAULTS.dayforce.importUrl), clientId: z.string().trim().min(4).max(120), clientSecret: secret(8).optional(), clientNamespace: z.string().trim().regex(/^[A-Za-z0-9_-]{2,40}$/, 'The client namespace is the name in your Dayforce address.') }),
  wagepoint: z.object({ importUrl: z.string().default(DEFAULTS.wagepoint.importUrl), apiKey: secret(16).optional(), companyId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,40}$/) }),
};

/** Saves a provider's connection. Secrets are sealed; leave one out to keep the saved one. */
payrollProviderRouter.put(
  '/payroll/provider/:provider',
  requirePermission('payroll.approve'),
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    wholeCity(a);
    const provider = providerParam.parse(req.params.provider);
    const out = await withTenant(a.tenantId, async (tx) => {
      const s = await settingsOf(tx);
      passkey(a, s);
      const p: ProviderSettings = s.payrollProvider ?? { mode: 'in_app' };
      const missing = (what: string) => new HttpError(400, 'PROVIDER_SECRET_MISSING', `Add the ${what}.`);
      if (provider === 'adp') {
        const b = bodies.adp.parse(req.body);
        const was = p.adp;
        p.adp = {
          tokenUrl: checkProviderUrl('adp', b.tokenUrl),
          importUrl: checkProviderUrl('adp', b.importUrl),
          clientId: b.clientId,
          companyCode: b.companyCode.toUpperCase(),
          batchId: b.batchId === undefined ? (was?.batchId ?? null) : b.batchId,
          clientSecret: b.clientSecret ? await sealSecret(a.tenantId, 'adp', b.clientSecret) : (was?.clientSecret ?? (() => { throw missing('client secret'); })()),
          certificate: b.certificate ?? was?.certificate ?? (() => { throw missing('certificate'); })(),
          privateKey: b.privateKey ? await sealSecret(a.tenantId, 'adp', b.privateKey) : (was?.privateKey ?? (() => { throw missing('private key'); })()),
        };
      } else if (provider === 'dayforce') {
        const b = bodies.dayforce.parse(req.body);
        const was = p.dayforce;
        p.dayforce = {
          tokenUrl: checkProviderUrl('dayforce', b.tokenUrl),
          importUrl: checkProviderUrl('dayforce', b.importUrl.replace('{namespace}', 'namespace')).replace('namespace', '{namespace}'),
          clientId: b.clientId,
          clientNamespace: b.clientNamespace,
          clientSecret: b.clientSecret ? await sealSecret(a.tenantId, 'dayforce', b.clientSecret) : (was?.clientSecret ?? (() => { throw missing('client secret'); })()),
        };
      } else {
        const b = bodies.wagepoint.parse(req.body);
        const was = p.wagepoint;
        p.wagepoint = {
          importUrl: checkProviderUrl('wagepoint', b.importUrl.replace('{company}', 'company')).replace('company', '{company}'),
          companyId: b.companyId,
          apiKey: b.apiKey ? await sealSecret(a.tenantId, 'wagepoint', b.apiKey) : (was?.apiKey ?? (() => { throw missing('API key'); })()),
        };
      }
      // A changed connection needs a new test.
      p.tested = { ...p.tested, [provider]: undefined };
      await save(tx, a.tenantId, { ...s, payrollProvider: p });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.provider.connect', entity: 'Tenant', entityId: a.tenantId, after: { provider } });
      return p;
    });
    res.json(providerView(out));
  }),
);

payrollProviderRouter.delete(
  '/payroll/provider/:provider',
  requirePermission('payroll.approve'),
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    wholeCity(a);
    const provider = providerParam.parse(req.params.provider);
    const out = await withTenant(a.tenantId, async (tx) => {
      const s = await settingsOf(tx);
      passkey(a, s);
      const p: ProviderSettings = { ...(s.payrollProvider ?? { mode: 'in_app' }) };
      delete p[provider];
      if (p.mode === provider) p.mode = 'in_app';
      p.tested = { ...p.tested, [provider]: undefined };
      await save(tx, a.tenantId, { ...s, payrollProvider: p });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.provider.disconnect', entity: 'Tenant', entityId: a.tenantId, after: { provider } });
      return p;
    });
    res.json(providerView(out));
  }),
);

payrollProviderRouter.post(
  '/payroll/provider/:provider/test',
  requirePermission('payroll.approve'),
  h(async (req, res) => {
    const a = authOf(req);
    wholeCity(a);
    const provider = providerParam.parse(req.params.provider);
    const s = await withTenant(a.tenantId, settingsOf);
    await testConnection(a.tenantId, provider, s.payrollProvider ?? { mode: 'in_app' });
    const at = new Date().toISOString();
    await withTenant(a.tenantId, async (tx) => {
      const now = await settingsOf(tx);
      const p = now.payrollProvider ?? { mode: 'in_app' as const };
      await save(tx, a.tenantId, { ...now, payrollProvider: { ...p, tested: { ...p.tested, [provider]: at } } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'payroll.provider.test', entity: 'Tenant', entityId: a.tenantId, after: { provider } });
    });
    res.json({ ok: true, testedAt: at });
  }),
);

/** Builds the period's approved hours in the provider's layout and sends them. */
payrollProviderRouter.post(
  '/payroll/provider/:provider/send',
  requirePermission('payroll.export'),
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    wholeCity(a);
    const provider: Provider = providerParam.parse(req.params.provider);
    const b = z.object({ periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), weeks: z.number().int().min(1).max(5), resend: z.boolean().default(false) }).parse(req.body);
    const periodEnd = addDays(b.periodStart, b.weeks * 7 - 1);
    const built = await withTenant(a.tenantId, async (tx) => {
      const s = await settingsOf(tx);
      passkey(a, s);
      const p = s.payrollProvider ?? { mode: 'in_app' as const };
      if (!p[provider]) throw new HttpError(400, 'PROVIDER_NOT_SET', 'Connect that provider first.');
      if (p.mode !== provider) throw new HttpError(409, 'PROVIDER_NOT_IN_USE', `Payroll doesn’t run with ${provider} for this organization: choose it first, so the same hours aren’t also paid in the app.`);
      // The same period once, unless someone deliberately sends it again (the provider rejected it, or it was corrected).
      if (!b.resend && (await tx.payrollSync.findFirst({ where: { provider, periodStart: new Date(`${b.periodStart}T00:00:00Z`), status: 'SENT' } }))) {
        throw new HttpError(409, 'ALREADY_SENT', 'This period was already sent to the provider. Sending it again could pay people twice; confirm to send it again.');
      }
      const options = provider === 'adp' ? { format: 'adp' as const, adpCompanyCode: p.adp!.companyCode, adpBatchId: p.adp!.batchId ?? null } : { format: provider };
      return { settings: p, run: await runPayroll(tx, a.tenantId, b.periodStart, b.weeks, null, null, options) };
    });
    if (!built.run.csv.ok) {
      res.status(422).json({ code: 'EXPORT_INVALID', problems: built.run.csv.problems, warnings: built.run.warnings });
      return;
    }
    const csv = built.run.csv.csv;
    const fileSha256 = createHash('sha256').update(csv).digest('hex');
    const name = `payroll-${provider}-${b.periodStart}.csv`;
    let outcome: { status: 'SENT' | 'FAILED'; httpStatus: number | null; reference: string | null; message: string | null };
    try {
      const r = await sendPeriod(a.tenantId, provider, built.settings, { csv, name, periodStart: b.periodStart, periodEnd });
      outcome = { status: 'SENT', httpStatus: r.status, reference: r.reference, message: null };
    } catch (e) {
      const err = e instanceof HttpError ? e : new HttpError(502, 'PROVIDER_DOWN', e instanceof Error ? e.message : 'The provider couldn’t be reached.');
      outcome = { status: 'FAILED', httpStatus: (err.details as { status?: number } | undefined)?.status ?? null, reference: null, message: err.message.slice(0, 500) };
    }
    const row = await withTenant(a.tenantId, async (tx) => {
      const r = await tx.payrollSync.create({ data: { tenantId: a.tenantId, provider, periodStart: new Date(`${b.periodStart}T00:00:00Z`), periodEnd: new Date(`${periodEnd}T00:00:00Z`), rows: built.run.csv.ok ? built.run.csv.rowCount : 0, fileSha256, sentById: a.userId, ...outcome } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: `payroll.provider.send`, entity: 'PayrollSync', entityId: r.id, after: { provider, periodStart: b.periodStart, status: outcome.status, rows: r.rows } });
      return r;
    });
    if (outcome.status === 'FAILED') {
      res.status(502).json({ code: 'PROVIDER_SEND_FAILED', message: outcome.message, sync: { id: row.id }, warnings: built.run.warnings });
      return;
    }
    res.status(201).json({ id: row.id, rows: row.rows, reference: row.reference, fileSha256, warnings: built.run.warnings });
  }),
);
