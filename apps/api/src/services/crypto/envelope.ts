/**
 * Envelope encryption for sensitive records (incident narratives, union messages).
 *
 * Replaces the original "end-to-end encryption with HR/Supervisor keys", which
 * would have broken on staff turnover and blocked mandatory reporting to
 * WorkSafeBC/WSIB and health authorities. Instead:
 *   - each record gets a fresh 256-bit data key (AES-256-GCM),
 *   - the data key is wrapped by a key-encryption key (KEK) held in AWS KMS
 *     (ca-central-1) — one KEK per tenant, and a separate one per union local,
 *   - decryption happens server-side only after a permission check, and every
 *     read is written to an access log.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface KeyProvider {
  /** Returns the plaintext data key and its wrapped form. */
  generateDataKey(kekId: string): Promise<{ plaintext: Buffer; wrapped: Buffer }>;
  unwrapDataKey(kekId: string, wrapped: Buffer): Promise<Buffer>;
}

export interface Sealed {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  wrappedDataKey: Buffer;
  kekId: string;
}

export async function seal(keys: KeyProvider, kekId: string, plaintext: string, aad: string): Promise<Sealed> {
  const { plaintext: dataKey, wrapped } = await keys.generateDataKey(kekId);
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
    cipher.setAAD(Buffer.from(aad));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return { ciphertext, iv, authTag: cipher.getAuthTag(), wrappedDataKey: wrapped, kekId };
  } finally {
    dataKey.fill(0);
  }
}

/** `aad` binds the ciphertext to its record (e.g. "incident:<tenantId>:<id>") so rows can't be swapped. */
export async function open(keys: KeyProvider, sealed: Sealed, aad: string): Promise<string> {
  const dataKey = await keys.unwrapDataKey(sealed.kekId, sealed.wrappedDataKey);
  try {
    const decipher = createDecipheriv('aes-256-gcm', dataKey, sealed.iv);
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(sealed.authTag);
    return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString('utf8');
  } finally {
    dataKey.fill(0);
  }
}

/**
 * Development/test provider: wraps data keys with a single local KEK using AES-256-GCM.
 * Never used in production (config() requires KMS_KEY_ARN there).
 */
export class LocalKeyProvider implements KeyProvider {
  constructor(private readonly kek: Buffer) {
    if (kek.length !== 32) throw new Error('Local KEK must be 32 bytes');
  }

  async generateDataKey(kekId: string) {
    const plaintext = randomBytes(32);
    return { plaintext, wrapped: this.wrap(kekId, plaintext) };
  }

  async unwrapDataKey(kekId: string, wrapped: Buffer) {
    const iv = wrapped.subarray(0, 12);
    const tag = wrapped.subarray(12, 28);
    const body = wrapped.subarray(28);
    const d = createDecipheriv('aes-256-gcm', this.kek, iv);
    d.setAAD(Buffer.from(kekId));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]);
  }

  private wrap(kekId: string, key: Buffer): Buffer {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.kek, iv);
    c.setAAD(Buffer.from(kekId));
    const body = Buffer.concat([c.update(key), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), body]);
  }
}

/**
 * AWS KMS provider (production). Loaded lazily so local dev doesn't need the SDK:
 *   npm i @aws-sdk/client-kms
 */
export class AwsKmsKeyProvider implements KeyProvider {
  constructor(private readonly region: string) {}

  private async client() {
    const mod = (await import('@aws-sdk/client-kms' as string)) as {
      KMSClient: new (cfg: { region: string }) => { send(cmd: unknown): Promise<Record<string, Uint8Array | undefined>> };
      GenerateDataKeyCommand: new (input: unknown) => unknown;
      DecryptCommand: new (input: unknown) => unknown;
    };
    return { mod, kms: new mod.KMSClient({ region: this.region }) };
  }

  async generateDataKey(kekId: string) {
    const { mod, kms } = await this.client();
    const out = await kms.send(new mod.GenerateDataKeyCommand({ KeyId: kekId, KeySpec: 'AES_256' }));
    return { plaintext: Buffer.from(out.Plaintext!), wrapped: Buffer.from(out.CiphertextBlob!) };
  }

  async unwrapDataKey(kekId: string, wrapped: Buffer) {
    const { mod, kms } = await this.client();
    const out = await kms.send(new mod.DecryptCommand({ KeyId: kekId, CiphertextBlob: wrapped }));
    return Buffer.from(out.Plaintext!);
  }
}
