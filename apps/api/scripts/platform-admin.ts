/**
 * Creates (or re-enables) an FH Dev console account, ending any session it already had.
 *
 *   PLATFORM_ADMIN_PASSWORD='…' npm run platform:admin -- you@flexcity.ca "Your Name"
 *
 * The password comes from the environment so it never lands in shell history.
 */
import { createPrismaClient } from '../src/lib/prismaClient.js';
import { hashPassword } from '../src/auth/tokens.js';
import { setPlatformAdmin } from '../src/auth/platform.js';
// @ts-expect-error a plain JavaScript module without types, shared with the migration scripts
import { ownerUrl } from './owner-url.mjs';

const [email, ...nameParts] = process.argv.slice(2);
const password = process.env.PLATFORM_ADMIN_PASSWORD ?? '';
if (!email || !nameParts.length || password.length < 12) {
  console.error('Usage: PLATFORM_ADMIN_PASSWORD=<12+ characters> npm run platform:admin -- <email> "<name>"');
  process.exit(1);
}
// Owner connection: DATABASE_URL, or on AWS the DB_* parts and the RDS-managed password the
// migration task gets (scripts/owner-url.mjs), its TLS settings translated for Prisma (src/lib/dbUrl.ts).
let url: string;
try {
  url = ownerUrl();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
const prisma = createPrismaClient(url); // libpq URL: pg verifies sslmode=verify-full itself
const passwordHash = await hashPassword(password);
// Re-enabling or resetting ends every session the account had (src/auth/platform.ts, SEC-34).
const { admin: a, sessionsEnded } = await setPlatformAdmin(prisma, { email, name: nameParts.join(' '), passwordHash });
console.log(`Dev console account ready: ${a.email}${sessionsEnded ? ` (${sessionsEnded} earlier session(s) ended)` : ''}`);
await prisma.$disconnect();
