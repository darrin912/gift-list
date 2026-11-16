-- Migration number: 0007 	 Phase 4: My wishlist.
-- Keep in sync with src/db/schema.ts.
--
-- gifts.withdrawn_at: set when the owner removes a wish (the spouse sees "No longer wanted").
--
-- wishes: the owner's own side of each wishlist item, fixed at creation and changed only by the
-- owner. GET/PATCH/DELETE /wishlist read only this table, so nothing the spouse does to the gift
-- (status, prices, store, givers, recipients, the wished flag, its season, even deleting it)
-- changes whether or how the item appears on the owner's list. id = the gift's id at creation
-- (gift ids are AUTOINCREMENT, never reused). gift_id goes NULL if the spouse deletes the gift.
ALTER TABLE gifts ADD COLUMN withdrawn_at TEXT;

CREATE TABLE wishes (
  id               INTEGER PRIMARY KEY,
  gift_id          INTEGER REFERENCES gifts(id) ON DELETE SET NULL,
  owner_user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            TEXT    NOT NULL,
  description      TEXT    NOT NULL DEFAULT '',
  url              TEXT    NOT NULL DEFAULT '',
  image_url        TEXT    NOT NULL DEFAULT '',
  category         TEXT    NOT NULL DEFAULT 'main'
                     CHECK (category IN ('main', 'stocking', 'experience', 'clothing', 'book', 'other')),
  priority         INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  est_price_cents  INTEGER,
  season_id        INTEGER REFERENCES seasons(id) ON DELETE SET NULL, -- the season the OWNER chose
  withdrawn_at     TEXT,
  created_at       TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL
);
CREATE INDEX wishes_owner_idx ON wishes(owner_user_id, created_at);
CREATE INDEX wishes_gift_idx ON wishes(gift_id);

-- Backfill existing wishlist items (created by a user for exactly themselves, not a family gift,
-- wished). updated_at = created_at: the live updated_at may reflect the spouse's edits.
INSERT INTO wishes (id, gift_id, owner_user_id, title, description, url, image_url, category, priority,
                    est_price_cents, season_id, created_at, updated_at)
SELECT g.id, g.id, g.created_by, g.title, g.description, g.url, g.image_url, g.category, g.priority,
       g.est_price_cents, g.season_id, g.created_at, g.created_at
FROM gifts g
WHERE g.wished = 1
  AND g.is_family = 0
  AND (SELECT count(*) FROM gift_recipients gr WHERE gr.gift_id = g.id) = 1
  AND EXISTS (
    SELECT 1 FROM gift_recipients gr JOIN users u ON u.person_id = gr.person_id
    WHERE gr.gift_id = g.id AND u.id = g.created_by
  );
