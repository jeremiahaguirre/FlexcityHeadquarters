/**
 * Job applications taken on the careers page (postings with "apply in the app").
 *
 * Applicants agree to a short privacy notice; a résumé (PDF, up to 5 MB) is
 * encrypted with the organization's key like employee documents, and every
 * look at one is logged. HR moves applications through stages and can hire
 * someone straight into an account invitation. Applications that didn't end
 * in a hire are deleted after the retention period (retention.ts).
 */
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import { allow } from '../auth/rateLimit.js';
import { appUrl, issueAuthToken } from '../auth/authTokens.js';
import { audit, withTenant } from '../lib/db.js';
import { HttpError, conflict, notFound } from '../lib/errors.js';
import { open, seal } from '../services/crypto/envelope.js';
import { notify, usersWithPermission } from '../services/notifications/notifier.js';
import { sha256 } from '../services/people/fingerprint.js';
import { h, keys, subdomainOf, tenantKekId } from './context.js';
import { sniff } from './documents.js';

export const publicApplicationsRouter = Router();
export const applicationsRouter = Router();
applicationsRouter.use(['/applications', '/jobs/:id/applications'], requireFeature('jobs'));
const uuid = z.string().uuid();
const MAX_BYTES = 5 * 1024 * 1024;
const aad = (tenantId: string, id: string) => `application:${tenantId}:${id}`;
const STATUSES = ['NEW', 'REVIEWING', 'INTERVIEW', 'OFFERED', 'HIRED', 'DECLINED', 'WITHDRAWN'] as const;

publicApplicationsRouter.post(
  '/public/jobs/:id/apply',
  requireFeature('jobs'),
  h(async (req, res) => {
    const postingId = uuid.safeParse(req.params.id);
    if (!postingId.success) throw notFound('Job');
    const b = z
      .object({
        firstName: z.string().trim().min(1).max(60),
        lastName: z.string().trim().min(1).max(60),
        email: z.string().trim().email().max(160),
        phone: z.string().trim().max(30).nullable().optional(),
        message: z.string().trim().max(4000).nullable().optional(),
        certifications: z.string().trim().max(1000).nullable().optional(),
        resume: z.object({ fileName: z.string().trim().min(1).max(160), data: z.string().regex(/^data:[\w.+/-]+;base64,/).max(Math.ceil((MAX_BYTES * 4) / 3) + 200) }).nullable().optional(),
        consent: z.literal(true, { message: 'Agree to how your information is used to apply.' }),
        website: z.string().max(500).optional().default(''),
        startedAt: z.number().int(),
      })
      .parse(req.body);
    if (b.website) throw new HttpError(400, 'REJECTED', 'This form couldn’t be sent.');
    if (Date.now() - b.startedAt < 3000) throw new HttpError(400, 'TOO_FAST', 'Please take a moment to check the form, then send it again.');
    if (!(await allow(`apply:${req.ip}:${req.tenantId}`, 10, 3_600_000))) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many applications from here. Try again later.');
    const tenantId = req.tenantId!;
    let file: Buffer | null = null;
    if (b.resume) {
      file = Buffer.from(b.resume.data.slice(b.resume.data.indexOf(',') + 1), 'base64');
      if (!file.length || file.length > MAX_BYTES) throw new HttpError(413, 'TOO_LARGE', 'Résumés can be up to 5 MB.');
      if (sniff(file) !== 'application/pdf') throw new HttpError(415, 'UNSUPPORTED_TYPE', 'Attach your résumé as a PDF.');
    }
    await withTenant(tenantId, async (tx) => {
      const p = await tx.jobPosting.findFirst({ where: { id: postingId.data, published: true, applyInApp: true, closesOn: { gte: new Date(new Date().toISOString().slice(0, 10)) } } });
      if (!p) throw notFound('Job');
      const dup = await tx.jobApplication.findFirst({ where: { postingId: p.id, email: b.email.toLowerCase(), status: { notIn: ['WITHDRAWN', 'DECLINED'] } } });
      if (dup) throw conflict('ALREADY_APPLIED', 'You’ve already applied to this job. We’ll be in touch.');
      const id = randomUUID();
      const sealed = file ? await seal(keys(), tenantKekId(tenantId), file.toString('base64'), aad(tenantId, id)) : null;
      await tx.jobApplication.create({
        data: {
          id, tenantId, postingId: p.id, firstName: b.firstName, lastName: b.lastName, email: b.email.toLowerCase(), phone: b.phone ?? null, message: b.message ?? null, certifications: b.certifications ?? null, consentAt: new Date(),
          ...(file && sealed ? { resumeName: b.resume!.fileName.replace(/[^\w.\- ()]/g, '_'), resumeType: 'application/pdf', resumeSize: file.length, resumeSha256: sha256(file), ciphertext: sealed.ciphertext, iv: sealed.iv, authTag: sealed.authTag, wrappedKey: sealed.wrappedDataKey, kekId: sealed.kekId } : {}),
        },
      });
      const hr = await usersWithPermission(tx, tenantId, 'jobs.manage');
      await notify(tx, tenantId, hr.map((userId) => ({ userId, type: 'application_received', params: { title: p.title, name: `${b.firstName} ${b.lastName}` }, link: '/manage/jobs' })));
    });
    res.status(201).json({ ok: true });
  }),
);

const view = (x: { id: string; postingId: string; firstName: string; lastName: string; email: string; phone: string | null; message: string | null; certifications: string | null; status: string; notes: string | null; resumeName: string | null; resumeSize: number | null; hiredUserId: string | null; createdAt: Date }) => ({
  id: x.id, postingId: x.postingId, name: `${x.firstName} ${x.lastName}`, firstName: x.firstName, lastName: x.lastName, email: x.email, phone: x.phone, message: x.message, certifications: x.certifications, status: x.status, notes: x.notes, resume: x.resumeName ? { name: x.resumeName, size: x.resumeSize } : null, hiredUserId: x.hiredUserId, createdAt: x.createdAt,
});
const SELECT = { id: true, postingId: true, firstName: true, lastName: true, email: true, phone: true, message: true, certifications: true, status: true, notes: true, resumeName: true, resumeSize: true, hiredUserId: true, createdAt: true } as const;

applicationsRouter.get(
  '/jobs/:id/applications',
  requirePermission('jobs.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const postingId = uuid.parse(req.params.id);
    res.json(await withTenant(a.tenantId, async (tx) => (await tx.jobApplication.findMany({ where: { postingId }, orderBy: { createdAt: 'asc' }, select: SELECT })).map(view)));
  }),
);

applicationsRouter.patch(
  '/applications/:id',
  requirePermission('jobs.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const b = z.object({ status: z.enum(STATUSES).exclude(['HIRED']).optional(), notes: z.string().trim().max(4000).nullable().optional() }).parse(req.body);
    const x = await withTenant(a.tenantId, async (tx) => {
      const x = await tx.jobApplication.findUnique({ where: { id } });
      if (!x) throw notFound('Application');
      if (x.status === 'HIRED') throw conflict('ALREADY_HIRED', 'This person was hired.');
      const u = await tx.jobApplication.update({ where: { id }, data: b, select: SELECT });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'application.update', entity: 'JobApplication', entityId: id, after: { status: b.status } });
      return u;
    });
    res.json(view(x));
  }),
);

/** The résumé, decrypted. Every look is logged. */
applicationsRouter.get(
  '/applications/:id/resume',
  requirePermission('jobs.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const { x, file } = await withTenant(a.tenantId, async (tx) => {
      const x = await tx.jobApplication.findUnique({ where: { id } });
      if (!x?.ciphertext) throw notFound('Résumé');
      const b64 = await open(keys(), { ciphertext: Buffer.from(x.ciphertext), iv: Buffer.from(x.iv!), authTag: Buffer.from(x.authTag!), wrappedDataKey: Buffer.from(x.wrappedKey!), kekId: x.kekId! }, aad(a.tenantId, id));
      const file = Buffer.from(b64, 'base64');
      if (sha256(file) !== x.resumeSha256) throw new HttpError(500, 'DOCUMENT_CHANGED', 'This file doesn’t match what was uploaded.');
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'application.resume_view', entity: 'JobApplication', entityId: id });
      return { x, file };
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${(x.resumeName ?? 'resume.pdf').replace(/"/g, '')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.send(file);
  }),
);

/** Hire: an account and an invitation to set a password, with the posting's facility position(s). */
applicationsRouter.post(
  '/applications/:id/hire',
  requirePermission('jobs.manage'),
  requirePermission('users.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const b = z.object({ role: z.enum(['STAFF', 'EMPLOYEE', 'FRONT_DESK', 'HEAD_LIFEGUARD']), employmentStatus: z.enum(['FULL_TIME', 'PART_TIME', 'CASUAL', 'ON_CALL', 'VOLUNTEER']), positionIds: z.array(uuid).max(10).default([]), hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }).parse(req.body);
    const sub = subdomainOf(req)!;
    const out = await withTenant(a.tenantId, async (tx) => {
      const x = await tx.jobApplication.findUnique({ where: { id } });
      if (!x) throw notFound('Application');
      if (x.status === 'HIRED') throw conflict('ALREADY_HIRED', 'This person was hired.');
      if (await tx.user.findUnique({ where: { tenantId_email: { tenantId: a.tenantId, email: x.email } } })) throw conflict('EMAIL_TAKEN', 'Someone in your organization already uses this email.');
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { name: true, defaultLocale: true } });
      const hire = b.hireDate ? new Date(b.hireDate) : null;
      const u = await tx.user.create({ data: { tenantId: a.tenantId, firstName: x.firstName, lastName: x.lastName, email: x.email, phone: x.phone, roles: [b.role], employmentStatus: b.employmentStatus, locale: tenant.defaultLocale, hireDate: hire, seniorityDate: hire } });
      if (b.positionIds.length) await tx.userPosition.createMany({ data: b.positionIds.map((positionId) => ({ tenantId: a.tenantId, userId: u.id, positionId })) });
      const token = await issueAuthToken(tx, a.tenantId, u.id, 'INVITE');
      await tx.emailOutbox.create({ data: { tenantId: a.tenantId, toEmail: u.email, template: 'invite', locale: u.locale, params: { organization: tenant.name, url: appUrl(sub, `/reset?token=${token}&invite=1`) } } });
      await tx.jobApplication.update({ where: { id }, data: { status: 'HIRED', hiredUserId: u.id } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'application.hire', entity: 'JobApplication', entityId: id, after: { userId: u.id, role: b.role } });
      return { userId: u.id };
    });
    res.status(201).json(out);
  }),
);
