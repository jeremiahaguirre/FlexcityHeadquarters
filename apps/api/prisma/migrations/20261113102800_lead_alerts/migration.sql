-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "alertedAt" TIMESTAMPTZ(3);

-- Enquiries already received count as alerted: turning alerts on never sends a backlog.
UPDATE "Lead" SET "alertedAt" = "createdAt";
