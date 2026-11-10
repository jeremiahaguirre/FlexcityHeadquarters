/**
 * Direct deposit accounts and tax profiles.
 *
 * Security:
 * - Account numbers and SINs are sealed with the city's own key (envelope
 *   encryption); only the last digits are stored in clear.
 * - A new account starts PENDING and is used only after someone other than the
 *   person who entered it verifies it (stops a single compromised account from
 *   redirecting pay).
 * - The employee is told about every change to where their pay goes.
 */
import type { Tx } from '../../lib/db.js';
import { HttpError, badRequest, forbidden, notFound } from '../../lib/errors.js';
import { keys, tenantKekId } from '../../routes/context.js';
import { open, seal } from '../crypto/envelope.js';
import { notify, usersWithPermission } from '../notifications/notifier.js';

export const CONSENT = {
  'en-CA':
    'I authorize my employer to deposit my pay directly into this account, and to reverse a deposit made in error. This authorization stays in effect until I replace or cancel it in writing or in the app.',
  'fr-CA':
    'J’autorise mon employeur à déposer ma paie directement dans ce compte et à annuler tout dépôt fait par erreur. Cette autorisation demeure en vigueur jusqu’à ce que je la remplace ou l’annule par écrit ou dans l’application.',
} as const;

const aad = (kind: 'bank' | 'sin', tenantId: string, userId: string) => `${kind}:${tenantId}:${userId}`;

export function checkBankNumbers(institution: string, transit: string, account: string) {
  if (!/^\d{3}$/.test(institution)) throw badRequest('The institution number is 3 digits (e.g. 001 for BMO, 004 for TD).');
  if (!/^\d{5}$/.test(transit)) throw badRequest('The transit (branch) number is 5 digits.');
  if (!/^\d{5,12}$/.test(account)) throw badRequest('The account number is 5 to 12 digits.');
}

/** Social Insurance Numbers pass the Luhn check; numbers starting with 0 or 8 aren't issued to people. */
export function validSin(sin: string): boolean {
  const d = sin.replace(/\D/g, '');
  if (!/^[1-79]\d{8}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let n = Number(d[i]) * (i % 2 ? 2 : 1);
    if (n > 9) n -= 9;
    sum += n;
  }
  return sum % 10 === 0;
}

export async function addBankAccount(
  tx: Tx,
  tenantId: string,
  input: { userId: string; enteredById: string; holderName: string; institution: string; transit: string; account: string; locale: 'en-CA' | 'fr-CA' },
) {
  checkBankNumbers(input.institution, input.transit, input.account);
  const sealed = await seal(keys(), tenantKekId(tenantId), input.account, aad('bank', tenantId, input.userId));
  // Only one account waits at a time: a newer entry replaces an older pending one.
  await tx.bankAccount.updateMany({ where: { userId: input.userId, status: 'PENDING' }, data: { status: 'REJECTED', retiredAt: new Date() } });
  const row = await tx.bankAccount.create({
    data: {
      tenantId,
      userId: input.userId,
      holderName: input.holderName,
      institution: input.institution,
      transit: input.transit,
      accountCiphertext: sealed.ciphertext,
      accountIv: sealed.iv,
      accountAuthTag: sealed.authTag,
      accountWrappedKey: sealed.wrappedDataKey,
      accountKekId: sealed.kekId,
      last4: input.account.slice(-4),
      consentText: CONSENT[input.locale],
      consentAt: new Date(),
      enteredById: input.enteredById,
    },
  });
  const verifiers = await usersWithPermission(tx, tenantId, 'payroll.export', [input.enteredById]);
  await notify(tx, tenantId, [
    // Always tell the employee, even when they made the change: a stranger changing it is how pay gets stolen.
    { userId: input.userId, type: 'bank_changed', params: { last4: row.last4 }, link: '/pay', email: 'bank_changed' },
    ...verifiers.map((userId) => ({ userId, type: 'bank_to_verify', params: { last4: row.last4 }, link: '/manage/payroll?tab=people' })),
  ]);
  return row;
}

export async function verifyBankAccount(tx: Tx, tenantId: string, id: string, verifierId: string, approve: boolean) {
  const row = await tx.bankAccount.findUnique({ where: { id } });
  if (!row || row.status !== 'PENDING') throw notFound('Pending bank account');
  if (row.enteredById === verifierId) throw forbidden('Someone other than the person who entered these banking details has to verify them.');
  if (!approve) {
    await tx.bankAccount.update({ where: { id }, data: { status: 'REJECTED', retiredAt: new Date(), verifiedById: verifierId, verifiedAt: new Date() } });
    await notify(tx, tenantId, [{ userId: row.userId, type: 'bank_rejected', params: { last4: row.last4 }, link: '/pay', email: 'bank_rejected' }]);
    return;
  }
  await tx.bankAccount.updateMany({ where: { userId: row.userId, status: 'ACTIVE' }, data: { status: 'RETIRED', retiredAt: new Date() } });
  await tx.bankAccount.update({ where: { id }, data: { status: 'ACTIVE', verifiedById: verifierId, verifiedAt: new Date() } });
  await notify(tx, tenantId, [{ userId: row.userId, type: 'bank_active', params: { last4: row.last4 }, link: '/pay', email: 'bank_active' }]);
}

export async function accountNumber(tenantId: string, row: { userId: string; accountCiphertext: Uint8Array; accountIv: Uint8Array; accountAuthTag: Uint8Array; accountWrappedKey: Uint8Array; accountKekId: string }) {
  return open(keys(), { ciphertext: Buffer.from(row.accountCiphertext), iv: Buffer.from(row.accountIv), authTag: Buffer.from(row.accountAuthTag), wrappedDataKey: Buffer.from(row.accountWrappedKey), kekId: row.accountKekId }, aad('bank', tenantId, row.userId));
}

export const bankView = (b: { id: string; holderName: string; institution: string; transit: string; last4: string; status: string; createdAt: Date; verifiedAt: Date | null; enteredById: string }) => ({
  id: b.id,
  holderName: b.holderName,
  institution: b.institution,
  transit: b.transit,
  account: `••••${b.last4}`,
  status: b.status,
  createdAt: b.createdAt,
  verifiedAt: b.verifiedAt,
  enteredById: b.enteredById,
});

export interface ProfileInput {
  province?: string | null;
  federalClaim?: number | null;
  provincialClaim?: number | null;
  extraTaxPerPeriod?: number;
  cppExempt?: boolean;
  eiExempt?: boolean;
  sin?: string | null;
}

export async function savePayProfile(tx: Tx, tenantId: string, userId: string, input: ProfileInput, byEmployee: boolean) {
  const data: Record<string, unknown> = {};
  if (input.province !== undefined) data.province = input.province;
  if (input.federalClaim !== undefined) data.federalClaim = input.federalClaim;
  if (input.provincialClaim !== undefined) data.provincialClaim = input.provincialClaim;
  if (input.extraTaxPerPeriod !== undefined) data.extraTaxPerPeriod = input.extraTaxPerPeriod;
  // Exemptions are an employer decision (e.g. CPP for people over 70), never self-declared.
  if (!byEmployee && input.cppExempt !== undefined) data.cppExempt = input.cppExempt;
  if (!byEmployee && input.eiExempt !== undefined) data.eiExempt = input.eiExempt;
  if (byEmployee && (input.federalClaim !== undefined || input.provincialClaim !== undefined)) data.td1SignedAt = new Date();
  if (input.sin) {
    if (!validSin(input.sin)) throw new HttpError(400, 'INVALID_SIN', 'That isn’t a valid Social Insurance Number.');
    const digits = input.sin.replace(/\D/g, '');
    const s = await seal(keys(), tenantKekId(tenantId), digits, aad('sin', tenantId, userId));
    Object.assign(data, { sinCiphertext: s.ciphertext, sinIv: s.iv, sinAuthTag: s.authTag, sinWrappedKey: s.wrappedDataKey, sinKekId: s.kekId, sinLast3: digits.slice(-3) });
  }
  return tx.payProfile.upsert({ where: { userId }, update: data, create: { tenantId, userId, ...data } });
}

export async function revealSin(tenantId: string, p: { userId: string; sinCiphertext: Uint8Array | null; sinIv: Uint8Array | null; sinAuthTag: Uint8Array | null; sinWrappedKey: Uint8Array | null; sinKekId: string | null }) {
  if (!p.sinCiphertext || !p.sinIv || !p.sinAuthTag || !p.sinWrappedKey || !p.sinKekId) return null;
  return open(keys(), { ciphertext: Buffer.from(p.sinCiphertext), iv: Buffer.from(p.sinIv), authTag: Buffer.from(p.sinAuthTag), wrappedDataKey: Buffer.from(p.sinWrappedKey), kekId: p.sinKekId }, aad('sin', tenantId, p.userId));
}

export const profileView = (p: { province: string | null; federalClaim: unknown; provincialClaim: unknown; extraTaxPerPeriod: unknown; cppExempt: boolean; eiExempt: boolean; sinLast3: string | null; td1SignedAt: Date | null } | null) => ({
  province: p?.province ?? null,
  federalClaim: p?.federalClaim != null ? Number(p.federalClaim) : null,
  provincialClaim: p?.provincialClaim != null ? Number(p.provincialClaim) : null,
  extraTaxPerPeriod: p ? Number(p.extraTaxPerPeriod) : 0,
  cppExempt: p?.cppExempt ?? false,
  eiExempt: p?.eiExempt ?? false,
  sin: p?.sinLast3 ? `•••-•••-${p.sinLast3}` : null,
  td1SignedAt: p?.td1SignedAt ?? null,
});
