-- AlterTable
ALTER TABLE "PlatformAdmin" ALTER COLUMN "permissions" SET DEFAULT ARRAY['trust.read', 'trust.manage', 'releases.manage']::TEXT[];

-- CreateTable
CREATE TABLE "ReleaseNote" (
    "id" UUID NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleFr" TEXT NOT NULL,
    "bodyEn" TEXT NOT NULL,
    "bodyFr" TEXT NOT NULL,
    "roles" "AccessRole"[],
    "tenantIds" UUID[],
    "ringIds" UUID[],
    "publishAt" TIMESTAMPTZ(3) NOT NULL,
    "publishedAt" TIMESTAMPTZ(3),
    "announcedAt" TIMESTAMPTZ(3),
    "withdrawnAt" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ReleaseNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseNoteRead" (
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "noteId" UUID NOT NULL,
    "readAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseNoteRead_pkey" PRIMARY KEY ("userId","noteId")
);

-- CreateIndex
CREATE INDEX "ReleaseNote_publishAt_idx" ON "ReleaseNote"("publishAt");

-- CreateIndex
CREATE INDEX "ReleaseNoteRead_tenantId_readAt_idx" ON "ReleaseNoteRead"("tenantId", "readAt");

-- AddForeignKey
ALTER TABLE "ReleaseNoteRead" ADD CONSTRAINT "ReleaseNoteRead_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "ReleaseNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Every Dev console admin may manage What's new, releases and maintenance notices, as each had Trust when it came.
UPDATE "PlatformAdmin" SET "permissions" = array_append("permissions", 'releases.manage') WHERE NOT ('releases.manage' = ANY("permissions"));
