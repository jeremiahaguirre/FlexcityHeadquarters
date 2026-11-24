import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import * as openpgp from 'openpgp';
import { Server, utils } from 'ssh2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { ensureTaxTables } from '../../src/services/payroll/taxTables.js';
import { prepareBankFile, readSettings, sendToBank } from '../../src/services/payroll/payRuns.js';
import { withTenant } from '../../src/lib/db.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');

const server = createApp();
const SUB = 'bankcity';
let t: Awaited<ReturnType<typeof seedTenant>>;
const tok = { prep: '', approver: '' };
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  put: (p: string, b: object = {}) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});

// ---- A stand-in for the bank: an SFTP server that keeps uploaded files in memory.
const { STATUS_CODE, OPEN_MODE } = utils.sftp;
const hostKey = utils.generateKeyPairSync('ed25519');
const parsed = utils.parseKey(hostKey.public);
const fingerprint = createHash('sha256').update((Array.isArray(parsed) ? parsed[0] : parsed)!.getPublicSSH()).digest('base64').replace(/=+$/, '');
const received = new Map<string, Buffer>();
// Holds uploads while set, so a test can act while a file is on its way to the bank.
let gate: Promise<void> | null = null;
let uploading = false;
let sftpServer: Server;
let port = 0;
let bankPgp: { publicKey: string; privateKey: string };

beforeAll(async () => {
  sftpServer = new Server({ hostKeys: [hostKey.private] }, (client) => {
    client.on('error', () => undefined); // the client hanging up on a fingerprint mismatch
    client.on('authentication', (ctx) => (ctx.method === 'password' && ctx.username === 'city' && ctx.password === 's3cret-pw' ? ctx.accept() : ctx.reject(['password'])));
    client.on('ready', () => {
      client.on('session', (acceptSession) => {
        const session = acceptSession();
        session.on('sftp', (acceptSftp) => {
          const sftp = acceptSftp();
          const handles = new Map<string, { name: string; chunks: Buffer[]; dir?: boolean; listed?: boolean }>();
          let n = 0;
          const handle = () => {
            const h = Buffer.alloc(4);
            h.writeUInt32BE(n++);
            return h;
          };
          sftp.on('OPEN', (id, name, flags) => {
            if (!name.startsWith('/inbound/')) return sftp.status(id, STATUS_CODE.PERMISSION_DENIED);
            if (flags & OPEN_MODE.EXCL && received.has(name)) return sftp.status(id, STATUS_CODE.FAILURE);
            const h = handle();
            handles.set(h.toString('hex'), { name, chunks: [] });
            sftp.handle(id, h);
          });
          sftp.on('WRITE', (id, h, _offset, data) => {
            uploading = true;
            const write = () => {
              handles.get(h.toString('hex'))!.chunks.push(Buffer.from(data));
              sftp.status(id, STATUS_CODE.OK);
            };
            if (gate) void gate.then(write);
            else write();
          });
          sftp.on('CLOSE', (id, h) => {
            const e = handles.get(h.toString('hex'));
            if (e && !e.dir) received.set(e.name, Buffer.concat(e.chunks));
            handles.delete(h.toString('hex'));
            sftp.status(id, STATUS_CODE.OK);
          });
          sftp.on('OPENDIR', (id, path) => {
            if (path !== '/inbound') return sftp.status(id, STATUS_CODE.NO_SUCH_FILE);
            const h = handle();
            handles.set(h.toString('hex'), { name: path, chunks: [], dir: true });
            sftp.handle(id, h);
          });
          sftp.on('READDIR', (id, h) => {
            const e = handles.get(h.toString('hex'))!;
            if (e.listed) return sftp.status(id, STATUS_CODE.EOF);
            e.listed = true;
            sftp.name(id, [...received.keys()].map((f) => ({ filename: f.split('/').pop()!, longname: f, attrs: { mode: 0o100644, uid: 0, gid: 0, size: received.get(f)!.length, atime: 0, mtime: 0 } })));
          });
        });
      });
    });
  });
  await new Promise<void>((r) => sftpServer.listen(0, '127.0.0.1', () => r()));
  port = (sftpServer.address() as AddressInfo).port;
  bankPgp = await openpgp.generateKey({ type: 'ecc', curve: 'curve25519Legacy', userIDs: [{ name: 'Test Bank Payroll' }], format: 'armored' });

  // A city with approved hours, verified tables, a verified bank account and deposit details.
  t = await seedTenant(SUB, 1);
  await owner.tenant.update({ where: { id: t.tenant.id }, data: { payWeekStartDay: 1 } });
  const now = Math.floor(Date.now() / 1000);
  const hr = async (name: string) => (await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: name, lastName: 'HR', email: `${name}@${SUB}.test` } })).id;
  const prep = await hr('prep');
  const approver = await hr('approver');
  tok.prep = await signAccessToken({ sub: prep, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now, mfa: true });
  tok.approver = await signAccessToken({ sub: approver, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now, mfa: true });
  const u = t.users[0]!;
  await owner.user.update({ where: { id: u.id }, data: { hireDate: new Date('2024-01-01') } });
  await owner.payRate.create({ data: { tenantId: t.tenant.id, userId: u.id, positionId: t.position.id, hourlyRate: 30, effectiveFrom: new Date('2025-01-01') } });
  for (const d of [2, 3, 4]) {
    const start = new Date(Date.UTC(2026, 2, d, 16));
    await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: u.id, facilityId: t.facility.id, positionId: t.position.id, clockIn: start, clockOut: new Date(start.getTime() + 8 * 3_600_000), status: 'APPROVED' } });
  }
  await ensureTaxTables(owner, 2026);
  await owner.payrollTaxTable.updateMany({ where: { year: 2026 }, data: { verifiedAt: new Date(), verifiedBy: 'test' } });
  const bank = await call(tok.prep).post(`/api/users/${u.id}/bank-accounts`, { holderName: 'Guard Zero', institution: '004', transit: '12345', account: '9876543210', agree: true });
  await call(tok.approver).post(`/api/bank-accounts/${bank.body.id}/verify`, { approve: true });
  await call(tok.approver).put('/api/payroll/settings', { originatorId: 'BANKCITY01', originatorShortName: 'Bank City', originatorLongName: 'City of Bankcity Payroll', destinationDataCentre: '00310', returnsInstitution: '003', returnsTransit: '00010', returnsAccount: '7654321' });
});

afterAll(async () => {
  sftpServer?.close();
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('sending payroll straight to the bank', () => {
  const link = () => ({ host: '127.0.0.1', port, username: 'city', remoteDir: '/inbound', hostKeySha256: `SHA256:${fingerprint}`, password: 's3cret-pw', pgpPublicKey: bankPgp.publicKey, autoSend: true });

  it('stores the connection with its secret sealed, and never shows it back', async () => {
    expect((await call(tok.approver).put('/api/payroll/bank-connection', { ...link(), pgpPublicKey: bankPgp.privateKey })).body.code).toBe('BAD_PGP_KEY');
    const r = await call(tok.approver).put('/api/payroll/bank-connection', link());
    expect(r.status).toBe(200);
    expect(r.body.configured).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain('s3cret-pw');
    const stored = JSON.stringify((await owner.tenant.findUniqueOrThrow({ where: { id: t.tenant.id } })).payrollSettings);
    expect(stored).not.toContain('s3cret-pw');
    expect((await call(tok.prep).get('/api/payroll/settings')).body.bank.hostKeySha256).toBe(fingerprint);
  });

  it('tests the connection without sending anything', async () => {
    const r = await call(tok.approver).post('/api/payroll/bank-connection/test');
    expect(r.body).toEqual({ ok: true, files: 0 });
  });

  it('refuses a server whose fingerprint doesn’t match', async () => {
    await call(tok.approver).put('/api/payroll/bank-connection', { ...link(), hostKeySha256: `SHA256:${'A'.repeat(43)}` });
    const r = await call(tok.approver).post('/api/payroll/bank-connection/test');
    expect(r.status).toBe(502);
    expect(r.body.code).toBe('BANK_HOST_MISMATCH');
    await call(tok.approver).put('/api/payroll/bank-connection', link());
  });

  it('sends the encrypted deposit file when the run is approved, once', async () => {
    const run = await call(tok.prep).post('/api/payroll/runs', { departmentId: null, periodStart: '2026-03-02', weeks: 2, payDate: '2026-03-20' });
    const approved = await call(tok.approver).post(`/api/payroll/runs/${run.body.id}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.transmission.status).toBe('SENT');
    expect(received.size).toBe(1);
    const [name, bytes] = [...received.entries()][0]!;
    expect(name).toMatch(/^\/inbound\/FH-PAY-\d{4}-20260320\.txt\.pgp$/);
    // Only the bank can read it.
    expect(bytes.toString('latin1')).not.toContain('9876543210');
    const message = await openpgp.readMessage({ binaryMessage: bytes });
    const { data } = await openpgp.decrypt({ message, decryptionKeys: await openpgp.readPrivateKey({ armoredKey: bankPgp.privateKey }), format: 'binary' });
    const lines = Buffer.from(data as Uint8Array).toString('latin1').split('\r\n').filter(Boolean);
    expect(lines.map((l) => l.length)).toEqual([1464, 1464, 1464]);
    expect(lines[1]).toContain('9876543210');
    // Never twice.
    const again = await call(tok.approver).post(`/api/payroll/runs/${run.body.id}/send`);
    expect(again.body.code).toBe('ALREADY_SENT');
    const detail = (await call(tok.prep).get(`/api/payroll/runs/${run.body.id}`)).body;
    expect(detail.transmissions).toHaveLength(1);
    expect(detail.transmissions[0].status).toBe('SENT');
    expect(await owner.auditLog.count({ where: { tenantId: t.tenant.id, action: 'payroll.bank.sent' } })).toBe(1);
  });

  it('a run can’t be voided while its deposit file is on its way to the bank', async () => {
    const u = t.users[0]!;
    for (const d of [16, 17]) {
      const start = new Date(Date.UTC(2026, 2, d, 16));
      await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: u.id, facilityId: t.facility.id, positionId: t.position.id, clockIn: start, clockOut: new Date(start.getTime() + 8 * 3_600_000), status: 'APPROVED' } });
    }
    const run = await call(tok.prep).post('/api/payroll/runs', { departmentId: null, periodStart: '2026-03-16', weeks: 2, payDate: '2026-04-03' });
    expect(run.status).toBe(201);
    let release!: () => void;
    gate = new Promise((r) => (release = r));
    uploading = false;
    // Approving sends the file straight away (autoSend); the bank is slow to take it.
    const approving = call(tok.approver).post(`/api/payroll/runs/${run.body.id}/approve`).then((r) => r);
    await expect.poll(() => uploading, { timeout: 10_000 }).toBe(true);
    const v = await call(tok.approver).post(`/api/payroll/runs/${run.body.id}/void`, { reason: 'Wrong pay date, rebuilding' });
    release();
    gate = null;
    expect(v.status).toBe(409);
    expect(v.body.code).toBe('RUN_SENT_TO_BANK');
    const a = await approving;
    expect(a.body.transmission.status).toBe('SENT');
    expect((await owner.payRun.findUniqueOrThrow({ where: { id: run.body.id } })).status).toBe('APPROVED');
    expect((await owner.payTransmission.findMany({ where: { payRunId: run.body.id } })).map((x) => x.status)).toEqual(['SENT']);
  });

  it('a file the bank took is never recorded as failed, even if recording it as sent fails; payroll resolves it after checking with the bank', async () => {
    const u = t.users[0]!;
    for (const d of [30, 31]) {
      const start = new Date(Date.UTC(2026, 2, d, 16));
      await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: u.id, facilityId: t.facility.id, positionId: t.position.id, clockIn: start, clockOut: new Date(start.getTime() + 8 * 3_600_000), status: 'APPROVED' } });
    }
    await call(tok.approver).put('/api/payroll/bank-connection', { ...link(), autoSend: false });
    const run = await call(tok.prep).post('/api/payroll/runs', { departmentId: null, periodStart: '2026-03-30', weeks: 2, payDate: '2026-04-17' });
    expect(run.status).toBe(201);
    const runId = run.body.id as string;
    expect((await call(tok.approver).post(`/api/payroll/runs/${runId}/approve`)).status).toBe(200);
    const settings = readSettings((await owner.tenant.findUniqueOrThrow({ where: { id: t.tenant.id } })).payrollSettings);
    const prepared = await withTenant(t.tenant.id, (tx) => prepareBankFile(tx, t.tenant.id, runId, settings));
    const before = received.size;
    // The upload works; writing down that it was sent doesn't (a timeout or a dropped connection).
    const recorded: string[] = [];
    const out = await sendToBank(t.tenant.id, runId, null, settings, prepared, async (d) => {
      recorded.push(d.status);
      if (d.status === 'SENT') throw new Error('Transaction already closed');
      await owner.payTransmission.update({ where: { id: prepared.transmissionId }, data: { status: d.status, error: d.error } });
    });
    expect(received.size).toBe(before + 1);
    expect(recorded).not.toContain('FAILED');
    expect(out.status).toBe('SENDING');
    expect((await owner.payTransmission.findUniqueOrThrow({ where: { id: prepared.transmissionId } })).status).toBe('SENDING');
    // Still counts as at the bank: no void, no second send.
    expect((await call(tok.approver).post(`/api/payroll/runs/${runId}/void`, { reason: 'Rebuilding it' })).body.code).toBe('RUN_SENT_TO_BANK');
    expect((await call(tok.approver).post(`/api/payroll/runs/${runId}/send`)).body.code).toBe('ALREADY_SENT');
    // After checking with the bank, payroll records what happened, with a reason.
    const path = `/api/payroll/runs/${runId}/transmissions/${prepared.transmissionId}/resolve`;
    expect((await call(tok.approver).post(path, { outcome: 'SENT', reason: '' })).status).toBe(400);
    // Right after the send it might still be uploading, so it can't be resolved yet.
    expect((await call(tok.approver).post(path, { outcome: 'SENT', reason: 'The bank confirmed it received file 0003 by phone' })).body.code).toBe('SEND_IN_PROGRESS');
    await owner.payTransmission.update({ where: { id: prepared.transmissionId }, data: { createdAt: new Date(Date.now() - 16 * 60_000) } });
    const done = await call(tok.approver).post(path, { outcome: 'SENT', reason: 'The bank confirmed it received file 0003 by phone' });
    expect(done.status).toBe(200);
    expect((await owner.payTransmission.findUniqueOrThrow({ where: { id: prepared.transmissionId } })).status).toBe('SENT');
    expect(await owner.auditLog.count({ where: { tenantId: t.tenant.id, action: 'payroll.bank.resolved', entityId: runId } })).toBe(1);
    expect((await call(tok.approver).post(path, { outcome: 'FAILED', reason: 'Changed my mind' })).body.code).toBe('NOT_SENDING');
    await call(tok.approver).put('/api/payroll/bank-connection', link());
  });

  it('a send still uploading can’t be resolved; a result arriving after someone resolved it never overwrites that', async () => {
    const u = t.users[0]!;
    for (const d of [13, 14]) {
      const start = new Date(Date.UTC(2026, 3, d, 16));
      await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: u.id, facilityId: t.facility.id, positionId: t.position.id, clockIn: start, clockOut: new Date(start.getTime() + 8 * 3_600_000), status: 'APPROVED' } });
    }
    await call(tok.approver).put('/api/payroll/bank-connection', { ...link(), autoSend: false });
    const run = await call(tok.prep).post('/api/payroll/runs', { departmentId: null, periodStart: '2026-04-13', weeks: 2, payDate: '2026-05-01' });
    expect(run.status).toBe(201);
    const runId = run.body.id as string;
    expect((await call(tok.approver).post(`/api/payroll/runs/${runId}/approve`)).status).toBe(200);
    let release!: () => void;
    gate = new Promise((r) => (release = r));
    uploading = false;
    const sending = call(tok.approver).post(`/api/payroll/runs/${runId}/send`).then((r) => r);
    try {
      await expect.poll(() => uploading, { timeout: 10_000 }).toBe(true);
      const row = await owner.payTransmission.findFirstOrThrow({ where: { payRunId: runId, status: 'SENDING' } });
      const path = `/api/payroll/runs/${runId}/transmissions/${row.id}/resolve`;
      // Someone asks the bank mid-upload, is told nothing has arrived, and tries to record that.
      const early = await call(tok.approver).post(path, { outcome: 'FAILED', reason: 'The bank has nothing from us yet' });
      expect(early.status).toBe(409);
      expect(early.body.code).toBe('SEND_IN_PROGRESS');
      expect((await call(tok.approver).post(`/api/payroll/runs/${runId}/void`, { reason: 'Rebuilding it' })).body.code).toBe('RUN_SENT_TO_BANK');
      // Much later (the upload is stuck), it can be resolved; then the upload finishes after all.
      await owner.payTransmission.update({ where: { id: row.id }, data: { createdAt: new Date(Date.now() - 16 * 60_000) } });
      expect((await call(tok.approver).post(path, { outcome: 'FAILED', reason: 'The bank has no file from us today' })).status).toBe(200);
      release();
      gate = null;
      await sending;
      expect((await owner.payTransmission.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('FAILED');
      expect(await owner.auditLog.count({ where: { tenantId: t.tenant.id, action: 'payroll.bank.late_result', entityId: runId } })).toBe(1);
    } finally {
      release();
      gate = null;
      await call(tok.approver).put('/api/payroll/bank-connection', link());
    }
  });
});
