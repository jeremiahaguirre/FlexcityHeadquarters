-- AlterTable
ALTER TABLE "User" ADD COLUMN     "calendarTokenAt" TIMESTAMPTZ(3),
ADD COLUMN     "calendarTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_calendarTokenHash_key" ON "User"("calendarTokenHash");

