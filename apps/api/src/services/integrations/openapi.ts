/**
 * OpenAPI 3.1 description of the public API, served at /api/v1/openapi.json. Hand-written to match
 * routes/publicApi.ts; test/integration/publicApi.test.ts checks every documented path answers.
 */
import { SCOPES } from './apiKeys.js';
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
const errors = {
  '400': { $ref: '#/components/responses/Error' },
  '401': { $ref: '#/components/responses/Error' },
  '403': { $ref: '#/components/responses/Error' },
  '429': { $ref: '#/components/responses/Error' },
};
const op = (summary: string, scope: string, schema: string, parameters: unknown[] = listParams) => ({
  get: {
    summary,
    description: `Needs the \`${scope}\` scope.`,
    security: [{ apiKey: [] }],
    'x-required-scope': scope,
    parameters,
    responses: { '200': { description: 'OK', content: { 'application/json': { schema: ref(schema) } } }, ...errors },
  },
});

export function openApiSpec() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'FlexcityHeadquarters API',
      version: '1.0.0',
      description: 'Read your organization’s people, structure, schedules, approved time, time off and approved pay runs from your own systems. Authenticate with an API key from Settings › Integrations. See docs/PUBLIC-API.md.',
    },
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'fh_live_…', description: `An organization API key. Scopes: ${SCOPES.join(', ')}.` } },
      responses: {
        Error: {
          description: 'An error, with a stable code and the request id to quote to support.',
          content: { 'application/json': { schema: obj({ code: str(), message: str(), requestId: str() }) } },
        },
      },
      schemas: {
        Person: obj({
          id: uuid,
          employee_number: nullable(str()),
          first_name: nullable(str()),
          last_name: nullable(str()),
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
        Department: obj({ id: uuid, name: str(), name_fr: nullable(str()), gl_code: nullable(str()), manager_ids: { type: 'array', items: uuid }, created_at: ts, updated_at: ts }),
        Position: obj({ id: uuid, name: str(), name_fr: nullable(str()), department_id: nullable(uuid), updated_at: ts }),
        Facility: obj({ id: uuid, name: str(), province: str(), timezone: str(), cost_center: nullable(str()), created_at: ts, updated_at: ts }),
        Shift: obj({ id: uuid, facility_id: uuid, position_id: uuid, person_id: nullable(uuid), starts_at: ts, ends_at: ts, type: str(), title: nullable(str()), status: str({ enum: ['published', 'cancelled'] }), updated_at: ts }),
        Timesheet: obj({ id: uuid, person_id: uuid, facility_id: uuid, position_id: uuid, shift_id: nullable(uuid), clock_in: ts, clock_out: ts, hours: decimal, approved_at: nullable(ts), updated_at: ts }),
        TimeOff: obj({ id: uuid, person_id: uuid, type: str({ enum: ['vacation', 'sick', 'protected_leave', 'unpaid_personal', 'other', 'lieu'] }), starts_at: ts, ends_at: ts, hours: nullable(decimal), approved_at: nullable(ts), updated_at: ts }),
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
      '/people': op('List people', 'people:read', 'PersonPage', [...listParams, { name: 'status', in: 'query', schema: str({ enum: ['active', 'inactive', 'terminated'] }) }]),
      '/people/{id}': op('Get one person', 'people:read', 'Person', [{ name: 'id', in: 'path', required: true, schema: uuid }]),
      '/departments': op('List departments', 'departments:read', 'DepartmentPage'),
      '/positions': op('List positions', 'positions:read', 'PositionPage'),
      '/facilities': op('List facilities', 'facilities:read', 'FacilityPage'),
      '/shifts': op('List published shifts in a date range', 'schedule:read', 'ShiftPage', [
        ...listParams,
        ...rangeParams,
        { name: 'facility_id', in: 'query', schema: uuid },
        { name: 'person_id', in: 'query', schema: uuid },
        { name: 'include_cancelled', in: 'query', schema: str({ enum: ['true', 'false'] }) },
      ]),
      '/timesheets': op('List approved punches in a date range', 'timesheets:read', 'TimesheetPage', [...listParams, ...rangeParams, { name: 'person_id', in: 'query', schema: uuid }, { name: 'facility_id', in: 'query', schema: uuid }]),
      '/time-off': op('List approved time off', 'timeoff:read', 'TimeOffPage', [...listParams, { name: 'from', in: 'query', schema: str() }, { name: 'to', in: 'query', schema: str() }, { name: 'person_id', in: 'query', schema: uuid }]),
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
