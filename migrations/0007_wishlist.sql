-- Migration number: 0007 	 Phase 4: My wishlist.
-- Keep in sync with src/db/schema.ts.
--
-- withdrawn_at: set when the owner removes an item from their wishlist (DELETE /wishlist/:id
-- always soft-withdraws; the gift itself stays for the spouse, who may already have bought it).
--
-- wish_snapshot: the owner's own view of a wishlist item (JSON: the WishItem fields as the owner
-- last set them, plus their own updatedAt). GET/PATCH/DELETE /wishlist read only this, so nothing
-- the spouse changes on the gift (status, store, prices, givers, season, even the title) can
-- show up in, reorder, or change the owner's wishlist responses.
ALTER TABLE gifts ADD COLUMN withdrawn_at TEXT;
ALTER TABLE gifts ADD COLUMN wish_snapshot TEXT;

-- Backfill snapshots for gifts that already match the wishlist definition: created by a user
-- for exactly themselves (one recipient, not a family gift) and marked wished.
UPDATE gifts SET wish_snapshot = json_object(
    'title', title,
    'description', description,
    'url', url,
    'imageUrl', image_url,
    'category', category,
    'priority', priority,
    'estPriceCents', est_price_cents,
    'seasonId', season_id,
    'updatedAt', created_at
  )
WHERE wished = 1
  AND is_family = 0
  AND (SELECT count(*) FROM gift_recipients gr WHERE gr.gift_id = gifts.id) = 1
  AND EXISTS (
    SELECT 1 FROM gift_recipients gr JOIN users u ON u.person_id = gr.person_id
    WHERE gr.gift_id = gifts.id AND u.id = gifts.created_by
  );
