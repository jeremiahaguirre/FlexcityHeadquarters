/**
 * The organization's full data export, for its administrators (tenant.configure).
 * Needs a recent sign-in, is never open to FH support visits, and is audited.
 * After offboarding it's the one thing the administrators can still reach.
 */
import { Router } from 'express';
import { authOf, requirePermission, requireRecentAuth } from '../auth/middleware.js';
import { withTenant } from '../lib/db.js';
import { forbidden } from '../lib/errors.js';
import { exportSummary, recordExport, writeCityExport } from '../services/platform/cityExport.js';
import { h } from './context.js';

export const dataExportRouter = Router();

dataExportRouter.get(
  '/data-export',
  requirePermission('tenant.configure'),
  h(async (req, res) => {
    const a = authOf(req);
    if (a.support) throw forbidden('The data export is only for the organization’s own administrators.');
    const [summary, t] = await Promise.all([exportSummary(a.tenantId), withTenant(a.tenantId, (tx) => tx.tenant.findFirstOrThrow({ select: { disabledAt: true, exportUntil: true, deleteAfter: true } }))]);
    const last = await withTenant(a.tenantId, (tx) => tx.auditLog.findFirst({ where: { action: 'data.export' }, orderBy: { at: 'desc' } }));
    res.json({ ...summary, closed: !!t.disabledAt, exportUntil: t.exportUntil, deleteAfter: t.deleteAfter?.toISOString().slice(0, 10) ?? null, lastExport: last ? { at: last.at, by: last.actorId } : null });
  }),
);

dataExportRouter.get(
  '/data-export/download',
  requirePermission('tenant.configure'),
  requireRecentAuth,
  h(async (req, res) => {
    const a = authOf(req);
    if (a.support) throw forbidden('The data export is only for the organization’s own administrators.');
    const [me, t] = await withTenant(a.tenantId, (tx) => Promise.all([tx.user.findUniqueOrThrow({ where: { id: a.userId }, select: { firstName: true, lastName: true } }), tx.tenant.findFirstOrThrow({ select: { subdomain: true } })]));
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${t.subdomain}-data-${new Date().toISOString().slice(0, 10)}.zip"`);
    res.setHeader('Cache-Control', 'no-store');
    // Recorded before the first byte leaves, with how much is going.
    const summary = await exportSummary(a.tenantId);
    await recordExport(a.tenantId, a.userId, { tables: summary.tables.length, rows: summary.tables.reduce((n, x) => n + x.rows, 0), files: summary.files });
    await writeCityExport(a.tenantId, { userId: a.userId, name: `${me.firstName} ${me.lastName}` }, (chunk, final) => {
      res.write(Buffer.from(chunk));
      if (final) res.end();
    });
  }),
);
