export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The server's error in the reader's language: errors.<CODE>, with the error's
 * details filling its {{placeholders}} (a line number, a limit). The server's own
 * English message is the fallback for a code the app doesn't know yet.
 */
export function errorText(t: Translate, e: unknown, fallback?: string): string {
  if (!(e instanceof ApiError)) return fallback ?? t('common.error');
  const params = e.details && typeof e.details === 'object' && !Array.isArray(e.details) ? (e.details as Record<string, unknown>) : {};
  // Plain values only: `count` would switch plural forms, and objects can't fill a sentence.
  const values = Object.fromEntries(Object.entries(params).filter(([k, v]) => k !== 'count' && (typeof v === 'string' || typeof v === 'number')));
  return t(`errors.${e.code}`, { ...values, defaultValue: e.message });
}
