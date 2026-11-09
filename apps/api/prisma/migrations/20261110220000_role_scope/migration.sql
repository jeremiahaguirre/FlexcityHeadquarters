-- AlterTable
ALTER TABLE "CustomRole" ADD COLUMN     "scopeFacilityIds" UUID[] DEFAULT ARRAY[]::UUID[],
ADD COLUMN     "scopePositionIds" UUID[] DEFAULT ARRAY[]::UUID[];

