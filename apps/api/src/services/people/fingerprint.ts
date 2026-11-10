/**
 * A fingerprint (SHA-256) of exactly what an employee signed, so the record can
 * later be shown to be unchanged: the content at signing is hashed and kept with
 * the signature, and recomputed whenever the record is shown. This is the kind of
 * integrity evidence the Electronic Commerce / Electronic Transactions Acts look for.
 */
import { createHash } from 'node:crypto';

export interface SignableRecord {
  id: string;
  userId: string;
  issuedById: string;
  issuedAt: Date;
  summary: string;
  level: string | null;
  stewardPresent: boolean;
  evidence: unknown;
  fairProcess: unknown;
}

/** Keys sorted at every level, so the same content always gives the same text. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object' && !(v instanceof Date)) return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  return v instanceof Date ? v.toISOString() : v;
}

export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

export function recordFingerprint(r: SignableRecord): string {
  return sha256(JSON.stringify(canonical({ v: 1, id: r.id, userId: r.userId, issuedById: r.issuedById, issuedAt: r.issuedAt, summary: r.summary, level: r.level, stewardPresent: r.stewardPresent, evidence: r.evidence ?? [], fairProcess: r.fairProcess ?? null })));
}

/** What the screen shows: the fingerprint signed, and whether the record still matches it. */
export function signatureCheck(r: SignableRecord & { signedSha256: string | null; signatureSha256: string | null; acknowledgedAt: Date | null }) {
  if (!r.acknowledgedAt) return null;
  if (!r.signedSha256) return { signed: null, signature: null, intact: null as boolean | null };
  return { signed: r.signedSha256, signature: r.signatureSha256, intact: recordFingerprint(r) === r.signedSha256 };
}
