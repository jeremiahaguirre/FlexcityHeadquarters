-- CreateTable
CREATE TABLE "Lead" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "organization" TEXT,
    "role" TEXT,
    "province" TEXT,
    "facilities" INTEGER,
    "message" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en-CA',
    "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
    "consentText" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lead_status_createdAt_idx" ON "Lead"("status", "createdAt");

