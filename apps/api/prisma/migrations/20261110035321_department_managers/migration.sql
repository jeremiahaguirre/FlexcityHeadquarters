-- CreateTable
CREATE TABLE "DepartmentManager" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepartmentManager_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DepartmentManager_userId_idx" ON "DepartmentManager"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DepartmentManager_departmentId_userId_key" ON "DepartmentManager"("departmentId", "userId");

-- AddForeignKey
ALTER TABLE "DepartmentManager" ADD CONSTRAINT "DepartmentManager_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentManager" ADD CONSTRAINT "DepartmentManager_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Aquatic supervisors and head lifeguards already ran their city's aquatics
-- departments; record them as its managers so nobody loses access.
INSERT INTO "DepartmentManager" ("id", "tenantId", "departmentId", "userId")
SELECT gen_random_uuid(), d."tenantId", d."id", u."id"
FROM "Department" d
JOIN "User" u ON u."tenantId" = d."tenantId"
WHERE d."aquatic" = true
  AND u."anonymizedAt" IS NULL
  AND (u."roles" && ARRAY['AQUATIC_SUPERVISOR', 'HEAD_LIFEGUARD']::"AccessRole"[]);
