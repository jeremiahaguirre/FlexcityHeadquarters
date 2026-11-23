/**
 * Custom fields on people: definitions in settings, values on the staff file with HR-only and
 * manager-level access, department scope, FH support visits and the Dev console's import never
 * seeing HR-only fields, the public API with its own scopes, the person's records export, the
 * city export, erasure and isolation between cities.
 */
import { randomBytes } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { hashPassword, signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { forgetCustomPermissions } from '../../src/services/people/customRoles.js';
import { exportSummary, writeCityExport } from '../../src/services/platform/cityExport.js';
import { anonymizeUser } from '../../src/services/privacy/erasure.js';
import { exportPersonRecords } from '../../src/services/privacy/recordsExport.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

// HR-only values are sealed with the organization's key.
process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');

const server = createApp();
const A = 'cfields';
const B = 'cfieldsb';
let a: Awaited<ReturnType<typeof seedTenant>>;
let b: Awaited<ReturnType<typeof seedTenant>>;
const ids = { hr: '', lead: '', guard: '', librarian: '' };
const tok = { hr: '', lead: '', guard: '', hrB: '', visit: '' };
const now = () => Math.floor(Date.now() / 1000);
const call = (token: string, sub = A) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }),
  post: (p: string, body: object = {}) => request(server).post(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }).send(body),
  patch: (p: string, body: object = {}) => request(server).patch(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }).send(body),
  put: (p: string, body: object = {}) => request(server).put(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }).send(body),
});
const v1 = (key: string) => ({
  get: (p: string) => request(server).get(`/api/v1${p}`).auth(key, { type: 'bearer' }),
  patch: (p: string, body: object) => request(server).patch(`/api/v1${p}`).auth(key, { type: 'bearer' }).send(body),
});
type Field = { key: string; value: unknown; editable: boolean; missing: boolean };
const keysOf = (r: { body: { fields: Field[] } }) => r.body.fields.map((f) => f.key);

beforeAll(async () => {
  resetLimits();
  a = await seedTenant(A, 0);
  b = await seedTenant(B, 1);
  const library = (await owner.position.create({ data: { tenantId: a.tenant.id, name: 'Library Assistant' } })).id;
  const mk = async (roles: ('HR_ADMIN' | 'EMPLOYEE' | 'STAFF')[], name: string, position?: string) => {
    const u = await owner.user.create({ data: { tenantId: a.tenant.id, roles, employmentStatus: 'FULL_TIME', firstName: name, lastName: 'X', email: `${name}@${A}.test` } });
    if (position) await owner.userPosition.create({ data: { tenantId: a.tenant.id, userId: u.id, positionId: position } });
    return u.id;
  };
  ids.hr = await mk(['HR_ADMIN'], 'hr');
  ids.lead = await mk(['EMPLOYEE'], 'lead');
  ids.guard = await mk(['STAFF'], 'guard', a.position.id);
  ids.librarian = await mk(['EMPLOYEE'], 'librarian', library);
  // An aquatics lead limited to the lifeguard position: sees and manages the guard, not the librarian.
  const role = await owner.customRole.create({ data: { tenantId: a.tenant.id, name: 'Aquatics lead', permissions: ['users.read', 'users.scheduling'], scopePositionIds: [a.position.id] } });
  await owner.userCustomRole.create({ data: { tenantId: a.tenant.id, userId: ids.lead, customRoleId: role.id } });
  forgetCustomPermissions(a.tenant.id);
  tok.hr = await signAccessToken({ sub: ids.hr, tid: a.tenant.id, roles: ['HR_ADMIN'], aat: now(), mfa: true });
  tok.lead = await signAccessToken({ sub: ids.lead, tid: a.tenant.id, roles: ['EMPLOYEE'], aat: now() });
  tok.guard = await signAccessToken({ sub: ids.guard, tid: a.tenant.id, roles: ['STAFF'], aat: now() });
  const hrB = await owner.user.create({ data: { tenantId: b.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'H', lastName: 'B', email: `hr@${B}.test` } });
  tok.hrB = await signAccessToken({ sub: hrB.id, tid: b.tenant.id, roles: ['HR_ADMIN'], aat: now(), mfa: true });
  // An FH support visit the city allowed (full level).
  const admin = await owner.platformAdmin.create({ data: { email: `fh-${randomBytes(3).toString('hex')}@fh.test`, name: 'FH Support', passwordHash: 'x' } });
  const grant = await owner.supportGrant.create({ data: { tenantId: a.tenant.id, grantedById: ids.hr, level: 'FULL', expiresAt: new Date(Date.now() + 3_600_000) } });
  const session = await owner.supportSession.create({ data: { tenantId: a.tenant.id, grantId: grant.id, adminId: admin.id, codeHash: randomBytes(16).toString('hex'), codeExpiresAt: new Date(Date.now() + 60_000), usedAt: new Date(), endsAt: new Date(Date.now() + 1_800_000) } });
  tok.visit = await signAccessToken({ sub: ids.hr, tid: a.tenant.id, roles: ['HR_ADMIN'], mfa: true, sup: session.id });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('definitions', () => {
  it('HR defines fields of every type with English and French labels; bad definitions are refused', async () => {
    const defs = [
      { key: 'badge_number', label: 'Badge number', labelFr: 'Numéro d’insigne', type: 'TEXT', viewAccess: 'MANAGER', editAccess: 'MANAGER', required: true, sortOrder: 1 },
      { key: 'locker', label: 'Locker', labelFr: 'Casier', type: 'NUMBER', viewAccess: 'MANAGER', editAccess: 'HR', sortOrder: 2 },
      { key: 'police_check_ref', label: 'Police check reference', labelFr: 'Référence de vérification policière', type: 'TEXT', viewAccess: 'HR', editAccess: 'HR', sortOrder: 3 },
      { key: 'uniform_size', label: 'Uniform size', labelFr: 'Taille d’uniforme', type: 'CHOICE', viewAccess: 'MANAGER', editAccess: 'MANAGER', sortOrder: 4, choices: [{ value: 'S', label: 'Small', labelFr: 'Petit' }, { value: 'M', label: 'Medium', labelFr: 'Moyen' }] },
      { key: 'first_aid_due', label: 'First aid due', labelFr: 'Secourisme à renouveler', type: 'DATE', viewAccess: 'MANAGER', editAccess: 'MANAGER', sortOrder: 5 },
      { key: 'second_job', label: 'Has a second job', labelFr: 'A un deuxième emploi', type: 'BOOLEAN', viewAccess: 'HR', editAccess: 'HR', sortOrder: 6 },
    ];
    for (const d of defs) expect((await call(tok.hr).post('/api/settings/custom-fields', d)).status).toBe(201);
    expect((await call(tok.hr).post('/api/settings/custom-fields', defs[0]!)).body.code).toBe('CUSTOM_FIELD_KEY_TAKEN');
    expect((await call(tok.hr).post('/api/settings/custom-fields', { key: 'one_choice', label: 'One choice', labelFr: 'Un choix', type: 'CHOICE', choices: [{ value: 'A', label: 'A', labelFr: 'A' }] })).body.code).toBe('CUSTOM_FIELD_CHOICES');
    expect((await call(tok.hr).post('/api/settings/custom-fields', { key: 'odd', label: 'Odd', labelFr: 'Étrange', type: 'TEXT', viewAccess: 'HR', editAccess: 'MANAGER' })).body.code).toBe('CUSTOM_FIELD_ACCESS');
    expect((await call(tok.hr).post('/api/settings/custom-fields', { key: 'Bad Key', label: 'Bad', labelFr: 'Mauvais', type: 'TEXT' })).status).toBe(400);
    const list = await call(tok.hr).get('/api/settings/custom-fields');
    expect(list.body.fields.map((f: { key: string; labelFr: string }) => [f.key, f.labelFr])).toEqual(defs.map((d) => [d.key, d.labelFr]));
    // Defining fields is organization setup: not for a department lead or staff.
    expect((await call(tok.lead).get('/api/settings/custom-fields')).status).toBe(403);
    expect((await call(tok.guard).post('/api/settings/custom-fields', defs[0]!)).status).toBe(403);
  });
});

describe('on the staff file', () => {
  it('HR sees and sets every field; values are checked against their type', async () => {
    const r = await call(tok.hr).put(`/api/users/${ids.guard}/custom-fields`, { values: { badge_number: ' B-104 ', locker: '12', police_check_ref: 'PC-99', uniform_size: 'medium', first_aid_due: '2027-05-01', second_job: 'oui' } });
    expect(r.status).toBe(200);
    expect(r.body.changed.sort()).toEqual(['badge_number', 'first_aid_due', 'locker', 'police_check_ref', 'second_job', 'uniform_size']);
    const byKey = Object.fromEntries((r.body.fields as Field[]).map((f) => [f.key, f.value]));
    expect(byKey).toEqual({ badge_number: 'B-104', locker: 12, police_check_ref: 'PC-99', uniform_size: 'M', first_aid_due: '2027-05-01', second_job: true });
    for (const [values, code] of [
      [{ locker: 'twelve' }, 'CUSTOM_FIELD_INVALID'],
      [{ first_aid_due: '2027-02-30' }, 'CUSTOM_FIELD_INVALID'],
      [{ uniform_size: 'XL' }, 'CUSTOM_FIELD_INVALID'],
      [{ badge_number: '' }, 'CUSTOM_FIELD_REQUIRED'],
      [{ nope: 'x' }, 'CUSTOM_FIELD_UNKNOWN'],
    ] as const) {
      expect((await call(tok.hr).put(`/api/users/${ids.guard}/custom-fields`, { values })).body.code).toBe(code);
    }
  });

  it('the audit says which fields changed, but never an HR-only value', async () => {
    const row = await owner.auditLog.findFirstOrThrow({ where: { tenantId: a.tenant.id, action: 'customfields.update', entityId: ids.guard } });
    const text = JSON.stringify(row.after);
    expect(text).toContain('B-104');
    expect(text).not.toContain('PC-99');
    expect(text).toContain('police_check_ref');
  });

  it('a lead in scope sees manager-level fields only, and changes only the ones managers may', async () => {
    const r = await call(tok.lead).get(`/api/users/${ids.guard}/custom-fields`);
    expect(r.status).toBe(200);
    expect(keysOf(r)).toEqual(['badge_number', 'locker', 'uniform_size', 'first_aid_due']);
    expect(JSON.stringify(r.body)).not.toContain('PC-99');
    expect((r.body.fields as Field[]).find((f) => f.key === 'locker')!.editable).toBe(false);
    expect((await call(tok.lead).put(`/api/users/${ids.guard}/custom-fields`, { values: { badge_number: 'B-105' } })).status).toBe(200);
    expect((await call(tok.lead).put(`/api/users/${ids.guard}/custom-fields`, { values: { locker: 13 } })).body.code).toBe('CUSTOM_FIELD_READ_ONLY');
    // An HR-only field answers as if it didn't exist.
    expect((await call(tok.lead).put(`/api/users/${ids.guard}/custom-fields`, { values: { police_check_ref: 'X' } })).body.code).toBe('CUSTOM_FIELD_UNKNOWN');
  });

  it('department scope: the aquatics lead can’t read or change the librarian’s fields', async () => {
    await call(tok.hr).put(`/api/users/${ids.librarian}/custom-fields`, { values: { badge_number: 'L-7' } });
    // Someone outside their department reads as not found, as everywhere else.
    expect((await call(tok.lead).get(`/api/users/${ids.librarian}/custom-fields`)).status).toBe(404);
    expect((await call(tok.lead).put(`/api/users/${ids.librarian}/custom-fields`, { values: { badge_number: 'L-8' } })).status).toBe(404);
    expect((await owner.customFieldValue.findFirstOrThrow({ where: { userId: ids.librarian } })).value).toBe('L-7');
  });

  it('staff can’t read anyone’s fields; another city sees none of them', async () => {
    expect((await call(tok.guard).get(`/api/users/${ids.guard}/custom-fields`)).status).toBe(403);
    expect((await call(tok.hrB, B).get(`/api/users/${ids.guard}/custom-fields`)).status).toBe(404);
    expect((await call(tok.hrB, B).get('/api/settings/custom-fields')).body.fields).toEqual([]);
    expect(await withTenant(b.tenant.id, (tx) => tx.customFieldValue.count())).toBe(0);
  });
});

describe('FH never sees HR-only fields', () => {
  it('a support visit, even at full level, gets manager-level fields only', async () => {
    const r = await call(tok.visit).get(`/api/users/${ids.guard}/custom-fields`);
    expect(r.status).toBe(200);
    expect(keysOf(r)).toEqual(['badge_number', 'locker', 'uniform_size', 'first_aid_due']);
    expect(JSON.stringify(r.body)).not.toMatch(/PC-99|police_check_ref|second_job/);
    expect((await call(tok.visit).put(`/api/users/${ids.guard}/custom-fields`, { values: { badge_number: 'FH' } })).status).toBe(403);
  });

  it('the Dev console’s staff import takes manager-level columns and refuses HR-only ones unread', async () => {
    const email = `dev-${randomBytes(3).toString('hex')}@flexcity.dev`;
    await owner.platformAdmin.create({ data: { email, name: 'Dev', passwordHash: await hashPassword('right password!') } });
    const login = await request(server).post('/api/platform/auth/login').set('x-fh-platform', '1').send({ email, password: 'right password!' });
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const csv = 'first_name,last_name,email,Badge number,uniform_size,police_check_ref,second_job\nNew,Person,new@cfields.test,B-200,Small,SECRET-REF,yes\nBad,Row,bad@cfields.test,,Huge,,\n';
    const r = await request(server).post(`/api/platform/tenants/${a.tenant.id}/import/preview`).set('x-fh-platform', '1').set('Cookie', cookie).send({ csv });
    expect(r.status).toBe(200);
    expect(r.body.hrOnlyColumns).toEqual(['police_check_ref', 'second_job']);
    expect(r.body.unknownColumns).toEqual([]);
    expect(JSON.stringify(r.body)).not.toContain('SECRET-REF');
    const [ok, bad] = r.body.rows;
    expect(Object.values(ok.customFields).sort()).toEqual(['B-200', 'S']);
    expect(bad.errors.map((e: { field: string; code: string }) => [e.field, e.code])).toEqual([
      ['Badge number', 'REQUIRED'],
      ['Uniform size', 'CUSTOM_FIELD_INVALID'],
    ]);
  });
});

describe('public API', () => {
  let key = '';
  it('reads and writes custom fields only with their own scopes, which only HR can give', async () => {
    const plain = await call(tok.hr).post('/api/integrations/api-keys', { name: 'Directory', scopes: ['people:read'] });
    expect((await v1(plain.body.key).get('/custom-fields')).body.code).toBe('INSUFFICIENT_SCOPE');
    const k = await call(tok.hr).post('/api/integrations/api-keys', { name: 'HRIS', scopes: ['customfields:read', 'customfields:write'] });
    expect(k.status).toBe(201);
    key = k.body.key;
    const defs = await v1(key).get('/custom-fields');
    expect(defs.body.data.map((d: { key: string; visible_to: string }) => [d.key, d.visible_to])[2]).toEqual(['police_check_ref', 'hr']);
    const vals = await v1(key).get(`/people/${ids.guard}/custom-fields`);
    expect(vals.body.data).toMatchObject({ badge_number: 'B-105', locker: 12, police_check_ref: 'PC-99', second_job: true });
    const w = await v1(key).patch(`/people/${ids.guard}/custom-fields`, { locker: 14, second_job: false });
    expect(w.status).toBe(200);
    expect(w.body.changed.sort()).toEqual(['locker', 'second_job']);
    expect((await v1(key).patch(`/people/${ids.guard}/custom-fields`, { locker: 'x' })).status).toBe(422);
    expect((await v1(key).patch(`/people/${ids.guard}/custom-fields`, { locker: 'x' })).body.code).toBe('CUSTOM_FIELD_INVALID');
    expect((await owner.auditLog.findFirstOrThrow({ where: { action: 'customfields.update', entityId: ids.guard }, orderBy: { at: 'desc' } })).apiKeyId).toBeTruthy();
  });

  it('a lead can’t give a key the custom-fields scopes; another city’s person is not found', async () => {
    expect((await call(tok.lead).post('/api/integrations/api-keys', { name: 'Mine', scopes: ['customfields:read'] })).status).toBe(403);
    expect((await v1(key).get(`/people/${b.users[0]!.id}/custom-fields`)).status).toBe(404);
  });
});

describe('privacy', () => {
  it('in the person’s records export (every field, labelled) and the city export', async () => {
    const rec = await withTenant(a.tenant.id, (tx) => exportPersonRecords(tx, ids.guard));
    const fields = (rec as unknown as { customFields: Array<{ key: string; fieldFr: string; value: unknown }> }).customFields;
    expect(fields.map((f) => f.key)).toContain('police_check_ref');
    expect(fields.find((f) => f.key === 'uniform_size')).toMatchObject({ fieldFr: 'Taille d’uniforme', value: 'M' });
    const summary = await exportSummary(a.tenant.id);
    expect(summary.tables).toContainEqual({ table: 'CustomFieldDefinition', rows: 6 });
    expect(summary.tables.find((t) => t.table === 'CustomFieldValue')!.rows).toBeGreaterThan(0);
  });

  it('erasure removes the person’s values and keeps the organization’s fields', async () => {
    await withTenant(a.tenant.id, (tx) => anonymizeUser(tx, a.tenant.id, ids.hr, ids.guard));
    expect(await owner.customFieldValue.count({ where: { userId: ids.guard } })).toBe(0);
    expect(await owner.customFieldValue.count({ where: { userId: ids.librarian } })).toBe(1);
    expect(await owner.customFieldDefinition.count({ where: { tenantId: a.tenant.id } })).toBe(6);
    expect((await call(tok.hr).get(`/api/users/${ids.guard}/custom-fields`)).status).toBe(404);
  });

  it('an archived field leaves the staff file but keeps its values', async () => {
    const f = await owner.customFieldDefinition.findFirstOrThrow({ where: { tenantId: a.tenant.id, key: 'badge_number' } });
    expect((await call(tok.hr).patch(`/api/settings/custom-fields/${f.id}`, { label: 'Badge number', labelFr: 'Numéro d’insigne', archived: true, viewAccess: 'MANAGER', editAccess: 'MANAGER' })).status).toBe(200);
    expect(keysOf(await call(tok.hr).get(`/api/users/${ids.librarian}/custom-fields`))).not.toContain('badge_number');
    expect(await owner.customFieldValue.count({ where: { fieldId: f.id } })).toBe(1);
  });
});

describe('review round 1', () => {
  let scopedHr = '';
  beforeAll(async () => {
    // "Aquatics HR": HR and settings powers, limited to the lifeguard position's department.
    const u = await owner.user.create({ data: { tenantId: a.tenant.id, roles: ['EMPLOYEE'], employmentStatus: 'FULL_TIME', firstName: 'aqhr', lastName: 'X', email: `aqhr@${A}.test` } });
    const role = await owner.customRole.create({ data: { tenantId: a.tenant.id, name: 'Aquatics HR', permissions: ['users.read', 'users.write', 'tenant.configure'], scopePositionIds: [a.position.id] } });
    await owner.userCustomRole.create({ data: { tenantId: a.tenant.id, userId: u.id, customRoleId: role.id } });
    forgetCustomPermissions(a.tenant.id);
    scopedHr = await signAccessToken({ sub: u.id, tid: a.tenant.id, roles: ['EMPLOYEE'], aat: now(), mfa: true });
    await call(tok.hr).put(`/api/users/${ids.librarian}/custom-fields`, { values: { police_check_ref: 'PC-SECRET' } });
  });

  it('a role limited to a department can’t give a key the custom-fields read scope (keys reach the whole organization)', async () => {
    // In the app the librarian is out of reach…
    expect((await call(scopedHr).get(`/api/users/${ids.librarian}/custom-fields`)).status).toBe(404);
    // …so a key that would read every person's HR-only values is refused.
    const k = await call(scopedHr).post('/api/integrations/api-keys', { name: 'Leak', scopes: ['customfields:read'] });
    expect(k.status).toBe(403);
    expect(k.body.code).toBe('SCOPE_NOT_YOURS');
    const listed = (await call(scopedHr).get('/api/integrations')).body.scopes as Array<{ scope: string; allowed: boolean }>;
    expect(listed.find((s) => s.scope === 'customfields:read')!.allowed).toBe(false);
    // HR for the whole organization still can.
    expect((await call(tok.hr).post('/api/integrations/api-keys', { name: 'HRIS 2', scopes: ['customfields:read'] })).status).toBe(201);
  });

  it('a key stops reading custom fields once its maker’s role is limited to a department', async () => {
    const u = await owner.user.create({ data: { tenantId: a.tenant.id, roles: ['EMPLOYEE'], employmentStatus: 'FULL_TIME', firstName: 'orghr', lastName: 'X', email: `orghr@${A}.test` } });
    const role = await owner.customRole.create({ data: { tenantId: a.tenant.id, name: 'Organization HR', permissions: ['users.read', 'users.write', 'tenant.configure'] } });
    await owner.userCustomRole.create({ data: { tenantId: a.tenant.id, userId: u.id, customRoleId: role.id } });
    forgetCustomPermissions(a.tenant.id);
    const token = await signAccessToken({ sub: u.id, tid: a.tenant.id, roles: ['EMPLOYEE'], aat: now(), mfa: true });
    const k = await call(token).post('/api/integrations/api-keys', { name: 'HRIS org', scopes: ['customfields:read', 'customfields:write'] });
    expect(k.status).toBe(201);
    expect((await v1(k.body.key).get(`/people/${ids.librarian}/custom-fields`)).body.data.police_check_ref).toBe('PC-SECRET');
    await owner.customRole.update({ where: { id: role.id }, data: { scopePositionIds: [a.position.id] } });
    forgetCustomPermissions(a.tenant.id);
    const r = await v1(k.body.key).get(`/people/${ids.librarian}/custom-fields`);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('KEY_OWNER_LACKS_PERMISSION');
    expect(JSON.stringify(r.body)).not.toContain('PC-SECRET');
    expect((await v1(k.body.key).patch(`/people/${ids.librarian}/custom-fields`, { locker: 3 })).body.code).toBe('KEY_OWNER_LACKS_PERMISSION');
  });

  it('a role limited to a department can’t define, change or archive the organization’s fields', async () => {
    const f = await owner.customFieldDefinition.findFirstOrThrow({ where: { tenantId: a.tenant.id, key: 'police_check_ref' } });
    expect((await call(scopedHr).get('/api/settings/custom-fields')).status).toBe(403);
    expect((await call(scopedHr).post('/api/settings/custom-fields', { key: 'aq_only', label: 'Aquatics only', labelFr: 'Aquatique seulement', type: 'TEXT' })).status).toBe(403);
    expect((await call(scopedHr).patch(`/api/settings/custom-fields/${f.id}`, { label: 'Police check reference', labelFr: 'Référence de vérification policière', viewAccess: 'MANAGER', editAccess: 'HR' })).status).toBe(403);
    expect((await call(scopedHr).patch(`/api/settings/custom-fields/${f.id}`, { label: 'Police check reference', labelFr: 'Référence de vérification policière', viewAccess: 'HR', editAccess: 'HR', archived: true })).status).toBe(403);
    expect(await owner.customFieldDefinition.findUniqueOrThrow({ where: { id: f.id } })).toMatchObject({ viewAccess: 'HR', archivedAt: null });
    expect(await owner.customFieldDefinition.count({ where: { tenantId: a.tenant.id, key: 'aq_only' } })).toBe(0);
  });

  it('HR-only values are sealed with the organization’s key; manager-level ones stay plain text', async () => {
    const police = await owner.customFieldDefinition.findFirstOrThrow({ where: { tenantId: a.tenant.id, key: 'police_check_ref' } });
    const uniform = await owner.customFieldDefinition.findFirstOrThrow({ where: { tenantId: a.tenant.id, key: 'uniform_size' } });
    await call(tok.hr).put(`/api/users/${ids.librarian}/custom-fields`, { values: { uniform_size: 'S' } });
    const raw = await owner.$queryRawUnsafe<Array<{ id: string; value: string | null; sealed: Buffer | null }>>(`SELECT "id", "value", "valueCiphertext" AS sealed FROM "CustomFieldValue" WHERE "userId" = '${ids.librarian}' AND "fieldId" = '${police.id}'`);
    expect(raw[0]!.value).toBeNull();
    expect(raw[0]!.sealed).toBeTruthy();
    expect(Buffer.from(raw[0]!.sealed!).toString('utf8')).not.toContain('PC-SECRET');
    expect((await owner.customFieldValue.findFirstOrThrow({ where: { userId: ids.librarian, fieldId: uniform.id } })).value).toBe('S');
    // The database refuses a row that is both plain and sealed.
    await expect(owner.$executeRawUnsafe(`UPDATE "CustomFieldValue" SET "value" = 'x' WHERE "id" = '${raw[0]!.id}'`)).rejects.toThrow();
    // Opened for HR, the person's records export and the public API.
    expect((await call(tok.hr).get(`/api/users/${ids.librarian}/custom-fields`)).body.fields.find((f: Field) => f.key === 'police_check_ref').value).toBe('PC-SECRET');
    const rec = await withTenant(a.tenant.id, (tx) => exportPersonRecords(tx, ids.librarian));
    expect((rec as unknown as { customFields: Array<{ key: string; value: unknown }> }).customFields.find((f) => f.key === 'police_check_ref')!.value).toBe('PC-SECRET');
    const k = await call(tok.hr).post('/api/integrations/api-keys', { name: 'HRIS 3', scopes: ['customfields:read'] });
    expect((await v1(k.body.key).get(`/people/${ids.librarian}/custom-fields`)).body.data.police_check_ref).toBe('PC-SECRET');
    // An unchanged value isn't written (or audited) again.
    expect((await call(tok.hr).put(`/api/users/${ids.librarian}/custom-fields`, { values: { police_check_ref: 'PC-SECRET' } })).body.changed).toEqual([]);
  });

  it('the city export opens the sealed values, without their machinery', async () => {
    const chunks: Uint8Array[] = [];
    await new Promise<void>((resolve) => {
      void writeCityExport(a.tenant.id, { userId: ids.hr, name: 'hr X' }, (c, final) => {
        chunks.push(c);
        if (final) resolve();
      });
    });
    const zip = unzipSync(new Uint8Array(Buffer.concat(chunks)));
    const csv = strFromU8(zip['flexcity-export/csv/CustomFieldValue.csv']!);
    expect(csv).toContain('PC-SECRET');
    expect(csv).not.toMatch(/valueCiphertext|valueWrappedKey|valueKekId/);
    expect(JSON.parse(strFromU8(zip['flexcity-export/README.json']!)).problems).toEqual([]);
  });

  it('changing who sees a field seals or opens its stored values to match', async () => {
    const f = await owner.customFieldDefinition.findFirstOrThrow({ where: { tenantId: a.tenant.id, key: 'police_check_ref' } });
    const body = { label: 'Police check reference', labelFr: 'Référence de vérification policière', editAccess: 'HR', sortOrder: 3 };
    const stored = async () => (await owner.$queryRawUnsafe<Array<{ value: string | null; sealed: Buffer | null }>>(`SELECT "value", "valueCiphertext" AS sealed FROM "CustomFieldValue" WHERE "userId" = '${ids.librarian}' AND "fieldId" = '${f.id}'`))[0]!;
    expect((await call(tok.hr).patch(`/api/settings/custom-fields/${f.id}`, { ...body, viewAccess: 'MANAGER' })).status).toBe(200);
    expect(await stored()).toEqual({ value: 'PC-SECRET', sealed: null });
    expect((await call(tok.hr).patch(`/api/settings/custom-fields/${f.id}`, { ...body, viewAccess: 'HR' })).status).toBe(200);
    const row = await stored();
    expect(row.value).toBeNull();
    expect(row.sealed).toBeTruthy();
    expect((await call(tok.hr).get(`/api/users/${ids.librarian}/custom-fields`)).body.fields.find((x: Field) => x.key === 'police_check_ref').value).toBe('PC-SECRET');
  });
});
