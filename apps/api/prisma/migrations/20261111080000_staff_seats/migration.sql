-- Extra staff places added to a plan, billed monthly to the organization.
ALTER TABLE "BillingAccount" ADD COLUMN "extraStaffSeats" INTEGER NOT NULL DEFAULT 0;
