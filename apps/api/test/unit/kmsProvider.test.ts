import { describe, expect, it } from 'vitest';
import { AwsKmsKeyProvider, type KmsApi, open, seal } from '../../src/services/crypto/envelope.js';

const TENANT = '0b8e3c1a-1111-4222-8333-944455556666';
const ALIAS = `alias/flexcity-tenant-${TENANT}`;
const DR = 'ca-west-1';
const notFound = () => Object.assign(new Error('Alias not found'), { name: 'NotFoundException' });

/**
 * A fake KMS with two regions. Keys wrap by XOR with a per-key byte, enough to prove which key was
 * used. `aliasLag` makes a new alias invisible to data-key and decrypt calls for that many calls,
 * as KMS may briefly do. `fail` makes one named step throw once.
 */
function fakeKms(opts: { aliasLag?: number; fail?: string } = {}) {
  const calls: string[] = [];
  const aliases = new Map<string, string>(); // `${region}|${alias}` -> keyId
  const keyByte = new Map<string, number>();
  const lag = new Map<string, number>();
  let n = 0;
  let failing = opts.fail;
  const maybeFail = (step: string) => {
    if (failing === step) {
      failing = undefined;
      throw new Error(`${step} failed`);
    }
  };
  const resolve = (id: string) => {
    if (!id.startsWith('alias/')) return keyByte.has(id) ? id : undefined;
    const k = `primary|${id}`;
    const left = lag.get(k) ?? 0;
    if (left > 0) {
      lag.set(k, left - 1);
      return undefined;
    }
    return aliases.get(k);
  };
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
      calls.push(`createKey ${keyId} ${tags['fh:tenant'] ?? ''}`.trim());
      return { keyId };
    },
    async enableKeyRotation(id) {
      calls.push(`rotate ${id}`);
    },
    async createAlias(alias, keyId, region) {
      const r = region ?? 'primary';
      calls.push(`alias ${r} ${keyId}`);
      maybeFail(`alias ${r}`);
      const k = `${r}|${alias}`;
      if (aliases.has(k)) return 'exists';
      aliases.set(k, keyId);
      if (opts.aliasLag) lag.set(k, opts.aliasLag);
      return 'created';
    },
    async aliasTarget(alias, region) {
      return aliases.get(`${region ?? 'primary'}|${alias}`) ?? null;
    },
    async replicateKey(keyId, region) {
      calls.push(`replicate ${keyId} ${region}`);
      maybeFail('replicate');
    },
    async tagUnused(keyId) {
      calls.push(`unused ${keyId}`);
    },
  };
  return { api, calls, aliases };
}

const provider = (f: ReturnType<typeof fakeKms>, region?: string) => new AwsKmsKeyProvider(f.api, region, async () => {});

describe('AWS KMS provider', () => {
  it('creates an organization’s key on first use: rotation, a copy in the recovery region named first, then the primary alias', async () => {
    const f = fakeKms();
    const p = provider(f, DR);
    const sealed = await seal(p, ALIAS, 'Narrative', 'incident:1');
    expect(f.calls).toEqual([`createKey mrk-key1 ${TENANT}`, 'rotate mrk-key1', `replicate mrk-key1 ${DR}`, `alias ${DR} mrk-key1`, 'alias primary mrk-key1']);
    expect(f.aliases.get(`${DR}|${ALIAS}`)).toBe('mrk-key1');
    expect(f.aliases.get(`primary|${ALIAS}`)).toBe('mrk-key1');
    expect(await open(p, sealed, 'incident:1')).toBe('Narrative');
    await seal(p, ALIAS, 'Second', 'incident:2');
    expect(f.calls.filter((c) => c.startsWith('createKey'))).toHaveLength(1);
  });

  it('without a recovery region the key is single-region and not copied', async () => {
    const f = fakeKms();
    await seal(provider(f), ALIAS, 'x', 'a');
    expect(f.calls).toEqual([`createKey key1 ${TENANT}`, 'rotate key1', 'alias primary key1']);
  });

  it('never creates keys it does not own (platform key, union locals, anything else)', async () => {
    const f = fakeKms();
    const p = provider(f, DR);
    await expect(seal(p, 'alias/flexcity-platform', 'x', 'a')).rejects.toThrow('Alias not found');
    await expect(seal(p, 'alias/flexcity-tenant-not-a-uuid', 'x', 'a')).rejects.toThrow('Alias not found');
    expect(f.calls).toEqual([]);
  });

  it('requests at the same moment in one process create one key', async () => {
    const f = fakeKms();
    const p = provider(f);
    await Promise.all([seal(p, ALIAS, 'a', 'a'), seal(p, ALIAS, 'b', 'b'), seal(p, ALIAS, 'c', 'c')]);
    expect(f.calls.filter((c) => c.startsWith('createKey'))).toHaveLength(1);
  });

  it('a new alias KMS does not resolve yet: the first record still seals (by key id) and opens after a short wait', async () => {
    const f = fakeKms({ aliasLag: 2 });
    const p = provider(f, DR);
    const sealed = await seal(p, ALIAS, 'early', 'a');
    expect(f.calls.filter((c) => c.startsWith('createKey'))).toHaveLength(1);
    expect(await open(p, sealed, 'a')).toBe('early');
  });

  it('losing the race in the recovery region adopts the winner’s key everywhere and marks its own unused', async () => {
    const f = fakeKms();
    const { keyId: winner } = await f.api.createKey({ description: '', multiRegion: true, tags: {} }); // another process's key
    f.aliases.set(`${DR}|${ALIAS}`, winner);
    const p = provider(f, DR);
    const sealed = await seal(p, ALIAS, 'shared', 'a');
    expect(f.calls).toContain('unused mrk-key2');
    expect(f.aliases.get(`primary|${ALIAS}`)).toBe(winner);
    expect(await open(p, sealed, 'a')).toBe('shared');
  });

  it('a failure after the recovery alias is repaired by the next request, with the same key', async () => {
    const f = fakeKms({ fail: 'alias primary' });
    const p = provider(f, DR);
    await expect(seal(p, ALIAS, 'x', 'a')).rejects.toThrow('alias primary failed');
    expect(f.aliases.has(`primary|${ALIAS}`)).toBe(false);
    const sealed = await seal(p, ALIAS, 'y', 'b');
    expect(f.aliases.get(`primary|${ALIAS}`)).toBe('mrk-key1');
    expect(f.aliases.get(`${DR}|${ALIAS}`)).toBe('mrk-key1');
    expect(f.calls).toContain('unused mrk-key2');
    expect(await open(p, sealed, 'b')).toBe('y');
  });

  it('a failed copy to the recovery region leaves no alias anywhere', async () => {
    const f = fakeKms({ fail: 'replicate' });
    await expect(seal(provider(f, DR), ALIAS, 'x', 'a')).rejects.toThrow('replicate failed');
    expect(f.aliases.size).toBe(0);
  });

  it('aliases naming different keys in the two regions stop creation with a clear error', async () => {
    const f = fakeKms();
    const { keyId: calgary } = await f.api.createKey({ description: '', multiRegion: true, tags: {} });
    const { keyId: montreal } = await f.api.createKey({ description: '', multiRegion: true, tags: {} });
    f.aliases.set(`${DR}|${ALIAS}`, calgary);
    f.aliases.set(`primary|${ALIAS}`, montreal);
    // The data-key request misses (as during alias propagation), so the provider goes to create.
    const api: KmsApi = { ...f.api, generateDataKey: async () => Promise.reject(notFound()) };
    await expect(new AwsKmsKeyProvider(api, DR, async () => {}).generateDataKey(ALIAS)).rejects.toThrow('names different keys in the two regions');
  });
});
