-- Fix Postgres logical replication delete requirement.
-- Without a replica identity, deleting from "Session" can fail with:
-- "cannot delete from table \"Session\" because it does not have a replica identity and publishes deletes".

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'Session'
      AND c.contype = 'p'
  ) THEN
    ALTER TABLE "Session" ADD CONSTRAINT "Session_pkey" PRIMARY KEY ("sessionToken");
  END IF;
END $$;

-- With a primary key in place, DEFAULT replica identity uses the PK.
ALTER TABLE "Session" REPLICA IDENTITY DEFAULT;
