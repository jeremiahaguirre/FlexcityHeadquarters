-- Each patrol keeps the route's name and road class as they were when it was done.
ALTER TABLE "PatrolRecord" ADD COLUMN "routeName" TEXT, ADD COLUMN "routeClass" TEXT;

-- Patrols recorded before: the route as it is now (routes could not be renamed until this change).
UPDATE "PatrolRecord" p SET "routeName" = r."name", "routeClass" = r."roadClass" FROM "PatrolRoute" r WHERE p."routeId" = r."id";
