/**
 * Setting up in-app payroll's money path: the deposit file's originator details (from the city's
 * bank), the returns account, and the host-to-host connection that sends the file. Shared by the
 * city's own Payroll settings and the FH Dev console, so both apply the same rules.
 */
import { z } from 'zod';
import { HttpError } from '../../lib/errors.js';
import { type BankLink, checkPgpKey, normalizeFingerprint, sealCredential } from './bankLink.js';
import { type PayrollSettings, sealReturnsAccount } from './payRuns.js';

export const bankLinkBody = z.object({
  host: z.string().trim().min(3).max(253).regex(/^[A-Za-z0-9.-]+$/, 'Enter the bank’s server name, e.g. sftp.yourbank.com.'),
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().trim().min(1).max(100),
  remoteDir: z.string().trim().min(1).max(200).startsWith('/'),
  hostKeySha256: z.string().trim().regex(/^(SHA256:)?[A-Za-z0-9+/]{43}=?$/, 'Paste the server’s SHA256 fingerprint from your bank, e.g. SHA256:abc…'),
  pgpPublicKey: z.string().trim().max(20_000).nullable().optional(),
  autoSend: z.boolean().default(false),
  password: z.string().min(1).max(200).optional(),
  privateKey: z.string().min(50).max(20_000).optional(),
});

export async function buildBankLink(tenantId: string, b: z.infer<typeof bankLinkBody>, prev: BankLink | undefined): Promise<{ link: BankLink; credentialChanged: boolean }> {
  const secret = b.privateKey ?? b.password;
  if (!secret && !prev) throw new HttpError(400, 'BANK_CREDENTIAL', 'Enter the password or private key the bank gave you.');
  return {
    credentialChanged: !!secret,
    link: {
      host: b.host,
      port: b.port,
      username: b.username,
      remoteDir: b.remoteDir,
      hostKeySha256: normalizeFingerprint(b.hostKeySha256),
      autoSend: b.autoSend,
      ...(b.pgpPublicKey ? { pgpPublicKey: b.pgpPublicKey, pgpFingerprint: await checkPgpKey(b.pgpPublicKey) } : {}),
      credentialKind: secret ? (b.privateKey ? 'privateKey' : 'password') : prev!.credentialKind,
      credential: secret ? await sealCredential(tenantId, secret) : prev!.credential,
    },
  };
}

/** The direct deposit file's details, as the city's bank gives them (CPA-005). */
export const depositBody = z.object({
  businessNumber: z.string().trim().regex(/^\d{9}RP\d{4}$/, 'A payroll account number looks like 123456789RP0001.').nullable().optional(),
  originatorId: z.string().trim().regex(/^[A-Za-z0-9]{1,10}$/).nullable().optional(),
  originatorShortName: z.string().trim().max(15).nullable().optional(),
  originatorLongName: z.string().trim().max(30).nullable().optional(),
  destinationDataCentre: z.string().trim().regex(/^\d{5}$/).nullable().optional(),
  returnsInstitution: z.string().trim().regex(/^\d{3}$/).nullable().optional(),
  returnsTransit: z.string().trim().regex(/^\d{5}$/).nullable().optional(),
  returnsAccount: z.string().trim().regex(/^\d{5,12}$/).optional(),
});

export async function applyDeposit(tenantId: string, s: PayrollSettings, b: z.infer<typeof depositBody>): Promise<PayrollSettings> {
  const { returnsAccount, ...rest } = b;
  const next: PayrollSettings = { ...s, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v ?? undefined])) };
  if (returnsAccount) next.returnsAccount = await sealReturnsAccount(tenantId, returnsAccount);
  return next;
}

/** What's still missing before pay can go from the city's bank to its staff. */
export function depositReadiness(s: PayrollSettings) {
  const missing: string[] = [];
  if (!s.originatorId) missing.push('originatorId');
  if (!s.originatorShortName) missing.push('originatorShortName');
  if (!s.originatorLongName) missing.push('originatorLongName');
  if (!s.destinationDataCentre) missing.push('destinationDataCentre');
  if (!s.returnsInstitution || !s.returnsTransit || !s.returnsAccount) missing.push('returnsAccount');
  return { ready: missing.length === 0, missing, bankConnected: !!s.bank, autoSend: !!s.bank?.autoSend };
}
