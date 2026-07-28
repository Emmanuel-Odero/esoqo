-- Esoko · database bootstrap
-- Runs once, on first container start.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";      -- gen_random_uuid, digest
CREATE EXTENSION IF NOT EXISTS "citext";        -- case-insensitive email
CREATE EXTENSION IF NOT EXISTS "pg_trgm";       -- fuzzy entity resolution

-- Application role. Prisma migrates as the owner; the app connects as this
-- role so row-level security is never bypassed by ownership.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'esoko_app') THEN
    CREATE ROLE esoko_app LOGIN PASSWORD 'esoko_dev_only' NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE esoko TO esoko_app;
GRANT USAGE ON SCHEMA public TO esoko_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO esoko_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO esoko_app;

COMMENT ON DATABASE esoko IS
  'Esoko registry. Consent-bound. Subject to the Data Protection Act 2019.';
