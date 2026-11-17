-- The language a booking was requested in, so the decision email is written in it.
ALTER TABLE "BookingRequest" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en-CA';

-- Bookings already made: the language of their "request received" email, while that email is still on record.
UPDATE "BookingRequest" b SET "locale" = 'fr-CA'
FROM "EmailOutbox" o
WHERE o."tenantId" = b."tenantId" AND o."template" = 'booking_received' AND o."locale" = 'fr-CA' AND o."params"->>'reference' = b."reference";
