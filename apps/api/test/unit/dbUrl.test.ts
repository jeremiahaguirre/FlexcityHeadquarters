import { describe, expect, it } from 'vitest';
import { prismaUrl, verifiesServer } from '../../src/lib/dbUrl.js';
// @ts-expect-error a plain JavaScript module without types
import { prismaUrl as scriptPrismaUrl } from '../../scripts/prisma-url.mjs';

const CA = '/etc/ssl/rds/global-bundle.pem';
const prod = `postgresql://flexcity_app:p%40ss@db.example.ca:5432/flexcity?sslmode=verify-full&sslrootcert=${encodeURIComponent(CA)}`;

describe('database URLs', () => {
  it('translates the libpq form to Prisma’s: require + the CA as sslcert + strict checking', () => {
    const u = new URL(prismaUrl(prod));
    expect(u.searchParams.get('sslmode')).toBe('require');
    expect(u.searchParams.get('sslcert')).toBe(CA);
    expect(u.searchParams.get('sslaccept')).toBe('strict');
    expect(u.searchParams.has('sslrootcert')).toBe(false);
    expect(u.username).toBe('flexcity_app');
    expect(decodeURIComponent(u.password)).toBe('p@ss');
    expect(u.host).toBe('db.example.ca:5432');
  });

  it('leaves development URLs (no TLS) untouched', () => {
    const dev = 'postgresql://flexcity_app:change-me@localhost:5432/flexcity';
    expect(prismaUrl(dev)).toBe(dev);
  });

  it('the scripts’ copy gives exactly the same result', () => {
    for (const u of [prod, 'postgresql://a:b@h:5432/d', 'postgresql://a:b@h/d?sslmode=verify-ca&sslrootcert=/x.pem&connection_limit=5']) expect(scriptPrismaUrl(u)).toBe(prismaUrl(u));
  });

  it('production accepts only URLs that check the server against a named CA', () => {
    expect(verifiesServer(prod)).toBe(true);
    expect(verifiesServer('postgresql://a:b@h/d?sslmode=require')).toBe(false);
    expect(verifiesServer('postgresql://a:b@h/d?sslmode=verify-full')).toBe(false);
    expect(verifiesServer('postgresql://a:b@h/d?sslmode=require&sslcert=/x&sslaccept=strict')).toBe(false);
  });
});
