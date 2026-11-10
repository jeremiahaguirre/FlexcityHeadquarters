/**
 * Server logs are read by FH operators, who have no right to the personal
 * information inside a city's records. Nothing that may carry it goes to the
 * log: database errors are cut to their code and first line (Prisma otherwise
 * prints the query's arguments, names and dates included), and emails are
 * logged without their contents.
 */

/** A one-line description of an error, plus its stack frames, with no request data. */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return `non-error thrown (${typeof err})`;
  const code = (err as { code?: unknown }).code;
  const first = err.message.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  // Prisma names the call ("Invalid `prisma.user.create()` invocation:") on the first line; the arguments follow it.
  const head = `${err.name}${typeof code === 'string' ? ` ${code}` : ''}: ${first.slice(0, 200)}`;
  const frames = (err.stack ?? '').split('\n').filter((l) => /^\s+at /.test(l)).slice(0, 8);
  return [head, ...frames].join('\n');
}

export function logError(context: string, err: unknown): void {
  console.error(`[error] ${context}\n${describeError(err)}`);
}

/** j•••@city.ca: enough to tell messages apart, not enough to identify someone. */
export function maskEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@');
  return `${user.slice(0, 1)}•••@${domain}`;
}
