-- CreateEnum
CREATE TYPE "SsoProtocol" AS ENUM ('OIDC', 'SAML');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuthTokenPurpose" ADD VALUE 'SSO';
ALTER TYPE "AuthTokenPurpose" ADD VALUE 'SSO_MFA';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "ssoSubject" TEXT;

-- CreateTable
CREATE TABLE "SsoConnection" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "protocol" "SsoProtocol" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enforced" BOOLEAN NOT NULL DEFAULT false,
    "idpMfa" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT,
    "domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "oidcIssuer" TEXT,
    "oidcClientId" TEXT,
    "oidcSecret" JSONB,
    "samlEntryPoint" TEXT,
    "samlIdpIssuer" TEXT,
    "samlCert" TEXT,
    "lastUsedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SsoConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SsoConnection_tenantId_key" ON "SsoConnection"("tenantId");

-- AddForeignKey
ALTER TABLE "SsoConnection" ADD CONSTRAINT "SsoConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

