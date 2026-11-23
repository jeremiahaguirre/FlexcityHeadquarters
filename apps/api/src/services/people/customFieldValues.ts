/**
 * Custom field values, checked and written in their canonical form. No imports: the staff import
 * (bundled into the web app's demo too) uses this as well as the API.
 */
export type FieldType = 'TEXT' | 'NUMBER' | 'DATE' | 'CHOICE' | 'BOOLEAN';
export type FieldAccess = 'HR' | 'MANAGER';
export interface FieldChoice { value: string; label: string; labelFr: string }
export interface FieldShape { key: string; label: string; type: FieldType; choices: FieldChoice[]; required: boolean }

export const MAX_TEXT = 500;

/** Why a value was refused: CUSTOM_FIELD_REQUIRED (a required field left empty) or CUSTOM_FIELD_INVALID. */
export class FieldValueError extends Error {
  constructor(public readonly code: 'CUSTOM_FIELD_REQUIRED' | 'CUSTOM_FIELD_INVALID', public readonly field: FieldShape) {
    super(code === 'CUSTOM_FIELD_REQUIRED' ? `${field.label} is required.` : `That isn’t a valid value for ${field.label}.`);
  }
}

/**
 * The value as stored, or null when empty. Numbers as plain decimals, dates as YYYY-MM-DD, a
 * choice as its value (matched by value or by its English or French label), yes/no as true/false.
 */
export function normalizeValue(def: FieldShape, raw: unknown): string | null {
  const empty = raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '');
  if (empty) {
    if (def.required) throw new FieldValueError('CUSTOM_FIELD_REQUIRED', def);
    return null;
  }
  const bad = () => new FieldValueError('CUSTOM_FIELD_INVALID', def);
  switch (def.type) {
    case 'TEXT': {
      if (typeof raw !== 'string' && typeof raw !== 'number') throw bad();
      const s = String(raw).trim();
      if (s.length > MAX_TEXT) throw bad();
      return s;
    }
    case 'NUMBER': {
      const s = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim().replace(/\s/g, '').replace(',', '.') : '';
      if (!/^-?\d{1,12}(\.\d{1,6})?$/.test(s)) throw bad();
      return String(Number(s));
    }
    case 'DATE': {
      const s = typeof raw === 'string' ? raw.trim() : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`)) || !new Date(`${s}T00:00:00Z`).toISOString().startsWith(s)) throw bad();
      return s;
    }
    case 'CHOICE': {
      const s = typeof raw === 'string' ? raw.trim() : '';
      const lower = s.toLowerCase();
      const c = def.choices.find((x) => x.value === s) ?? def.choices.find((x) => [x.value, x.label, x.labelFr].some((v) => v.toLowerCase() === lower));
      if (!c) throw bad();
      return c.value;
    }
    case 'BOOLEAN': {
      if (typeof raw === 'boolean') return raw ? 'true' : 'false';
      const s = String(raw).trim().toLowerCase();
      if (['true', 'yes', 'y', '1', 'oui', 'o'].includes(s)) return 'true';
      if (['false', 'no', 'n', '0', 'non'].includes(s)) return 'false';
      throw bad();
    }
  }
}

/** A stored value as JSON: numbers as numbers, yes/no as booleans, the rest as text. */
export function typedValue(def: { type: FieldType }, v: string | null): string | number | boolean | null {
  if (v === null) return null;
  if (def.type === 'NUMBER') return Number(v);
  if (def.type === 'BOOLEAN') return v === 'true';
  return v;
}
