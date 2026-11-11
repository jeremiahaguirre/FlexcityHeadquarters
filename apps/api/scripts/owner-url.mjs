// The owner connection for migrations and set-up scripts. DATABASE_URL when given (development);
// otherwise built from parts, so on AWS the password comes straight from the RDS-managed secret,
// which RDS rotates (ops/terraform/compute.tf passes DB_HOST, DB_PORT, DB_NAME, DB_USER,
// DB_SSLROOTCERT and the secret's password as DB_PASSWORD).
export function ownerUrl(env = process.env) {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const missing = ['DB_HOST', 'DB_USER', 'DB_PASSWORD'].filter((k) => !env[k]);
  if (missing.length) throw new Error(`DATABASE_URL, or ${missing.join(', ')}, is required`);
  const u = new URL('postgresql://localhost');
  u.hostname = env.DB_HOST;
  u.port = env.DB_PORT ?? '5432';
  u.pathname = `/${env.DB_NAME ?? 'flexcity'}`;
  u.username = encodeURIComponent(env.DB_USER);
  u.password = encodeURIComponent(env.DB_PASSWORD);
  if (env.DB_SSLROOTCERT) {
    u.searchParams.set('sslmode', 'verify-full');
    u.searchParams.set('sslrootcert', env.DB_SSLROOTCERT);
  }
  return u.toString();
}
