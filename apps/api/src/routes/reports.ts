/** Reports: run, download as CSV, save, and have emailed weekly or monthly (services/reports). */
import { Router } from 'express';
import { z } from 'zod';
import { authOf } from '../auth/middleware.js';
import { audit, replica, withTenant } from '../lib/db.js';
import { forbidden, notFound } from '../lib/errors.js';
import { REPORTS, REPORT_KEYS, canRun, runReport, toCsv } from '../services/reports/catalog.js';
import { h } from './context.js';

export const reportsRouter = Router();
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const params = z.object({ key: z.enum(REPORT_KEYS as [string, ...string[]]), from: isoDate.optional(), to: isoDate.optional(), days: z.coerce.number().int().min(1).max(366).default(60) });
const window = (p: z.infer<typeof params>) => ({ from: p.from ?? iso(new Date(Date.now() - 30 * 86_400_000)), to: p.to ?? iso(new Date()), days: p.days });

/** The reports this person may run. */
reportsRouter.get(
  '/reports',
  h(async (req, res) => {
    const a = authOf(req);
    res.json(REPORT_KEYS.filter((k) => canRun(a, k)).map((k) => ({ key: k, kind: REPORTS[k]!.kind })));
  }),
);

reportsRouter.get(
  '/reports/run',
  h(async (req, res) => {
    const a = authOf(req);
    const p = params.parse(req.query);
    const w = window(p);
    if (w.from > w.to) throw forbidden('The start date is after the end date.');
    // Reports read from the replica when there is one (they can be a few seconds behind).
    res.json({ ...w, ...(await withTenant(a.tenantId, (tx) => runReport(tx, a, p.key, w), { readOnly: true, prisma: replica() })) });
  }),
);

/** CSV with the column names in the reader's language (sent by the app as `labels`). */
reportsRouter.get(
  '/reports/run.csv',
  h(async (req, res) => {
    const a = authOf(req);
    const p = params.parse(req.query);
    const labels = z.record(z.string(), z.string().max(80)).catch({}).parse(JSON.parse(String(req.query.labels ?? '{}')));
    const w = window(p);
    // Read from the replica, then record the export on the primary.
    const out = await withTenant(a.tenantId, (tx) => runReport(tx, a, p.key, w), { readOnly: true, prisma: replica() });
    await withTenant(a.tenantId, (tx) => audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'report.export', entity: 'Tenant', entityId: a.tenantId, after: { key: p.key, ...w, rows: out.rows.length } }));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${p.key}-${w.from}-${w.to}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(`﻿${toCsv(out, labels)}`);
  }),
);

reportsRouter.get(
  '/reports/saved',
  h(async (req, res) => {
    const a = authOf(req);
    const rows = await withTenant(a.tenantId, (tx) => tx.savedReport.findMany({ where: { ownerId: a.userId }, orderBy: { createdAt: 'asc' } }));
    res.json(rows.filter((r) => canRun(a, r.reportKey)).map((r) => ({ id: r.id, name: r.name, key: r.reportKey, params: r.params, schedule: r.schedule, lastSentAt: r.lastSentAt })));
  }),
);

reportsRouter.post(
  '/reports/saved',
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ name: z.string().trim().min(2).max(80), key: z.enum(REPORT_KEYS as [string, ...string[]]), days: z.number().int().min(1).max(366).optional(), schedule: z.enum(['NONE', 'WEEKLY', 'MONTHLY']) }).parse(req.body);
    if (!canRun(a, b.key)) throw forbidden('This report isn’t open to you.');
    const r = await withTenant(a.tenantId, async (tx) => {
      if ((await tx.savedReport.count({ where: { ownerId: a.userId } })) >= 30) throw forbidden('You can keep up to 30 saved reports.');
      return tx.savedReport.create({ data: { tenantId: a.tenantId, ownerId: a.userId, name: b.name, reportKey: b.key, params: b.days ? { days: b.days } : {}, schedule: b.schedule } });
    });
    res.status(201).json({ id: r.id });
  }),
);

reportsRouter.patch(
  '/reports/saved/:id',
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const b = z.object({ schedule: z.enum(['NONE', 'WEEKLY', 'MONTHLY']) }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const done = await tx.savedReport.updateMany({ where: { id, ownerId: a.userId }, data: { schedule: b.schedule } });
      if (!done.count) throw notFound('Saved report');
    });
    res.json({ ok: true });
  }),
);

reportsRouter.delete(
  '/reports/saved/:id',
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    await withTenant(a.tenantId, async (tx) => {
      const done = await tx.savedReport.deleteMany({ where: { id, ownerId: a.userId } });
      if (!done.count) throw notFound('Saved report');
    });
    res.status(204).end();
  }),
);
