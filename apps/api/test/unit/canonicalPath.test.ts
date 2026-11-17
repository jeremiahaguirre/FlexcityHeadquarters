import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { type AddressInfo, connect } from 'node:net';
import express from 'express';
import { canonicalPath, originFormOnly, routedPath } from '../../src/lib/canonicalPath.js';
import { supportMayOpen } from '../../src/auth/middleware.js';

describe('canonicalPath', () => {
  it('decodes, lower-cases and drops the query, repeated and trailing slashes', () => {
    expect(canonicalPath('/api/Users/%33fa85f64-5717-4562-b3fc-2c963f66afa6/SIN?x=1')).toBe('/api/users/3fa85f64-5717-4562-b3fc-2c963f66afa6/sin');
    expect(canonicalPath('/api//incidents/abc/')).toBe('/api/incidents/abc');
    expect(canonicalPath('/')).toBe('/');
  });
  it('returns null for a malformed escape', () => {
    expect(canonicalPath('/api/users/%zz')).toBeNull();
  });
  it('reduces an absolute-form target to its pathname, whatever the scheme’s case', () => {
    expect(canonicalPath('http://x/api/Users/abc/SIN?y=1')).toBe('/api/users/abc/sin');
    expect(canonicalPath('HTTP://x/api/union/locals')).toBe('/api/union/locals');
    expect(canonicalPath('*')).toBeNull();
  });
});

describe('routedPath and originFormOnly', () => {
  it('routedPath is the path the router matched, even for an absolute-form request line; originFormOnly refuses that form', async () => {
    const seen: string[] = [];
    const router = express.Router();
    router.get('/users/:id/sin', (req, res) => {
      seen.push(routedPath(req), req.originalUrl);
      res.json({ ok: true });
    });
    const plain = express().use('/api', router);
    const strict = express().use(originFormOnly).use('/api', router);
    const send = (app: express.Express, target: string) =>
      new Promise<string>((resolve, reject) => {
        const srv = createServer(app).listen(0, () => {
          const s = connect((srv.address() as AddressInfo).port, '127.0.0.1');
          let out = '';
          s.on('data', (c) => (out += c.toString('latin1')));
          s.on('end', () => (srv.close(), resolve(out.slice(9, 12))));
          s.on('error', reject);
          s.write(`GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
        });
      });
    expect(await send(plain, 'http://x/api/users/abc/sin')).toBe('200');
    expect(seen).toEqual(['/api/users/abc/sin', 'http://x/api/users/abc/sin']);
    expect(await send(strict, 'HTTP://x/api/users/abc/sin')).toBe('400');
    expect(await send(strict, '/api/users/abc/sin')).toBe('200');
  });
});

describe('supportMayOpen', () => {
  const id = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
  it('refuses records whatever the case, encoding or request-target form', () => {
    for (const url of [`http://x/api/users/${id}/sin`, 'HTTP://x/api/union/locals', '/api/offboarding', '/api/leave/balances', '/api/lieu', '/api/payees', `/api/jobs/${id}/applications`, '/api/surveys-admin/offboardings',`/api/users/${id}/documents`, `/api/Users/${id}/Documents`, `/api/users/${id}/%64ocuments`, '/api/Union/locals', '/api/UNION', `/api/incidents/${id}/`, '/api/Payroll/people', '/api/users/%zz/documents', `/api/users/${id}/salary`, '/api/messages/conversations']) {
      expect(supportMayOpen(url), url).toBe(false);
    }
  });
  it('lets setup pages through', () => {
    for (const url of ['/api/settings', '/api/Settings', '/api/payroll/settings', '/api/shifts?from=2026-01-01', `/api/users/${id}`]) {
      expect(supportMayOpen(url), url).toBe(true);
    }
  });
});
