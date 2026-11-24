-- Bookings made before "locale" was recorded (20261117143517_booking_locale): the language of their
-- "request received" email, while that email is still on record, so the answer is written in it.
UPDATE "BookingRequest" b SET "locale" = 'fr-CA'
FROM "EmailOutbox" o
WHERE o."tenantId" = b."tenantId" AND o."template" = 'booking_received' AND o."locale" = 'fr-CA' AND o."params"->>'reference' = b."reference";
