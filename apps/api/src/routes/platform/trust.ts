/**
 * Dev console › Trust: FH's own security and compliance program. Dev console only; nothing here
 * is public or reachable from a city's app.
 *
 * Permissions: "trust.read" to see it, "trust.manage" to change it (PlatformAdmin.permissions).
 * Every change is written to PlatformAudit (action "trust.*"). Exports (the auditor bundle, the
 * posture summary) and opening an evidence file need a passkey step-up from the last 10 minutes.
 */
import { createHash, randomUUID } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { platformOf, requirePlatformStepUp } from '../../auth/platform.js';
import { config } from '../../config.js';
import { db } from '../../lib/db.js';
import { badRequest, forbidden, HttpError, notFound } from '../../lib/errors.js';
import { open, seal } from '../../services/crypto/envelope.js';
import { auditorBundle, postureSummary, postureSummaryCsv, postureSummaryPdf } from '../../services/trust/exports.js';
import { CONTROLS, FRAMEWORKS, FRAMEWORK_KEYS, LIBRARY_VERSION, controlByKey, type FrameworkKey } from '../../services/trust/library.js';
import { MONITORS, monitorByKey, runMonitors } from '../../services/trust/monitors.js';
import { controlStatuses, defaultScope, kpis, parseScope, policyAckProgress, settings, snapshot, trend, vendorDistribution } from '../../services/trust/posture.js';
import { APPETITE_RANGE, VENDOR_QUESTIONS, addMonths, frameworkReadiness, nextDue, postureScore, riskLevel, riskScore, vendorRisk, vendorScore, type VendorAnswer } from '../../services/trust/scoring.js';
import { ensureTrustSeeded } from '../../services/trust/seed.js';
import { sniff } from '../documents.js';
import { h, keys } from '../context.js';

export const trustRouter = Router();
const DAY = 86_400_000;
const uuid = z.string().uuid();
const MAX_BYTES = 10 * 1024 * 1024;

/** The admin holds `perm` ("trust.manage" implies "trust.read"). */
export const requireTrust = (perm: 'trust.read' | 'trust.manage') => (req: Request, _res: Response, next: NextFunction) => {
  const p = req.platform;
  if (!p) return next(new HttpError(401, 'UNAUTHENTICATED', 'Sign in to the Dev console'));
  const ok = p.permissions.includes(perm) || (perm === 'trust.read' && p.permissions.includes('trust.manage'));
  next(ok ? undefined : forbidden('You don’t have access to Trust.'));
};
const read = requireTrust('trust.read');
const manage = requireTrust('trust.manage');
/** The two guards, exported so a test can check every Trust route carries one of them. */
export const trustGuards = { read, manage };

const audit = (adminId: string, action: string, detail?: object) => db().platformAudit.create({ data: { adminId, action: `trust.${action}`, detail: detail ? JSON.parse(JSON.stringify(detail)) : undefined } });

let seeded: Promise<void> | null = null;
/** Starter content on first use (idempotent; also run by the worker). */
trustRouter.use('/trust', (_req, _res, next) => {
  seeded ??= ensureTrustSeeded(db()).catch((e) => {
    seeded = null;
    throw e;
  });
  seeded.then(() => next(), next);
});

const optDate = z.union([z.string().datetime({ offset: true }), z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()]).optional().transform((v) => (v === undefined ? undefined : v === null ? null : new Date(v.length === 10 ? `${v}T12:00:00Z` : v)));
const ownerId = uuid.nullable().optional();
const controlKeys = z.array(z.string().max(12)).max(40).optional().transform((v) => v?.filter((k) => controlByKey.has(k)));
const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v === '' ? null : v));

async function people() {
  return db().platformAdmin.findMany({ where: { disabledAt: null }, select: { id: true, name: true, email: true, permissions: true }, orderBy: { name: 'asc' } });
}

// ---- Overview ---------------------------------------------------------------------------

trustRouter.get(
  '/trust/overview',
  read,
  h(async (req, res) => {
    const p = db();
    const now = new Date();
    const s = await settings(p);
    const scope = req.query.frameworks !== undefined ? parseScope(req.query.frameworks) : defaultScope(s.frameworks);
    const days = Math.min(366, Math.max(7, Number(req.query.days) || 30));
    const [{ statuses }, tests, k, tr, risks, vendors, commitments, acks, alerts, lastRun] = await Promise.all([
      controlStatuses(p, now),
      p.trustTest.findMany({ select: { key: true, lastStatus: true, lastRunAt: true, lastSummary: true, lastDetails: true, enabled: true } }),
      kpis(p, now, s.riskAppetite),
      trend(p, days, now),
      p.trustRisk.findMany({ where: { status: 'OPEN' }, select: { id: true, ref: true, title: true, titleFr: true, likelihood: true, impact: true, residualLikelihood: true, residualImpact: true } }),
      p.trustVendor.findMany({ select: { criticality: true, personalInfo: true, inCanada: true, score: true, status: true } }),
      p.trustCommitment.findMany({ where: { status: 'OPEN', dueAt: { lt: new Date(now.getTime() + 90 * DAY) } }, orderBy: { dueAt: 'asc' }, select: { id: true, title: true, customer: true, kind: true, dueAt: true } }),
      policyAckProgress(p),
      p.trustAlert.findMany({ orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, kind: true, title: true, titleFr: true, link: true, createdAt: true, readAt: true } }),
      p.trustTest.findFirst({ where: { lastRunAt: { not: null } }, orderBy: { lastRunAt: 'desc' }, select: { lastRunAt: true } }),
    ]);
    const body = {
      libraryVersion: LIBRARY_VERSION,
      scope,
      savedScope: s.frameworks,
      riskAppetite: s.riskAppetite,
      appetiteRange: APPETITE_RANGE,
      score: postureScore(statuses, scope),
      updatedAt: lastRun?.lastRunAt ?? null,
      frameworks: FRAMEWORKS.map((f) => ({ key: f.key, name: f.name, nameFr: f.nameFr, optional: !!f.optional, inScope: scope.includes(f.key), ...frameworkReadiness(f.key, statuses) })),
      controls: CONTROLS.reduce<Record<string, number>>((acc, c) => ((acc[statuses[c.key]!] = (acc[statuses[c.key]!] ?? 0) + 1), acc), {}),
      tests: MONITORS.map((m) => {
        const t = tests.find((x) => x.key === m.key);
        return { key: m.key, title: m.title, titleFr: m.titleFr, status: t?.lastStatus ?? null, lastRunAt: t?.lastRunAt ?? null, summary: t?.lastSummary ?? null, summaryFr: (t?.lastDetails as { summaryFr?: string } | null)?.summaryFr ?? null, enabled: t?.enabled ?? true };
      }),
      kpis: k,
      trend: tr,
      risks: risks.map((r) => ({ ...r, score: riskScore(r.residualLikelihood, r.residualImpact) })),
      vendors: vendorDistribution(vendors),
      commitments,
      policyAcks: acks,
      alerts,
      /** Present mode's "report a security issue" line (SECURITY_EMAIL); null shows none. */
      securityContact: config().SECURITY_EMAIL || null,
    };
    const etag = `"${createHash('sha256').update(JSON.stringify(body)).digest('base64url').slice(0, 27)}"`;
    res.setHeader('ETag', etag);
    if (req.header('if-none-match') === etag) return void res.status(304).end();
    res.json(body);
  }),
);

trustRouter.patch(
  '/trust/settings',
  manage,
  h(async (req, res) => {
    const b = z.object({ riskAppetite: z.number().int().min(APPETITE_RANGE[0]).max(APPETITE_RANGE[1]).optional(), frameworks: z.array(z.enum(FRAMEWORK_KEYS as [FrameworkKey, ...FrameworkKey[]])).max(10).optional() }).parse(req.body);
    const p = platformOf(req);
    await settings(db());
    const out = await db().trustSettings.update({ where: { id: 1 }, data: { ...b, updatedById: p.adminId } });
    await audit(p.adminId, 'settings', b);
    res.json({ riskAppetite: out.riskAppetite, frameworks: out.frameworks });
  }),
);

trustRouter.get('/trust/people', read, h(async (_req, res) => res.json((await people()).map(({ id, name }) => ({ id, name })))));

trustRouter.get(
  '/trust/alerts',
  read,
  h(async (_req, res) => res.json(await db().trustAlert.findMany({ orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, kind: true, title: true, titleFr: true, link: true, createdAt: true, readAt: true } }))),
);
trustRouter.post(
  '/trust/alerts/read',
  read,
  h(async (_req, res) => {
    await db().trustAlert.updateMany({ where: { readAt: null }, data: { readAt: new Date() } });
    res.status(204).end();
  }),
);

// ---- Frameworks and controls ------------------------------------------------------------

trustRouter.get(
  '/trust/frameworks',
  read,
  h(async (_req, res) => {
    const { statuses } = await controlStatuses(db());
    res.json(
      FRAMEWORKS.map((f) => ({
        key: f.key, name: f.name, nameFr: f.nameFr, description: f.description, descriptionFr: f.descriptionFr, note: f.note ?? null, noteFr: f.noteFr ?? null, optional: !!f.optional,
        ...frameworkReadiness(f.key, statuses),
        requirements: f.requirements.map((r) => {
          const cs = CONTROLS.filter((c) => c.maps.includes(`${f.key}:${r.id}`));
          return { ...r, controls: cs.map((c) => ({ key: c.key, status: statuses[c.key] })) };
        }),
      })),
    );
  }),
);

trustRouter.get(
  '/trust/controls',
  read,
  h(async (_req, res) => {
    const p = db();
    const { statuses, states } = await controlStatuses(p);
    const [ev, tests, admins] = await Promise.all([
      p.trustEvidence.groupBy({ by: ['controlKey'], where: { deletedAt: null }, _count: true, _max: { createdAt: true } }),
      p.trustTest.findMany({ select: { key: true, lastStatus: true } }),
      people(),
    ]);
    res.json(
      CONTROLS.map((c) => {
        const s = states.find((x) => x.key === c.key);
        const e = ev.find((x) => x.controlKey === c.key);
        return {
          ...c,
          status: statuses[c.key],
          frameworks: [...new Set(c.maps.map((x) => x.split(':')[0]))],
          ownerId: s?.ownerId ?? null,
          owner: admins.find((a) => a.id === s?.ownerId)?.name ?? null,
          manualStatus: s?.manualStatus ?? null,
          justification: s?.justification ?? null,
          notes: s?.notes ?? null,
          evidenceCount: e?._count ?? 0,
          lastEvidenceAt: e?._max.createdAt ?? null,
          testResults: c.tests.map((k) => ({ key: k, title: monitorByKey.get(k)?.title, titleFr: monitorByKey.get(k)?.titleFr, status: tests.find((t) => t.key === k)?.lastStatus ?? null })),
        };
      }),
    );
  }),
);

trustRouter.patch(
  '/trust/controls/:key',
  manage,
  h(async (req, res) => {
    const key = String(req.params.key);
    if (!controlByKey.has(key)) throw notFound('Control');
    const b = z.object({ ownerId, manualStatus: z.enum(['PASSING', 'FAILING', 'NEEDS_EVIDENCE', 'NOT_APPLICABLE']).nullable().optional(), justification: optText(1000), notes: optText(2000) }).parse(req.body);
    const before = await db().trustControlState.findUnique({ where: { key } });
    const just = b.justification !== undefined ? b.justification : before?.justification;
    if (b.manualStatus && !just) throw badRequest('Say why: a manual status needs a justification.');
    const p = platformOf(req);
    const out = await db().trustControlState.upsert({ where: { key }, create: { key, ...b, updatedById: p.adminId }, update: { ...b, updatedById: p.adminId } });
    await audit(p.adminId, 'control.update', { key, ...b });
    res.json(out);
  }),
);

// ---- Tests --------------------------------------------------------------------------------

trustRouter.get(
  '/trust/tests',
  read,
  h(async (_req, res) => {
    const [rows, admins] = await Promise.all([db().trustTest.findMany(), people()]);
    res.json(
      MONITORS.map((m) => {
        const t = rows.find((x) => x.key === m.key);
        return {
          key: m.key, title: m.title, titleFr: m.titleFr, everyMinutes: m.everyMinutes, enabled: t?.enabled ?? true,
          ownerId: t?.ownerId ?? null, owner: admins.find((a) => a.id === t?.ownerId)?.name ?? null,
          status: t?.lastStatus ?? null, lastRunAt: t?.lastRunAt ?? null, summary: t?.lastSummary ?? null, details: t?.lastDetails ?? null,
          controls: CONTROLS.filter((c) => c.tests.includes(m.key)).map((c) => c.key),
        };
      }),
    );
  }),
);

trustRouter.get(
  '/trust/tests/:key/history',
  read,
  h(async (req, res) => {
    const key = String(req.params.key);
    if (!monitorByKey.has(key)) throw notFound('Test');
    const days = Math.min(400, Math.max(1, Number(req.query.days) || 30));
    res.json(await db().trustTestRun.findMany({ where: { testKey: key, at: { gte: new Date(Date.now() - days * DAY) } }, orderBy: { at: 'desc' }, take: 500, select: { id: true, status: true, summary: true, details: true, at: true, trigger: true, durationMs: true } }));
  }),
);

trustRouter.post(
  '/trust/tests/run',
  manage,
  h(async (req, res) => {
    const b = z.object({ keys: z.array(z.string().max(40)).max(50).optional() }).parse(req.body ?? {});
    const keys = b.keys?.filter((k) => monitorByKey.has(k));
    const p = platformOf(req);
    const out = await runMonitors({ keys: keys?.length ? keys : undefined, force: true, trigger: 'manual' });
    await snapshot(db(), new Date(), true);
    await audit(p.adminId, 'tests.run', { keys: out.map((o) => o.key) });
    res.json(out);
  }),
);

trustRouter.patch(
  '/trust/tests/:key',
  manage,
  h(async (req, res) => {
    const key = String(req.params.key);
    if (!monitorByKey.has(key)) throw notFound('Test');
    const b = z.object({ ownerId, enabled: z.boolean().optional() }).parse(req.body);
    const p = platformOf(req);
    const out = await db().trustTest.upsert({ where: { key }, create: { key, ...b }, update: b });
    await audit(p.adminId, 'test.update', { key, ...b });
    res.json({ key: out.key, ownerId: out.ownerId, enabled: out.enabled });
  }),
);

// ---- Evidence -----------------------------------------------------------------------------

const EVIDENCE_LIST = { id: true, controlKey: true, kind: true, title: true, url: true, note: true, result: true, fileName: true, contentType: true, size: true, sha256: true, testKey: true, validUntil: true, addedById: true, createdAt: true } as const;
const kekId = () => (config().KMS_KEY_ARN ? 'alias/flexcity-trust' : 'local:fh-trust');
const aad = (id: string) => `trust-evidence:${id}`;

trustRouter.get(
  '/trust/evidence',
  read,
  h(async (_req, res) => {
    const [items, requests, admins] = await Promise.all([
      db().trustEvidence.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 2000, select: EVIDENCE_LIST }),
      db().trustEvidenceRequest.findMany({ orderBy: [{ status: 'asc' }, { dueAt: 'asc' }], take: 500 }),
      people(),
    ]);
    const name = (id: string | null) => admins.find((a) => a.id === id)?.name ?? null;
    res.json({ items: items.map((e) => ({ ...e, addedBy: name(e.addedById) })), requests: requests.map((r) => ({ ...r, owner: name(r.ownerId) })) });
  }),
);

const evidenceBody = z.object({
  controlKey: z.string().refine((k) => controlByKey.has(k), 'Unknown control'),
  kind: z.enum(['FILE', 'LINK', 'NOTE', 'CI']),
  title: text(160),
  url: z.string().url().max(1000).refine((u) => /^https:\/\//.test(u), 'Use an https link').nullable().optional(),
  note: optText(4000),
  result: z.enum(['PASS', 'FAIL']).nullable().optional(),
  validUntil: optDate,
  fileName: z.string().trim().max(160).optional(),
  data: z.string().regex(/^data:[\w.+/-]+;base64,/).max(Math.ceil((MAX_BYTES * 4) / 3) + 200).optional(),
  requestId: uuid.optional(),
});

trustRouter.post(
  '/trust/evidence',
  manage,
  h(async (req, res) => {
    const b = evidenceBody.parse(req.body);
    const p = platformOf(req);
    const id = randomUUID();
    let file: Record<string, unknown> = {};
    if (b.kind === 'FILE') {
      if (!b.data || !b.fileName) throw badRequest('Attach a file.');
      const buf = Buffer.from(b.data.slice(b.data.indexOf(',') + 1), 'base64');
      if (!buf.length) throw badRequest('The file is empty.');
      if (buf.length > MAX_BYTES) throw new HttpError(413, 'TOO_LARGE', 'Files can be up to 10 MB.');
      const type = sniff(buf);
      if (!type) throw new HttpError(415, 'UNSUPPORTED_TYPE', 'Upload a PDF, PNG, JPEG or WebP file.');
      const sealed = await seal(keys(), kekId(), buf.toString('base64'), aad(id));
      file = { fileName: b.fileName.replace(/[^\w.\- ()]/g, '_'), contentType: type, size: buf.length, sha256: createHash('sha256').update(buf).digest('hex'), ciphertext: sealed.ciphertext, iv: sealed.iv, authTag: sealed.authTag, wrappedKey: sealed.wrappedDataKey, kekId: sealed.kekId };
    } else if (b.kind === 'LINK' && !b.url) throw badRequest('Add the link.');
    else if (b.kind === 'CI' && !b.result) throw badRequest('Say whether the run passed.');
    const e = await db().trustEvidence.create({ data: { id, controlKey: b.controlKey, kind: b.kind, title: b.title, url: b.url ?? null, note: b.note ?? null, result: b.kind === 'CI' ? b.result : null, validUntil: b.validUntil ?? null, addedById: p.adminId, ...file }, select: EVIDENCE_LIST });
    if (b.requestId) await db().trustEvidenceRequest.updateMany({ where: { id: b.requestId, status: 'OPEN' }, data: { status: 'DONE', evidenceId: id, closedAt: new Date() } });
    await audit(p.adminId, 'evidence.add', { id, controlKey: b.controlKey, kind: b.kind, size: e.size, sha256: e.sha256 });
    // A test that reads this evidence (backups, restore, CI) re-runs now, so the dashboard reflects it.
    const tests = controlByKey.get(b.controlKey)!.tests;
    if (tests.length) await runMonitors({ keys: tests, trigger: 'manual' }).catch(() => undefined);
    res.status(201).json(e);
  }),
);

trustRouter.get(
  '/trust/evidence/:id/file',
  read,
  requirePlatformStepUp,
  h(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const e = await db().trustEvidence.findFirst({ where: { id, deletedAt: null, kind: 'FILE' } });
    if (!e?.ciphertext) throw notFound('Evidence file');
    const b64 = await open(keys(), { ciphertext: Buffer.from(e.ciphertext), iv: Buffer.from(e.iv!), authTag: Buffer.from(e.authTag!), wrappedDataKey: Buffer.from(e.wrappedKey!), kekId: e.kekId! }, aad(id));
    const buf = Buffer.from(b64, 'base64');
    if (createHash('sha256').update(buf).digest('hex') !== e.sha256) throw new HttpError(500, 'DOCUMENT_CHANGED', 'This file doesn’t match what was uploaded.');
    await audit(platformOf(req).adminId, 'evidence.open', { id });
    res.setHeader('content-type', e.contentType!);
    res.setHeader('content-disposition', `attachment; filename="${e.fileName}"`);
    res.send(buf);
  }),
);

trustRouter.delete(
  '/trust/evidence/:id',
  manage,
  h(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const p = platformOf(req);
    // Kept (removed from the count, still in the auditor's index): the contents are cleared.
    const r = await db().trustEvidence.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), ciphertext: null, iv: null, authTag: null, wrappedKey: null } });
    if (!r.count) throw notFound('Evidence');
    await audit(p.adminId, 'evidence.remove', { id });
    res.status(204).end();
  }),
);

trustRouter.post(
  '/trust/evidence-requests',
  manage,
  h(async (req, res) => {
    const b = z.object({ controlKey: z.string().refine((k) => controlByKey.has(k)), title: text(160), detail: optText(2000), ownerId, dueAt: optDate.refine((d) => !!d, 'Pick a due date') }).parse(req.body);
    const p = platformOf(req);
    const r = await db().trustEvidenceRequest.create({ data: { controlKey: b.controlKey, title: b.title, detail: b.detail ?? null, ownerId: b.ownerId ?? null, dueAt: b.dueAt!, createdById: p.adminId } });
    await audit(p.adminId, 'evidence_request.add', { id: r.id, controlKey: b.controlKey });
    res.status(201).json(r);
  }),
);

trustRouter.patch(
  '/trust/evidence-requests/:id',
  manage,
  h(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const b = z.object({ status: z.enum(['OPEN', 'DONE', 'CANCELLED']).optional(), ownerId, dueAt: optDate, title: text(160).optional() }).parse(req.body);
    const p = platformOf(req);
    const r = await db().trustEvidenceRequest.update({ where: { id }, data: { ...b, dueAt: b.dueAt ?? undefined, closedAt: b.status && b.status !== 'OPEN' ? new Date() : b.status === 'OPEN' ? null : undefined } }).catch(() => {
      throw notFound('Evidence request');
    });
    await audit(p.adminId, 'evidence_request.update', { id, ...b });
    res.json(r);
  }),
);

// ---- Policies -----------------------------------------------------------------------------

trustRouter.get(
  '/trust/policies',
  read,
  h(async (req, res) => {
    const me = platformOf(req).adminId;
    const [list, admins] = await Promise.all([
      db().trustPolicy.findMany({ orderBy: { title: 'asc' }, include: { versions: { orderBy: { version: 'desc' }, include: { acks: { select: { adminId: true, at: true } } } } } }),
      people(),
    ]);
    const name = (id: string | null) => admins.find((a) => a.id === id)?.name ?? null;
    res.json({
      admins: admins.length,
      policies: list.map((x) => {
        const published = x.versions.find((v) => v.status === 'PUBLISHED') ?? null;
        const ackedBy = new Set(published?.acks.map((a) => a.adminId) ?? []);
        return {
          id: x.id, key: x.key, title: x.title, titleFr: x.titleFr, ownerId: x.ownerId, owner: name(x.ownerId), reviewEveryMonths: x.reviewEveryMonths, nextReviewAt: x.nextReviewAt, controlKeys: x.controlKeys,
          status: published ? 'PUBLISHED' : x.versions[0]?.status ?? 'DRAFT',
          publishedVersion: published?.version ?? null,
          acknowledged: admins.filter((a) => ackedBy.has(a.id)).length,
          mine: published ? ackedBy.has(me) : null,
          pending: admins.filter((a) => published && !ackedBy.has(a.id)).map((a) => a.name),
          versions: x.versions.map((v) => ({ id: v.id, version: v.version, status: v.status, body: v.body, bodyFr: v.bodyFr, changeNote: v.changeNote, createdAt: v.createdAt, createdBy: name(v.createdById), approvedAt: v.approvedAt, approvedBy: name(v.approvedById), publishedAt: v.publishedAt, acks: v.acks.length })),
        };
      }),
    });
  }),
);

trustRouter.patch(
  '/trust/policies/:id',
  manage,
  h(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const b = z.object({ ownerId, reviewEveryMonths: z.number().int().min(1).max(36).optional(), nextReviewAt: optDate }).parse(req.body);
    const p = platformOf(req);
    const r = await db().trustPolicy.update({ where: { id }, data: b }).catch(() => {
      throw notFound('Policy');
    });
    await audit(p.adminId, 'policy.update', { id, ...b });
    res.json({ id: r.id });
  }),
);

trustRouter.post(
  '/trust/policies/:id/versions',
  manage,
  h(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const b = z.object({ body: text(20_000), bodyFr: text(20_000), changeNote: optText(300) }).parse(req.body);
    const p = platformOf(req);
    const last = await db().trustPolicyVersion.findFirst({ where: { policyId: id }, orderBy: { version: 'desc' } });
    if (!last) throw notFound('Policy');
    // One draft at a time: an unpublished draft is edited in place.
    const v = last.status === 'DRAFT'
      ? await db().trustPolicyVersion.update({ where: { id: last.id }, data: { body: b.body, bodyFr: b.bodyFr, changeNote: b.changeNote ?? last.changeNote, createdById: p.adminId } })
      : await db().trustPolicyVersion.create({ data: { policyId: id, version: last.version + 1, body: b.body, bodyFr: b.bodyFr, changeNote: b.changeNote ?? null, createdById: p.adminId } });
    await audit(p.adminId, 'policy.draft', { id, version: v.version });
    res.status(201).json({ id: v.id, version: v.version, status: v.status });
  }),
);

trustRouter.post(
  '/trust/policies/:id/versions/:vid/:step(approve|publish)',
  manage,
  h(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const vid = uuid.parse(req.params.vid);
    const step = req.params.step as 'approve' | 'publish';
    const p = platformOf(req);
    const v = await db().trustPolicyVersion.findFirst({ where: { id: vid, policyId: id }, include: { policy: true } });
    if (!v) throw notFound('Policy version');
    const now = new Date();
    if (step === 'approve') {
      if (v.status !== 'DRAFT') throw badRequest('Only a draft can be approved.');
      await db().trustPolicyVersion.update({ where: { id: vid }, data: { status: 'APPROVED', approvedById: p.adminId, approvedAt: now } });
    } else {
      if (v.status !== 'APPROVED') throw badRequest('Approve the version before publishing it.');
      await db().$transaction([
        db().trustPolicyVersion.updateMany({ where: { policyId: id, status: 'PUBLISHED' }, data: { status: 'RETIRED' } }),
        db().trustPolicyVersion.update({ where: { id: vid }, data: { status: 'PUBLISHED', publishedAt: now } }),
        db().trustPolicy.update({ where: { id }, data: { nextReviewAt: addMonths(now, v.policy.reviewEveryMonths) } }),
      ]);
    }
    await audit(p.adminId, `policy.${step}`, { id, version: v.version });
    res.json({ id: vid, status: step === 'approve' ? 'APPROVED' : 'PUBLISHED' });
  }),
);

trustRouter.post(
  '/trust/policies/:id/ack',
  read,
  h(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const p = platformOf(req);
    const v = await db().trustPolicyVersion.findFirst({ where: { policyId: id, status: 'PUBLISHED' } });
    if (!v) throw badRequest('This policy isn’t published yet.');
    await db().trustPolicyAck.createMany({ data: [{ versionId: v.id, adminId: p.adminId }], skipDuplicates: true });
    await audit(p.adminId, 'policy.ack', { id, version: v.version });
    res.status(201).json({ version: v.version });
  }),
);

// ---- Risks --------------------------------------------------------------------------------

const level = z.number().int().min(1).max(5);
const riskBody = z.object({
  title: text(200), titleFr: optText(200), category: text(40), description: text(4000),
  likelihood: level, impact: level, residualLikelihood: level, residualImpact: level,
  treatment: z.enum(['MITIGATE', 'ACCEPT', 'TRANSFER', 'AVOID']), treatmentPlan: optText(4000),
  ownerId, controlKeys, vendorIds: z.array(uuid).max(20).optional(), dueAt: optDate, reviewEveryDays: z.number().int().min(7).max(730).optional(), status: z.enum(['OPEN', 'CLOSED']).optional(),
});

trustRouter.get(
  '/trust/risks',
  read,
  h(async (_req, res) => {
    const [list, admins, s] = await Promise.all([db().trustRisk.findMany({ orderBy: { ref: 'asc' } }), people(), settings(db())]);
    res.json({
      riskAppetite: s.riskAppetite,
      risks: list.map((r) => {
        const inherent = riskScore(r.likelihood, r.impact);
        const residual = riskScore(r.residualLikelihood, r.residualImpact);
        const reviewDue = new Date((r.lastReviewedAt ?? r.createdAt).getTime() + r.reviewEveryDays * DAY);
        return { ...r, owner: admins.find((a) => a.id === r.ownerId)?.name ?? null, inherent, residual, level: riskLevel(residual, s.riskAppetite), reviewDue };
      }),
    });
  }),
);

trustRouter.post(
  '/trust/risks',
  manage,
  h(async (req, res) => {
    const b = riskBody.parse(req.body);
    const p = platformOf(req);
    const count = await db().trustRisk.count();
    let ref = `R-${String(count + 1).padStart(3, '0')}`;
    while (await db().trustRisk.findUnique({ where: { ref } })) ref = `R-${String(Number(ref.slice(2)) + 1).padStart(3, '0')}`;
    const r = await db().trustRisk.create({ data: { ...b, ref, titleFr: b.titleFr ?? null, treatmentPlan: b.treatmentPlan ?? null, ownerId: b.ownerId ?? null, controlKeys: b.controlKeys ?? [], vendorIds: b.vendorIds ?? [], dueAt: b.dueAt ?? null, lastReviewedAt: new Date() } });
    await audit(p.adminId, 'risk.add', { id: r.id, ref });
    res.status(201).json(r);
  }),
);

trustRouter.patch(
  '/trust/risks/:id',
  manage,
  h(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const b = riskBody.partial().parse(req.body);
    const p = platformOf(req);
    const r = await db().trustRisk.update({ where: { id }, data: b }).catch(() => {
      throw notFound('Risk');
    });
    await audit(p.adminId, 'risk.update', { id, ...b });
    res.json(r);
  }),
);

trustRouter.post(
  '/trust/risks/:id/review',
  manage,
  h(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const p = platformOf(req);
    const r = await db().trustRisk.update({ where: { id }, data: { lastReviewedAt: new Date() } }).catch(() => {
      throw notFound('Risk');
    });
    await audit(p.adminId, 'risk.review', { id });
    res.json(r);
  }),
);

// ---- Vendors ------------------------------------------------------------------------------

const answer = z.enum(['yes', 'partial', 'no', 'na']);
const vendorBody = z.object({
  name: text(120), purpose: text(300), purposeFr: optText(300), criticality: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  dataAccessed: text(300), personalInfo: z.boolean(), dataLocation: text(160), inCanada: z.boolean(), website: z.string().url().max(300).nullable().optional(),
  dpaSignedAt: optDate, dpaExpiresAt: optDate, soc2ExpiresAt: optDate, isoExpiresAt: optDate, reviewEveryMonths: z.number().int().min(1).max(36).optional(), nextReviewAt: optDate,
  status: z.enum(['PROPOSED', 'ACTIVE', 'OFFBOARDED']).optional(), questionnaire: z.record(z.string(), answer).optional(), ownerId, controlKeys, notes: optText(4000),
});

trustRouter.get(
  '/trust/vendors',
  read,
  h(async (_req, res) => {
    const [list, admins, risks] = await Promise.all([db().trustVendor.findMany({ orderBy: { name: 'asc' } }), people(), db().trustRisk.findMany({ select: { id: true, ref: true, vendorIds: true } })]);
    res.json({
      questions: VENDOR_QUESTIONS.map((q) => q.key),
      vendors: list.map((v) => ({ ...v, owner: admins.find((a) => a.id === v.ownerId)?.name ?? null, risk: vendorRisk(v), risks: risks.filter((r) => r.vendorIds.includes(v.id)).map((r) => r.ref) })),
    });
  }),
);

const cleanQuestionnaire = (q: Record<string, VendorAnswer> | undefined) => (q ? Object.fromEntries(Object.entries(q).filter(([k]) => VENDOR_QUESTIONS.some((x) => x.key === k))) : undefined);

trustRouter.post(
  '/trust/vendors',
  manage,
  h(async (req, res) => {
    const b = vendorBody.parse(req.body);
    const p = platformOf(req);
    const q = cleanQuestionnaire(b.questionnaire);
    const v = await db().trustVendor.create({ data: { ...b, questionnaire: q, score: vendorScore(q), controlKeys: b.controlKeys ?? [] } }).catch((e) => {
      if ((e as { code?: string }).code === 'P2002') throw new HttpError(409, 'DUPLICATE', 'A vendor with this name exists.');
      throw e;
    });
    await audit(p.adminId, 'vendor.add', { id: v.id, name: v.name });
    res.status(201).json(v);
  }),
);

trustRouter.patch(
  '/trust/vendors/:id',
  manage,
  h(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const b = vendorBody.partial().parse(req.body);
    const p = platformOf(req);
    const q = cleanQuestionnaire(b.questionnaire);
    const v = await db().trustVendor.update({ where: { id }, data: { ...b, ...(q ? { questionnaire: q, score: vendorScore(q) } : {}) } }).catch(() => {
      throw notFound('Vendor');
    });
    await audit(p.adminId, 'vendor.update', { id, fields: Object.keys(b) });
    res.json(v);
  }),
);

trustRouter.post(
  '/trust/vendors/:id/review',
  manage,
  h(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const p = platformOf(req);
    const v = await db().trustVendor.findUnique({ where: { id } });
    if (!v) throw notFound('Vendor');
    const now = new Date();
    const out = await db().trustVendor.update({ where: { id }, data: { lastReviewedAt: now, nextReviewAt: addMonths(now, v.reviewEveryMonths) } });
    await audit(p.adminId, 'vendor.review', { id });
    res.json(out);
  }),
);

// ---- Customer commitments -------------------------------------------------------------------

const KINDS = ['SECURITY_CLAUSE', 'SLA_UPTIME', 'SUPPORT_RESPONSE', 'DATA_RESIDENCY', 'BREACH_NOTICE', 'PEN_TEST', 'REPORT_DELIVERY', 'QUESTIONNAIRE', 'CUSTOM'] as const;
const commitmentBody = z.object({
  tenantId: uuid.nullable().optional(), customer: text(160), kind: z.enum(KINDS), title: text(200), detail: optText(4000), source: optText(300),
  dueAt: optDate, recurrence: z.enum(['NONE', 'MONTHLY', 'QUARTERLY', 'YEARLY']).optional(), ownerId, status: z.enum(['OPEN', 'MET', 'WAIVED']).optional(), controlKeys,
});

trustRouter.get(
  '/trust/commitments',
  read,
  h(async (_req, res) => {
    const [list, admins, tenants] = await Promise.all([
      db().trustCommitment.findMany({ orderBy: [{ status: 'asc' }, { dueAt: 'asc' }], include: { fulfilments: { orderBy: { metAt: 'desc' }, take: 20 } } }),
      people(),
      db().$queryRaw<Array<{ id: string }>>`SELECT all_tenant_ids() AS id`,
    ]);
    res.json({ kinds: KINDS, tenants: tenants.length, commitments: list.map((c) => ({ ...c, owner: admins.find((a) => a.id === c.ownerId)?.name ?? null })) });
  }),
);

/** The customer must be an organization on the platform when a tenant is named. */
async function checkTenant(tenantId: string | null | undefined) {
  if (!tenantId) return;
  const ids = await db().$queryRaw<Array<{ id: string }>>`SELECT all_tenant_ids() AS id`;
  if (!ids.some((x) => x.id === tenantId)) throw badRequest('Unknown organization.');
}

trustRouter.post(
  '/trust/commitments',
  manage,
  h(async (req, res) => {
    const b = commitmentBody.parse(req.body);
    await checkTenant(b.tenantId);
    const p = platformOf(req);
    const c = await db().trustCommitment.create({ data: { ...b, tenantId: b.tenantId ?? null, detail: b.detail ?? null, source: b.source ?? null, dueAt: b.dueAt ?? null, ownerId: b.ownerId ?? null, controlKeys: b.controlKeys ?? [], createdById: p.adminId } });
    await audit(p.adminId, 'commitment.add', { id: c.id, kind: c.kind, tenantId: c.tenantId });
    res.status(201).json(c);
  }),
);

trustRouter.patch(
  '/trust/commitments/:id',
  manage,
  h(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const b = commitmentBody.partial().parse(req.body);
    await checkTenant(b.tenantId);
    const p = platformOf(req);
    const c = await db().trustCommitment.update({ where: { id }, data: b }).catch(() => {
      throw notFound('Commitment');
    });
    await audit(p.adminId, 'commitment.update', { id, fields: Object.keys(b) });
    res.json(c);
  }),
);

/** Met: recorded with its evidence; a recurring commitment moves to its next due date and stays open. */
trustRouter.post(
  '/trust/commitments/:id/fulfil',
  manage,
  h(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const b = z.object({ note: optText(2000), evidenceId: uuid.nullable().optional() }).parse(req.body ?? {});
    const p = platformOf(req);
    const c = await db().trustCommitment.findUnique({ where: { id } });
    if (!c) throw notFound('Commitment');
    if (c.status !== 'OPEN') throw badRequest('This commitment is already closed.');
    const next = c.dueAt ? nextDue(c.dueAt, c.recurrence as 'NONE') : null;
    const [, out] = await db().$transaction([
      db().trustCommitmentFulfilment.create({ data: { commitmentId: id, dueAt: c.dueAt, note: b.note ?? null, evidenceId: b.evidenceId ?? null, byId: p.adminId } }),
      db().trustCommitment.update({ where: { id }, data: next ? { dueAt: next } : { status: 'MET' } }),
    ]);
    await audit(p.adminId, 'commitment.fulfil', { id, dueAt: c.dueAt, next });
    res.json(out);
  }),
);

// ---- Questionnaire answer library ----------------------------------------------------------

const answerBody = z.object({ category: text(80), question: text(500), questionFr: text(500), answer: text(4000), answerFr: text(4000), controlKeys });

trustRouter.get(
  '/trust/answers',
  read,
  h(async (_req, res) => {
    const [list, admins] = await Promise.all([db().trustAnswer.findMany({ orderBy: [{ category: 'asc' }, { question: 'asc' }] }), people()]);
    res.json(list.map((a) => ({ ...a, reviewedBy: admins.find((x) => x.id === a.reviewedById)?.name ?? null })));
  }),
);

trustRouter.post(
  '/trust/answers',
  manage,
  h(async (req, res) => {
    const b = answerBody.parse(req.body);
    const p = platformOf(req);
    const a = await db().trustAnswer.create({ data: { ...b, controlKeys: b.controlKeys ?? [], reviewedById: p.adminId } });
    await audit(p.adminId, 'answer.add', { id: a.id });
    res.status(201).json(a);
  }),
);

trustRouter.patch(
  '/trust/answers/:id',
  manage,
  h(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const b = answerBody.partial().extend({ reviewed: z.boolean().optional() }).parse(req.body);
    const p = platformOf(req);
    const { reviewed, ...data } = b;
    const a = await db().trustAnswer.update({ where: { id }, data: { ...data, ...(reviewed || Object.keys(data).length ? { lastReviewedAt: new Date(), reviewedById: p.adminId } : {}) } }).catch(() => {
      throw notFound('Answer');
    });
    await audit(p.adminId, 'answer.update', { id, fields: Object.keys(b) });
    res.json(a);
  }),
);

// ---- Exports (step-up, audited) -------------------------------------------------------------

trustRouter.get(
  '/trust/export/:framework.zip',
  manage,
  requirePlatformStepUp,
  h(async (req, res) => {
    const fw = z.enum(FRAMEWORK_KEYS as [FrameworkKey, ...FrameworkKey[]]).parse(req.params.framework);
    const fr = String(req.query.lang ?? '').startsWith('fr');
    const out = await auditorBundle(db(), fw, new Date(), fr);
    await audit(platformOf(req).adminId, 'export.auditor', { framework: fw, lang: fr ? 'fr' : 'en', files: out.files, bytes: out.zip.length });
    res.setHeader('content-type', 'application/zip');
    res.setHeader('content-disposition', `attachment; filename="fh-${fw}-evidence-${new Date().toISOString().slice(0, 10)}.zip"`);
    res.send(Buffer.from(out.zip));
  }),
);

/** The posture summary for a customer who asks: readiness bands and controls in place, nothing failing named. */
trustRouter.get(
  '/trust/summary.:format(pdf|csv|json)',
  read,
  requirePlatformStepUp,
  h(async (req, res) => {
    const fr = String(req.query.lang ?? '').startsWith('fr');
    const format = req.params.format as 'pdf' | 'csv' | 'json';
    await audit(platformOf(req).adminId, 'export.summary', { format, lang: fr ? 'fr' : 'en' });
    const name = `fh-security-posture-${new Date().toISOString().slice(0, 10)}`;
    if (format === 'json') return void res.json(await postureSummary(db()));
    if (format === 'csv') {
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.setHeader('content-disposition', `attachment; filename="${name}.csv"`);
      return void res.send(await postureSummaryCsv(db(), fr));
    }
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="${name}.pdf"`);
    res.send(await postureSummaryPdf(db(), fr));
  }),
);
