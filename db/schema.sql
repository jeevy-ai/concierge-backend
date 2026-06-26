-- YOU-913: Phase 8 real_backend — per-account butler persistence (Neon)
-- Maps to YOU-4: "butler that grows with you" — durable per-user memory substrate.
--
-- Apply once against your Neon project:
--   psql $NEON_DATABASE_URL -f db/schema.sql

CREATE TABLE IF NOT EXISTS butler_profiles (
  clerk_user_id  TEXT        PRIMARY KEY,
  first_name     TEXT,
  prefs          JSONB       NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS butler_trips (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  clerk_user_id   TEXT        NOT NULL REFERENCES butler_profiles(clerk_user_id) ON DELETE CASCADE,
  trip_id         TEXT        NOT NULL,
  destination     TEXT        NOT NULL,
  dates           TEXT        NOT NULL,
  summary         TEXT        NOT NULL,
  highlight_venues TEXT[]     NOT NULL DEFAULT '{}',
  saved_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(clerk_user_id, trip_id)
);

CREATE INDEX IF NOT EXISTS butler_trips_user_idx ON butler_trips(clerk_user_id, saved_at DESC);

-- Auto-update updated_at on butler_profiles
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER butler_profiles_updated_at
  BEFORE UPDATE ON butler_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
