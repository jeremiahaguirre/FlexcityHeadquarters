/**
 * When single sign-on gives the session its second factor (ASVS 6.8.4; owner decision 1): for roles
 * that need a passkey, only with the provider's proof of a phishing-resistant method (fresh, for
 * admin-level powers); for everyone else, as before.
 */
import { describe, expect, it } from 'vitest';
import { permissionsFor } from '../../src/auth/permissions.js';
import { ADMIN_AUTH_MAX_AGE_S, ssoSecondFactor } from '../../src/services/auth/sso.js';

const NOW = 2_000_000_000;
const perms = { lifeguard: permissionsFor(['STAFF']), head: permissionsFor(['HEAD_LIFEGUARD']), hr: permissionsFor(['HR_ADMIN']), supervisor: permissionsFor(['AQUATIC_SUPERVISOR']), steward: permissionsFor(['UNION_STEWARD']), frontDesk: permissionsFor(['FRONT_DESK']), manager: new Set(['schedule.read', 'discipline.read', 'reliability.read']) };
const factor = (who: keyof typeof perms, proof: { mfa?: boolean; phishingResistant?: boolean; authTime?: number }, idpMfa = false) =>
  ssoSecondFactor({ mfa: !!proof.mfa, phishingResistant: !!proof.phishingResistant, authTime: proof.authTime }, { idpMfa, permissions: perms[who], now: NOW });

describe('roles that don’t need a passkey keep today’s rule', () => {
  it.each(['lifeguard', 'head', 'steward', 'frontDesk'] as const)('%s: any reported second factor, or the city switch', (who) => {
    expect(factor(who, { mfa: true })).toEqual({ mfa: true, passkeyRequired: false });
    expect(factor(who, {}, true)).toEqual({ mfa: true, passkeyRequired: false });
    expect(factor(who, {})).toEqual({ mfa: false, passkeyRequired: false });
  });
});

describe('roles that need a passkey', () => {
  it.each(['hr', 'supervisor', 'manager'] as const)('%s: a plain mfa amr or the city switch never counts, and a passkey is owed', (who) => {
    expect(factor(who, { mfa: true, authTime: NOW })).toEqual({ mfa: false, passkeyRequired: true });
    expect(factor(who, {}, true)).toEqual({ mfa: false, passkeyRequired: true });
    expect(factor(who, { mfa: true, authTime: NOW }, true)).toEqual({ mfa: false, passkeyRequired: true });
  });

  it.each(['hr', 'supervisor', 'manager'] as const)('%s: phishing-resistant proof with a fresh sign-in counts', (who) => {
    expect(factor(who, { phishingResistant: true, authTime: NOW - 60 })).toEqual({ mfa: true, passkeyRequired: false });
  });

  it('admin-level powers need the provider sign-in within 15 minutes; other managers don’t', () => {
    for (const who of ['hr', 'supervisor'] as const) {
      expect(factor(who, { phishingResistant: true, authTime: NOW - ADMIN_AUTH_MAX_AGE_S }).mfa).toBe(true);
      expect(factor(who, { phishingResistant: true, authTime: NOW - ADMIN_AUTH_MAX_AGE_S - 1 }).mfa).toBe(false);
      expect(factor(who, { phishingResistant: true }).mfa).toBe(false);
      expect(factor(who, { phishingResistant: true, authTime: NOW + 3600 }).mfa).toBe(false); // a sign-in "from the future"
    }
    expect(factor('manager', { phishingResistant: true })).toEqual({ mfa: true, passkeyRequired: false });
  });

  it('SAML gives no phishing-resistant proof yet, so HR confirms with a passkey even with Entra multipleauthn', () => {
    expect(factor('hr', { mfa: true, phishingResistant: false, authTime: undefined }, true)).toEqual({ mfa: false, passkeyRequired: true });
  });
});
