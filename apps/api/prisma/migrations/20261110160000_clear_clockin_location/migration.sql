-- Clock-in keeps only whether someone was at the facility (distance and status), never where they
-- were or their IP address. Clear what was stored before that change.
UPDATE "TimePunch" SET "latitude" = NULL, "longitude" = NULL, "ipAddress" = NULL
WHERE "latitude" IS NOT NULL OR "longitude" IS NOT NULL OR "ipAddress" IS NOT NULL;
