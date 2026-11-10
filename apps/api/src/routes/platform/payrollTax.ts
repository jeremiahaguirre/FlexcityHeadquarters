/**
 * Dev console: the CRA and provincial payroll tables every city's pay runs use.
 * A table only counts once an FH staff member has checked it against CRA's T4127
 * for that year; editing it clears that check.
 */
import { Router } from 'express';
import { z } from 'zod';
import { platformOf, requirePlatformStepUp } from '../../auth/platform.js';
import { db } from '../../lib/db.js';
import { notFound } from '../../lib/errors.js';
import { ensureTaxTables } from '../../services/payroll/taxTables.js';
import { h } from '../context.js';

export const payrollTaxRouter = Router();

const money = z.number().min(0).max(10_000_000);
const rate = z.number().min(0).max(1);
const brackets = z.array(z.object({ upTo: money.nullable(), rate })).min(1).max(20).refine((b) => b.at(-1)!.upTo === null, 'The last bracket has no upper limit.');
const federal = z.object({
  cpp: z.object({ rate, basicExemption: money, ympe: money, baseRate: rate }),
  cpp2: z.object({ rate, yampe: money }),
  ei: z.object({ rate, maxInsurable: money, employerMultiplier: z.number().min(1).max(3) }),
  brackets,
  basicPersonal: z.object({ max: money, min: money, phaseOutFrom: money, phaseOutTo: money }),
  cea: money,
});
const provincial = z.object({
  brackets,
  basicPersonal: money,
  surtax: z.array(z.object({ threshold: money, rate })).max(5).optional(),
  healthPremium: z.array(z.object({ over: money, base: money, rate, max: money })).max(10).optional(),
  reduction: z.object({ amount: money, rate, threshold: money }).optional(),
});
const JURISDICTIONS = ['CA', 'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'SK', 'YT'] as const;
const year = z.coerce.number().int().min(2020).max(2100);

payrollTaxRouter.get(
  '/payroll-tax',
  h(async (req, res) => {
    platformOf(req);
    const y = year.parse(req.query.year ?? new Date().getFullYear());
    await ensureTaxTables(db(), y);
    res.json({ year: y, jurisdictions: JURISDICTIONS, tables: await db().payrollTaxTable.findMany({ where: { year: y }, orderBy: { jurisdiction: 'asc' } }) });
  }),
);

payrollTaxRouter.put(
  '/payroll-tax/:year/:jurisdiction',
  h(async (req, res) => {
    const p = platformOf(req);
    const y = year.parse(req.params.year);
    const j = z.enum(JURISDICTIONS).parse(req.params.jurisdiction);
    const body = z.object({ data: z.unknown(), note: z.string().max(500).nullable().optional() }).parse(req.body);
    const data = (j === 'CA' ? federal : provincial).parse(body.data);
    // Any change needs a fresh check against CRA's tables.
    const row = await db().payrollTaxTable.upsert({
      where: { year_jurisdiction: { year: y, jurisdiction: j } },
      update: { data, note: body.note ?? null, verifiedAt: null, verifiedBy: null },
      create: { year: y, jurisdiction: j, data, note: body.note ?? null },
    });
    await db().platformAudit.create({ data: { adminId: p.adminId, action: 'payroll_tax.update', detail: { year: y, jurisdiction: j } } });
    res.json(row);
  }),
);

payrollTaxRouter.post(
  '/payroll-tax/:year/:jurisdiction/verify',
  requirePlatformStepUp,
  h(async (req, res) => {
    const p = platformOf(req);
    const y = year.parse(req.params.year);
    const j = z.enum(JURISDICTIONS).parse(req.params.jurisdiction);
    const body = z.object({ attest: z.literal(true), source: z.string().trim().min(5).max(300) }).parse(req.body);
    const row = await db().payrollTaxTable.findUnique({ where: { year_jurisdiction: { year: y, jurisdiction: j } } });
    if (!row) throw notFound('Payroll table');
    const out = await db().payrollTaxTable.update({ where: { id: row.id }, data: { verifiedAt: new Date(), verifiedBy: `${p.name} <${p.email}>`, note: `Checked against: ${body.source}` } });
    await db().platformAudit.create({ data: { adminId: p.adminId, action: 'payroll_tax.verify', detail: { year: y, jurisdiction: j, source: body.source } } });
    res.json(out);
  }),
);
