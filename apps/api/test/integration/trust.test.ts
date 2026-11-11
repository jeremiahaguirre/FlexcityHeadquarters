import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');

const { createApp } = await import('../../src/app.js');
const { resetLimits } = await import('../../src/auth/rateLimit.js');
const { hashPassword } = await import('../../src/auth/tokens.js');
const { db, withTenant } = await import('../../src/lib/db.js');
const { checkRls, runMonitors } = await import('../../src/services/trust/monitors.js');
const { runReminders } = await import('../../src/services/trust/reminders.js');
const { ensureTrustSeeded } = await import('../../src/services/trust/seed.js');
const { owner, seedTenant } = await import('./fixtures.js');

const server = createApp();
const tag = randomBytes(3).toString('hex');
const DAY = 86_400_000;
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(`restore test ${tag} confidential`), Buffer.from('\n%%EOF')]);

async function admin(name: string, permissions?: string[], extra: object = {}) {
  const email = `trust-${name}-${tag}@flexcity.dev`;
  const a = await owner.platformAdmin.create({ data: { email, name: `${name} ${tag}`, passwordHash: await hashPassword('right password!'), ...(permissions ? { permissions } : {}), ...extra } });
  resetLimits();
  const login = await request(server).post('/api/platform/auth/login').set('x-fh-platform', '1').send({ email, password: 'right password!' });
  const cookie = String(login.headers['set-cookie']).split(';')[0]!;
  const as = (m: 'get' | 'post' | 'patch' | 'delete', path: string) => request(server)[m](`/api/platform${path}`).set('x-fh-platform', '1').set('Cookie', cookie);
  return { ...a, as };
}

let mgr: Awaited<ReturnType<typeof admin>>;
beforeAll(async () => {
  mgr = await admin('manager');
  await ensureTrustSeeded(db());
});
afterAll(async () => {
  await owner.$executeRawUnsafe('DROP SCHEMA IF EXISTS trust_rls_probe CASCADE');
  await owner.$disconnect();
});

describe('Trust: permissions and isolation', () => {
  it('needs trust.read to see it and trust.manage to change it', async () => {
    const none = await admin('none', []);
    expect((await none.as('get', '/trust/overview')).status).toBe(403);
    const reader = await admin('reader', ['trust.read']);
    expect((await reader.as('get', '/trust/overview')).status).toBe(200);
    expect((await reader.as('patch', '/trust/settings').send({ riskAppetite: 10 })).status).toBe(403);
    expect((await reader.as('post', '/trust/risks').send({})).status).toBe(403);
    expect((await request(server).get('/api/platform/trust/overview').set('x-fh-platform', '1')).status).toBe(401);
  });

  it('keeps FH’s trust records out of every city’s transaction', async () => {
    const { tenant } = await seedTenant(`trust${tag}`, 0);
    expect(await db().trustRisk.count()).toBeGreaterThan(0);
    expect(await withTenant(tenant.id, (tx) => tx.trustRisk.count())).toBe(0);
    expect(await withTenant(tenant.id, (tx) => tx.trustVendor.count())).toBe(0);
    await expect(withTenant(tenant.id, (tx) => tx.trustRisk.create({ data: { ref: `X-${tag}`, title: 'x', category: 'x', description: 'x', likelihood: 1, impact: 1, residualLikelihood: 1, residualImpact: 1, treatment: 'ACCEPT' } }))).rejects.toThrow();
  });

  it('answers 304 when the overview hasn’t changed (live polling)', async () => {
    const a = await mgr.as('get', '/trust/overview?days=30');
    expect(a.status).toBe(200);
    expect(a.body.frameworks.map((f: { key: string }) => f.key)).toEqual(['soc2', 'iso27001', 'hipaa', 'pipeda', 'provincial', 'law25']);
    const b = await mgr.as('get', '/trust/overview?days=30').set('If-None-Match', String(a.headers.etag));
    expect(b.status).toBe(304);
  });
});

describe('Trust: monitors', () => {
  it('the RLS check passes on the real schema and catches a table without a policy', async () => {
    expect((await checkRls(db())).status).toBe('PASS');
    await owner.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS trust_rls_probe');
    await owner.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS trust_rls_probe."Leaky" (id uuid primary key, "tenantId" uuid not null)');
    await owner.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS trust_rls_probe."NoPolicy" (id uuid primary key, "tenantId" uuid not null)');
    await owner.$executeRawUnsafe('ALTER TABLE trust_rls_probe."NoPolicy" ENABLE ROW LEVEL SECURITY');
    const r = await checkRls(db(), 'trust_rls_probe');
    expect(r.status).toBe('FAIL');
    expect(r.details!.problems).toEqual(expect.arrayContaining(['Leaky: row-level security off', 'NoPolicy: no policy']));
  });

  it('the MFA check fails while passkeys aren’t enforced, and names admins without one', async () => {
    const [x] = await runMonitors({ keys: ['platform_mfa'] });
    expect(x!.status).toBe('FAIL');
    const t = await db().trustTest.findUniqueOrThrow({ where: { key: 'platform_mfa' } });
    expect((t.lastDetails as { missingPasskeys: string[] }).missingPasskeys).toContain(`manager ${tag}`);
    expect(JSON.stringify(t.lastDetails)).not.toMatch(/passwordHash|\$argon|scrypt/);
  });

  it('flags stale and offboarded admins, raising one alert per failure', async () => {
    await owner.platformAdmin.create({ data: { email: `stale-${tag}@flexcity.dev`, name: `Stale ${tag}`, passwordHash: 'x', lastLoginAt: new Date(Date.now() - 120 * DAY), createdAt: new Date(Date.now() - 400 * DAY) } });
    const gone = await admin('gone');
    await owner.platformAdmin.update({ where: { id: gone.id }, data: { disabledAt: new Date() } });
    const before = await db().trustAlert.count({ where: { kind: 'test_failed' } });
    const out = await runMonitors({ keys: ['stale_admins', 'offboarded_admins'] });
    expect(out.map((o) => o.status)).toEqual(['FAIL', 'FAIL']);
    const stale = await db().trustTest.findUniqueOrThrow({ where: { key: 'stale_admins' } });
    expect((stale.lastDetails as { stale: string[] }).stale).toContain(`Stale ${tag}`);
    const off = await db().trustTest.findUniqueOrThrow({ where: { key: 'offboarded_admins' } });
    expect((off.lastDetails as { accounts: string[] }).accounts).toContain(`gone ${tag}`);
    await runMonitors({ keys: ['stale_admins', 'offboarded_admins'] });
    expect(await db().trustAlert.count({ where: { kind: 'test_failed' } })).toBeLessThanOrEqual(before + 2);
    expect(await db().trustTestRun.count({ where: { testKey: 'stale_admins' } })).toBeGreaterThan(0);
  });

  it('never puts a secret in a result', async () => {
    await mgr.as('post', '/trust/tests/run').send({});
    const all = JSON.stringify(await db().trustTest.findMany());
    expect(all).not.toContain(process.env.JWT_SECRET);
    expect(all).not.toContain(process.env.LOCAL_KEK_BASE64);
    expect(all).not.toContain('change-me');
  });
});

describe('Trust: evidence', () => {
  it('seals uploaded files, gives them back intact, and turns a backup test green', async () => {
    const r = await mgr.as('post', '/trust/evidence').send({ controlKey: 'BK-02', kind: 'FILE', title: 'November restore test', fileName: 'restore.pdf', data: `data:application/pdf;base64,${PDF.toString('base64')}` });
    expect(r.status).toBe(201);
    expect(r.body.ciphertext).toBeUndefined();
    const row = await owner.trustEvidence.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(Buffer.from(row.ciphertext!).includes(Buffer.from(`restore test ${tag}`))).toBe(false);
    expect(Buffer.from(row.ciphertext!).includes(Buffer.from(PDF.toString('base64')))).toBe(false);
    const f = await mgr.as('get', `/trust/evidence/${r.body.id}/file`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(f.status).toBe(200);
    expect(Buffer.compare(f.body as Buffer, PDF)).toBe(0);
    expect((await db().trustTest.findUniqueOrThrow({ where: { key: 'restore_evidence' } })).lastStatus).toBe('PASS');
    expect((await mgr.as('post', '/trust/evidence').send({ controlKey: 'BK-02', kind: 'FILE', title: 'x', fileName: 'x.exe', data: 'data:application/pdf;base64,TVqQAAMAAAAEAAAA' })).status).toBe(415);
    expect(await owner.platformAudit.count({ where: { adminId: mgr.id, action: { in: ['trust.evidence.add', 'trust.evidence.open'] } } })).toBe(2);
  });

  it('records a CI result for the dependency audit test', async () => {
    expect((await mgr.as('post', '/trust/evidence').send({ controlKey: 'VM-01', kind: 'CI', title: 'Security workflow #812', url: 'https://github.com/example/run/812', result: 'PASS' })).status).toBe(201);
    expect((await db().trustTest.findUniqueOrThrow({ where: { key: 'dependency_audit' } })).lastStatus).toBe('PASS');
  });
});

describe('Trust: policies', () => {
  it('approves, publishes and tracks acknowledgement', async () => {
    const list = (await mgr.as('get', '/trust/policies')).body.policies as Array<{ id: string; key: string; versions: Array<{ id: string; status: string }> }>;
    expect(list.length).toBe(12);
    const pol = list.find((x) => x.key === 'acceptable-use')!;
    const v = pol.versions[0]!;
    expect((await mgr.as('post', `/trust/policies/${pol.id}/versions/${v.id}/publish`)).status).toBe(400);
    if (v.status === 'DRAFT') expect((await mgr.as('post', `/trust/policies/${pol.id}/versions/${v.id}/approve`)).status).toBe(200);
    expect((await mgr.as('post', `/trust/policies/${pol.id}/versions/${v.id}/publish`)).status).toBe(200);
    const reader = await admin('acker', ['trust.read']);
    expect((await reader.as('post', `/trust/policies/${pol.id}/ack`)).status).toBe(201);
    expect((await reader.as('post', `/trust/policies/${pol.id}/ack`)).status).toBe(201);
    const after = (await reader.as('get', '/trust/policies')).body.policies.find((x: { key: string }) => x.key === 'acceptable-use');
    expect(after).toMatchObject({ status: 'PUBLISHED', mine: true });
    expect(after.pending).not.toContain(`acker ${tag}`);
    expect(after.nextReviewAt).toBeTruthy();
    expect(await owner.trustPolicyAck.count({ where: { adminId: reader.id } })).toBe(1);
  });
});

describe('Trust: risks', () => {
  it('adds, scores, updates and reviews a risk', async () => {
    const r = await mgr.as('post', '/trust/risks').send({ title: `Phishing of console staff ${tag}`, category: 'access', description: 'A convincing email steals a session.', likelihood: 4, impact: 4, residualLikelihood: 2, residualImpact: 4, treatment: 'MITIGATE', controlKeys: ['AC-01', 'NOPE'], dueAt: '2026-12-31' });
    expect(r.status).toBe(201);
    expect(r.body.ref).toMatch(/^R-\d{3}$/);
    expect(r.body.controlKeys).toEqual(['AC-01']);
    expect((await mgr.as('patch', `/trust/risks/${r.body.id}`).send({ residualLikelihood: 1 })).status).toBe(200);
    expect((await mgr.as('patch', `/trust/risks/${r.body.id}`).send({ likelihood: 9 })).status).toBe(400);
    expect((await mgr.as('post', `/trust/risks/${r.body.id}/review`)).status).toBe(200);
    const list = (await mgr.as('get', '/trust/risks')).body;
    const mine = list.risks.find((x: { id: string }) => x.id === r.body.id);
    expect(mine).toMatchObject({ inherent: 16, residual: 4, level: 'low' });
  });
});

describe('Trust: reminders', () => {
  it('reminds before a vendor’s SOC 2 report expires, once per offset', async () => {
    const now = new Date();
    const v = await mgr.as('post', '/trust/vendors').send({ name: `Mail Co ${tag}`, purpose: 'Email', criticality: 'HIGH', dataAccessed: 'Addresses', personalInfo: true, dataLocation: 'Canada', inCanada: true, soc2ExpiresAt: new Date(now.getTime() + 6 * DAY).toISOString(), questionnaire: { certification: 'yes', dpa: 'yes', canada: 'yes', bogus: 'yes' } });
    expect(v.status).toBe(201);
    expect(v.body.score).toBe(100);
    expect(v.body.questionnaire).not.toHaveProperty('bogus');
    await runReminders(db(), now);
    const alerts = await db().trustAlert.findMany({ where: { title: { contains: `Mail Co ${tag}: SOC 2 report expires` } } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.title).toContain('due in 6 days');
    await runReminders(db(), now);
    expect(await db().trustAlert.count({ where: { title: { contains: `Mail Co ${tag}: SOC 2` } } })).toBe(1);
    await runReminders(db(), new Date(now.getTime() + 5 * DAY + 3_600_000));
    expect(await db().trustAlert.count({ where: { title: { contains: `Mail Co ${tag}: SOC 2` } } })).toBe(2);
  });

  it('reminds 30, 7 and 1 days before a commitment, then when overdue; a recurring one rolls forward', async () => {
    const { tenant } = await seedTenant(`trustc${tag}`, 0);
    const due = new Date(Date.UTC(2027, 2, 15, 12));
    const c = await mgr.as('post', '/trust/commitments').send({ tenantId: tenant.id, customer: tenant.name, kind: 'REPORT_DELIVERY', title: `Annual security report ${tag}`, dueAt: due.toISOString(), recurrence: 'YEARLY' });
    expect(c.status).toBe(201);
    const at = (d: number) => new Date(due.getTime() - d * DAY);
    for (const d of [40, 30, 20, 7, 1, -2, -3]) await runReminders(db(), at(d));
    const titles = (await db().trustAlert.findMany({ where: { title: { contains: `Annual security report ${tag}` } }, orderBy: { createdAt: 'asc' } })).map((a) => a.title);
    expect(titles.map((x) => /\((due in \d+ days|due tomorrow|overdue)/.exec(x)![1])).toEqual(['due in 30 days', 'due in 7 days', 'due tomorrow', 'overdue']);
    const f = await mgr.as('post', `/trust/commitments/${c.body.id}/fulfil`).send({ note: 'Sent the PDF to the city’s privacy office' });
    expect(f.status).toBe(200);
    expect(f.body).toMatchObject({ status: 'OPEN', dueAt: '2028-03-15T12:00:00.000Z' });
    await runReminders(db(), new Date(Date.UTC(2028, 1, 14, 12)));
    expect(await db().trustAlert.count({ where: { title: { contains: `Annual security report ${tag}` } } })).toBe(5);
    expect(await db().trustCommitmentFulfilment.count({ where: { commitmentId: c.body.id } })).toBe(1);
    expect((await mgr.as('post', '/trust/commitments').send({ tenantId: '00000000-0000-4000-8000-000000000000', customer: 'X', kind: 'CUSTOM', title: 'x' })).status).toBe(400);
  });
});

describe('Trust: posture summary for customers', () => {
  it('shares readiness bands and controls in place only, and never claims certification', async () => {
    const r = await mgr.as('get', '/trust/summary.json');
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['auditReportOnFile', 'frameworks', 'generatedAt', 'inPlace', 'libraryVersion', 'score', 'subprocessors']);
    const s = JSON.stringify(r.body);
    expect(s).not.toMatch(/certified/i);
    expect(s).not.toMatch(/R-0\d\d|Annual security report|missingPasskeys|stale/);
    for (const f of r.body.frameworks) expect(Object.keys(f).sort()).toEqual(['band', 'key', 'name', 'nameFr', 'readiness']);
    expect(r.body.inPlace.every((c: { key: string }) => typeof c.key === 'string')).toBe(true);
    const pdf = await mgr.as('get', '/trust/summary.pdf?lang=fr');
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const zip = await mgr.as('get', '/trust/export/soc2.zip');
    expect(zip.status).toBe(200);
    expect(zip.headers['content-type']).toBe('application/zip');
    expect(await owner.platformAudit.count({ where: { adminId: mgr.id, action: { in: ['trust.export.summary', 'trust.export.auditor'] } } })).toBe(3);
  });

  it('writes the auditor bundle in French when asked, with the French test sentences', async () => {
    const { strFromU8, unzipSync } = await import('fflate');
    const { auditorBundle } = await import('../../src/services/trust/exports.js');
    await runMonitors({ keys: ['data_residency'], force: true, trigger: 'manual' });
    const files = (z: Uint8Array) => Object.fromEntries(Object.entries(unzipSync(z)).map(([k, v]) => [k, strFromU8(v)]));
    const en = files((await auditorBundle(db(), 'soc2')).zip);
    const fr = files((await auditorBundle(db(), 'soc2', new Date(), true)).zip);
    expect(en['requirements.csv']).toContain('Requirement,Group,Title');
    expect(fr['requirements.csv']).toContain('Exigence,Groupe,Titre');
    expect(fr['requirements.csv']).toContain('CC6 Accès logique et physique');
    expect(fr['README.txt']).toContain('dossier de preuves SOC 2');
    expect(fr['tests.csv']).toContain('Hébergé dans une région canadienne');
    expect(fr['tests.csv']).toMatch(/Région [a-z0-9-]+ /);
    expect(fr['vendors.csv']).toContain('Fournisseur,Utilité,Criticité');
  });

  it('needs a passkey step-up for exports when the second factor is on', async () => {
    process.env.PLATFORM_MFA = 'required';
    try {
      const r = await mgr.as('get', '/trust/summary.pdf');
      expect(r.status).toBe(403);
      expect(['MFA_REQUIRED', 'PASSKEY_STEP_UP']).toContain(r.body.code);
    } finally {
      delete process.env.PLATFORM_MFA;
    }
  });
});
