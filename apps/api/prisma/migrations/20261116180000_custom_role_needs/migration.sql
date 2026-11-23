-- Custom roles saved before these rules: give them, explicitly, what their screens need.
-- 1. Managing roles, setting up reviews, handling grievances and changing records pick people from the staff list.
UPDATE "CustomRole"
SET "permissions" = array_append("permissions", 'users.read')
WHERE "permissions" && ARRAY['roles.manage', 'performance.manage', 'grievances.manage', 'users.write']::text[]
  AND NOT ('users.read' = ANY ("permissions"));

-- 2. My pay now follows its own capability (pay.self) instead of clocking in: whoever
--    clocks in through a custom role keeps seeing their pay.
UPDATE "CustomRole"
SET "permissions" = array_append("permissions", 'pay.self')
WHERE 'timeclock.punch' = ANY ("permissions")
  AND NOT ('pay.self' = ANY ("permissions"));
