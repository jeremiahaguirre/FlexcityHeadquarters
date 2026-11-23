/**
 * Custom fields on people (CustomFieldDefinition / CustomFieldValue): a badge number, a second
 * employee number, a cost centre, a locker, a union local number: whatever an organization keeps
 * that the app has no column for.
 *
 * - Types: TEXT, NUMBER, DATE (YYYY-MM-DD), CHOICE (one of the field's choices) and BOOLEAN
 *   (yes/no). Every value is stored as text in a canonical form (customFieldValues.ts).
 * - Labels in English and French; a field is required (it can't be emptied) or optional.
 * - Who sees and who changes it: HR only (people who hold users.write), or also a manager in
 *   scope (users.read to see, users.scheduling to change). The person is always reached through
 *   the asker's department scope (assertUserInScope).
 * - An HR-only field is sensitive. Its values are sealed with the organization's key (envelope.ts:
 *   a data key per value, AAD bound to the organization, field and person), like SINs; a
 *   manager-level value is plain text. Changing who sees a field seals or opens its values to
 *   match. It never reaches FH: a support visit sees only manager-level fields, and the Dev
 *   console's staff import refuses HR-only columns. Its values stay out of the audit log (the entry
 *   names the fields changed, not the values), and the public API reads it only through the
 *   customfields scopes, which only HR for the whole organization can give a key.
 * - In the city's data export (every table), the person's own records export, and erased with
 *   the person (anonymizeUser).
 */
import type { AuthContext } from '../../auth/middleware.js';
import type { CustomFieldAccess, CustomFieldType } from '../../generated/prisma/client.js';
import { type Tx, audit } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { keys, tenantKekId } from '../../routes/context.js';
import { open, seal } from '../crypto/envelope.js';
import { type FieldChoice, FieldValueError, normalizeValue, typedValue } from './customFieldValues.js';

export interface FieldDef {
  id: string;
  key: string;
  label: string;
  labelFr: string;
  type: CustomFieldType;
  choices: FieldChoice[];
  required: boolean;
  viewAccess: CustomFieldAccess;
  editAccess: CustomFieldAccess;
  sortOrder: number;
  archivedAt: Date | null;
}

export const MAX_FIELDS = 50;

/** A row as a definition (choices from JSON). */
export function fieldDef(r: { id: string; key: string; label: string; labelFr: string; type: CustomFieldType; choices: unknown; required: boolean; viewAccess: CustomFieldAccess; editAccess: CustomFieldAccess; sortOrder: number; archivedAt: Date | null }): FieldDef {
  const choices = Array.isArray(r.choices) ? (r.choices as FieldChoice[]).filter((c) => c && typeof c.value === 'string') : [];
  return { id: r.id, key: r.key, label: r.label, labelFr: r.labelFr, type: r.type, choices, required: r.required, viewAccess: r.viewAccess, editAccess: r.editAccess, sortOrder: r.sortOrder, archivedAt: r.archivedAt };
}

type Viewer = Pick<AuthContext, 'permissions'> & { support?: unknown };
const isHr = (a: Viewer) => a.permissions.has('users.write');

/** Whether someone may see a field (the person must also be in their scope). FH support never sees HR-only fields. */
export function canView(def: Pick<FieldDef, 'viewAccess'>, a: Viewer): boolean {
  if (def.viewAccess === 'HR') return isHr(a) && !a.support;
  return isHr(a) || a.permissions.has('users.read');
}
/** Whether someone may change a field (always also one they can see). */
export function canEdit(def: Pick<FieldDef, 'viewAccess' | 'editAccess'>, a: Viewer): boolean {
  if (!canView(def, a)) return false;
  if (def.editAccess === 'HR') return isHr(a);
  return isHr(a) || a.permissions.has('users.scheduling');
}

/** normalizeValue, as an HTTP 400 with the field's key. */
export function checkedValue(def: FieldDef, raw: unknown): string | null {
  try {
    return normalizeValue(def, raw);
  } catch (e) {
    if (e instanceof FieldValueError) throw new HttpError(400, e.code, e.message, { field: def.key });
    throw e;
  }
}

/** A stored value: plain text (manager-level fields) or sealed (HR-only fields); exactly one, as the table checks. */
export interface StoredValue {
  tenantId: string;
  fieldId: string;
  userId: string;
  value: string | null;
  valueCiphertext: Uint8Array | null;
  valueIv: Uint8Array | null;
  valueAuthTag: Uint8Array | null;
  valueWrappedKey: Uint8Array | null;
  valueKekId: string | null;
}

const valueAad = (tenantId: string, fieldId: string, userId: string) => `customfield:${tenantId}:${fieldId}:${userId}`;

/** The columns that store a value for a field with this access: sealed when HR-only. */
export async function valueColumns(tenantId: string, fieldId: string, userId: string, access: CustomFieldAccess, value: string) {
  if (access !== 'HR') return { value, valueCiphertext: null, valueIv: null, valueAuthTag: null, valueWrappedKey: null, valueKekId: null };
  const s = await seal(keys(), tenantKekId(tenantId), value, valueAad(tenantId, fieldId, userId));
  return { value: null, valueCiphertext: s.ciphertext, valueIv: s.iv, valueAuthTag: s.authTag, valueWrappedKey: s.wrappedDataKey, valueKekId: s.kekId };
}

/** A stored value as text, opened if sealed. Only for someone allowed to see the field. */
export async function storedValue(r: StoredValue): Promise<string | null> {
  if (r.value !== null) return r.value;
  if (!r.valueCiphertext || !r.valueIv || !r.valueAuthTag || !r.valueWrappedKey || !r.valueKekId) return null;
  return open(keys(), { ciphertext: Buffer.from(r.valueCiphertext), iv: Buffer.from(r.valueIv), authTag: Buffer.from(r.valueAuthTag), wrappedDataKey: Buffer.from(r.valueWrappedKey), kekId: r.valueKekId }, valueAad(r.tenantId, r.fieldId, r.userId));
}

/** A person's values for these fields, by field id, opened. The caller has checked who may see each. */
export async function fieldValues(tx: Tx, userId: string, fieldIds: string[]): Promise<Map<string, string>> {
  const rows = fieldIds.length ? await tx.customFieldValue.findMany({ where: { userId, fieldId: { in: fieldIds } } }) : [];
  const out = new Map<string, string>();
  for (const r of rows) {
    const v = await storedValue(r);
    if (v !== null) out.set(r.fieldId, v);
  }
  return out;
}

/** After a field's access changed: seal its values (now HR-only) or open them (now manager-level). */
export async function restoreFieldValues(tx: Tx, tenantId: string, fieldId: string, access: CustomFieldAccess) {
  const rows = await tx.customFieldValue.findMany({ where: { fieldId } });
  for (const r of rows) {
    if ((r.value === null) === (access === 'HR')) continue;
    const v = await storedValue(r);
    if (v !== null) await tx.customFieldValue.update({ where: { id: r.id }, data: await valueColumns(tenantId, fieldId, r.userId, access, v) });
  }
}

/** The organization's fields in order (archived ones only when asked). */
export async function fieldDefs(tx: Tx, opts: { archived?: boolean } = {}): Promise<FieldDef[]> {
  const rows = await tx.customFieldDefinition.findMany({ where: opts.archived ? {} : { archivedAt: null }, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] });
  return rows.map(fieldDef);
}

/** The fields someone may see on a person, with values and whether they may change each. The caller checks scope. */
export async function fieldsFor(tx: Tx, a: Viewer, userId: string) {
  const defs = (await fieldDefs(tx)).filter((d) => canView(d, a));
  const values = await fieldValues(tx, userId, defs.map((d) => d.id));
  return defs.map((d) => {
    const v = values.get(d.id) ?? null;
    return { id: d.id, key: d.key, label: d.label, labelFr: d.labelFr, type: d.type, choices: d.choices, required: d.required, viewAccess: d.viewAccess, editAccess: d.editAccess, editable: canEdit(d, a), value: typedValue(d, v), missing: d.required && v === null };
  });
}

/**
 * Sets some of a person's fields, by key (null or '' clears). Refuses a field the actor can't
 * change, and a key they can't see or that doesn't exist (CUSTOM_FIELD_UNKNOWN, the same answer
 * for both). Audited with the keys changed; values only for manager-level fields.
 */
export async function saveFieldValues(tx: Tx, a: Viewer & { tenantId: string; userId: string }, userId: string, input: Record<string, unknown>, opts: { onlyManagerLevel?: boolean } = {}) {
  const defs = await fieldDefs(tx);
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const changes: Array<{ def: FieldDef; value: string | null }> = [];
  for (const [key, raw] of Object.entries(input)) {
    const def = byKey.get(key);
    if (!def || !canView(def, a) || (opts.onlyManagerLevel && def.viewAccess === 'HR')) throw new HttpError(400, 'CUSTOM_FIELD_UNKNOWN', `There’s no field called ${key}.`, { field: key });
    if (!canEdit(def, a)) throw new HttpError(403, 'CUSTOM_FIELD_READ_ONLY', `You can’t change ${def.label}.`, { field: key });
    changes.push({ def, value: checkedValue(def, raw) });
  }
  const before = await fieldValues(tx, userId, changes.map((c) => c.def.id));
  const changed: Array<{ def: FieldDef; from: string | null; to: string | null }> = [];
  for (const c of changes) {
    const old = before.get(c.def.id) ?? null;
    if (old === c.value) continue;
    if (c.value === null) await tx.customFieldValue.deleteMany({ where: { userId, fieldId: c.def.id } });
    else {
      const stored = await valueColumns(a.tenantId, c.def.id, userId, c.def.viewAccess, c.value);
      await tx.customFieldValue.upsert({ where: { fieldId_userId: { fieldId: c.def.id, userId } }, update: { ...stored, updatedById: a.userId }, create: { tenantId: a.tenantId, fieldId: c.def.id, userId, ...stored, updatedById: a.userId } });
    }
    changed.push({ def: c.def, from: old, to: c.value });
  }
  if (changed.length) {
    const shown = (c: (typeof changed)[number], v: string | null) => (c.def.viewAccess === 'HR' ? '[HR only]' : v);
    await audit(tx, {
      tenantId: a.tenantId,
      actorId: a.userId,
      action: 'customfields.update',
      entity: 'User',
      entityId: userId,
      before: Object.fromEntries(changed.map((c) => [c.def.key, shown(c, c.from)])),
      after: Object.fromEntries(changed.map((c) => [c.def.key, shown(c, c.to)])),
    });
  }
  return changed.map((c) => c.def.key);
}

/** For the person's own records export: every field with a value, labelled, whatever its access. */
export async function personFieldRecords(tx: Tx, userId: string) {
  const values = await tx.customFieldValue.findMany({ where: { userId }, include: { field: true }, orderBy: { field: { sortOrder: 'asc' } } });
  const out = [];
  for (const v of values) out.push({ field: v.field.label, fieldFr: v.field.labelFr, key: v.field.key, value: typedValue(v.field, await storedValue(v)), updatedAt: v.updatedAt });
  return out;
}

/** Erasure: a person's values go with their identity. */
export async function forgetFieldValues(tx: Tx, userId: string): Promise<number> {
  return (await tx.customFieldValue.deleteMany({ where: { userId } })).count;
}
