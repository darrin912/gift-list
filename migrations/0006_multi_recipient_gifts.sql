-- Migration number: 0006 	 Phase 3 (part C): gifts for several people and family gifts.
-- Keep in sync with src/db/schema.ts.
--
-- gifts.recipient_id is retired: recipients now live in gift_recipients. SQLite can't drop a
-- NOT NULL REFERENCES column in place, so the gifts table is rebuilt. Every row keeps its id.
--
-- D1 can't turn foreign keys off, and DROP TABLE runs an implicit DELETE that would fire
-- gift_givers' ON DELETE CASCADE (defer_foreign_keys defers checks, not cascade actions).
-- So gift_givers is copied to a plain stash table and dropped first, then recreated after the
-- swap. The AUTOINCREMENT counter is carried over so deleted gift ids (still referenced by
-- activity_log.gift_id) are never reused.
PRAGMA defer_foreign_keys = true;

-- 1. Stash what the rebuild would lose.
CREATE TABLE _m0006_gift_givers AS SELECT gift_id, person_id FROM gift_givers;
CREATE TABLE _m0006_gift_recipients AS SELECT id AS gift_id, recipient_id AS person_id FROM gifts;
CREATE TABLE _m0006_seq AS SELECT seq FROM sqlite_sequence WHERE name = 'gifts';

-- 2. The new gifts table: no recipient_id, plus is_family.
CREATE TABLE gifts_new (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id                INTEGER REFERENCES seasons(id) ON DELETE SET NULL, -- NULL = ideas inbox
  title                    TEXT    NOT NULL,
  description              TEXT    NOT NULL DEFAULT '',
  url                      TEXT    NOT NULL DEFAULT '',
  image_url                TEXT    NOT NULL DEFAULT '',
  category                 TEXT    NOT NULL DEFAULT 'main'
                             CHECK (category IN ('main', 'stocking', 'experience', 'clothing', 'book', 'other')),
  status                   TEXT    NOT NULL DEFAULT 'idea'
                             CHECK (status IN ('idea', 'planned', 'ordered', 'received', 'wrapped', 'given', 'returned')),
  wished                   INTEGER NOT NULL DEFAULT 0,
  priority                 INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  est_price_cents          INTEGER,
  actual_price_cents       INTEGER,
  store                    TEXT    NOT NULL DEFAULT '',
  order_number             TEXT    NOT NULL DEFAULT '',
  tracking_url             TEXT    NOT NULL DEFAULT '',
  return_by                TEXT,
  created_by               INTEGER REFERENCES users(id),
  updated_by               INTEGER REFERENCES users(id),
  created_at               TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at               TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  watch_price              INTEGER NOT NULL DEFAULT 0,
  last_seen_price_cents    INTEGER,
  lowest_seen_price_cents  INTEGER,
  last_checked_at          TEXT,
  price_dropped_at         TEXT,
  is_family                INTEGER NOT NULL DEFAULT 0
);

INSERT INTO gifts_new (
  id, season_id, title, description, url, image_url, category, status, wished, priority,
  est_price_cents, actual_price_cents, store, order_number, tracking_url, return_by,
  created_by, updated_by, created_at, updated_at,
  watch_price, last_seen_price_cents, lowest_seen_price_cents, last_checked_at, price_dropped_at,
  is_family
)
SELECT
  id, season_id, title, description, url, image_url, category, status, wished, priority,
  est_price_cents, actual_price_cents, store, order_number, tracking_url, return_by,
  created_by, updated_by, created_at, updated_at,
  watch_price, last_seen_price_cents, lowest_seen_price_cents, last_checked_at, price_dropped_at,
  0
FROM gifts;

-- 3. Swap. gift_givers goes first so dropping gifts cascades into nothing.
DROP TABLE gift_givers;
DROP TABLE gifts;
ALTER TABLE gifts_new RENAME TO gifts;
CREATE INDEX gifts_season_id_idx ON gifts(season_id);
CREATE INDEX gifts_price_watch_idx ON gifts(watch_price, last_checked_at);

-- Keep the AUTOINCREMENT high-water mark (the copy only set it to max(id)).
UPDATE sqlite_sequence
SET seq = max(seq, coalesce((SELECT seq FROM _m0006_seq), 0))
WHERE name = 'gifts';

-- 4. Givers, exactly as before.
CREATE TABLE gift_givers (
  gift_id    INTEGER NOT NULL REFERENCES gifts(id) ON DELETE CASCADE,
  person_id  INTEGER NOT NULL REFERENCES people(id),
  PRIMARY KEY (gift_id, person_id)
);
CREATE INDEX gift_givers_person_id_idx ON gift_givers(person_id);
INSERT INTO gift_givers (gift_id, person_id) SELECT gift_id, person_id FROM _m0006_gift_givers;

-- 5. Recipients, backfilled from the old recipient_id.
CREATE TABLE gift_recipients (
  gift_id    INTEGER NOT NULL REFERENCES gifts(id) ON DELETE CASCADE,
  person_id  INTEGER NOT NULL REFERENCES people(id),
  PRIMARY KEY (gift_id, person_id)
);
CREATE INDEX gift_recipients_person_id_idx ON gift_recipients(person_id);
INSERT INTO gift_recipients (gift_id, person_id) SELECT gift_id, person_id FROM _m0006_gift_recipients;

DROP TABLE _m0006_gift_givers;
DROP TABLE _m0006_gift_recipients;
DROP TABLE _m0006_seq;

-- 6. Family budget per season.
ALTER TABLE seasons ADD COLUMN family_budget_cents INTEGER NOT NULL DEFAULT 0;

-- 7. Activity rows log every recipient (JSON array text); recipient_id stays as a legacy column.
ALTER TABLE activity_log ADD COLUMN recipient_ids TEXT;
UPDATE activity_log SET recipient_ids = json_array(recipient_id) WHERE recipient_id IS NOT NULL;
