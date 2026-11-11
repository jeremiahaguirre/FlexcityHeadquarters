import { describe, expect, it } from 'vitest';
import { AwsKmsKeyProvider, type KmsApi, open, seal } from '../../src/services/crypto/envelope.js';

const TENANT = '0b8e3c1a-1111-4222-8333-944455556666';
const ALIAS = `alias/flexcity-tenant-${TENANT}`;
const notFound = () => Object.assign(new Error('Alias not found'), { name: 'NotFoundException' });

/** A fake KMS: aliases per region, keys wrap by XOR with a per-key byte (enough to check routing). */
function fakeKms(opts: { failReplicate?: boolean } = {}) {
  const calls: string[] = [];
  const aliases = new Map<string, string>(); // `${region}|${alias}` -> keyId
  const keyByte = new Map<string, number>();
  let n = 0;
  const resolve = (id: string) => (id.startsWith('alias/') ? aliases.get(`primary|${id}`) : keyByte.has(id) ? id : undefined);
  const api: KmsApi = {
    async generateDataKey(id) {
      const k = resolve(id);
      if (!k) throw notFound();
      const plaintext = new Uint8Array(32).fill(7);
      return { plaintext, wrapped: Uint8Array.from([keyByte.get(k)!, ...plaintext.map((b) => b ^ keyByte.get(k)!)]) };
    },
    async decrypt(id, wrapped) {
      const k = resolve(id);
      if (!k) throw notFound();
      return Uint8Array.from(wrapped.slice(1).map((b) => b ^ keyByte.get(k)!));
    },
    async createKey({ multiRegion, tags }) {
      const keyId = `${multiRegion ? 'mrk-' : ''}key${++n}`;
      keyByte.set(keyId, n);
      calls.push(`createKey ${keyId} ${tags['fh:tenant']}`);
      return { keyId };
    },
    async enableKeyRotation(id) {
      calls.push(`rotate ${id}`);
    },
    async createAlias(alias, keyId, region) {
      const k = `${region ?? 'primary'}|${alias}`;
      calls.push(`alias ${region ?? 'primary'} ${keyId}`);
      if (aliases.has(k)) return 'exists';
      aliases.set(k, keyId);
      return 'created';
    },
    async replicateKey(keyId, region) {
      calls.push(`replicate ${keyId} ${region}`);
      if (opts.failReplicate) throw new Error('replica region unavailable');
    },
    async tagUnused(keyId) {
      calls.push(`unused ${keyId}`);
    },
  };
  return { api, calls, aliases };
}

describe('AWS KMS provider', () => {
  it('creates an organization’s key the first time, with rotation and a copy in the recovery region, then seals and opens', async () => {
    const f = fakeKms();
    const p = new AwsKmsKeyProvider(f.api, 'ca-west-1');
    const sealed = await seal(p, ALIAS, 'Narrative', 'incident:1');
    expect(f.calls).toEqual([`createKey mrk-key1 ${TENANT}`, 'rotate mrk-key1', 'replicate mrk-key1 ca-west-1', 'alias primary mrk-key1', 'alias ca-west-1 mrk-key1']);
    expect(await open(p, sealed, 'incident:1')).toBe('Narrative');
    await seal(p, ALIAS, 'Second', 'incident:2');
    expect(f.calls.filter((c) => c.startsWith('createKey'))).toHaveLength(1);
  });

  it('without a recovery region the key is single-region and not copied', async () => {
    const f = fakeKms();
    await seal(new AwsKmsKeyProvider(f.api), ALIAS, 'x', 'a');
    expect(f.calls).toEqual([`createKey key1 ${TENANT}`, 'rotate key1', 'alias primary key1']);
  });

  it('never creates keys it does not own (platform key, union locals, anything else)', async () => {
    const f = fakeKms();
    const p = new AwsKmsKeyProvider(f.api, 'ca-west-1');
    await expect(seal(p, 'alias/flexcity-platform', 'x', 'a')).rejects.toThrow('Alias not found');
    await expect(seal(p, 'alias/flexcity-tenant-not-a-uuid', 'x', 'a')).rejects.toThrow('Alias not found');
    expect(f.calls).toEqual([]);
  });

  it('requests at the same moment in one process create one key', async () => {
    const f = fakeKms();
    const p = new AwsKmsKeyProvider(f.api);
    await Promise.all([seal(p, ALIAS, 'a', 'a'), seal(p, ALIAS, 'b', 'b'), seal(p, ALIAS, 'c', 'c')]);
    expect(f.calls.filter((c) => c.startsWith('createKey'))).toHaveLength(1);
  });

  it('losing a race with another process uses the winner’s key and marks its own unused', async () => {
    const f = fakeKms();
    f.aliases.set(`primary|${ALIAS}`, 'winner');
    const p = new AwsKmsKeyProvider(f.api, 'ca-west-1');
    // The alias appears between our failed data-key request and our own alias request.
    let first = true;
    const gen = f.api.generateDataKey.bind(f.api);
    f.api.generateDataKey = async (id) => {
      if (first) {
        first = false;
        throw notFound();
      }
      return gen(id);
    };
    await f.api.createKey({ description: '', multiRegion: false, tags: {} }); // the winner's key material
    f.aliases.set(`primary|${ALIAS}`, 'key1');
    const sealed = await seal(p, ALIAS, 'shared', 'a');
    expect(f.calls).toContain('unused mrk-key2');
    expect(f.calls).not.toContain('alias ca-west-1 mrk-key2');
    expect(await open(p, sealed, 'a')).toBe('shared');
  });

  it('a failed copy to the recovery region leaves no alias, so the next request starts over', async () => {
    const f = fakeKms({ failReplicate: true });
    const p = new AwsKmsKeyProvider(f.api, 'ca-west-1');
    await expect(seal(p, ALIAS, 'x', 'a')).rejects.toThrow('replica region unavailable');
    expect(f.aliases.size).toBe(0);
  });
});
