-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'APPROVED', 'DECLINED', 'DENIED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "ShiftTrade" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "fromUserId" UUID NOT NULL,
    "fromShiftId" UUID NOT NULL,
    "toUserId" UUID NOT NULL,
    "toShiftId" UUID NOT NULL,
    "status" "TradeStatus" NOT NULL DEFAULT 'PROPOSED',
    "note" TEXT,
    "check" JSONB,
    "respondedAt" TIMESTAMPTZ(3),
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftTrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShiftTrade_tenantId_status_idx" ON "ShiftTrade"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ShiftTrade_fromShiftId_idx" ON "ShiftTrade"("fromShiftId");

-- CreateIndex
CREATE INDEX "ShiftTrade_toShiftId_idx" ON "ShiftTrade"("toShiftId");

