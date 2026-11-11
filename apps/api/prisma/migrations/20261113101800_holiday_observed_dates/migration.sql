-- CreateEnum
CREATE TYPE "HolidayObservance" AS ENUM ('STATUTORY', 'NEXT_WEEKDAY');

-- CreateEnum
CREATE TYPE "HolidayOffDayRule" AS ENUM ('SUBSTITUTE', 'PAY');

-- CreateEnum
CREATE TYPE "HolidayKind" AS ENUM ('ACTUAL', 'MOVED', 'MOVED_IF_OFF');

-- AlterTable
ALTER TABLE "StatutoryHoliday" ADD COLUMN     "key" TEXT,
ADD COLUMN     "kind" "HolidayKind" NOT NULL DEFAULT 'ACTUAL',
ADD COLUMN     "observedOn" DATE,
ADD COLUMN     "weekdayOn" DATE;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "holidayObservance" "HolidayObservance" NOT NULL DEFAULT 'STATUTORY',
ADD COLUMN     "holidayOffDayRule" "HolidayOffDayRule";

