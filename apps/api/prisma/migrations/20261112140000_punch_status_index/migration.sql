-- CreateIndex
CREATE INDEX "TimePunch_tenantId_status_clockIn_idx" ON "TimePunch"("tenantId", "status", "clockIn");

