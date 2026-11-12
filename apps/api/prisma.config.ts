// Prisma CLI settings (Prisma 7: the CLI no longer reads the URL from schema.prisma or loads .env).
// The app itself connects through the pg driver adapter (src/lib/prismaClient.ts); this file is
// only for `prisma migrate`, `prisma migrate diff`, `prisma db seed` and `prisma generate`.
//
// The URL is the owner connection (scripts/owner-url.mjs: DATABASE_URL, or DB_HOST/DB_USER/… on
// AWS), translated to the spelling Prisma's schema engine understands (scripts/prisma-url.mjs), so
// a production URL with sslmode=verify-full really verifies the database's certificate.
// `prisma generate` needs no database, so a missing URL is fine here.
import { defineConfig } from 'prisma/config';
// @ts-expect-error a plain JavaScript module without types
import { ownerUrl } from './scripts/owner-url.mjs';
// @ts-expect-error a plain JavaScript module without types
import { prismaUrl } from './scripts/prisma-url.mjs';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env file: the environment already has what it needs (CI, containers).
}

function url(): string | undefined {
  try {
    return prismaUrl(ownerUrl()) as string;
  } catch {
    return undefined;
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node --env-file-if-exists=.env --import tsx prisma/seed.ts',
  },
  datasource: {
    url: url(),
    // `prisma migrate diff` (CI's "migrations match the schema" check) replays the migrations here.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
