// Migration 0006 rebuilds the gifts table (retiring recipient_id). This applies 0001–0005 to an
// empty database, seeds pre-0006 data, applies 0006, and checks nothing was lost.
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import * as schema from "../src/db/schema";
import { loadVisibleGifts } from "../src/worker/gift-access";

const db = env.MIGRATION_DB;

async function all<T>(sql: string): Promise<T[]> {
  return (await db.prepare(sql).all<T>()).results;
}

describe("migration 0006 (gifts for several people)", () => {
  it("preserves every gift, id, giver and activity row, and backfills recipients", async () => {
    const migrations = env.TEST_MIGRATIONS;
    const idx = migrations.findIndex((m) => m.name.startsWith("0006"));
    expect(idx).toBe(5);
    await applyD1Migrations(db, migrations.slice(0, idx));

    // ---- pre-0006 data
    await db.batch([
      db.prepare("INSERT INTO people (id, name, kind) VALUES (10, 'Ava', 'kid'), (11, 'Ben', 'kid'), (12, 'Mom', 'parent')"),
      db.prepare(
        "INSERT INTO users (id, email, display_name, password_hash, password_salt, person_id) VALUES (5, 'mom@example.com', 'Mom', 'h', 's', 12)",
      ),
      db.prepare("INSERT INTO seasons (id, kind, name, date, overall_budget_cents, is_active) VALUES (3, 'christmas', 'Xmas', '2026-12-25', 50000, 1)"),
      db.prepare("INSERT INTO person_budgets (season_id, person_id, budget_cents) VALUES (3, 10, 10000)"),
      db.prepare(
        `INSERT INTO gifts (id, season_id, recipient_id, title, description, status, est_price_cents, actual_price_cents, store,
           watch_price, last_seen_price_cents, created_by, updated_by, created_at, updated_at)
         VALUES
           (1, 3, 10, 'Bike', 'red', 'ordered', 9000, 8500, 'REI', 1, 8999, 5, 5, '2026-11-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z'),
           (2, NULL, 11, 'Kite', '', 'idea', NULL, NULL, '', 0, NULL, 5, NULL, '2026-11-03T00:00:00.000Z', '2026-11-03T00:00:00.000Z'),
           (3, 3, 12, 'Scarf', '', 'planned', 2500, NULL, 'Target', 0, NULL, NULL, NULL, '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z'),
           (4, 3, 10, 'Deleted later', '', 'idea', NULL, NULL, '', 0, NULL, NULL, NULL, '2026-11-05T00:00:00.000Z', '2026-11-05T00:00:00.000Z')`,
      ),
      db.prepare("INSERT INTO gift_givers (gift_id, person_id) VALUES (1, 12), (1, 11), (3, 10), (4, 12)"),
      db.prepare(
        `INSERT INTO activity_log (user_id, gift_id, recipient_id, season_id, action, summary) VALUES
           (5, 1, 10, 3, 'create', 'Added "Bike" for Ava'),
           (5, 4, 10, 3, 'delete', 'Deleted "Deleted later" for Ava'),
           (5, NULL, NULL, 3, 'create', 'Imported 2 gifts')`,
      ),
      db.prepare("INSERT INTO exchange_draws (season_id, giver_person_id, recipient_person_id) VALUES (3, 10, 11), (3, 11, 10)"),
    ]);
    await db.prepare("DELETE FROM gifts WHERE id = 4").run(); // cascades its giver row; id 4 must never be reused
    const giftsBefore = await all<Record<string, unknown>>("SELECT * FROM gifts ORDER BY id");
    const giversBefore = await all("SELECT gift_id, person_id FROM gift_givers ORDER BY gift_id, person_id");
    expect(giftsBefore).toHaveLength(3);

    // ---- 0006
    await applyD1Migrations(db, migrations.slice(0, idx + 1)); // through 0006 only (later migrations add columns)

    const giftsAfter = await all<Record<string, unknown>>("SELECT * FROM gifts ORDER BY id");
    expect(giftsAfter.map(({ is_family, ...rest }) => ({ ...rest, is_family }))).toEqual(
      giftsBefore.map(({ recipient_id: _drop, ...rest }) => ({ ...rest, is_family: 0 })),
    );
    expect((await all<{ name: string }>("SELECT name FROM pragma_table_info('gifts')")).map((c) => c.name)).not.toContain("recipient_id");
    expect(await all("SELECT gift_id, person_id FROM gift_givers ORDER BY gift_id, person_id")).toEqual(giversBefore);
    expect(await all("SELECT gift_id, person_id FROM gift_recipients ORDER BY gift_id")).toEqual([
      { gift_id: 1, person_id: 10 },
      { gift_id: 2, person_id: 11 },
      { gift_id: 3, person_id: 12 },
    ]);
    expect(await all("SELECT gift_id, recipient_id, recipient_ids FROM activity_log ORDER BY id")).toEqual([
      { gift_id: 1, recipient_id: 10, recipient_ids: "[10]" },
      { gift_id: 4, recipient_id: 10, recipient_ids: "[10]" },
      { gift_id: null, recipient_id: null, recipient_ids: null },
    ]);
    expect(await all("SELECT id, family_budget_cents FROM seasons")).toEqual([{ id: 3, family_budget_cents: 0 }]);
    expect(await all("SELECT count(*) AS n FROM exchange_draws")).toEqual([{ n: 2 }]);
    expect(await all("SELECT count(*) AS n FROM person_budgets")).toEqual([{ n: 1 }]);
    // No dangling references, and no leftover stash tables.
    expect(await all("PRAGMA foreign_key_check")).toEqual([]);
    expect(await all("SELECT name FROM sqlite_master WHERE name LIKE '%m0006%' OR name = 'gifts_new'")).toEqual([]);
    const indexes = (await all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index'")).map((r) => r.name);
    expect(indexes).toEqual(
      expect.arrayContaining(["gifts_season_id_idx", "gifts_price_watch_idx", "gift_givers_person_id_idx", "gift_recipients_person_id_idx"]),
    );
    expect(indexes).not.toContain("gifts_recipient_id_idx");

    // The AUTOINCREMENT high-water mark survives: deleted id 4 isn't reused.
    const next = await db.prepare("INSERT INTO gifts (title) VALUES ('New') RETURNING id").first<{ id: number }>();
    expect(next!.id).toBe(5);

    // Foreign keys still work on the rebuilt tables.
    await expect(db.prepare("INSERT INTO gift_recipients (gift_id, person_id) VALUES (999, 10)").run()).rejects.toThrow(/FOREIGN KEY/);
    await expect(db.prepare("INSERT INTO gift_givers (gift_id, person_id) VALUES (999, 10)").run()).rejects.toThrow(/FOREIGN KEY/);
    await db.prepare("DELETE FROM gifts WHERE id = 1").run();
    expect(await all("SELECT count(*) AS n FROM gift_givers WHERE gift_id = 1")).toEqual([{ n: 0 }]);
    expect(await all("SELECT count(*) AS n FROM gift_recipients WHERE gift_id = 1")).toEqual([{ n: 0 }]);
    await db.prepare("DELETE FROM seasons WHERE id = 3").run(); // ON DELETE SET NULL still applies
    expect(await all("SELECT id, season_id FROM gifts WHERE id = 3")).toEqual([{ id: 3, season_id: null }]);

    // ---- 0007 (phase 4): withdrawn_at + the wishes table, backfilled for existing wishlist items only.
    await db.batch([
      db.prepare(
        `INSERT INTO gifts (id, season_id, title, description, wished, priority, est_price_cents, status, store, actual_price_cents, created_by, created_at, updated_at)
         VALUES (6, NULL, 'Scarf wish', 'blue', 1, 1, 3000, 'ordered', 'Secret Shop', 2800, 5, '2026-11-06T00:00:00.000Z', '2026-11-09T00:00:00.000Z'),
                (7, NULL, 'Not mine', '', 1, 2, NULL, 'idea', '', NULL, 5, '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z')`,
      ),
      db.prepare("INSERT INTO gift_recipients (gift_id, person_id) VALUES (6, 12), (7, 10)"),
    ]);
    await applyD1Migrations(db, migrations);
    expect(await all("SELECT id, withdrawn_at FROM gifts WHERE id IN (3, 6, 7) ORDER BY id")).toEqual([
      { id: 3, withdrawn_at: null },
      { id: 6, withdrawn_at: null },
      { id: 7, withdrawn_at: null },
    ]);
    // Only gift 6 (created by Mom for Mom, wished) becomes a wish. updated_at is the creation time,
    // not the live updated_at (which may reflect the spouse's edits).
    expect(await all("SELECT * FROM wishes")).toEqual([
      {
        id: 6, gift_id: 6, owner_user_id: 5, title: "Scarf wish", description: "blue", url: "", image_url: "", category: "main",
        priority: 1, est_price_cents: 3000, season_id: null, withdrawn_at: null,
        created_at: "2026-11-06T00:00:00.000Z", updated_at: "2026-11-06T00:00:00.000Z",
      },
    ]);

    // The app reads migrated rows with their recipients.
    const viewer = { id: 0, email: "", displayName: "", personId: null };
    const loaded = await loadVisibleGifts(drizzle(db, { schema }), viewer, "2026-11-15");
    expect(loaded.map((r) => [r.gift.id, r.gift.recipientIds, r.gift.isFamily])).toEqual([
      [2, [11], false],
      [3, [12], false],
      [5, [], false],
      [6, [12], false],
      [7, [10], false],
    ]);
  });
});
