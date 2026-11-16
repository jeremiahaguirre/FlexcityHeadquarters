import { describe, expect, it } from 'vitest';
import { canEdit, canView } from '../../src/services/people/customFields.js';
import { type FieldShape, FieldValueError, normalizeValue, typedValue } from '../../src/services/people/customFieldValues.js';
import { previewImport } from '../../src/services/platform/staffImport.js';

const f = (type: FieldShape['type'], extra: Partial<FieldShape> = {}): FieldShape => ({ key: 'k', label: 'K', type, choices: [], required: false, ...extra });
const code = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as FieldValueError).code;
  }
};

describe('custom field values', () => {
  it('stores each type in one canonical form', () => {
    expect(normalizeValue(f('TEXT'), '  B-104 ')).toBe('B-104');
    expect(normalizeValue(f('NUMBER'), '1 234,50')).toBe('1234.5');
    expect(normalizeValue(f('NUMBER'), 7)).toBe('7');
    expect(normalizeValue(f('DATE'), '2028-02-29')).toBe('2028-02-29');
    const sizes = f('CHOICE', { choices: [{ value: 'S', label: 'Small', labelFr: 'Petit' }] });
    expect(normalizeValue(sizes, 'petit')).toBe('S');
    expect(normalizeValue(f('BOOLEAN'), 'Oui')).toBe('true');
    expect(normalizeValue(f('BOOLEAN'), false)).toBe('false');
    expect(typedValue({ type: 'NUMBER' }, '12')).toBe(12);
    expect(typedValue({ type: 'BOOLEAN' }, 'true')).toBe(true);
  });

  it('refuses the wrong type, and a required field left empty', () => {
    expect(code(() => normalizeValue(f('NUMBER'), '12a'))).toBe('CUSTOM_FIELD_INVALID');
    expect(code(() => normalizeValue(f('DATE'), '2027-02-29'))).toBe('CUSTOM_FIELD_INVALID');
    expect(code(() => normalizeValue(f('BOOLEAN'), 'maybe'))).toBe('CUSTOM_FIELD_INVALID');
    expect(code(() => normalizeValue(f('TEXT'), 'x'.repeat(501)))).toBe('CUSTOM_FIELD_INVALID');
    expect(code(() => normalizeValue(f('TEXT', { required: true }), ' '))).toBe('CUSTOM_FIELD_REQUIRED');
    expect(normalizeValue(f('TEXT'), '')).toBeNull();
  });
});

describe('who sees and changes a field', () => {
  const p = (...perms: string[]) => ({ permissions: new Set(perms) as never });
  const hrOnly = { viewAccess: 'HR', editAccess: 'HR' } as const;
  const managers = { viewAccess: 'MANAGER', editAccess: 'MANAGER' } as const;
  it('HR sees everything; a manager sees manager-level fields and changes them with users.scheduling', () => {
    expect(canView(hrOnly, p('users.write'))).toBe(true);
    expect(canView(hrOnly, p('users.read', 'users.scheduling'))).toBe(false);
    expect(canView(managers, p('users.read'))).toBe(true);
    expect(canEdit(managers, p('users.read'))).toBe(false);
    expect(canEdit(managers, p('users.read', 'users.scheduling'))).toBe(true);
    expect(canEdit({ viewAccess: 'MANAGER', editAccess: 'HR' }, p('users.read', 'users.scheduling'))).toBe(false);
    expect(canView(managers, p('schedule.read'))).toBe(false);
  });
  it('an FH support visit never sees an HR-only field, whatever it holds', () => {
    expect(canView(hrOnly, { ...p('users.write'), support: { level: 'FULL' } })).toBe(false);
    expect(canView(managers, { ...p('users.write'), support: { level: 'FULL' } })).toBe(true);
  });
});

describe('staff import with custom fields', () => {
  const fields = [
    { id: 'f1', key: 'badge_number', label: 'Badge number', labelFr: 'Numéro d’insigne', type: 'TEXT' as const, choices: [], required: true, viewAccess: 'MANAGER' as const },
    { id: 'f2', key: 'sin_ref', label: 'Reference', labelFr: 'Référence', type: 'TEXT' as const, choices: [], required: false, viewAccess: 'HR' as const },
  ];
  const ctx = { existingEmails: new Set<string>(), positions: [], customFields: fields, normalize: normalizeValue, today: '2026-11-16' };
  it('matches columns by key or by English or French label, and never reads HR-only columns', () => {
    const pv = previewImport('first_name,last_name,email,Numéro d’insigne,sin_ref\nA,B,a@x.test,B-1,SECRET\n', ctx);
    expect(pv.rows[0]!.customFields).toEqual({ f1: 'B-1' });
    expect(pv.hrOnlyColumns).toEqual(['sin_ref']);
    expect(JSON.stringify(pv)).not.toContain('SECRET');
  });
  it('a required manager-level field with no column is a missing column', () => {
    expect(previewImport('first_name,last_name,email\nA,B,a@x.test\n', ctx).missingColumns).toEqual(['Badge number']);
    expect(previewImport('first_name,last_name,email\nA,B,a@x.test\n', { ...ctx, customFields: [] }).missingColumns).toEqual([]);
  });
});
