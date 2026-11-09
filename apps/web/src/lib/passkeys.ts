'use client';

import { browserSupportsWebAuthn, platformAuthenticatorIsAvailable, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { api, setAccessToken } from './api';
import { DEMO } from './demo';
import { papi } from './platform';

/**
 * Passkeys: the device's own unlock (Face ID, Touch ID, fingerprint, Windows
 * Hello, or a security key) instead of a password.
 */
export const passkeysSupported = () => !DEMO && typeof window !== 'undefined' && browserSupportsWebAuthn();

/** Built-in biometrics/PIN on this device (worth offering setup after a password sign-in). */
export async function deviceCanUsePasskeys(): Promise<boolean> {
  if (!passkeysSupported()) return false;
  return platformAuthenticatorIsAvailable().catch(() => false);
}

/** The person closed the device prompt: not an error worth shouting about. */
export const cancelled = (e: unknown) => e instanceof Error && (e.name === 'NotAllowedError' || e.name === 'AbortError');

type Options = { challengeId: string; options: Parameters<typeof startAuthentication>[0]['optionsJSON'] };
type RegOptions = { challengeId: string; options: Parameters<typeof startRegistration>[0]['optionsJSON'] };

export async function signInWithPasskey() {
  const o = await api<Options>('/api/auth/passkey/options', { method: 'POST', body: {} }, false);
  const response = await startAuthentication({ optionsJSON: o.options });
  const r = await api<{ accessToken: string; user: { id: string } }>('/api/auth/passkey', { method: 'POST', body: { challengeId: o.challengeId, response } }, false);
  setAccessToken(r.accessToken);
  return r.user;
}

export async function addPasskey() {
  const o = await api<RegOptions>('/api/me/passkeys/options', { method: 'POST', body: {} });
  const response = await startRegistration({ optionsJSON: o.options });
  return api<{ id: string; name: string }>('/api/me/passkeys', { method: 'POST', body: { challengeId: o.challengeId, response } });
}

/** "Confirm it's you" with a passkey. Throws ApiError NO_PASSKEY if the account has none. */
export async function stepUpWithPasskey() {
  const o = await api<Options>('/api/auth/step-up/options', { method: 'POST', body: {} }, true, true);
  const response = await startAuthentication({ optionsJSON: o.options });
  const r = await api<{ accessToken: string }>('/api/auth/step-up', { method: 'POST', body: { challengeId: o.challengeId, response } }, true, true);
  setAccessToken(r.accessToken);
}

export async function stepUpWithPassword(password: string) {
  const r = await api<{ accessToken: string }>('/api/auth/step-up', { method: 'POST', body: { password } }, true, true);
  setAccessToken(r.accessToken);
}

// ---------------------------------------------------------------- Dev console
export async function platformSignInWithPasskey() {
  const o = await papi<Options>('/auth/passkey/options', { method: 'POST', body: {} });
  const response = await startAuthentication({ optionsJSON: o.options });
  return papi('/auth/passkey', { method: 'POST', body: { challengeId: o.challengeId, response } });
}

export async function platformAddPasskey() {
  const o = await papi<RegOptions>('/passkeys/options', { method: 'POST', body: {} });
  const response = await startRegistration({ optionsJSON: o.options });
  return papi<{ id: string; name: string }>('/passkeys', { method: 'POST', body: { challengeId: o.challengeId, response } });
}
