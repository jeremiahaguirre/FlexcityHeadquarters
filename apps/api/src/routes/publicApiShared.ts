/**
 * What the public API's read and write routes share (routes/publicApi.ts, routes/publicApiWrite.ts):
 * the key in the request, scope checks, the error shape, ETags, and the records' public shapes.
 */
import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodIssue } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import { type Tx, withTenant } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { type ApiScope, SCOPE_FEATURES } from '../services/integrations/apiKeys.js';
import { tenantSettings } from '../services/platform/features.js';

export interface ApiKeyContext {
  id: string;
  name: string;
  tenantId: string;
  scopes: string[];
  createdById: string;
  rateLimitPerMinute: number;
}
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiKey?: ApiKeyContext;
    }
  }
}

/** The request needs one of these scopes (and its feature switched on). */
export function need(...scopes: ApiScope[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const k = req.apiKey!;
      const held = scopes.find((s) => k.scopes.includes(s));
      if (!held) throw new HttpError(403, 'INSUFFICIENT_SCOPE', `This API key needs the ${scopes.join(' or ')} scope.`, { scope: scopes.length === 1 ? scopes[0] : scopes });
      const feature = SCOPE_FEATURES[held];
      if (feature && !(await tenantSettings(k.tenantId)).features[feature]) throw new HttpError(404, 'FEATURE_OFF', 'This feature is switched off for the organization.');
      next();
    } catch (e) {
      next(e);
    }
  };
}

export const read = <T>(req: Request, fn: (tx: Tx) => Promise<T>) => withTenant(req.apiKey!.tenantId, fn);

/* ---------- Errors: problem details (RFC 9457) with a stable code ---------- */

export interface FieldError {
  field: string;
  code: string;
  message: string;
}

const TITLES: Record<number, string> = { 400: 'Bad request', 401: 'Unauthorized', 402: 'Payment required', 403: 'Forbidden', 404: 'Not found', 409: 'Conflict', 412: 'Precondition failed', 413: 'Payload too large', 415: 'Unsupported media type', 422: 'Unprocessable content', 428: 'Precondition required', 429: 'Too many requests', 500: 'Internal server error' };

/** snake_case field paths ("positions.0") as the client sent them. */
const fieldOf = (path: PropertyKey[]) => path.map(String).join('.');

export function zodFieldErrors(issues: ZodIssue[]): FieldError[] {
  return issues.flatMap((i) =>
    i.code === 'unrecognized_keys' ? i.keys.map((k) => ({ field: fieldOf([...i.path, k]), code: 'unknown_field', message: 'This field isn’t accepted here.' })) : [{ field: fieldOf(i.path) || '(body)', code: i.code, message: i.message }],
  );
}

/** A 422 for fields that failed validation. */
export const invalid = (errors: FieldError[], message = 'Some fields aren’t valid.') => new HttpError(422, 'VALIDATION', message, { errors });

export interface Problem {
  status: number;
  body: Record<string, unknown>;
}

/** Any error as the API's problem body: type, title, status, code, message, field errors, request id. */
export function toProblem(err: unknown, requestId: string | undefined): Problem | null {
  let status: number;
  let code: string;
  let message: string;
  let details: unknown;
  let errors: FieldError[] | undefined;
  if (err instanceof HttpError) {
    ({ status, code, message, details } = err);
    const d = details as { errors?: FieldError[]; field?: string } | undefined;
    if (d?.errors) {
      errors = d.errors;
      details = undefined;
    } else if (d?.field) errors = [{ field: d.field, code: code.toLowerCase(), message }];
  } else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    // Two requests creating the same record at once: one wins, the other is told to read it again.
    status = 409;
    code = 'ALREADY_EXISTS';
    message = 'Another request just made this record. Read it, then retry your change.';
  } else if (err instanceof ZodError) {
    status = 422;
    code = 'VALIDATION';
    message = 'Some fields aren’t valid.';
    errors = zodFieldErrors(err.issues);
  } else {
    const s = (err as { status?: unknown; type?: unknown }).status;
    if (typeof s === 'number' && s >= 400 && s < 500 && typeof (err as { type?: unknown }).type === 'string') {
      status = s;
      code = s === 413 ? 'TOO_LARGE' : 'BAD_JSON';
      message = s === 413 ? 'The request body is too large (100 kB at most).' : 'The request body isn’t valid JSON.';
    } else return null;
  }
  return {
    status,
    body: {
      type: 'about:blank',
      title: TITLES[status] ?? 'Error',
      status,
      code,
      message,
      detail: message,
      ...(errors ? { errors } : {}),
      ...(details !== undefined ? { details } : {}),
      request_id: requestId,
      requestId,
    },
  };
}

export function sendProblem(res: Response, p: Problem) {
  res.status(p.status).type('application/problem+json').send(JSON.stringify(p.body));
}

/* ---------- ETags: a record's version, from when it last changed ---------- */

export const etagOf = (updatedAt: Date) => `"${updatedAt.getTime().toString(36)}"`;

const LOCKABLE = { User: 'User', Department: 'Department', Position: 'Position' } as const;

/**
 * With an If-Match header, the record must still be the version the client read: the row is locked
 * for the rest of the transaction, and a different version answers 412.
 */
export async function checkIfMatch(tx: Tx, req: Request, table: keyof typeof LOCKABLE, id: string): Promise<void> {
  const header = req.header('if-match');
  if (!header) return;
  const rows = await tx.$queryRawUnsafe<Array<{ updatedAt: Date }>>(`SELECT "updatedAt" FROM "${LOCKABLE[table]}" WHERE id = $1::uuid FOR UPDATE`, id);
  const row = rows[0];
  if (!row) return; // not found is answered by the change itself
  const wanted = header.split(',').map((t) => t.trim().replace(/^W\//, ''));
  const current = etagOf(row.updatedAt);
  if (!wanted.includes('*') && !wanted.includes(current)) throw new HttpError(412, 'PRECONDITION_FAILED', 'This record changed since you read it. Read it again, then send your change with its new ETag.', { etag: current });
}

/* ---------- Public shapes (snake_case, stable) ---------- */

export const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
export const iso = (d: Date | null) => (d ? d.toISOString() : null);
export const money = (v: unknown) => (v === null || v === undefined ? null : Number(v).toFixed(2));

export const PERSON_SELECT = {
  id: true,
  employeeNumber: true,
  externalId: true,
  firstName: true,
  lastName: true,
  preferredName: true,
  email: true,
  status: true,
  employmentStatus: true,
  hireDate: true,
  reportsToId: true,
  processingRestrictedAt: true,
  anonymizedAt: true,
  createdAt: true,
  updatedAt: true,
  positions: { select: { position: { select: { id: true, name: true, departmentId: true } } } },
} satisfies Prisma.UserSelect;
export type PersonRow = Prisma.UserGetPayload<{ select: typeof PERSON_SELECT }>;

export function person(u: PersonRow) {
  const hidden = !!u.processingRestrictedAt || !!u.anonymizedAt;
  const positions = u.positions.map((p) => ({ id: p.position.id, name: p.position.name, department_id: p.position.departmentId }));
  return {
    id: u.id,
    external_id: hidden ? null : u.externalId,
    employee_number: hidden ? null : u.employeeNumber,
    first_name: hidden ? null : u.firstName,
    last_name: hidden ? null : u.lastName,
    preferred_name: hidden ? null : u.preferredName,
    email: hidden ? null : u.email,
    status: u.status.toLowerCase(),
    employment_status: u.employmentStatus.toLowerCase(),
    hire_date: hidden ? null : day(u.hireDate),
    manager_id: hidden ? null : u.reportsToId,
    department_ids: hidden ? [] : [...new Set(positions.map((p) => p.department_id).filter((d): d is string => !!d))],
    positions: hidden ? [] : positions,
    processing_restricted: hidden,
    created_at: iso(u.createdAt),
    updated_at: iso(u.updatedAt),
  };
}

export const DEPARTMENT_SELECT = { id: true, name: true, nameFr: true, glCode: true, externalId: true, createdAt: true, updatedAt: true, managers: { select: { userId: true } } } satisfies Prisma.DepartmentSelect;
export const department = (d: Prisma.DepartmentGetPayload<{ select: typeof DEPARTMENT_SELECT }>) => ({
  id: d.id,
  external_id: d.externalId,
  name: d.name,
  name_fr: d.nameFr,
  gl_code: d.glCode,
  manager_ids: d.managers.map((m) => m.userId),
  created_at: iso(d.createdAt),
  updated_at: iso(d.updatedAt),
});

export const POSITION_SELECT = { id: true, name: true, nameFr: true, departmentId: true, externalId: true, updatedAt: true } satisfies Prisma.PositionSelect;
export const position = (p: Prisma.PositionGetPayload<{ select: typeof POSITION_SELECT }>) => ({ id: p.id, external_id: p.externalId, name: p.name, name_fr: p.nameFr, department_id: p.departmentId, updated_at: iso(p.updatedAt) });

// Never the person's note or the decision note: they can hold health details.
export const TIME_OFF_SELECT = { id: true, userId: true, type: true, status: true, startsAt: true, endsAt: true, chargedHours: true, decidedAt: true, createdAt: true, updatedAt: true } satisfies Prisma.TimeOffRequestSelect;
export const timeOff = (r: Prisma.TimeOffRequestGetPayload<{ select: typeof TIME_OFF_SELECT }>) => ({
  id: r.id,
  person_id: r.userId,
  type: r.type.toLowerCase(),
  status: r.status.toLowerCase(),
  starts_at: iso(r.startsAt),
  ends_at: iso(r.endsAt),
  hours: money(r.chargedHours),
  approved_at: r.status === 'APPROVED' || r.status === 'CANCELLED' ? iso(r.decidedAt) : null,
  created_at: iso(r.createdAt),
  updated_at: iso(r.updatedAt),
});
