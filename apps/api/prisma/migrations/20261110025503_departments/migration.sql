-- AlterTable
ALTER TABLE "CustomRole" ADD COLUMN     "scopeDepartmentIds" UUID[] DEFAULT ARRAY[]::UUID[];

-- AlterTable
ALTER TABLE "Position" ADD COLUMN     "departmentId" UUID;

-- CreateTable
CREATE TABLE "Department" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameFr" TEXT,
    "aquatic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_tenantId_name_key" ON "Department"("tenantId", "name");

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Every existing city starts with an Aquatics department holding its pool positions,
-- so built-in aquatic supervisors stop reaching other departments' people.
INSERT INTO "Department" ("id", "tenantId", "name", "nameFr", "aquatic")
SELECT gen_random_uuid(), t."id", 'Aquatics', 'Aquatique', true
FROM "Tenant" t
WHERE EXISTS (
  SELECT 1 FROM "Position" p WHERE p."tenantId" = t."id"
    AND p."name" ~* '(life ?guard|guard|swim|instructor|aquatic|pool|natation|sauvet|moniteur|wsi|nls|bronze|waterfront)'
);

UPDATE "Position" p SET "departmentId" = d."id"
FROM "Department" d
WHERE d."tenantId" = p."tenantId" AND d."aquatic" = true AND d."name" = 'Aquatics'
  AND p."name" ~* '(life ?guard|guard|swim|instructor|aquatic|pool|natation|sauvet|moniteur|wsi|nls|bronze|waterfront)';
