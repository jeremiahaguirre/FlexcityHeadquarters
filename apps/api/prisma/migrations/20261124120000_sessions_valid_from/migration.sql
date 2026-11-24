-- Access tokens issued before a person's sessions were ended stop working (SEC-31).
ALTER TABLE "User" ADD COLUMN "sessionsValidFrom" TIMESTAMPTZ(3);
