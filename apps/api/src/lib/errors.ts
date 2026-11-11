/** Errors that carry an HTTP status and a stable code; app.ts turns them into the JSON error body. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, 'NOT_FOUND', `${what} not found`);
export const forbidden = (msg = 'Forbidden') => new HttpError(403, 'FORBIDDEN', msg);
export const conflict = (code: string, msg: string, details?: unknown) =>
  new HttpError(409, code, msg, details);
export const badRequest = (msg: string, details?: unknown) =>
  new HttpError(400, 'BAD_REQUEST', msg, details);
