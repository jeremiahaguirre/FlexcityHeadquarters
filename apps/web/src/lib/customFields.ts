/** Custom fields on people (apps/api/src/services/people/customFields.ts). */
export type CustomFieldType = 'TEXT' | 'NUMBER' | 'DATE' | 'CHOICE' | 'BOOLEAN';
export type FieldAccess = 'HR' | 'MANAGER';
export interface FieldChoice { value: string; label: string; labelFr: string }
export const FIELD_TYPES: CustomFieldType[] = ['TEXT', 'NUMBER', 'DATE', 'CHOICE', 'BOOLEAN'];

/** One field on a person's file, as the API gives it to the person looking. */
export interface PersonField {
  id: string;
  key: string;
  label: string;
  labelFr: string;
  type: CustomFieldType;
  choices: FieldChoice[];
  required: boolean;
  viewAccess: FieldAccess;
  editAccess: FieldAccess;
  editable: boolean;
  value: string | number | boolean | null;
  missing: boolean;
}

/** A value as the form holds it (text), and back. */
export const formValue = (f: PersonField) => (f.value === null ? '' : String(f.value));
