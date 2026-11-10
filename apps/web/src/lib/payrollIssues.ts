import type { TFunction } from 'i18next';

export interface Issue { code: string; params?: Record<string, string | number> }

/** A payroll problem or warning in the reader's language. Older pay runs stored plain English, shown as is. */
export function issueLabel(t: TFunction, i: Issue | string): string {
  if (typeof i === 'string') return i;
  return t(`payrollIssues.${i.code}`, { ...(i.params ?? {}), defaultValue: i.code });
}
export const issueKey = (i: Issue | string) => (typeof i === 'string' ? i : JSON.stringify(i));
