-- CreateTable
CREATE TABLE "JobPosting" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID,
    "title" TEXT NOT NULL,
    "titleFr" TEXT,
    "description" TEXT NOT NULL,
    "descriptionFr" TEXT,
    "employmentStatus" "EmploymentStatus" NOT NULL,
    "payMin" DECIMAL(10,2),
    "payMax" DECIMAL(10,2),
    "closesOn" DATE NOT NULL,
    "applyUrl" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "JobPosting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobPosting_tenantId_published_closesOn_idx" ON "JobPosting"("tenantId", "published", "closesOn");
