/**
 * OpenAPI 3.1 description of the public API, served at /api/v1/openapi.json. Hand-written to match
 * routes/publicApi.ts and routes/publicApiWrite.ts; test/integration/publicApi.test.ts checks every
 * documented read answers and every documented write exists.
 */
import { READ_SCOPES, WRITE_SCOPES } from './apiKeys.js';
import { WEBHOOK_EVENT_TYPES } from './webhooks.js';

type Schema = Record<string, unknown>;
const str = (extra: Schema = {}): Schema => ({ type: 'string', ...extra });
const nullable = (s: Schema): Schema => ({ ...s, type: [s.type as string, 'null'] });
const uuid = str({ format: 'uuid' });
const ts = str({ format: 'date-time' });
const date = str({ format: 'date' });
const decimal = str({ pattern: '^-?\\d+\\.\\d{2}$', description: 'A decimal amount as a string, two places.' });
const obj = (properties: Record<string, Schema>): Schema => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const page = (item: string): Schema => obj({ data: { type: 'array', items: ref(item) }, next_cursor: nullable(str({ description: 'Pass as `cursor` for the next page; null on the last page.' })) });

const listParams = [
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 } },
  { name: 'cursor', in: 'query', schema: str(), description: 'From the previous page’s `next_cursor`.' },
  { name: 'updated_since', in: 'query', schema: ts, description: 'Only records changed at or after this moment. Results are ordered oldest change first.' },
];
const rangeParams = [
  { name: 'from', in: 'query', required: true, schema: str(), description: 'Start (ISO date or date-time). At most 93 days before `to`.' },
  { name: 'to', in: 'query', required: true, schema: str(), description: 'End (exclusive).' },
];
const E = { $ref: '#/components/responses/Error' };
const errors = { '400': E, '401': E, '403': E, '429': E };
const writeErrors = { ...errors, '404': E, '409': E, '412': E, '422': E };
const getOp = (summary: string, scope: string, schema: string, parameters: unknown[] = listParams, etag = false) => ({
  summary,
  description: `Needs the \`${scope}\` scope.${etag ? ' The `ETag` header is the record’s version, for `If-Match` on a change.' : ''}`,
  security: [{ apiKey: [] }],
  'x-required-scope': scope,
  parameters,
  responses: { '200': { description: 'OK', ...(etag ? { headers: { ETag: { schema: str() } } } : {}), content: { 'application/json': { schema: ref(schema) } } }, ...errors },
});
const op = (summary: string, scope: string, schema: string, parameters: unknown[] = listParams) => ({ get: getOp(summary, scope, schema, parameters) });

const idPath = { name: 'id', in: 'path', required: true, schema: uuid };
const externalPath = { name: 'externalId', in: 'path', required: true, schema: str({ pattern: '^[A-Za-z0-9._:@-]{1,100}$' }), description: 'Your own system’s id for the record.' };
const idempotencyHeader = { name: 'Idempotency-Key', in: 'header', required: true, schema: str({ minLength: 1, maxLength: 255 }), description: 'A unique value per change (a UUID). A retry with the same key and body gets the first answer again; the same key with another body answers 409. Kept 24 hours.' };
const optionalIdempotency = { ...idempotencyHeader, required: false };
const ifMatchHeader = { name: 'If-Match', in: 'header', required: false, schema: str(), description: 'The ETag you read. If the record changed since, the answer is 412 and nothing is changed.' };
const writeResponse = (status: '200' | '201', schema: string) => ({
  [status]: { description: status === '201' ? 'Created' : 'OK', headers: { ETag: { schema: str() }, ...(status === '201' ? { Location: { schema: str() } } : {}) }, content: { 'application/json': { schema: ref(schema) } } },
});
const writeOp = (summary: string, scope: string, description: string, opts: { body?: string; response: string; status?: '200' | '201'; parameters?: unknown[]; upsert?: boolean }) => ({
  summary,
  description: `Needs the \`${scope}\` scope. ${description}`,
  security: [{ apiKey: [] }],
  'x-required-scope': scope,
  parameters: opts.parameters ?? [],
  ...(opts.body ? { requestBody: { required: true, content: { 'application/json': { schema: ref(opts.body) } } } } : {}),
  responses: { ...(opts.upsert ? { ...writeResponse('200', opts.response), ...writeResponse('201', opts.response) } : writeResponse(opts.status ?? '200', opts.response)), ...writeErrors },
});
const snakeEnum = (values: string[]) => str({ enum: values });
const EMPLOYMENT = ['full_time', 'part_time', 'casual', 'on_call', 'volunteer'];
const TIME_OFF_TYPES = ['vacation', 'sick', 'protected_leave', 'unpaid_personal', 'other', 'lieu'];
const externalId = nullable(str({ pattern: '^[A-Za-z0-9._:@-]{1,100}$', description: 'Your own system’s id (unique in your organization).' }));
const input = (properties: Record<string, Schema>, required: string[] = []): Schema => ({ type: 'object', additionalProperties: false, required, properties });
const personInput: Record<string, Schema> = {
  first_name: str({ maxLength: 60 }),
  last_name: str({ maxLength: 60 }),
  preferred_name: nullable(str({ maxLength: 60 })),
  email: str({ format: 'email' }),
  phone: nullable(str({ maxLength: 30, description: 'Kept on their record; never returned by the API.' })),
  employee_number: nullable(str({ maxLength: 40 })),
  employment_status: snakeEnum(EMPLOYMENT),
  hire_date: nullable(date),
  position_ids: { type: 'array', items: uuid, maxItems: 10, description: 'Replaces the positions they hold. Their departments follow their positions.' },
  manager_id: nullable({ ...uuid, description: 'Who they report to; null for their department’s manager.' }),
  external_id: externalId,
};
const createOnly: Record<string, Schema> = {
  locale: snakeEnum(['en-CA', 'fr-CA']),
  invite: { type: 'boolean', default: true, description: 'Email them an invitation to sign in. false: a record without sign-in until HR invites them from the app.' },
};
const without = (o: Record<string, Schema>, key: string) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));

export function openApiSpec() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'FlexcityHeadquarters API',
      version: '1.0.0',
      description:
        'Read your organization’s people, structure, schedules, approved time, time off and approved pay runs from your own systems, and, with write scopes, send in people, departments, positions and time off. Authenticate with an API key from Settings › Integrations. Every POST needs an Idempotency-Key; changes take If-Match with the ETag you read. See docs/PUBLIC-API.md.',
    },
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: {
        apiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'fh_live_…', description: `An organization API key. Read scopes: ${READ_SCOPES.join(', ')}. Write scopes (opt-in per key, “Can change data”): ${WRITE_SCOPES.join(', ')}.` },
      },
      responses: {
        Error: {
          description: 'Problem details (RFC 9457) with a stable code and the request id to quote to support. 422 lists the fields that failed.',
          content: { 'application/problem+json': { schema: ref('Problem') } },
        },
      },
      schemas: {
        Problem: {
          type: 'object',
          required: ['type', 'title', 'status', 'code', 'message', 'request_id'],
          properties: {
            type: str(),
            title: str(),
            status: { type: 'integer' },
            code: str({ description: 'Stable, e.g. VALIDATION, INSUFFICIENT_SCOPE, PRECONDITION_FAILED, IDEMPOTENCY_KEY_REUSED.' }),
            message: str(),
            detail: str(),
            errors: { type: 'array', items: obj({ field: str(), code: str(), message: str() }) },
            details: { type: 'object' },
            request_id: str(),
            requestId: str({ description: 'The same as request_id (kept for existing clients).' }),
          },
        },
        PersonCreate: input({ ...personInput, ...createOnly }, ['first_name', 'last_name', 'email', 'employment_status']),
        PersonChange: input(personInput),
        PersonUpsert: input({ ...without(personInput, 'external_id'), ...createOnly }),
        Terminate: input({ last_day: date, reason: snakeEnum(['resignation', 'retirement', 'end_of_season', 'end_of_contract', 'dismissal', 'layoff', 'other']) }, ['last_day', 'reason']),
        Termination: obj({ person: ref('Person'), offboarding: obj({ id: uuid, last_day: date, reason: str(), completed: { type: 'boolean' } }) }),
        TimeOffCreate: input(
          {
            person_id: uuid,
            type: snakeEnum(TIME_OFF_TYPES),
            starts_at: ts,
            ends_at: ts,
            note: nullable(str({ maxLength: 500, description: 'Kept on the request; never returned by the API.' })),
            status: { ...snakeEnum(['pending', 'approved']), default: 'pending', description: 'approved needs the timeoff:approve scope.' },
          },
          ['person_id', 'type', 'starts_at', 'ends_at'],
        ),
        DepartmentCreate: input({ name: str({ minLength: 2, maxLength: 60 }), name_fr: nullable(str()), external_id: externalId }, ['name']),
        DepartmentChange: input({ name: str({ minLength: 2, maxLength: 60 }), name_fr: nullable(str()), external_id: externalId }),
        DepartmentUpsert: input({ name: str({ minLength: 2, maxLength: 60 }), name_fr: nullable(str()) }),
        PositionCreate: input({ name: str({ minLength: 2, maxLength: 80 }), name_fr: nullable(str()), department_id: nullable(uuid), external_id: externalId }, ['name']),
        PositionChange: input({ name: str({ minLength: 2, maxLength: 80 }), name_fr: nullable(str()), department_id: nullable(uuid), external_id: externalId }),
        PositionUpsert: input({ name: str({ minLength: 2, maxLength: 80 }), name_fr: nullable(str()), department_id: nullable(uuid) }),
        Person: obj({
          id: uuid,
          external_id: nullable(str()),
          employee_number: nullable(str()),
          first_name: nullable(str()),
          last_name: nullable(str()),
          preferred_name: nullable(str()),
          email: nullable(str()),
          status: str({ enum: ['active', 'inactive', 'terminated'] }),
          employment_status: str({ enum: ['full_time', 'part_time', 'casual', 'on_call', 'volunteer'] }),
          hire_date: nullable(date),
          manager_id: nullable(uuid),
          department_ids: { type: 'array', items: uuid },
          positions: { type: 'array', items: obj({ id: uuid, name: str(), department_id: nullable(uuid) }) },
          processing_restricted: { type: 'boolean', description: 'True after an erasure request or anonymization: only id and status are given.' },
          created_at: ts,
          updated_at: ts,
        }),
        Department: obj({ id: uuid, external_id: nullable(str()), name: str(), name_fr: nullable(str()), gl_code: nullable(str()), manager_ids: { type: 'array', items: uuid }, created_at: ts, updated_at: ts }),
        Position: obj({ id: uuid, external_id: nullable(str()), name: str(), name_fr: nullable(str()), department_id: nullable(uuid), updated_at: ts }),
        Facility: obj({ id: uuid, name: str(), province: str(), timezone: str(), cost_center: nullable(str()), created_at: ts, updated_at: ts }),
        Shift: obj({ id: uuid, facility_id: uuid, position_id: uuid, person_id: nullable(uuid), starts_at: ts, ends_at: ts, type: str(), title: nullable(str()), status: str({ enum: ['published', 'cancelled'] }), updated_at: ts }),
        Timesheet: obj({ id: uuid, person_id: uuid, facility_id: uuid, position_id: uuid, shift_id: nullable(uuid), clock_in: ts, clock_out: ts, hours: decimal, approved_at: nullable(ts), updated_at: ts }),
        TimeOff: obj({
          id: uuid,
          person_id: uuid,
          type: snakeEnum(TIME_OFF_TYPES),
          status: snakeEnum(['pending', 'approved', 'denied', 'cancelled']),
          starts_at: ts,
          ends_at: ts,
          hours: nullable(decimal),
          approved_at: nullable(ts),
          created_at: ts,
          updated_at: ts,
        }),
        PayRun: obj({
          id: uuid,
          department_id: nullable(uuid),
          kind: str({ enum: ['regular', 'off_cycle'] }),
          status: str({ enum: ['approved', 'paid'] }),
          period_start: date,
          period_end: date,
          pay_date: date,
          approved_at: nullable(ts),
          paid_at: nullable(ts),
          totals: obj({ gross: nullable(decimal), deductions: nullable(decimal), net: nullable(decimal), employer_cpp: nullable(decimal), employer_ei: nullable(decimal), people: { type: ['integer', 'null'] } }),
          updated_at: ts,
        }),
        PayStatement: obj({ id: uuid, person_id: uuid, hours: decimal, gross: decimal, net: decimal }),
        PersonPage: page('Person'),
        DepartmentPage: page('Department'),
        PositionPage: page('Position'),
        FacilityPage: page('Facility'),
        ShiftPage: page('Shift'),
        TimesheetPage: page('Timesheet'),
        TimeOffPage: page('TimeOff'),
        PayRunPage: page('PayRun'),
        PayStatementPage: page('PayStatement'),
        WebhookEvent: obj({
          id: uuid,
          type: str({ enum: [...WEBHOOK_EVENT_TYPES, 'ping'] }),
          created_at: ts,
          organization_id: uuid,
          data: { type: 'object', description: 'The record’s id (and person_id where it applies) and, for *.updated, the names of the fields that changed. Fetch the record from the API for its values.' },
        }),
      },
    },
    paths: {
      '/people': {
        get: getOp('List people', 'people:read', 'PersonPage', [...listParams, { name: 'status', in: 'query', schema: str({ enum: ['active', 'inactive', 'terminated'] }) }]),
        post: writeOp('Add a person', 'people:write', 'They start as an employee (access roles are given in the app) and are invited to sign in unless `invite` is false. Email, employee number and external id are unique in your organization (409).', { body: 'PersonCreate', response: 'Person', status: '201', parameters: [idempotencyHeader] }),
      },
      '/people/{id}': {
        get: getOp('Get one person', 'people:read', 'Person', [idPath], true),
        patch: writeOp('Change a person', 'people:write', 'Send only the fields that change. SIN, bank, pay, birth date and health details are never accepted (422).', { body: 'PersonChange', response: 'Person', parameters: [idPath, ifMatchHeader] }),
      },
      '/people/{id}/terminate': {
        post: writeOp('End someone’s employment', 'people:write', 'Starts their offboarding with the last day and reason; HR finishes its checklist in the app, which ends their access. Never deletes anything.', { body: 'Terminate', response: 'Termination', parameters: [idPath, idempotencyHeader, ifMatchHeader] }),
      },
      '/people/by-external-id/{externalId}': {
        put: writeOp('Add or change a person by your own id', 'people:write', 'Creates the person (201) when no one has this external id, else changes the fields you send (200).', { body: 'PersonUpsert', response: 'Person', upsert: true, parameters: [externalPath, ifMatchHeader, optionalIdempotency] }),
      },
      '/departments': {
        get: getOp('List departments', 'departments:read', 'DepartmentPage'),
        post: writeOp('Add a department', 'departments:write', 'Names are unique in your organization. Departments are never deleted through the API.', { body: 'DepartmentCreate', response: 'Department', status: '201', parameters: [idempotencyHeader] }),
      },
      '/departments/{id}': {
        get: getOp('Get one department', 'departments:read', 'Department', [idPath], true),
        patch: writeOp('Change a department', 'departments:write', 'Its positions and managers stay as they are.', { body: 'DepartmentChange', response: 'Department', parameters: [idPath, ifMatchHeader] }),
      },
      '/departments/by-external-id/{externalId}': {
        put: writeOp('Add or change a department by your own id', 'departments:write', 'Creates it (201) or changes it (200).', { body: 'DepartmentUpsert', response: 'Department', upsert: true, parameters: [externalPath, ifMatchHeader, optionalIdempotency] }),
      },
      '/positions': {
        get: getOp('List positions', 'positions:read', 'PositionPage'),
        post: writeOp('Add a position', 'positions:write', 'Required certifications and driving limits are set in the app. Positions are never deleted through the API.', { body: 'PositionCreate', response: 'Position', status: '201', parameters: [idempotencyHeader] }),
      },
      '/positions/{id}': {
        get: getOp('Get one position', 'positions:read', 'Position', [idPath], true),
        patch: writeOp('Change a position', 'positions:write', 'Move it to another department with department_id.', { body: 'PositionChange', response: 'Position', parameters: [idPath, ifMatchHeader] }),
      },
      '/positions/by-external-id/{externalId}': {
        put: writeOp('Add or change a position by your own id', 'positions:write', 'Creates it (201) or changes it (200).', { body: 'PositionUpsert', response: 'Position', upsert: true, parameters: [externalPath, ifMatchHeader, optionalIdempotency] }),
      },
      '/facilities': op('List facilities', 'facilities:read', 'FacilityPage'),
      '/shifts': op('List published shifts in a date range', 'schedule:read', 'ShiftPage', [
        ...listParams,
        ...rangeParams,
        { name: 'facility_id', in: 'query', schema: uuid },
        { name: 'person_id', in: 'query', schema: uuid },
        { name: 'include_cancelled', in: 'query', schema: str({ enum: ['true', 'false'] }) },
      ]),
      '/timesheets': op('List approved punches in a date range', 'timesheets:read', 'TimesheetPage', [...listParams, ...rangeParams, { name: 'person_id', in: 'query', schema: uuid }, { name: 'facility_id', in: 'query', schema: uuid }]),
      '/time-off': {
        get: getOp('List approved time off', 'timeoff:read', 'TimeOffPage', [...listParams, { name: 'from', in: 'query', schema: str() }, { name: 'to', in: 'query', schema: str() }, { name: 'person_id', in: 'query', schema: uuid }]),
        post: writeOp('Request time off for someone', 'timeoff:write', 'Pending by default: their manager approves it in the app. `status: approved` needs the timeoff:approve scope, and the key’s maker must be able to approve time off. The same rules as in the app (no overlap, at most 120 days, banked time for lieu).', { body: 'TimeOffCreate', response: 'TimeOff', status: '201', parameters: [idempotencyHeader] }),
      },
      '/time-off/{id}': { get: getOp('Get one time-off request, in any status', 'timeoff:read or timeoff:write', 'TimeOff', [idPath], true) },
      '/time-off/{id}/cancel': {
        post: writeOp('Cancel a time-off request', 'timeoff:write', 'Pending requests, and approved ones that haven’t started.', { response: 'TimeOff', parameters: [idPath, idempotencyHeader] }),
      },
      '/pay-runs': op('List approved pay runs (summaries)', 'payroll:read', 'PayRunPage'),
      '/pay-runs/{id}/statements': op('Gross and net per person in an approved pay run', 'payroll:read', 'PayStatementPage', [
        { name: 'id', in: 'path', required: true, schema: uuid },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 } },
        { name: 'cursor', in: 'query', schema: uuid },
      ]),
    },
    webhooks: Object.fromEntries(
      WEBHOOK_EVENT_TYPES.map((t) => [
        t,
        {
          post: {
            summary: `${t} event`,
            description: 'Signed with `FH-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`. Answer 2xx within 10 seconds.',
            requestBody: { content: { 'application/json': { schema: ref('WebhookEvent') } } },
            responses: { '200': { description: 'Received' } },
          },
        },
      ]),
    ),
  };
}
