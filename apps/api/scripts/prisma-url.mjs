// Same as apps/api/src/lib/dbUrl.ts prismaUrl(): the libpq URL (sslmode=verify-full&sslrootcert=…)
// translated to Prisma's spelling (sslmode=require&sslcert=…&sslaccept=strict). Kept identical by
// test/unit/dbUrl.test.ts.
export function prismaUrl(url) {
  const u = new URL(url);
  const mode = u.searchParams.get('sslmode');
  if (mode !== 'verify-full' && mode !== 'verify-ca') return url;
  const ca = u.searchParams.get('sslrootcert');
  u.searchParams.set('sslmode', 'require');
  u.searchParams.set('sslaccept', 'strict');
  u.searchParams.delete('sslrootcert');
  if (ca) u.searchParams.set('sslcert', ca);
  return u.toString();
}
