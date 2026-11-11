// Applies Prisma migrations with DATABASE_URL translated for Prisma (scripts/prisma-url.mjs), so a
// production URL with sslmode=verify-full really verifies the database's certificate.
import { spawnSync } from 'node:child_process';
import { ownerUrl } from './owner-url.mjs';
import { prismaUrl } from './prisma-url.mjs';

let url;
try {
  url = ownerUrl();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
const r = spawnSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit', env: { ...process.env, DATABASE_URL: prismaUrl(url) } });
process.exit(r.status ?? 1);
