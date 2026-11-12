import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'pg-connection-string';
import { afterAll, describe, expect, it } from 'vitest';
import { poolConfig } from '../../src/lib/prismaClient.js';

// Prisma 7 connects through pg (the driver adapter), so pg reads the libpq URL itself.
const dir = mkdtempSync(join(tmpdir(), 'fh-ca-'));
const CA = join(dir, 'ca.pem');
writeFileSync(CA, '-----BEGIN CERTIFICATE-----\nnot-a-real-ca\n-----END CERTIFICATE-----\n');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('the app’s database pool (pg driver adapter)', () => {
  it('keeps verify-full: pg checks the chain against the named CA and the host name', () => {
    const c = poolConfig(`postgresql://flexcity_app:p%40ss@db.example.ca:5432/flexcity?sslmode=verify-full&sslrootcert=${encodeURIComponent(CA)}`);
    const parsed = parse(c.connectionString!);
    const ssl = parsed.ssl as { ca?: string; rejectUnauthorized?: boolean; checkServerIdentity?: unknown };
    expect(ssl.ca).toContain('not-a-real-ca');
    // Not turned off, and no host-name check replaced: Node's defaults verify both.
    expect(ssl.rejectUnauthorized).toBeUndefined();
    expect(ssl.checkServerIdentity).toBeUndefined();
    expect(parsed.password).toBe('p@ss');
  });

  it('turns Prisma 5’s pool parameters into pg settings, and the configured ones otherwise', () => {
    const fromUrl = poolConfig('postgresql://a:b@h:5432/d?connection_limit=7&pool_timeout=3', { poolSize: 25, poolTimeoutS: 20 });
    expect(fromUrl.max).toBe(7);
    expect(fromUrl.connectionTimeoutMillis).toBe(3000);
    expect(new URL(fromUrl.connectionString!).search).toBe('');
    const configured = poolConfig('postgresql://a:b@h:5432/d', { poolSize: 25, poolTimeoutS: 20 });
    expect(configured.max).toBe(25);
    expect(configured.connectionTimeoutMillis).toBe(20_000);
    // Never pg's "wait forever" default.
    expect(poolConfig('postgresql://a:b@h:5432/d').connectionTimeoutMillis).toBe(10_000);
  });

  it('refuses a URL in Prisma’s TLS spelling (pg would read its sslcert as a client certificate)', () => {
    expect(() => poolConfig('postgresql://a:b@h/d?sslmode=require&sslcert=/x.pem&sslaccept=strict')).toThrow('libpq form');
  });
});
