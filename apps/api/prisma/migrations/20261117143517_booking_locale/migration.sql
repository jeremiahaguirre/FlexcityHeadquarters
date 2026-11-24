-- The language the resident booked in, for the emails that answer the booking.
ALTER TABLE "BookingRequest" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en-CA';
