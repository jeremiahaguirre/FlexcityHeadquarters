-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'EXCUSED');

-- CreateTable
CREATE TABLE "LessonClass" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "positionId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "level" TEXT,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "maxSwimmers" INTEGER NOT NULL DEFAULT 8,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonEnrollment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "swimmerName" TEXT NOT NULL,
    "safetyNote" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonAttendance" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "enrollmentId" UUID NOT NULL,
    "sessionDate" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL,
    "clientId" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LessonAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LessonClass_tenantId_facilityId_dayOfWeek_idx" ON "LessonClass"("tenantId", "facilityId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "LessonEnrollment_classId_idx" ON "LessonEnrollment"("classId");

-- CreateIndex
CREATE UNIQUE INDEX "LessonAttendance_clientId_key" ON "LessonAttendance"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "LessonAttendance_enrollmentId_sessionDate_key" ON "LessonAttendance"("enrollmentId", "sessionDate");

-- AddForeignKey
ALTER TABLE "LessonEnrollment" ADD CONSTRAINT "LessonEnrollment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "LessonClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonAttendance" ADD CONSTRAINT "LessonAttendance_classId_fkey" FOREIGN KEY ("classId") REFERENCES "LessonClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonAttendance" ADD CONSTRAINT "LessonAttendance_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "LessonEnrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
