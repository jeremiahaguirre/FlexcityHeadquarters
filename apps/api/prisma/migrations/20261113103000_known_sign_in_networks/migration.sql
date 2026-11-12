-- AlterTable
ALTER TABLE "PlatformAdmin" ADD COLUMN     "knownNetworks" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "knownNetworks" TEXT[] DEFAULT ARRAY[]::TEXT[];

