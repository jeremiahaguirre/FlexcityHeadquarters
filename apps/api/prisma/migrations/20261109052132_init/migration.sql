-- CreateEnum
CREATE TYPE "Province" AS ENUM ('BC', 'AB', 'SK', 'MB', 'ON', 'QC', 'NB', 'NS', 'PE', 'NL', 'YT', 'NT', 'NU');

-- CreateEnum
CREATE TYPE "AccessRole" AS ENUM ('HR_ADMIN', 'AQUATIC_SUPERVISOR', 'HEAD_LIFEGUARD', 'STAFF', 'FRONT_DESK', 'UNION_STEWARD');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('FULL_TIME', 'PART_TIME', 'CASUAL', 'ON_CALL', 'VOLUNTEER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "ShadowTier" AS ENUM ('A_SQUAD', 'B_SQUAD', 'C_SQUAD', 'UNASSIGNED');

-- CreateEnum
CREATE TYPE "ShiftType" AS ENUM ('STANDARD', 'CUSTOM', 'MANDATORY');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OfferSource" AS ENUM ('OPEN_SHIFT', 'SWAP');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('OPEN', 'PENDING_APPROVAL', 'COMPLETED', 'DENIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TimeOffType" AS ENUM ('VACATION', 'SICK', 'PROTECTED_LEAVE', 'UNPAID_PERSONAL', 'OTHER');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PunchLocationStatus" AS ENUM ('VERIFIED', 'OUTSIDE_RADIUS', 'LOW_ACCURACY', 'NO_LOCATION', 'FACILITY_NOT_CONFIGURED');

-- CreateEnum
CREATE TYPE "PunchStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PoolBodyKind" AS ENUM ('POOL', 'LEISURE_POOL', 'HOT_TUB', 'WADING_POOL', 'WAVE_POOL', 'SPLASH_PAD');

-- CreateEnum
CREATE TYPE "PoolBodyStatus" AS ENUM ('OPEN', 'CLOSURE_RECOMMENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReliabilityEventType" AS ENUM ('LATE_PUNCH', 'NO_SHOW', 'MISSED_IN_SERVICE', 'LATE_DROP', 'PICKED_UP_SHIFT');

-- CreateEnum
CREATE TYPE "PayCodeKey" AS ENUM ('REGULAR', 'OVERTIME_1_5', 'OVERTIME_2_0', 'STAT_WORKED_PREMIUM', 'STAT_HOLIDAY_PAY', 'SHIFT_PREMIUM', 'VACATION_PAY');

-- CreateEnum
CREATE TYPE "VacationPayMode" AS ENUM ('PAY_EACH_PERIOD', 'ACCRUE');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "subdomain" TEXT NOT NULL,
    "logoUrl" TEXT,
    "themeColors" JSONB NOT NULL DEFAULT '{}',
    "defaultLocale" TEXT NOT NULL DEFAULT 'en-CA',
    "payWeekStartDay" INTEGER NOT NULL DEFAULT 0,
    "vacationPayMode" "VacationPayMode" NOT NULL DEFAULT 'PAY_EACH_PERIOD',
    "payrollRetentionYears" INTEGER NOT NULL DEFAULT 7,
    "unionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Facility" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "province" "Province" NOT NULL,
    "timezone" TEXT NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "geoRadiusM" INTEGER NOT NULL DEFAULT 150,
    "costCenter" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleOverride" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "province" "Province",
    "ruleKey" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "source" TEXT,

    CONSTRAINT "RuleOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "roles" "AccessRole"[],
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "employmentStatus" "EmploymentStatus" NOT NULL,
    "shadowTier" "ShadowTier" NOT NULL DEFAULT 'UNASSIGNED',
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en-CA',
    "dateOfBirth" DATE,
    "employeeNumber" TEXT,
    "passwordHash" TEXT,
    "hireDate" DATE,
    "seniorityDate" DATE,
    "seniorityHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "weeklyMinHours" DECIMAL(5,2),
    "weeklyMaxHours" DECIMAL(5,2),
    "vscClearedDate" DATE,
    "unionMember" BOOLEAN NOT NULL DEFAULT false,
    "reliabilityScore" INTEGER NOT NULL DEFAULT 100,
    "processingRestrictedAt" TIMESTAMPTZ(3),
    "erasureDueAt" DATE,
    "anonymizedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameFr" TEXT,
    "minimumAge" INTEGER,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionCertRequirement" (
    "tenantId" UUID NOT NULL,
    "positionId" UUID NOT NULL,
    "certificationId" UUID NOT NULL,

    CONSTRAINT "PositionCertRequirement_pkey" PRIMARY KEY ("positionId","certificationId")
);

-- CreateTable
CREATE TABLE "UserPosition" (
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "positionId" UUID NOT NULL,
    "approvedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPosition_pkey" PRIMARY KEY ("userId","positionId")
);

-- CreateTable
CREATE TABLE "PayRate" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "positionId" UUID NOT NULL,
    "hourlyRate" DECIMAL(10,2) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,

    CONSTRAINT "PayRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certification" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "name" TEXT NOT NULL,
    "nameFr" TEXT,
    "issuingBody" TEXT NOT NULL,
    "validityMonths" INTEGER,

    CONSTRAINT "Certification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CertificationPrerequisite" (
    "certificationId" UUID NOT NULL,
    "requiresId" UUID NOT NULL,

    CONSTRAINT "CertificationPrerequisite_pkey" PRIMARY KEY ("certificationId","requiresId")
);

-- CreateTable
CREATE TABLE "UserCertification" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "certificationId" UUID NOT NULL,
    "issueDate" DATE NOT NULL,
    "expiryDate" DATE,
    "documentUrl" TEXT,
    "verifiedById" UUID,
    "verifiedAt" TIMESTAMPTZ(3),

    CONSTRAINT "UserCertification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Availability" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,

    CONSTRAINT "Availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeOffRequest" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "TimeOffType" NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeOffRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "positionId" UUID NOT NULL,
    "userId" UUID,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "shiftType" "ShiftType" NOT NULL DEFAULT 'STANDARD',
    "status" "ShiftStatus" NOT NULL DEFAULT 'DRAFT',
    "customTitle" TEXT,
    "premiumPerHour" DECIMAL(10,2),
    "conflictReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftOffer" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "shiftId" UUID NOT NULL,
    "source" "OfferSource" NOT NULL,
    "postedById" UUID,
    "claimedById" UUID,
    "status" "OfferStatus" NOT NULL DEFAULT 'OPEN',
    "complianceSnapshot" JSONB,
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ShiftOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatutoryHoliday" (
    "id" UUID NOT NULL,
    "province" "Province" NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "nameFr" TEXT,

    CONSTRAINT "StatutoryHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimePunch" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "shiftId" UUID,
    "positionId" UUID NOT NULL,
    "clockIn" TIMESTAMPTZ(3) NOT NULL,
    "clockOut" TIMESTAMPTZ(3),
    "ipAddress" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "accuracyM" INTEGER,
    "distanceM" INTEGER,
    "locationStatus" "PunchLocationStatus" NOT NULL DEFAULT 'NO_LOCATION',
    "status" "PunchStatus" NOT NULL DEFAULT 'PENDING',
    "varianceReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TimePunch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimePunchEdit" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "punchId" UUID NOT NULL,
    "editedById" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimePunchEdit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayCodeMapping" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "key" "PayCodeKey" NOT NULL,
    "positionId" UUID,
    "code" TEXT NOT NULL,

    CONSTRAINT "PayCodeMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReliabilityEvent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "ReliabilityEventType" NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "sourceId" TEXT,
    "excludedReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReliabilityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolBody" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PoolBodyKind" NOT NULL,
    "status" "PoolBodyStatus" NOT NULL DEFAULT 'OPEN',
    "freeChlorineMinPpm" DECIMAL(5,2),
    "freeChlorineMaxPpm" DECIMAL(5,2),
    "combinedChlorineMaxPpm" DECIMAL(5,2),
    "phMin" DECIMAL(4,2),
    "phMax" DECIMAL(4,2),
    "thresholdSource" TEXT,
    "bathersPerLifeguard" INTEGER,

    CONSTRAINT "PoolBody_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChemicalReading" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "poolBodyId" UUID NOT NULL,
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL,
    "freeChlorinePpm" DECIMAL(5,2),
    "totalChlorinePpm" DECIMAL(5,2),
    "ph" DECIMAL(4,2),
    "waterTempC" DECIMAL(4,1),
    "batherCount" INTEGER,
    "outOfRange" BOOLEAN NOT NULL DEFAULT false,
    "outOfRangeDetails" JSONB,
    "signedOffById" UUID,
    "signedOffAt" TIMESTAMPTZ(3),

    CONSTRAINT "ChemicalReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolClosure" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "poolBodyId" UUID NOT NULL,
    "readingId" UUID,
    "reason" TEXT NOT NULL,
    "recommendedAt" TIMESTAMPTZ(3) NOT NULL,
    "confirmedById" UUID,
    "confirmedAt" TIMESTAMPTZ(3),
    "dismissedById" UUID,
    "dismissedAt" TIMESTAMPTZ(3),
    "reopenedById" UUID,
    "reopenedAt" TIMESTAMPTZ(3),

    CONSTRAINT "PoolClosure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentReport" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "reportedById" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "category" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "wrappedDataKey" BYTEA NOT NULL,
    "kekId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentAccessLog" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "accessedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisciplinaryRecord" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "issuedById" UUID NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "acknowledgementSignature" BYTEA,
    "acknowledgedAt" TIMESTAMPTZ(3),
    "stewardPresent" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DisciplinaryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_subdomain_key" ON "Tenant"("subdomain");

-- CreateIndex
CREATE INDEX "Facility_tenantId_idx" ON "Facility"("tenantId");

-- CreateIndex
CREATE INDEX "RuleOverride_tenantId_ruleKey_effectiveFrom_idx" ON "RuleOverride"("tenantId", "ruleKey", "effectiveFrom");

-- CreateIndex
CREATE INDEX "User_tenantId_status_idx" ON "User"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_employeeNumber_key" ON "User"("tenantId", "employeeNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "Position_tenantId_name_key" ON "Position"("tenantId", "name");

-- CreateIndex
CREATE INDEX "PayRate_userId_positionId_effectiveFrom_idx" ON "PayRate"("userId", "positionId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "UserCertification_tenantId_expiryDate_idx" ON "UserCertification"("tenantId", "expiryDate");

-- CreateIndex
CREATE INDEX "UserCertification_userId_idx" ON "UserCertification"("userId");

-- CreateIndex
CREATE INDEX "Availability_userId_idx" ON "Availability"("userId");

-- CreateIndex
CREATE INDEX "TimeOffRequest_userId_startsAt_endsAt_idx" ON "TimeOffRequest"("userId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "Shift_tenantId_facilityId_startsAt_endsAt_idx" ON "Shift"("tenantId", "facilityId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "Shift_userId_startsAt_idx" ON "Shift"("userId", "startsAt");

-- CreateIndex
CREATE INDEX "ShiftOffer_tenantId_status_idx" ON "ShiftOffer"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ShiftOffer_shiftId_idx" ON "ShiftOffer"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "StatutoryHoliday_province_date_key" ON "StatutoryHoliday"("province", "date");

-- CreateIndex
CREATE INDEX "TimePunch_tenantId_userId_clockIn_idx" ON "TimePunch"("tenantId", "userId", "clockIn");

-- CreateIndex
CREATE INDEX "TimePunchEdit_punchId_idx" ON "TimePunchEdit"("punchId");

-- CreateIndex
CREATE UNIQUE INDEX "PayCodeMapping_tenantId_key_positionId_key" ON "PayCodeMapping"("tenantId", "key", "positionId");

-- CreateIndex
CREATE INDEX "ReliabilityEvent_userId_occurredAt_idx" ON "ReliabilityEvent"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "PoolBody_facilityId_idx" ON "PoolBody"("facilityId");

-- CreateIndex
CREATE INDEX "ChemicalReading_poolBodyId_recordedAt_idx" ON "ChemicalReading"("poolBodyId", "recordedAt");

-- CreateIndex
CREATE INDEX "PoolClosure_poolBodyId_recommendedAt_idx" ON "PoolClosure"("poolBodyId", "recommendedAt");

-- CreateIndex
CREATE INDEX "IncidentReport_tenantId_occurredAt_idx" ON "IncidentReport"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "DisciplinaryRecord_userId_idx" ON "DisciplinaryRecord"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_entity_entityId_idx" ON "AuditLog"("tenantId", "entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_at_idx" ON "AuditLog"("tenantId", "at");

-- AddForeignKey
ALTER TABLE "Facility" ADD CONSTRAINT "Facility_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleOverride" ADD CONSTRAINT "RuleOverride_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionCertRequirement" ADD CONSTRAINT "PositionCertRequirement_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionCertRequirement" ADD CONSTRAINT "PositionCertRequirement_certificationId_fkey" FOREIGN KEY ("certificationId") REFERENCES "Certification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPosition" ADD CONSTRAINT "UserPosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPosition" ADD CONSTRAINT "UserPosition_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayRate" ADD CONSTRAINT "PayRate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayRate" ADD CONSTRAINT "PayRate_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificationPrerequisite" ADD CONSTRAINT "CertificationPrerequisite_certificationId_fkey" FOREIGN KEY ("certificationId") REFERENCES "Certification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificationPrerequisite" ADD CONSTRAINT "CertificationPrerequisite_requiresId_fkey" FOREIGN KEY ("requiresId") REFERENCES "Certification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCertification" ADD CONSTRAINT "UserCertification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCertification" ADD CONSTRAINT "UserCertification_certificationId_fkey" FOREIGN KEY ("certificationId") REFERENCES "Certification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Availability" ADD CONSTRAINT "Availability_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeOffRequest" ADD CONSTRAINT "TimeOffRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftOffer" ADD CONSTRAINT "ShiftOffer_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftOffer" ADD CONSTRAINT "ShiftOffer_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftOffer" ADD CONSTRAINT "ShiftOffer_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimePunch" ADD CONSTRAINT "TimePunch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimePunch" ADD CONSTRAINT "TimePunch_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimePunch" ADD CONSTRAINT "TimePunch_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimePunchEdit" ADD CONSTRAINT "TimePunchEdit_punchId_fkey" FOREIGN KEY ("punchId") REFERENCES "TimePunch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayCodeMapping" ADD CONSTRAINT "PayCodeMapping_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayCodeMapping" ADD CONSTRAINT "PayCodeMapping_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReliabilityEvent" ADD CONSTRAINT "ReliabilityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolBody" ADD CONSTRAINT "PoolBody_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChemicalReading" ADD CONSTRAINT "ChemicalReading_poolBodyId_fkey" FOREIGN KEY ("poolBodyId") REFERENCES "PoolBody"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolClosure" ADD CONSTRAINT "PoolClosure_poolBodyId_fkey" FOREIGN KEY ("poolBodyId") REFERENCES "PoolBody"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentReport" ADD CONSTRAINT "IncidentReport_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentAccessLog" ADD CONSTRAINT "IncidentAccessLog_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "IncidentReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisciplinaryRecord" ADD CONSTRAINT "DisciplinaryRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
