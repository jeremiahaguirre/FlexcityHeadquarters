-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('SELF', 'MANAGER', 'DISCUSS', 'ACKNOWLEDGED');

-- CreateEnum
CREATE TYPE "GrievanceStatus" AS ENUM ('FILED', 'STEP_1', 'STEP_2', 'STEP_3', 'ARBITRATION', 'RESOLVED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "LeaveEntitlement" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "type" "TimeOffType" NOT NULL,
    "hours" DECIMAL(8,2) NOT NULL,
    "carryover" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LeaveEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceReview" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "cycle" TEXT NOT NULL,
    "dueOn" DATE NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'SELF',
    "goals" JSONB NOT NULL DEFAULT '[]',
    "selfComments" TEXT,
    "managerComments" TEXT,
    "rating" INTEGER,
    "employeeComments" TEXT,
    "acknowledgedAt" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PerformanceReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingCourse" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameFr" TEXT,
    "hours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "renewMonths" INTEGER,
    "positionIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingCourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingRecord" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "completedOn" DATE NOT NULL,
    "hours" DECIMAL(6,2),
    "trainer" TEXT,
    "recordedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Grievance" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "userId" UUID,
    "kind" TEXT NOT NULL DEFAULT 'INDIVIDUAL',
    "title" TEXT NOT NULL,
    "articles" TEXT,
    "filedOn" DATE NOT NULL,
    "status" "GrievanceStatus" NOT NULL DEFAULT 'FILED',
    "dueOn" DATE,
    "outcome" TEXT,
    "history" JSONB NOT NULL DEFAULT '[]',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Grievance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offboarding" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "lastDay" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "checklist" JSONB NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Offboarding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeaveEntitlement_userId_year_type_key" ON "LeaveEntitlement"("userId", "year", "type");

-- CreateIndex
CREATE INDEX "PerformanceReview_userId_idx" ON "PerformanceReview"("userId");

-- CreateIndex
CREATE INDEX "PerformanceReview_reviewerId_idx" ON "PerformanceReview"("reviewerId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingCourse_tenantId_name_key" ON "TrainingCourse"("tenantId", "name");

-- CreateIndex
CREATE INDEX "TrainingRecord_userId_idx" ON "TrainingRecord"("userId");

-- CreateIndex
CREATE INDEX "TrainingRecord_courseId_idx" ON "TrainingRecord"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "Grievance_tenantId_number_key" ON "Grievance"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Offboarding_userId_key" ON "Offboarding"("userId");

-- AddForeignKey
ALTER TABLE "LeaveEntitlement" ADD CONSTRAINT "LeaveEntitlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingRecord" ADD CONSTRAINT "TrainingRecord_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "TrainingCourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingRecord" ADD CONSTRAINT "TrainingRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

