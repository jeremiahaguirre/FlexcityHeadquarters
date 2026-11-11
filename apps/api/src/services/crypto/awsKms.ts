/** The KMS calls envelope.ts needs, on the AWS SDK (production only). */
import {
  CreateAliasCommand,
  CreateKeyCommand,
  DecryptCommand,
  DescribeKeyCommand,
  EnableKeyRotationCommand,
  GenerateDataKeyCommand,
  KMSClient,
  ReplicateKeyCommand,
  TagResourceCommand,
} from '@aws-sdk/client-kms';
import type { KmsApi } from './envelope.js';

const name = (e: unknown) => (e as { name?: string } | null)?.name;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function awsKms(region: string): KmsApi {
  const clients = new Map<string, KMSClient>();
  const client = (r = region) => {
    let c = clients.get(r);
    if (!c) clients.set(r, (c = new KMSClient({ region: r })));
    return c;
  };
  return {
    async generateDataKey(keyId) {
      const out = await client().send(new GenerateDataKeyCommand({ KeyId: keyId, KeySpec: 'AES_256' }));
      return { plaintext: out.Plaintext!, wrapped: out.CiphertextBlob! };
    },
    async decrypt(keyId, wrapped) {
      const out = await client().send(new DecryptCommand({ KeyId: keyId, CiphertextBlob: wrapped }));
      return out.Plaintext!;
    },
    async createKey({ description, multiRegion, tags }) {
      const out = await client().send(
        new CreateKeyCommand({
          Description: description,
          KeyUsage: 'ENCRYPT_DECRYPT',
          KeySpec: 'SYMMETRIC_DEFAULT',
          MultiRegion: multiRegion,
          Tags: Object.entries(tags).map(([TagKey, TagValue]) => ({ TagKey, TagValue })),
        }),
      );
      return { keyId: out.KeyMetadata!.KeyId! };
    },
    async enableKeyRotation(keyId) {
      await client().send(new EnableKeyRotationCommand({ KeyId: keyId }));
    },
    async createAlias(alias, keyId, r) {
      // A replica is created asynchronously: wait (up to a minute) until it can take an alias.
      if (r && r !== region) {
        for (let i = 0; i < 30; i++) {
          const d = await client(r).send(new DescribeKeyCommand({ KeyId: keyId })).catch((e) => (name(e) === 'NotFoundException' ? null : Promise.reject(e)));
          if (d?.KeyMetadata?.KeyState === 'Enabled') break;
          await sleep(2000);
        }
      }
      try {
        await client(r).send(new CreateAliasCommand({ AliasName: alias, TargetKeyId: keyId }));
        return 'created';
      } catch (e) {
        if (name(e) === 'AlreadyExistsException') return 'exists';
        throw e;
      }
    },
    async aliasTarget(alias, r) {
      try {
        const d = await client(r).send(new DescribeKeyCommand({ KeyId: alias }));
        return d.KeyMetadata?.KeyId ?? null;
      } catch (e) {
        if (name(e) === 'NotFoundException') return null;
        throw e;
      }
    },
    async replicateKey(keyId, r) {
      await client().send(new ReplicateKeyCommand({ KeyId: keyId, ReplicaRegion: r }));
    },
    async tagUnused(keyId) {
      await client().send(new TagResourceCommand({ KeyId: keyId, Tags: [{ TagKey: 'fh:unused', TagValue: 'true' }] }));
    },
  };
}
