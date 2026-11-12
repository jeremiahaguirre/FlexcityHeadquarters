// Applies Prisma migrations with the owner connection. prisma.config.ts builds the URL (DATABASE_URL,
// or the DB_* parts on AWS) and translates it for Prisma's schema engine (scripts/prisma-url.mjs),
// so a production URL with sslmode=verify-full really verifies the database's certificate.
import { spawnSync } from 'node:child_process';
import { ownerUrl } from './owner-url.mjs';

try {
  ownerUrl();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
const r = spawnSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit' });
process.exit(r.status ?? 1);
