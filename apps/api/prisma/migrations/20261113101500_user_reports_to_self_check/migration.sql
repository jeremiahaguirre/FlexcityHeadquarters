-- Nobody reports to themselves (longer cycles are refused in services/people/reporting.ts).
ALTER TABLE "User" ADD CONSTRAINT "User_reportsTo_not_self" CHECK ("reportsToId" IS NULL OR "reportsToId" <> "id");
