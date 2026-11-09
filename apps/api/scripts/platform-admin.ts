/**
 * Creates (or re-enables) an FH Dev console account.
 *
 *   PLATFORM_ADMIN_PASSWORD='…' npm run platform:admin -- you@flexcity.ca "Your Name"
 *
 * The password comes from the environment so it never lands in shell history.
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/auth/tokens.js';

const [email, ...nameParts] = process.argv.slice(2);
const password = process.env.PLATFORM_ADMIN_PASSWORD ?? '';
if (!email || !nameParts.length || password.length < 12) {
  console.error('Usage: PLATFORM_ADMIN_PASSWORD=<12+ characters> npm run platform:admin -- <email> "<name>"');
  process.exit(1);
}
const prisma = new PrismaClient(); // owner connection (DATABASE_URL)
const passwordHash = await hashPassword(password);
const a = await prisma.platformAdmin.upsert({
  where: { email: email.toLowerCase() },
  update: { passwordHash, name: nameParts.join(' '), disabledAt: null, failedLogins: 0, lockedUntil: null },
  create: { email: email.toLowerCase(), name: nameParts.join(' '), passwordHash },
});
console.log(`Dev console account ready: ${a.email}`);
await prisma.$disconnect();
