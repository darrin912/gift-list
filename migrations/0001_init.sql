-- Migration number: 0001 	 Initial schema for the family gift tracker (Phase 1).
-- Applied with `wrangler d1 migrations apply gift-list --local|--remote`.
-- Keep in sync with src/db/schema.ts.
-- Money is always integer cents. Dates are YYYY-MM-DD text; timestamps are ISO-8601 UTC text.

CREATE TABLE people (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  kind        TEXT    NOT NULL CHECK (kind IN ('parent', 'kid', 'other')),
  color       TEXT    NOT NULL DEFAULT '',
  emoji       TEXT    NOT NULL DEFAULT '',
  birthday    TEXT,
  sizes       TEXT    NOT NULL DEFAULT '{}',
  likes       TEXT    NOT NULL DEFAULT '',
  dislikes    TEXT    NOT NULL DEFAULT '',
  notes       TEXT    NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  archived    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE users (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  email               TEXT    NOT NULL UNIQUE CHECK (email = lower(email)),
  display_name        TEXT    NOT NULL,
  password_hash       TEXT    NOT NULL,
  password_salt       TEXT    NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 100000,
  person_id           INTEGER REFERENCES people(id),
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE sessions (
  id          TEXT    PRIMARY KEY, -- sha256 hex of the cookie token
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  user_agent  TEXT
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);

-- Failed login attempts, keyed "email:<email>" or "ip:<ip>"; `at` is epoch milliseconds.
CREATE TABLE login_attempts (
  key  TEXT    NOT NULL,
  at   INTEGER NOT NULL
);
CREATE INDEX login_attempts_key_at_idx ON login_attempts(key, at);

CREATE TABLE seasons (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  kind                  TEXT    NOT NULL CHECK (kind IN ('christmas', 'birthday', 'anniversary', 'other')),
  name                  TEXT    NOT NULL,
  date                  TEXT    NOT NULL,
  overall_budget_cents  INTEGER NOT NULL DEFAULT 0,
  is_active             INTEGER NOT NULL DEFAULT 0,
  archived              INTEGER NOT NULL DEFAULT 0
);
-- At most one active season.
CREATE UNIQUE INDEX seasons_one_active_idx ON seasons(is_active) WHERE is_active = 1;

CREATE TABLE person_budgets (
  season_id              INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  person_id              INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  budget_cents           INTEGER NOT NULL DEFAULT 0,
  stocking_budget_cents  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (season_id, person_id)
);

CREATE TABLE gifts (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id           INTEGER REFERENCES seasons(id) ON DELETE SET NULL, -- NULL = ideas inbox
  recipient_id        INTEGER NOT NULL REFERENCES people(id),
  title               TEXT    NOT NULL,
  description         TEXT    NOT NULL DEFAULT '',
  url                 TEXT    NOT NULL DEFAULT '',
  image_url           TEXT    NOT NULL DEFAULT '',
  category            TEXT    NOT NULL DEFAULT 'main'
                        CHECK (category IN ('main', 'stocking', 'experience', 'clothing', 'book', 'other')),
  status              TEXT    NOT NULL DEFAULT 'idea'
                        CHECK (status IN ('idea', 'planned', 'ordered', 'received', 'wrapped', 'given', 'returned')),
  wished              INTEGER NOT NULL DEFAULT 0,
  priority            INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  est_price_cents     INTEGER,
  actual_price_cents  INTEGER,
  store               TEXT    NOT NULL DEFAULT '',
  order_number        TEXT    NOT NULL DEFAULT '',
  tracking_url        TEXT    NOT NULL DEFAULT '',
  return_by           TEXT,
  created_by          INTEGER REFERENCES users(id),
  updated_by          INTEGER REFERENCES users(id),
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX gifts_season_id_idx ON gifts(season_id);
CREATE INDEX gifts_recipient_id_idx ON gifts(recipient_id);

CREATE TABLE gift_givers (
  gift_id    INTEGER NOT NULL REFERENCES gifts(id) ON DELETE CASCADE,
  person_id  INTEGER NOT NULL REFERENCES people(id),
  PRIMARY KEY (gift_id, person_id)
);
CREATE INDEX gift_givers_person_id_idx ON gift_givers(person_id);

-- gift_id is intentionally not a foreign key so rows survive gift deletion.
-- recipient_id/season_id are kept so a future activity feed can apply the surprise rule.
CREATE TABLE activity_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id),
  gift_id       INTEGER,
  recipient_id  INTEGER,
  season_id     INTEGER,
  action        TEXT    NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  summary       TEXT    NOT NULL,
  at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX activity_log_at_idx ON activity_log(at);

INSERT INTO people (name, kind, emoji, sort_order) VALUES ('Santa', 'other', '🎅', 1000);
