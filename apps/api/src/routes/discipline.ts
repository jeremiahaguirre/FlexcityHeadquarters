/**
 * Discipline records: a supervisor issues one with its evidence; the person reads it, signs to
 * acknowledge it and can add their own response.
 */
import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { RECENT_AUTH_MS, authOf, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { sniff } from '../lib/files.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { notify } from '../services/notifications/notifier.js';
import { POINTS } from '../services/reliability/score.js';
import { LEVELS, SERIOUS_LEVELS, requiredChecks } from '../services/people/review.js';
import { h } from './context.js';
import { hrRecordsBy } from '../services/people/scope.js';
import { type SignableRecord, recordFingerprint, sha256, signatureCheck } from '../services/people/fingerprint.js';

export const disciplineRouter = Router();
const uuid = z.string().uuid();
const MAX_SIGNATURE_BYTES = 200_000;

type Row = SignableRecord & {
  signedSha256: string | null;
  signatureSha256: string | null;
  id: string;
  summary: string;
  issuedAt: Date;
  acknowledgedAt: Date | null;
  stewardPresent: boolean;
  issuedById: string;
  level: string | null;
  evidence: Prisma.JsonValue;
  employeeResponse: string | null;
  respondedAt: Date | null;
};
const view = (r: Row) => ({
  id: r.id,
  summary: r.summary,
  issuedAt: r.issuedAt,
  acknowledgedAt: r.acknowledgedAt,
  stewardPresent: r.stewardPresent,
  level: r.level,
  evidence: r.evidence,
  employeeResponse: r.employeeResponse,
  respondedAt: r.respondedAt,
  signatureCheck: signatureCheck(r),
});

disciplineRouter.get(
  '/users/:id/discipline',
  requirePermission('discipline.read'),
  h(async (req, res) => {
    const a = authOf(req);
    const userId = uuid.parse(req.params.id);
    const rows = await withTenant(a.tenantId, async (tx) => {
      // HR sees every record; other supervisors only the ones they issued.
      const by = hrRecordsBy(a);
      const list = await tx.disciplinaryRecord.findMany({ where: { userId, ...(by ? { issuedById: by } : {}) }, orderBy: { issuedAt: 'desc' } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'discipline.view', entity: 'User', entityId: userId });
      return list;
    });
    res.json(rows.map(view));
  }),
);

const recordBody = z.object({
  summary: z.string().trim().min(10).max(4000),
  stewardPresent: z.boolean().default(false),
  level: z.enum(LEVELS as [string, ...string[]]).nullable().default(null),
  /** Facts relied on, by id; their details are copied onto the record as they are now. */
  evidence: z.object({ events: z.array(uuid).max(50).default([]), notes: z.array(uuid).max(50).default([]) }).prefault({}),
  fairProcess: z.record(z.string(), z.boolean()).default({}),
});

disciplineRouter.post(
  '/users/:id/discipline',
  requirePermission('discipline.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const userId = uuid.parse(req.params.id);
    if (userId === a.userId) throw forbidden('You cannot write a record about yourself.');
    const body = recordBody.parse(req.body);
    const level = body.level as (typeof LEVELS)[number] | null;
    if (level && SERIOUS_LEVELS.has(level)) {
      // Suspensions and terminations: HR only, after a fresh sign-in.
      if (!a.permissions.has('users.write')) throw forbidden('Only HR can record a suspension or termination.');
      const at = req.auth?.authenticatedAt;
      if (!at || Date.now() - at.getTime() > RECENT_AUTH_MS) throw new HttpError(401, 'STEP_UP_REQUIRED', 'Confirm it’s you to continue.');
    }
    const rec = await withTenant(a.tenantId, async (tx) => {
      const subject = await tx.user.findUnique({ where: { id: userId } });
      if (!subject || subject.anonymizedAt) throw notFound('Staff member');
      const missing = requiredChecks(level, subject.unionMember).filter((c) => body.fairProcess[c] !== true);
      if (missing.length) throw badRequest('Confirm each fair-process step before saving.', { missing });
      if (level && SERIOUS_LEVELS.has(level) && body.evidence.events.length + body.evidence.notes.length === 0) {
        throw badRequest('Attach the facts this decision relies on.');
      }

      const [events, notes] = await Promise.all([
        body.evidence.events.length ? tx.reliabilityEvent.findMany({ where: { id: { in: body.evidence.events }, userId } }) : [],
        body.evidence.notes.length ? tx.conductNote.findMany({ where: { id: { in: body.evidence.notes }, userId } }) : [],
      ]);
      if (events.length !== body.evidence.events.length || notes.length !== body.evidence.notes.length) throw badRequest('Some facts belong to someone else or no longer exist.');
      if (notes.some((n) => n.retractedAt) || events.some((e) => e.excludedReason)) throw badRequest('Excused events and retracted notes cannot be relied on.');
      const evidence = [
        ...events.map((e) => ({ kind: 'EVENT', id: e.id, type: e.type, points: POINTS[e.type], occurredAt: e.occurredAt.toISOString(), note: e.note })),
        ...notes.map((n) => ({ kind: 'NOTE', id: n.id, category: n.category, occurredAt: n.occurredAt.toISOString(), summary: n.summary, incidentId: n.incidentId })),
      ].sort((x, y) => x.occurredAt.localeCompare(y.occurredAt));
      const now = new Date().toISOString();
      const fairProcess = Object.fromEntries(Object.entries(body.fairProcess).filter(([, v]) => v).map(([k]) => [k, now]));

      const r = await tx.disciplinaryRecord.create({
        data: {
          tenantId: a.tenantId,
          userId,
          issuedById: a.userId,
          issuedAt: new Date(),
          summary: body.summary,
          stewardPresent: body.stewardPresent,
          level,
          evidence: evidence as Prisma.InputJsonValue,
          fairProcess: Object.keys(fairProcess).length ? (fairProcess as Prisma.InputJsonValue) : undefined,
        },
      });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'discipline.create', entity: 'DisciplinaryRecord', entityId: r.id, after: { level, evidence: evidence.length, fairProcess: Object.keys(fairProcess) } });
      await notify(tx, a.tenantId, [{ userId, type: 'discipline_issued', link: '/profile' }]);
      return r;
    });
    res.status(201).json(view(rec));
  }),
);

disciplineRouter.get(
  '/me/discipline',
  h(async (req, res) => {
    const a = authOf(req);
    const rows = await withTenant(a.tenantId, (tx) => tx.disciplinaryRecord.findMany({ where: { userId: a.userId }, orderBy: { issuedAt: 'desc' } }));
    res.json(rows.map(view));
  }),
);

/** The staff member signs to confirm they received the record (not that they agree). */
disciplineRouter.post(
  '/me/discipline/:id/acknowledge',
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const { signature } = z.object({ signature: z.string().startsWith('data:image/png;base64,').max(300_000) }).parse(req.body);
    const png = Buffer.from(signature.slice('data:image/png;base64,'.length), 'base64');
    if (png.length > MAX_SIGNATURE_BYTES || sniff(png) !== 'image/png') throw badRequest('The signature image could not be read. Sign again.');
    await withTenant(a.tenantId, async (tx) => {
      const r = await tx.disciplinaryRecord.findUnique({ where: { id } });
      if (!r || r.userId !== a.userId) throw notFound('Record');
      if (r.acknowledgedAt) throw conflict('ALREADY_ACKNOWLEDGED', 'You already signed this record.');
      // Fingerprint exactly what was signed, so it can be shown later to be unchanged.
      const signedSha256 = recordFingerprint(r);
      const signatureSha256 = sha256(png);
      await tx.disciplinaryRecord.update({ where: { id }, data: { acknowledgementSignature: png, acknowledgedAt: new Date(), signedSha256, signatureSha256 } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'discipline.acknowledge', entity: 'DisciplinaryRecord', entityId: id, after: { signedSha256, signatureSha256 } });
    });
    res.json({ ok: true });
  }),
);

/** The staff member's own account, kept with the record. Written once; HR and supervisors are told. */
disciplineRouter.post(
  '/me/discipline/:id/response',
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const { response } = z.object({ response: z.string().trim().min(3).max(4000) }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const r = await tx.disciplinaryRecord.findUnique({ where: { id } });
      if (!r || r.userId !== a.userId) throw notFound('Record');
      if (r.employeeResponse) throw conflict('ALREADY_RESPONDED', 'You already added your response.');
      await tx.disciplinaryRecord.update({ where: { id }, data: { employeeResponse: response, respondedAt: new Date() } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'discipline.respond', entity: 'DisciplinaryRecord', entityId: id });
      await notify(tx, a.tenantId, [{ userId: r.issuedById, type: 'discipline_response', link: `/manage/staff/person?id=${a.userId}` }]);
    });
    res.json({ ok: true });
  }),
);
