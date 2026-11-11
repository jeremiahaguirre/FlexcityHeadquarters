/**
 * Database URLs are written once, in the standard libpq form that `pg` understands and verifies:
 *   ...?sslmode=verify-full&sslrootcert=/etc/ssl/rds/global-bundle.pem
 * Prisma's engine doesn't understand verify-full (it would quietly fall back to "prefer" with no
 * certificate check) and ignores sslrootcert, so Prisma gets the same URL translated to its own
 * spelling: sslmode=require, sslcert=<the CA file> (in Prisma, sslcert is the server's CA) and
 * sslaccept=strict (check the chain and the host name).
 *
 * scripts/prisma-url.mjs is the same function for the plain-JavaScript scripts; a test keeps the
 * two identical.
 */
export function prismaUrl(url: string): string {
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

/** Production: the URL must verify the server (verify-full or verify-ca) against a named CA file. */
export function verifiesServer(url: string): boolean {
  const u = new URL(url);
  return ['verify-full', 'verify-ca'].includes(u.searchParams.get('sslmode') ?? '') && !!u.searchParams.get('sslrootcert');
}
