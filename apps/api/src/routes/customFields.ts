/**
 * Custom fields on people (services/people/customFields.ts): the organization defines them in
 * settings; HR and, for manager-level fields, managers in scope read and change them on the
 * staff file.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { HttpError, forbidden, notFound } from '../lib/errors.js';
import { MAX_FIELDS, fieldDef, fieldDefs, fieldsFor, restoreFieldValues, saveFieldValues } from '../services/people/customFields.js';
import { assertUserInScope } from '../services/people/scope.js';
import { h } from './context.js';

export const customFieldsRouter = Router();
const uuid = z.string().uuid();

const choice = z.object({ value: z.string().trim().min(1).max(60), label: z.string().trim().min(1).max(80), labelFr: z.string().trim().min(1).max(80) });
const access = z.enum(['HR', 'MANAGER']);
const editable = z.object({
  label: z.string().trim().min(2).max(80),
  labelFr: z.string().trim().min(2).max(80),
  choices: z.array(choice).max(50).default([]),
  required: z.boolean().default(false),
  viewAccess: access.default('HR'),
  editAccess: access.default('HR'),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});
const createBody = editable.extend({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Use 2 to 40 lowercase letters, digits or _ , starting with a letter.'),
  type: z.enum(['TEXT', 'NUMBER', 'DATE', 'CHOICE', 'BOOLEAN']),
});

/** Fields are on every person in the organization: defined by its own administrators, never by a role limited to departments. */
function orgWide(a: { scope: unknown }) {
  if (a.scope) throw forbidden('Staff fields are set for the whole organization, by its administrators.');
}

function checkDefinition(b: { type?: string; choices: Array<{ value: string }>; viewAccess: string; editAccess: string }) {
  if (b.type === 'CHOICE' && b.choices.length < 2) throw new HttpError(400, 'CUSTOM_FIELD_CHOICES', 'A choice field needs at least two choices.');
  if (new Set(b.choices.map((c) => c.value)).size !== b.choices.length) throw new HttpError(400, 'CUSTOM_FIELD_CHOICES', 'Each choice needs its own value.');
  // Someone who can change a field can always see it.
  if (b.viewAccess === 'HR' && b.editAccess === 'MANAGER') throw new HttpError(400, 'CUSTOM_FIELD_ACCESS', 'Managers can only change a field they can see.');
}

customFieldsRouter.get(
  '/settings/custom-fields',
  requirePermission('tenant.configure'),
  h(async (req, res) => {
    const a = authOf(req);
    orgWide(a);
    const rows = await withTenant(a.tenantId, (tx) => fieldDefs(tx, { archived: true }));
    res.json({ fields: rows.map((d) => ({ ...d, archivedAt: d.archivedAt?.toISOString() ?? null })), max: MAX_FIELDS });
  }),
);

customFieldsRouter.post(
  '/settings/custom-fields',
  requirePermission('tenant.configure'),
  h(async (req, res) => {
    const a = authOf(req);
    orgWide(a);
    const b = createBody.parse(req.body);
    checkDefinition(b);
    const row = await withTenant(a.tenantId, async (tx) => {
      if ((await tx.customFieldDefinition.count()) >= MAX_FIELDS) throw new HttpError(400, 'TOO_MANY_FIELDS', `An organization can keep up to ${MAX_FIELDS} staff fields.`);
      if (await tx.customFieldDefinition.findFirst({ where: { key: b.key } })) throw new HttpError(409, 'CUSTOM_FIELD_KEY_TAKEN', 'Another field already uses this key.');
      const r = await tx.customFieldDefinition.create({ data: { ...b, tenantId: a.tenantId, choices: b.type === 'CHOICE' ? b.choices : [] } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'customfield.create', entity: 'CustomFieldDefinition', entityId: r.id, after: b });
      return r;
    });
    res.status(201).json({ id: row.id });
  }),
);

/** Key and type never change (imports and the public API rely on them); archive to retire a field. */
customFieldsRouter.patch(
  '/settings/custom-fields/:id',
  requirePermission('tenant.configure'),
  h(async (req, res) => {
    const a = authOf(req);
    orgWide(a);
    const id = uuid.parse(req.params.id);
    const b = editable.extend({ archived: z.boolean().default(false) }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const before = await tx.customFieldDefinition.findUnique({ where: { id } });
      if (!before) throw notFound('Field');
      checkDefinition({ ...b, type: before.type });
      const { archived, ...rest } = b;
      await tx.customFieldDefinition.update({ where: { id }, data: { ...rest, choices: before.type === 'CHOICE' ? rest.choices : [], archivedAt: archived ? (before.archivedAt ?? new Date()) : null } });
      // Now HR-only: its values are sealed; now manager-level: opened.
      if (before.viewAccess !== rest.viewAccess) await restoreFieldValues(tx, a.tenantId, id, rest.viewAccess);
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'customfield.update', entity: 'CustomFieldDefinition', entityId: id, before: fieldDef(before), after: b });
    });
    res.json({ ok: true });
  }),
);

/** The fields the signed-in person may see on someone in their scope, with values. */
customFieldsRouter.get(
  '/users/:id/custom-fields',
  requirePermission('users.read'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const out = await withTenant(a.tenantId, async (tx) => {
      const u = await tx.user.findUnique({ where: { id }, select: { anonymizedAt: true } });
      if (!u || u.anonymizedAt) throw notFound('Staff member');
      await assertUserInScope(tx, a, id);
      return fieldsFor(tx, a, id);
    });
    res.json({ fields: out });
  }),
);

customFieldsRouter.put(
  '/users/:id/custom-fields',
  requirePermission('users.read'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const { values } = z.object({ values: z.record(z.string().max(40), z.union([z.string().max(1000), z.number(), z.boolean(), z.null()])) }).parse(req.body);
    const out = await withTenant(a.tenantId, async (tx) => {
      const u = await tx.user.findUnique({ where: { id }, select: { anonymizedAt: true } });
      if (!u || u.anonymizedAt) throw notFound('Staff member');
      await assertUserInScope(tx, a, id);
      const changed = await saveFieldValues(tx, a, id, values);
      return { changed, fields: await fieldsFor(tx, a, id) };
    });
    res.json(out);
  }),
);
