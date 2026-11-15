-- Migration number: 0003 	 Giver-only people (gift tags like Santa): can give, never receive.
-- Keep in sync with src/db/schema.ts.
ALTER TABLE people ADD COLUMN giver_only INTEGER NOT NULL DEFAULT 0;

-- The person seeded by 0001_init.sql.
UPDATE people SET giver_only = 1 WHERE name = 'Santa' AND kind = 'other';
