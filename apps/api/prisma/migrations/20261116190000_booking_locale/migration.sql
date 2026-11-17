-- The language a booking was requested in, so the decision email is written in it.
ALTER TABLE "BookingRequest" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en-CA';
