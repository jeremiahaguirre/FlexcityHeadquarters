/**
 * Writes through the public API (docs/PUBLIC-API.md): an organization's HRIS or ERP sends changes in.
 *
 * - Opt-in write scopes per key: people:write, departments:write, positions:write, timeoff:write
 *   (and timeoff:approve to send time off already approved). The key acts with its maker's access,
 *   checked at every request: if they leave or lose the permission, the key stops changing data.
 *   Keys are organization-wide: there's no department limit on what a key can change.
 * - The app's own rules, through the same services HR's screens use (services/people/*): the same
 *   validation, uniqueness, reporting-line checks, offboarding and time-off rules. Nothing is ever
 *   deleted; SIN, bank, pay and health details are never accepted.
 * - Every change is audited with the key as the actor ("API key Payroll sync"), and webhooks fire
 *   from the database as for any other change.
 * - POST needs an Idempotency-Key (services/integrations/idempotency.ts); PATCH takes If-Match with
 *   the record's ETag (412 when it changed); PUT …/by-external-id/:id creates or updates by the
 *   organization's own id. Validation errors are 422 with field errors.
 * - Writes have their own per-key rate limit, on top of the key's overall one.
 */
import { type NextFunction, type Request, type Response, Router } from 'express';
import { z } from 'zod';
import type { EmploymentStatus, TimeOffType } from '@prisma/client';
import type { AuthContext } from '../auth/middleware.js';
import { databaseAllow } from '../auth/rateLimit.js';
import { actAsApiKey, audit, type Tx, withTenant } from '../lib/db.js';
import { HttpError, notFound } from '../lib/errors.js';
import { dispatchSoon, withEvents } from '../lib/events.js';
import { type ApiScope, SCOPE_PERMISSIONS } from '../services/integrations/apiKeys.js';
import { type StoredAnswer, claimIdempotency, finishIdempotency, idempotencyKeyOf, releaseIdempotency, requestHash } from '../services/integrations/idempotency.js';
import { customAccess, stillActive } from '../services/people/customRoles.js';
import { saveDepartment } from '../services/people/departmentAdmin.js';
import { savePosition } from '../services/people/positionAdmin.js';
import { OFFBOARD_REASONS, createPerson, startOffboarding, updatePerson } from '../services/people/staffAdmin.js';
import { cancelTimeOff, decideTimeOff, requestTimeOff } from '../services/people/timeOff.js';
import { tenantSettings, withoutDisabled } from '../services/platform/features.js';
import { permissionsWithOverrides } from '../services/platform/roleOverrides.js';
import { DEPARTMENT_SELECT, type FieldError, PERSON_SELECT, POSITION_SELECT, TIME_OFF_SELECT, checkIfMatch, department, etagOf, invalid, need, person, position, sendProblem, timeOff, toProblem } from './publicApiShared.js';

export const publicApiWriteRouter = Router();

/** Writes a key may make per minute (and never more than its overall limit). */
export const WRITES_PER_MINUTE = 60;

interface WriteResult {
  status: number;
  body: unknown;
  etag?: string;
  location?: string;
}
interface WriteCtx {
  /** The key, acting with its maker's access across the whole organization. */
  actor: AuthContext;
  /** A transaction in which every audit entry names the key as the actor. */
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

/**
 * The key's maker, as the one whose access the key uses: still active, and still holding the
 * permission the scope needs. Scope null: keys are organization-wide.
 */
async function keyActor(req: Request, scopes: ApiScope[]): Promise<AuthContext> {
  const k = req.apiKey!;
  const creator = await withTenant(k.tenantId, (tx) => tx.user.findUnique({ where: { id: k.createdById }, select: { id: true, roles: true } }));
  if (!creator || !(await stillActive(k.tenantId, creator.id))) throw new HttpError(403, 'KEY_OWNER_INACTIVE', 'The person who made this key no longer has access, so it can’t change data. Ask an administrator to make a new key.');
  const [settings, custom] = await Promise.all([tenantSettings(k.tenantId), customAccess(k.tenantId, creator.id)]);
  const permissions = withoutDisabled(new Set([...permissionsWithOverrides(creator.roles, settings.overrides), ...custom.perms]), settings.features);
  const scope = scopes.find((s) => k.scopes.includes(s))!;
  if (!SCOPE_PERMISSIONS[scope].some((p) => permissions.has(p))) throw new HttpError(403, 'KEY_OWNER_LACKS_PERMISSION', `The person who made this key no longer has the access ${scope} needs, so the key can’t make this change.`, { scope });
  return { userId: creator.id, tenantId: k.tenantId, roles: creator.roles, permissions, authenticatedAt: new Date(), mfa: true, mfaPending: false, scope: null };
}

function send(res: Response, a: StoredAnswer) {
  if (a.etag) res.setHeader('ETag', a.etag);
  if (a.location) res.setHeader('Location', a.location);
  if (a.status >= 400) return sendProblem(res, { status: a.status, body: a.body as Record<string, unknown> });
  res.status(a.status).json(a.body);
}

/** A write route: scope, limits, Idempotency-Key, the key's actor, and one answer whatever happens. */
function write(scopes: ApiScope[], fn: (req: Request, w: WriteCtx) => Promise<WriteResult>) {
  return [
    need(...scopes),
    async (req: Request, res: Response, next: NextFunction) => {
      let claim: { tenantId: string; id: string } | null = null;
      try {
        const k = req.apiKey!;
        const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
        if (hasBody && !req.is('application/json')) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the body as JSON (`Content-Type: application/json`).');
        const settings = await tenantSettings(k.tenantId);
        if (settings.billing.stage === 'suspended') throw new HttpError(402, 'ACCOUNT_SUSPENDED', 'Your organization’s account is read-only until the overdue balance is paid.');
        if (!(await databaseAllow(`api-key-write:${k.id}`, Math.min(WRITES_PER_MINUTE, k.rateLimitPerMinute), 60_000))) {
          res.setHeader('Retry-After', '60');
          throw new HttpError(429, 'RATE_LIMITED', `This key can make ${Math.min(WRITES_PER_MINUTE, k.rateLimitPerMinute)} changes a minute. Try again shortly.`);
        }
        // POST must carry an Idempotency-Key; PUT may.
        const header = req.header('idempotency-key');
        if (req.method === 'POST' || header) {
          const path = `${req.baseUrl}${req.path}`;
          const c = await claimIdempotency(k.tenantId, k.id, idempotencyKeyOf(header), req.method, path, requestHash(req.method, path, req.body ?? null));
          if ('replay' in c) {
            res.setHeader('Idempotent-Replayed', 'true');
            return send(res, c.replay);
          }
          claim = { tenantId: k.tenantId, id: c.claimId };
        }
        let result: WriteResult;
        try {
          const actor = await keyActor(req, scopes);
          const ctx: WriteCtx = {
            actor,
            tx: (f) =>
              withTenant(k.tenantId, async (tx) => {
                actAsApiKey(tx, { id: k.id, name: k.name });
                return f(tx);
              }),
          };
          result = await fn(req, ctx);
        } catch (e) {
          // A business rule's 400 is a refused change: 422, like a field that failed validation.
          throw e instanceof HttpError && e.status === 400 ? new HttpError(422, e.code, e.message, e.details) : e;
        }
        if (claim) await finishIdempotency(claim.tenantId, claim.id, result);
        dispatchSoon(k.tenantId);
        send(res, result);
      } catch (e) {
        if (claim) {
          const p = toProblem(e, req.id);
          // Refusals are part of the answer (a retry gets the same one); our own failures free the key.
          await (p && p.status < 500 ? finishIdempotency(claim.tenantId, claim.id, { status: p.status, body: p.body }) : releaseIdempotency(claim.tenantId, claim.id)).catch(() => undefined);
        }
        next(e);
      }
    },
  ];
}

/* ---------- Bodies ---------- */

const uuid = z.string().uuid();
/** The organization's own id for a record: letters, digits and . _ : @ - (it goes in a URL). */
const externalId = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._:@-]+$/, 'Use letters, digits and . _ : @ - only.');
const date = z.string().date();

/** Never accepted, whatever the scope: these are entered in the app, by people allowed to see them. */
const NEVER = new Set(['sin', 'social_insurance_number', 'sin_last4', 'bank', 'bank_account', 'bank_accounts', 'account_number', 'transit_number', 'institution_number', 'direct_deposit', 'date_of_birth', 'dob', 'birth_date', 'birthdate', 'medical', 'health', 'diagnosis', 'accommodation', 'accommodations', 'restrictions', 'pay_rate', 'pay_rates', 'hourly_rate', 'salary', 'password', 'password_hash', 'notes', 'discipline', 'reliability']);
/** A person's fields that are written another way. */
const PERSON_ELSEWHERE: Record<string, string> = {
  roles: 'Access roles are given in the app, by an administrator.',
  status: 'End someone’s employment with POST /people/{id}/terminate.',
  department_ids: 'A person’s departments follow their positions: send position_ids.',
};

/** Parses a JSON object body: sensitive fields first (a clear refusal), then the schema (422 with field errors). */
function body<T extends z.ZodTypeAny>(req: Request, schema: T, elsewhere: Record<string, string> = {}): z.infer<T> {
  const b: unknown = req.body;
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw invalid([{ field: '(body)', code: 'invalid_type', message: 'Send a JSON object.' }]);
  const refused: FieldError[] = Object.keys(b).flatMap((k) =>
    NEVER.has(k.toLowerCase()) ? [{ field: k, code: 'not_writable', message: 'Never accepted through the API: SIN, bank, pay, birth date and health details are entered in the app only.' }] : elsewhere[k] ? [{ field: k, code: 'not_writable', message: elsewhere[k]! }] : [],
  );
  if (refused.length) throw invalid(refused, 'Some fields can’t be written through the API.');
  const r = schema.safeParse(b);
  if (!r.success) throw r.error;
  return r.data;
}

const atLeastOne = (b: object) => {
  if (!Object.keys(b).length) throw invalid([{ field: '(body)', code: 'empty', message: 'Send at least one field to change.' }]);
};

/* ---------- People ---------- */

const EMPLOYMENT = ['full_time', 'part_time', 'casual', 'on_call', 'volunteer'] as const;
const name = z.string().trim().min(1).max(60);
const personFields = {
  first_name: name,
  last_name: name,
  preferred_name: z.string().trim().max(60).nullable(),
  email: z.string().trim().toLowerCase().email().max(160),
  phone: z.string().trim().max(30).nullable(),
  employee_number: z.string().trim().min(1).max(40).nullable(),
  employment_status: z.enum(EMPLOYMENT),
  hire_date: date.nullable(),
  position_ids: z.array(uuid).max(10),
  manager_id: uuid.nullable(),
  external_id: externalId.nullable(),
};
const personCreate = z
  .object({
    ...personFields,
    preferred_name: personFields.preferred_name.optional(),
    phone: personFields.phone.optional(),
    employee_number: personFields.employee_number.optional(),
    hire_date: personFields.hire_date.optional(),
    position_ids: personFields.position_ids.default([]),
    manager_id: personFields.manager_id.optional(),
    external_id: personFields.external_id.optional(),
    locale: z.enum(['en-CA', 'fr-CA']).optional(),
    /** Email them an invitation to sign in (default). false: a record without sign-in until HR invites them. */
    invite: z.boolean().default(true),
  })
  .strict();
const personPatch = z.object(personFields).partial().strict();
/** By external id: the id is in the path; invite and locale apply only when it's created. */
const personPut = personCreate.omit({ external_id: true }).partial().strict();

const loadPerson = (tx: Tx, id: string) => tx.user.findUniqueOrThrow({ where: { id }, select: PERSON_SELECT });
const personAnswer = (status: number, u: Awaited<ReturnType<typeof loadPerson>>): WriteResult => ({ status, body: person(u), etag: etagOf(u.updatedAt), location: `/api/v1/people/${u.id}` });

const personChange = (b: z.infer<typeof personPatch>) => ({
  firstName: b.first_name,
  lastName: b.last_name,
  preferredName: b.preferred_name,
  email: b.email,
  phone: b.phone,
  employeeNumber: b.employee_number,
  employmentStatus: b.employment_status?.toUpperCase() as EmploymentStatus | undefined,
  hireDate: b.hire_date,
  positionIds: b.position_ids,
  managerId: b.manager_id,
  externalId: b.external_id,
});

/** Writable fields only, for the audit log (never an invitation link). */
const audited = (b: object) => Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));

async function addPerson(w: WriteCtx, req: Request, b: z.infer<typeof personCreate>) {
  return w.tx(async (tx) => {
    const t = await tx.tenant.findFirstOrThrow({ select: { subdomain: true, defaultLocale: true } });
    const u = await createPerson(
      tx,
      w.actor,
      {
        firstName: b.first_name,
        lastName: b.last_name,
        preferredName: b.preferred_name ?? null,
        email: b.email,
        phone: b.phone ?? null,
        // A new person starts as an employee; access roles are given in the app.
        roles: ['EMPLOYEE'],
        employmentStatus: b.employment_status.toUpperCase() as EmploymentStatus,
        locale: b.locale ?? t.defaultLocale,
        hireDate: b.hire_date ?? null,
        employeeNumber: b.employee_number ?? null,
        externalId: b.external_id ?? null,
        positionIds: b.position_ids,
        customRoleIds: [],
        managerId: b.manager_id ?? null,
      },
      { invite: b.invite, subdomain: t.subdomain, audit: audited({ ...b, via: 'api' }) },
    );
    return personAnswer(201, await loadPerson(tx, u.id));
  });
}

async function changePerson(w: WriteCtx, req: Request, tx: Tx, id: string, b: z.infer<typeof personPatch>) {
  await checkIfMatch(tx, req, 'User', id);
  const u = await tx.user.findUnique({ where: { id }, select: { anonymizedAt: true, processingRestrictedAt: true } });
  if (!u || u.anonymizedAt) throw notFound('Person');
  if (u.processingRestrictedAt) throw new HttpError(409, 'PROCESSING_RESTRICTED', 'This person asked for their information to be erased; their record can’t be changed.');
  await updatePerson(tx, w.actor, id, personChange(b));
  return personAnswer(200, await loadPerson(tx, id));
}

const idParam = (req: Request, what: string) => {
  const r = uuid.safeParse(req.params.id);
  if (!r.success) throw notFound(what);
  return r.data;
};
const externalParam = (req: Request) => {
  const r = externalId.safeParse(req.params.externalId);
  if (!r.success) throw invalid([{ field: 'external_id', code: 'invalid_string', message: r.error.issues[0]!.message }]);
  return r.data;
};

publicApiWriteRouter.post(
  '/people',
  ...write(['people:write'], async (req, w) => addPerson(w, req, body(req, personCreate, PERSON_ELSEWHERE))),
);

publicApiWriteRouter.patch(
  '/people/:id',
  ...write(['people:write'], async (req, w) => {
    const id = idParam(req, 'Person');
    const b = body(req, personPatch, PERSON_ELSEWHERE);
    atLeastOne(b);
    return w.tx((tx) => changePerson(w, req, tx, id, b));
  }),
);

publicApiWriteRouter.put(
  '/people/by-external-id/:externalId',
  ...write(['people:write'], async (req, w) => {
    const ext = externalParam(req);
    const b = body(req, personPut, PERSON_ELSEWHERE);
    const existing = await w.tx((tx) => tx.user.findFirst({ where: { externalId: ext }, select: { id: true } }));
    if (!existing) return addPerson(w, req, { ...body(req, personCreate.omit({ external_id: true })), external_id: ext });
    const { invite: _invite, locale: _locale, ...change } = b;
    atLeastOne(change);
    return w.tx((tx) => changePerson(w, req, tx, existing.id, change));
  }),
);

const terminateBody = z.object({ last_day: date, reason: z.enum(OFFBOARD_REASONS.map((r) => r.toLowerCase()) as [string, ...string[]]) }).strict();

/** Ends someone's employment: their offboarding starts with the last day; HR finishes it in the app. Never deletes. */
publicApiWriteRouter.post(
  '/people/:id/terminate',
  ...write(['people:write'], async (req, w) => {
    const id = idParam(req, 'Person');
    const b = body(req, terminateBody);
    return w.tx(async (tx) => {
      await checkIfMatch(tx, req, 'User', id);
      const o = await startOffboarding(tx, w.actor, id, { lastDay: b.last_day, reason: b.reason.toUpperCase() as (typeof OFFBOARD_REASONS)[number] });
      const u = await loadPerson(tx, id);
      return { status: 200, body: { person: person(u), offboarding: { id: o.id, last_day: b.last_day, reason: b.reason, completed: false } }, etag: etagOf(u.updatedAt) };
    });
  }),
);

/* ---------- Time off ---------- */

const TIME_OFF_TYPES = ['vacation', 'sick', 'protected_leave', 'unpaid_personal', 'other', 'lieu'] as const;
const when = z.string().datetime({ offset: true });
const timeOffCreate = z
  .object({
    person_id: uuid,
    type: z.enum(TIME_OFF_TYPES),
    starts_at: when,
    ends_at: when,
    note: z.string().trim().max(500).nullable().optional(),
    /** pending (default): their manager approves it in the app. approved: needs timeoff:approve. */
    status: z.enum(['pending', 'approved']).default('pending'),
  })
  .strict();

publicApiWriteRouter.post(
  '/time-off',
  ...write(['timeoff:write'], async (req, w) => {
    const b = body(req, timeOffCreate);
    const approve = b.status === 'approved';
    if (approve && !req.apiKey!.scopes.includes('timeoff:approve')) throw new HttpError(403, 'INSUFFICIENT_SCOPE', 'Sending time off already approved needs the timeoff:approve scope.', { scope: 'timeoff:approve' });
    if (approve && !w.actor.permissions.has('timeoff.approve')) throw new HttpError(403, 'KEY_OWNER_LACKS_PERMISSION', 'The person who made this key can’t approve time off, so the key can’t either.', { scope: 'timeoff:approve' });
    return w.tx(async (tx) => {
      // Row-level security: another organization's person isn't there to find.
      const u = await tx.user.findUnique({ where: { id: b.person_id }, select: { status: true, anonymizedAt: true } });
      if (!u || u.anonymizedAt) throw notFound('Person');
      if (u.status === 'TERMINATED') throw new HttpError(409, 'PERSON_NOT_ACTIVE', 'This person no longer works here.', { field: 'person_id' });
      const out = await requestTimeOff(tx, w.actor.tenantId, b.person_id, { type: b.type.toUpperCase() as TimeOffType, startsAt: new Date(b.starts_at), endsAt: new Date(b.ends_at), note: b.note ?? null });
      await audit(tx, { tenantId: w.actor.tenantId, actorId: w.actor.userId, action: 'timeoff.request', entity: 'TimeOffRequest', entityId: out.request.id, after: { personId: b.person_id, type: b.type, startsAt: b.starts_at, endsAt: b.ends_at, status: b.status } });
      // Already approved: approvers aren't asked; the person is told, and their shifts are released, as when a manager approves.
      if (approve) await withEvents(tx, decideTimeOff(tx, { userId: w.actor.userId, tenantId: w.actor.tenantId }, out.request.id, 'APPROVE', null));
      else await withEvents(tx, out);
      const r = await tx.timeOffRequest.findUniqueOrThrow({ where: { id: out.request.id }, select: TIME_OFF_SELECT });
      return { status: 201, body: timeOff(r), etag: etagOf(r.updatedAt), location: `/api/v1/time-off/${r.id}` };
    });
  }),
);

publicApiWriteRouter.post(
  '/time-off/:id/cancel',
  ...write(['timeoff:write'], async (req, w) => {
    const id = idParam(req, 'Time-off request');
    if (req.body && Object.keys(req.body as object).length) body(req, z.object({}).strict());
    return w.tx(async (tx) => {
      const r = await tx.timeOffRequest.findUnique({ where: { id }, select: { userId: true, status: true } });
      if (!r) throw notFound('Time-off request');
      await cancelTimeOff(tx, r.userId, id);
      await audit(tx, { tenantId: w.actor.tenantId, actorId: w.actor.userId, action: 'timeoff.cancel', entity: 'TimeOffRequest', entityId: id, before: { status: r.status } });
      const after = await tx.timeOffRequest.findUniqueOrThrow({ where: { id }, select: TIME_OFF_SELECT });
      return { status: 200, body: timeOff(after), etag: etagOf(after.updatedAt) };
    });
  }),
);

/* ---------- Departments ---------- */

const departmentFields = { name: z.string().trim().min(2).max(60), name_fr: z.string().trim().max(60).nullable(), external_id: externalId.nullable() };
const departmentCreate = z.object({ ...departmentFields, name_fr: departmentFields.name_fr.optional(), external_id: departmentFields.external_id.optional() }).strict();
const departmentPatch = z.object(departmentFields).partial().strict();
const departmentPut = departmentPatch.omit({ external_id: true });

/** Saves through the app's own rules; positions and managers stay as they are. */
async function saveDept(w: WriteCtx, tx: Tx, id: string | null, b: z.infer<typeof departmentPatch>, ext?: string) {
  const cur = id ? await tx.department.findUnique({ where: { id }, include: { positions: { select: { id: true } } } }) : null;
  if (id && !cur) throw notFound('Department');
  const name = b.name ?? cur?.name;
  if (!name) throw invalid([{ field: 'name', code: 'invalid_type', message: 'Required' }]);
  const d = await saveDepartment(
    tx,
    w.actor.tenantId,
    id,
    { name, nameFr: b.name_fr !== undefined ? b.name_fr : (cur?.nameFr ?? null), aquatic: cur?.aquatic ?? false, positionIds: cur?.positions.map((p) => p.id) ?? [] },
    { externalId: ext ?? b.external_id },
  );
  await audit(tx, { tenantId: w.actor.tenantId, actorId: w.actor.userId, action: id ? 'department.update' : 'department.create', entity: 'Department', entityId: d.id, after: audited({ ...b, external_id: ext ?? b.external_id }) });
  const row = await tx.department.findUniqueOrThrow({ where: { id: d.id }, select: DEPARTMENT_SELECT });
  return { status: id ? 200 : 201, body: department(row), etag: etagOf(row.updatedAt), location: `/api/v1/departments/${row.id}` };
}

publicApiWriteRouter.post(
  '/departments',
  ...write(['departments:write'], async (req, w) => {
    const b = body(req, departmentCreate);
    return w.tx((tx) => saveDept(w, tx, null, b));
  }),
);

publicApiWriteRouter.patch(
  '/departments/:id',
  ...write(['departments:write'], async (req, w) => {
    const id = idParam(req, 'Department');
    const b = body(req, departmentPatch);
    atLeastOne(b);
    return w.tx(async (tx) => {
      await checkIfMatch(tx, req, 'Department', id);
      return saveDept(w, tx, id, b);
    });
  }),
);

publicApiWriteRouter.put(
  '/departments/by-external-id/:externalId',
  ...write(['departments:write'], async (req, w) => {
    const ext = externalParam(req);
    const b = body(req, departmentPut);
    return w.tx(async (tx) => {
      const existing = await tx.department.findFirst({ where: { externalId: ext }, select: { id: true } });
      if (existing) await checkIfMatch(tx, req, 'Department', existing.id);
      else body(req, departmentCreate.omit({ external_id: true }));
      return saveDept(w, tx, existing?.id ?? null, b, ext);
    });
  }),
);

/* ---------- Positions ---------- */

const positionFields = { name: z.string().trim().min(2).max(80), name_fr: z.string().trim().max(80).nullable(), department_id: uuid.nullable(), external_id: externalId.nullable() };
const positionCreate = z.object({ ...positionFields, name_fr: positionFields.name_fr.optional(), department_id: positionFields.department_id.optional(), external_id: positionFields.external_id.optional() }).strict();
const positionPatch = z.object(positionFields).partial().strict();
const positionPut = positionPatch.omit({ external_id: true });

/** Saves through the app's own rules; required certifications and driving limits stay as they are (set in the app). */
async function savePos(w: WriteCtx, tx: Tx, id: string | null, b: z.infer<typeof positionPatch>, ext?: string) {
  const p = await savePosition(tx, w.actor.tenantId, id, { name: b.name, nameFr: b.name_fr, departmentId: b.department_id, externalId: ext ?? b.external_id });
  await audit(tx, { tenantId: w.actor.tenantId, actorId: w.actor.userId, action: id ? 'position.update' : 'position.create', entity: 'Position', entityId: p.id, after: audited({ ...b, external_id: ext ?? b.external_id }) });
  const row = await tx.position.findUniqueOrThrow({ where: { id: p.id }, select: POSITION_SELECT });
  return { status: id ? 200 : 201, body: position(row), etag: etagOf(row.updatedAt), location: `/api/v1/positions/${row.id}` };
}

publicApiWriteRouter.post(
  '/positions',
  ...write(['positions:write'], async (req, w) => {
    const b = body(req, positionCreate);
    return w.tx((tx) => savePos(w, tx, null, b));
  }),
);

publicApiWriteRouter.patch(
  '/positions/:id',
  ...write(['positions:write'], async (req, w) => {
    const id = idParam(req, 'Position');
    const b = body(req, positionPatch);
    atLeastOne(b);
    return w.tx(async (tx) => {
      await checkIfMatch(tx, req, 'Position', id);
      return savePos(w, tx, id, b);
    });
  }),
);

publicApiWriteRouter.put(
  '/positions/by-external-id/:externalId',
  ...write(['positions:write'], async (req, w) => {
    const ext = externalParam(req);
    const b = body(req, positionPut);
    return w.tx(async (tx) => {
      const existing = await tx.position.findFirst({ where: { externalId: ext }, select: { id: true } });
      if (existing) await checkIfMatch(tx, req, 'Position', existing.id);
      else body(req, positionCreate.omit({ external_id: true }));
      return savePos(w, tx, existing?.id ?? null, b, ext);
    });
  }),
);
