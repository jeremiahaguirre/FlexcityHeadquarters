/** FH Dev console: every organization's signed agreements, as evidence. */
import { Router } from 'express';
import { z } from 'zod';
import { platformOf } from '../../auth/platform.js';
import { db, withTenant } from '../../lib/db.js';
import { notFound } from '../../lib/errors.js';
import { csvCell } from '../../services/payroll/export.js';
import { CONSENT_VERSION } from '../../services/privacy/consent.js';
import { consentCertificate } from '../../services/privacy/consentCertificate.js';
import { h } from '../context.js';

export const consentsRouter = Router();
const uuid = z.string().uuid();
const audit = (adminId: string, tenantId: string, action: string, detail?: object) =>
  db().platformAudit.create({ data: { adminId, tenantId, action, detail: detail ? JSON.parse(JSON.stringify(detail)) : undefined } });

async function rows(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const list = await tx.consentRecord.findMany({ orderBy: { signedAt: 'desc' }, take: 5000, select: { id: true, userId: true, version: true, locale: true, signedName: true, signedAt: true, choices: true, textSha256: true, ipAddress: true } });
    const people = await tx.user.findMany({ where: { id: { in: [...new Set(list.map((r) => r.userId))] } }, select: { id: true, firstName: true, lastName: true, email: true } });
    const staff = await tx.user.count({ where: { status: 'ACTIVE' } });
    const signedCurrent = new Set(list.filter((r) => r.version === CONSENT_VERSION).map((r) => r.userId)).size;
    return {
      currentVersion: CONSENT_VERSION,
      activeStaff: staff,
      signedCurrent,
      records: list.map((r) => {
        const u = people.find((p) => p.id === r.userId);
        return { ...r, person: u ? `${u.firstName} ${u.lastName}` : '—', email: u?.email ?? null };
      }),
    };
  });
}

consentsRouter.get(
  '/tenants/:id/consents',
  h(async (req, res) => {
    const p = platformOf(req);
    const tenantId = uuid.parse(req.params.id);
    const out = await rows(tenantId);
    await audit(p.adminId, tenantId, 'consent.list', { rows: out.records.length });
    res.json(out);
  }),
);

consentsRouter.get(
  '/tenants/:id/consents.csv',
  h(async (req, res) => {
    const p = platformOf(req);
    const tenantId = uuid.parse(req.params.id);
    const r = await rows(tenantId);
    await audit(p.adminId, tenantId, 'consent.export', { rows: r.records.length });
    const head = ['Signed at (UTC)', 'Person', 'Email', 'Name typed', 'Version', 'Language', 'Notifications', 'Location', 'Text SHA-256', 'Device address', 'Record'];
    const body = r.records.map((x) => {
      const c = x.choices as Record<string, string>;
      return [x.signedAt.toISOString(), x.person, x.email ?? '', x.signedName, x.version, x.locale, c.notifications ?? '', c.location ?? '', x.textSha256, x.ipAddress ?? '', x.id];
    });
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="consents-${tenantId.slice(0, 8)}.csv"`);
    res.setHeader('cache-control', 'no-store');
    res.send(`﻿${[head, ...body].map((l) => l.map((v) => csvCell(String(v))).join(',')).join('\r\n')}\r\n`);
  }),
);

consentsRouter.get(
  '/tenants/:id/consents/:recordId/certificate',
  h(async (req, res) => {
    const p = platformOf(req);
    const tenantId = uuid.parse(req.params.id);
    const id = uuid.parse(req.params.recordId);
    const out = await withTenant(tenantId, async (tx) => {
      const r = await tx.consentRecord.findUnique({ where: { id } });
      if (!r) throw notFound('Signed agreement');
      const [u, t] = await Promise.all([
        tx.user.findUnique({ where: { id: r.userId }, select: { firstName: true, lastName: true, email: true } }),
        tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } }),
      ]);
      return { r, who: { name: u ? `${u.firstName} ${u.lastName}` : r.signedName, email: u?.email ?? null, organization: t.name } };
    });
    await audit(p.adminId, tenantId, 'consent.certificate', { record: id });
    const pdf = await consentCertificate(out.r, out.who);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="agreement-${id.slice(0, 8)}.pdf"`);
    res.setHeader('cache-control', 'no-store');
    res.send(pdf);
  }),
);
