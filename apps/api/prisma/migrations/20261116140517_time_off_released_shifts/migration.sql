-- Shifts an approved time-off request took the person off (and posted to the board), so that
-- cancelling or shortening the leave can give back the ones nobody has taken.
ALTER TABLE "TimeOffRequest" ADD COLUMN "releasedShiftIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
