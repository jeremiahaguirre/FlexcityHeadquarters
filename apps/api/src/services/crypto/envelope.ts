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

/** The KMS calls this module makes (the AWS SDK client, or a fake in tests). */
export interface KmsApi {
  generateDataKey(keyId: string): Promise<{ plaintext: Uint8Array; wrapped: Uint8Array }>;
  decrypt(keyId: string, wrapped: Uint8Array): Promise<Uint8Array>;
  createKey(input: { description: string; multiRegion: boolean; tags: Record<string, string> }): Promise<{ keyId: string }>;
  enableKeyRotation(keyId: string): Promise<void>;
  /** 'exists' when the alias already points at a key (in `region`, default the primary). */
  createAlias(alias: string, keyId: string, region?: string): Promise<'created' | 'exists'>;
  /** Copies a multi-region key to another region (same key id there). */
  replicateKey(keyId: string, region: string): Promise<void>;
  /** Marks a key created by a lost race, for operations to schedule its deletion. */
  tagUnused(keyId: string): Promise<void>;
}

const TENANT_ALIAS = /^alias\/flexcity-tenant-[0-9a-f-]{36}$/;
const isNotFound = (e: unknown) => (e as { name?: string } | null)?.name === 'NotFoundException';

/**
 * AWS KMS provider (production).
 *
 * Each organization's key (alias/flexcity-tenant-<id>) is created the first time one of its records
 * is sealed: a symmetric key with yearly rotation, tagged with the organization. With a recovery
 * region set (KMS_REPLICA_REGION) it is a multi-region key, copied there before its alias exists
 * (so a failed copy is retried with a new key, never left half done) and given the same alias
 * there, so a restore in ca-west-1 can still open the data. Two processes creating the same key at once is harmless:
 * the second alias request finds the first, and its own unused key is left tagged
 * "fh:unused=true" for operations to delete (this service is never allowed to delete keys).
 * Other keys (alias/flexcity-platform, union locals) are created by operations, never here.
 */
export class AwsKmsKeyProvider implements KeyProvider {
  private creating = new Map<string, Promise<void>>();
  constructor(
    private readonly kms: KmsApi,
    private readonly replicaRegion?: string,
  ) {}

  async generateDataKey(kekId: string) {
    try {
      return await this.dataKey(kekId);
    } catch (e) {
      if (!isNotFound(e) || !TENANT_ALIAS.test(kekId)) throw e;
      await this.ensureTenantKey(kekId);
      return this.dataKey(kekId);
    }
  }

  async unwrapDataKey(kekId: string, wrapped: Buffer) {
    return Buffer.from(await this.kms.decrypt(kekId, wrapped));
  }

  private async dataKey(kekId: string) {
    const out = await this.kms.generateDataKey(kekId);
    return { plaintext: Buffer.from(out.plaintext), wrapped: Buffer.from(out.wrapped) };
  }

  private ensureTenantKey(alias: string): Promise<void> {
    let p = this.creating.get(alias);
    if (!p) {
      p = this.createTenantKey(alias).finally(() => this.creating.delete(alias));
      this.creating.set(alias, p);
    }
    return p;
  }

  private async createTenantKey(alias: string) {
    const tenantId = alias.slice('alias/flexcity-tenant-'.length);
    const { keyId } = await this.kms.createKey({
      description: `FlexcityHeadquarters organization ${tenantId}: wraps the data keys of its sealed records`,
      multiRegion: !!this.replicaRegion,
      tags: { 'fh:tenant': tenantId, Project: 'FlexcityHeadquarters' },
    });
    await this.kms.enableKeyRotation(keyId);
    if (this.replicaRegion) await this.kms.replicateKey(keyId, this.replicaRegion);
    if ((await this.kms.createAlias(alias, keyId)) === 'exists') {
      // Another process won the race; its key is the organization's. Ours is never used.
      await this.kms.tagUnused(keyId);
      return;
    }
    if (this.replicaRegion) await this.kms.createAlias(alias, keyId, this.replicaRegion);
  }
}
