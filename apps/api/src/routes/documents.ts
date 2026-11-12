/**
 * Files on an employee's record: doctor's notes, certificates, ID, contracts.
 *
 * - Encrypted at rest with the organization's key; the AAD ties each file to
 *   its own row, so encrypted files can't be swapped between records.
 * - Medical notes are HR-only (plus the employee), whoever uploads them.
 *   Other files can also be shared with the employee's department supervisors.
 * - Only PDF, PNG, JPEG and WebP, checked by content, up to 10 MB.
 * - Every download is logged; deleting keeps a tombstone with who and why.
 */
import { randomUUID } from 'node:crypto';
import type { DocumentKind, DocumentVisibility } from '../generated/prisma/client.js';
import { Router } from 'express';
import { z } from 'zod';
import { type AuthContext, authOf, requirePermission } from '../auth/middleware.js';
import { type Tx, audit, withTenant } from '../lib/db.js';
import { HttpError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { type FileType, sendFile, sniff, storedName } from '../lib/files.js';
import { open, seal } from '../services/crypto/envelope.js';
import { sha256 } from '../services/people/fingerprint.js';
import { userInScope } from '../services/people/scope.js';
import { h, keys, tenantKekId } from './context.js';

export const documentsRouter = Router();
const uuid = z.string().uuid();
const MAX_BYTES = 10 * 1024 * 1024;
const KINDS = ['MEDICAL_NOTE', 'CERTIFICATE', 'IDENTIFICATION', 'CONTRACT', 'POLICY', 'OTHER'] as const;

const body = z.object({
  kind: z.enum(KINDS),
  title: z.string().trim().min(2).max(120),
  fileName: z.string().trim().min(1).max(160),
  /** data:<type>;base64,<file> */
  data: z.string().regex(/^data:[\w.+/-]+;base64,/).max(Math.ceil((MAX_BYTES * 4) / 3) + 200),
  /** Ignored for medical notes, which are always HR-only. */
  shareWithDepartment: z.boolean().default(false),
});

/** Everything but the encrypted contents. */
const LIST = { id: true, userId: true, uploadedById: true, kind: true, visibility: true, title: true, fileName: true, contentType: true, size: true, sha256: true, createdAt: true } as const;
const aad = (tenantId: string, id: string) => `doc:${tenantId}:${id}`;
// HR is a role, not the absence of a department limit: in a city without departments every
// supervisor is unscoped, and must still never see medical notes.
const isHr = (a: AuthContext) => a.permissions.has('documents.manage') && a.roles.includes('HR_ADMIN');

export async function store(tx: Tx, a: AuthContext, userId: string, b: Omit<z.infer<typeof body>, 'kind'> & { kind: DocumentKind }) {
  const file = Buffer.from(b.data.slice(b.data.indexOf(',') + 1), 'base64');
  if (!file.length) throw badRequest('The file is empty.');
  if (file.length > MAX_BYTES) throw new HttpError(413, 'TOO_LARGE', 'Files can be up to 10 MB.');
  const type = sniff(file);
  if (!type) throw new HttpError(415, 'UNSUPPORTED_TYPE', 'Upload a PDF, PNG, JPEG or WebP file.');
  const id = randomUUID();
  // Base64 inside the seal: the envelope works on text.
  const sealed = await seal(keys(), tenantKekId(a.tenantId), file.toString('base64'), aad(a.tenantId, id));
  // Receipts are seen by whoever approves the claim: the person's department supervisors and HR.
  const visibility: DocumentVisibility = b.kind === 'MEDICAL_NOTE' ? 'HR' : b.kind === 'RECEIPT' || b.shareWithDepartment ? 'DEPARTMENT' : 'HR';
  const doc = await tx.employeeDocument.create({
    data: { id, tenantId: a.tenantId, userId, uploadedById: a.userId, kind: b.kind as DocumentKind, visibility, title: b.title, fileName: storedName(b.fileName, type), contentType: type, size: file.length, sha256: sha256(file), ciphertext: sealed.ciphertext, iv: sealed.iv, authTag: sealed.authTag, wrappedKey: sealed.wrappedDataKey, kekId: sealed.kekId },
  });
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'document.upload', entity: 'EmployeeDocument', entityId: id, after: { userId, kind: b.kind, visibility, size: file.length, sha256: doc.sha256 } });
  return doc;
}

const view = (d: { id: string; userId: string; uploadedById: string; kind: string; visibility: string; title: string; fileName: string; contentType: string; size: number; sha256: string; createdAt: Date }, names: Map<string, string>) => ({
  id: d.id,
  userId: d.userId,
  kind: d.kind,
  visibility: d.visibility,
  title: d.title,
  fileName: d.fileName,
  contentType: d.contentType,
  size: d.size,
  sha256: d.sha256,
  createdAt: d.createdAt,
  uploadedBy: names.get(d.uploadedById) ?? null,
});
async function names(tx: Tx, ids: string[]) {
  const users = await tx.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, firstName: true, lastName: true } });
  return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
}

/** May this person see this document? The employee, HR, or (for department-shared files) their supervisors. */
async function canSee(tx: Tx, a: AuthContext, d: { userId: string; visibility: string; kind?: string }) {
  if (d.userId === a.userId) return true;
  // Receipts: whoever approves this person's expense claims.
  if (d.kind === 'RECEIPT' && a.permissions.has('expenses.approve') && (await userInScope(tx, a.scope, d.userId))) return true;
  if (!a.permissions.has('documents.manage')) return false;
  if (isHr(a)) return true;
  return d.visibility === 'DEPARTMENT' && (await userInScope(tx, a.scope, d.userId));
}

// ------------------------------------------------------------------ The employee's own
documentsRouter.get(
  '/me/documents',
  h(async (req, res) => {
    const a = authOf(req);
    const out = await withTenant(a.tenantId, async (tx) => {
      const rows = await tx.employeeDocument.findMany({ where: { userId: a.userId, deletedAt: null }, orderBy: { createdAt: 'desc' }, select: LIST });
      const n = await names(tx, rows.map((r) => r.uploadedById));
      return rows.map((r) => view(r, n));
    });
    res.json(out);
  }),
);

documentsRouter.post(
  '/me/documents',
  h(async (req, res) => {
    const a = authOf(req);
    const b = body.parse(req.body);
    const d = await withTenant(a.tenantId, (tx) => store(tx, a, a.userId, b));
    res.status(201).json({ id: d.id, sha256: d.sha256, visibility: d.visibility });
  }),
);

// ------------------------------------------------------------------ HR and supervisors
documentsRouter.get(
  '/users/:id/documents',
  requirePermission('documents.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const userId = uuid.parse(req.params.id);
    const out = await withTenant(a.tenantId, async (tx) => {
      if (!(await userInScope(tx, a.scope, userId))) throw notFound('Person');
      const rows = await tx.employeeDocument.findMany({ where: { userId, deletedAt: null, ...(isHr(a) ? {} : { visibility: 'DEPARTMENT' }) }, orderBy: { createdAt: 'desc' }, select: LIST });
      const n = await names(tx, rows.map((r) => r.uploadedById));
      return rows.map((r) => view(r, n));
    });
    res.json(out);
  }),
);

documentsRouter.post(
  '/users/:id/documents',
  requirePermission('documents.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const userId = uuid.parse(req.params.id);
    const b = body.parse(req.body);
    // Supervisors add certificates and the like for their department; medical notes go to HR.
    if (!isHr(a) && b.kind === 'MEDICAL_NOTE') throw forbidden('Medical notes are for HR. Ask the employee to upload it, or send it to HR.');
    const d = await withTenant(a.tenantId, async (tx) => {
      if (!(await userInScope(tx, a.scope, userId))) throw notFound('Person');
      return store(tx, a, userId, isHr(a) ? b : { ...b, shareWithDepartment: true });
    });
    res.status(201).json({ id: d.id, sha256: d.sha256, visibility: d.visibility });
  }),
);

/** The file itself, decrypted. Every download is logged. */
documentsRouter.get(
  '/documents/:id/file',
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const { doc, file } = await withTenant(a.tenantId, async (tx) => {
      const doc = await tx.employeeDocument.findUnique({ where: { id } });
      if (!doc || doc.deletedAt || !(await canSee(tx, a, doc))) throw notFound('Document');
      const b64 = await open(keys(), { ciphertext: Buffer.from(doc.ciphertext), iv: Buffer.from(doc.iv), authTag: Buffer.from(doc.authTag), wrappedDataKey: Buffer.from(doc.wrappedKey), kekId: doc.kekId }, aad(a.tenantId, id));
      const file = Buffer.from(b64, 'base64');
      if (sha256(file) !== doc.sha256) throw new HttpError(500, 'DOCUMENT_CHANGED', 'This file doesn’t match what was uploaded.');
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'document.view', entity: 'EmployeeDocument', entityId: id, after: { userId: doc.userId, kind: doc.kind } });
      return { doc, file };
    });
    // The type was found from the file's bytes when it was uploaded (sniff), so it is one of FILE_TYPES.
    sendFile(res, file, { type: doc.contentType as FileType, name: doc.fileName });
  }),
);

/** Remove a file from the record: HR only. The contents are wiped; who, when and why stay. */
documentsRouter.delete(
  '/documents/:id',
  requirePermission('documents.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    if (!isHr(a)) throw forbidden('Only HR removes documents from a record.');
    const id = uuid.parse(req.params.id);
    const { reason } = z.object({ reason: z.string().trim().min(3).max(200) }).parse(req.body ?? {});
    await withTenant(a.tenantId, async (tx) => {
      const doc = await tx.employeeDocument.findUnique({ where: { id }, select: { id: true, deletedAt: true, userId: true } });
      if (!doc || doc.deletedAt) throw notFound('Document');
      await tx.employeeDocument.update({ where: { id }, data: { deletedAt: new Date(), deletedById: a.userId, deletedReason: reason, ciphertext: Buffer.alloc(0), iv: Buffer.alloc(0), authTag: Buffer.alloc(0), wrappedKey: Buffer.alloc(0) } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'document.delete', entity: 'EmployeeDocument', entityId: id, after: { userId: doc.userId, reason } });
    });
    res.json({ ok: true });
  }),
);
