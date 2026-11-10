-- CreateTable
CREATE TABLE "FacilityHours" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "opensMinute" INTEGER NOT NULL,
    "closesMinute" INTEGER NOT NULL,
    "minGuards" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacilityHours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FacilityHours_tenantId_facilityId_dayOfWeek_idx" ON "FacilityHours"("tenantId", "facilityId", "dayOfWeek");

-- AddForeignKey
ALTER TABLE "FacilityHours" ADD CONSTRAINT "FacilityHours_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

