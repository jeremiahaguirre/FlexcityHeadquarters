-- CreateTable
CREATE TABLE "PayrollSync" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "rows" INTEGER NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "reference" TEXT,
    "message" TEXT,
    "sentById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayrollSync_tenantId_createdAt_idx" ON "PayrollSync"("tenantId", "createdAt");

