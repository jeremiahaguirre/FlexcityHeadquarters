-- AlterTable
ALTER TABLE "PlatformSession" ADD COLUMN     "mfaAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "RefreshToken" ADD COLUMN     "mfaAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "mfaRoles" "AccessRole"[] DEFAULT ARRAY[]::"AccessRole"[];

