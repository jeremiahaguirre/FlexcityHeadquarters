-- AlterTable
ALTER TABLE "PlatformAdmin" ADD COLUMN     "lastFailedLoginAt" TIMESTAMPTZ(3),
ADD COLUMN     "lastLockedAt" TIMESTAMPTZ(3),
ADD COLUMN     "lockoutLevel" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastFailedLoginAt" TIMESTAMPTZ(3),
ADD COLUMN     "lastLockedAt" TIMESTAMPTZ(3),
ADD COLUMN     "lockoutLevel" INTEGER NOT NULL DEFAULT 0;

