-- CreateEnum
CREATE TYPE "AccommodationStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateTable
CREATE TABLE "AccommodationCase" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "AccommodationStatus" NOT NULL DEFAULT 'ACTIVE',
    "label" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "reviewOn" DATE,
    "maxShiftHours" DECIMAL(4,2),
    "maxWeeklyHours" DECIMAL(5,2),
    "noStartBefore" INTEGER,
    "noEndAfter" INTEGER,
    "daysOff" INTEGER[],
    "excludedPositionIds" UUID[],
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),
    "reviewNotifiedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AccommodationCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccommodationCase_userId_status_idx" ON "AccommodationCase"("userId", "status");

-- AddForeignKey
ALTER TABLE "AccommodationCase" ADD CONSTRAINT "AccommodationCase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

