import { describe, expect, it } from 'vitest';
import { canonicalPath } from '../../src/lib/canonicalPath.js';
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
});

describe('supportMayOpen', () => {
  const id = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
  it('refuses records whatever the case or encoding', () => {
    for (const url of [`/api/users/${id}/documents`, `/api/Users/${id}/Documents`, `/api/users/${id}/%64ocuments`, '/api/Union/locals', '/api/UNION', `/api/incidents/${id}/`, '/api/Payroll/people', '/api/users/%zz/documents', `/api/users/${id}/salary`, '/api/messages/conversations']) {
      expect(supportMayOpen(url), url).toBe(false);
    }
  });
  it('lets setup pages through', () => {
    for (const url of ['/api/settings', '/api/Settings', '/api/payroll/settings', '/api/shifts?from=2026-01-01', `/api/users/${id}`]) {
      expect(supportMayOpen(url), url).toBe(true);
    }
  });
});
