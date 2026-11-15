-- Migration number: 0002 	 Phase 2: generic per-key rate-limit events (link preview: 30/min per user).
-- Keep in sync with src/db/schema.ts.

-- One row per allowed request; keyed e.g. "link-preview:<userId>". `at` is epoch milliseconds.
CREATE TABLE rate_limit_events (
  key  TEXT    NOT NULL,
  at   INTEGER NOT NULL
);
CREATE INDEX rate_limit_events_key_at_idx ON rate_limit_events(key, at);

-- The activity feed reads newest-first, optionally per season.
CREATE INDEX activity_log_season_id_idx ON activity_log(season_id, id);
