'use client';

import { api, setAccessToken } from './api';

/**
 * A one-time sign-in code by email or text, the other second factor beside a passkey
 * (apps/api/src/routes/mfaCodes.ts). These calls are what a session owing a second factor
 * may reach, so they never wait on the second-factor prompt themselves.
 */
export type CodeChannel = 'email' | 'sms';
export interface CodeOptions {
  codes: boolean;
  channels: Array<{ channel: CodeChannel; destination: string }>;
  expiresInMinutes?: number;
  resendAfterSeconds?: number;
}

export const CODE_LENGTH = 6;
export const RESEND_SECONDS = 30;

/**
 * What the person typed or pasted, as the code: digits only. A pasted message ("Your code is
 * 123 456. It expires in 10 minutes.") gives the 6-digit group in it, not every digit.
 */
export function normalizeCode(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length <= CODE_LENGTH) return digits;
  const group = raw.match(/(?<!\d)(\d{3})[\s -]?(\d{3})(?!\d)/);
  return group ? `${group[1]}${group[2]}` : digits.slice(0, CODE_LENGTH);
}

export const codeOptions = () => api<CodeOptions>('/api/auth/mfa/options', {}, true, true);

export const sendCode = (channel: CodeChannel) =>
  api<{ channel: CodeChannel; destination: string; expiresInMinutes: number; resendAfterSeconds: number }>('/api/auth/mfa/code', { method: 'POST', body: { channel } }, true, true);

export async function verifyCode(code: string) {
  const r = await api<{ accessToken: string }>('/api/auth/mfa/code/verify', { method: 'POST', body: { code } }, true, true);
  setAccessToken(r.accessToken);
}
