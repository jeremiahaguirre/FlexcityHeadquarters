-- An overtime call-out recorded by mistake is voided by a reversing entry that points at it.
-- The unique index allows only one reversal per entry, even if two people void it at once.
-- Existing rows keep NULL; adding a nullable column and an index is safe on live data.
ALTER TABLE "OvertimeEntry" ADD COLUMN "reversesId" UUID;
CREATE UNIQUE INDEX "OvertimeEntry_reversesId_key" ON "OvertimeEntry"("reversesId");
