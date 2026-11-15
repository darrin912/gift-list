-- Migration number: 0004 	 Phase 3 (part A): price watch, birthday honorees, kids' name draw, system activity.
-- Keep in sync with src/db/schema.ts.

-- Price-drop watch.
ALTER TABLE gifts ADD COLUMN watch_price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gifts ADD COLUMN last_seen_price_cents INTEGER;
ALTER TABLE gifts ADD COLUMN lowest_seen_price_cents INTEGER;
ALTER TABLE gifts ADD COLUMN last_checked_at TEXT;
ALTER TABLE gifts ADD COLUMN price_dropped_at TEXT;
CREATE INDEX gifts_price_watch_idx ON gifts(watch_price, last_checked_at);

-- Activity rows written by the system (no user): 'price-watch'. NULL for rows written by a user.
ALTER TABLE activity_log ADD COLUMN system_actor TEXT;

-- Birthday / anniversary seasons: who the season is for.
ALTER TABLE seasons ADD COLUMN honoree_person_id INTEGER REFERENCES people(id);

-- Kids' name draw: one row per giver per season; a new draw replaces the old one.
CREATE TABLE exchange_draws (
  season_id            INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  giver_person_id      INTEGER NOT NULL REFERENCES people(id),
  recipient_person_id  INTEGER NOT NULL REFERENCES people(id),
  created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (season_id, giver_person_id),
  CHECK (giver_person_id <> recipient_person_id)
);
CREATE INDEX exchange_draws_recipient_idx ON exchange_draws(recipient_person_id);
