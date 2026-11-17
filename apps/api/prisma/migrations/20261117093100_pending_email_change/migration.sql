-- AlterEnum
ALTER TYPE "AuthTokenPurpose" ADD VALUE 'EMAIL_CHANGE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "pendingEmail" TEXT,
ADD COLUMN     "pendingEmailAt" TIMESTAMPTZ(3);
