# API Contract (Phase 1)

Base path `/api`. JSON in and out. Errors are returned as `{ "error": string }` with a 4xx or 5xx status.
**Money is always integer cents.** Dates are `YYYY-MM-DD` strings; timestamps are ISO strings.
Auth uses an `HttpOnly; Secure; SameSite=Lax` cookie named `gl_session`. Every route except `POST /api/auth/login` returns 401 without a valid session.

## Auth
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/auth/login` | `{ email, password }` | `{ user }`, sets the cookie. 401 on a bad login; 429 when rate-limited (5 failures per email or IP per 15 min) |
| POST | `/auth/logout` | – | `{ ok: true }`, clears the cookie and deletes the session |
| GET | `/auth/me` | – | `{ user }` |
| POST | `/auth/password` | `{ currentPassword, newPassword }` (min 10 chars) | `{ ok: true }` |

`User = { id, email, displayName, personId }`

## People
`Person = { id, name, kind: "parent"|"kid"|"other", color, emoji, birthday: string|null, sizes: Record<string,string>, likes, dislikes, notes, sortOrder, archived }`

| Method | Path | Notes |
|---|---|---|
| GET | `/people` | Ordered by sortOrder, then name. Add `?includeArchived=1` to include archived people. |
| POST | `/people` | Body: Person without `id`. Only `name` and `kind` are required. |
| PATCH | `/people/:id` | Partial update. |
| DELETE | `/people/:id` | Archives the person if they have gifts; otherwise deletes them. A person linked to a user can't be deleted (409). |

## Seasons and budgets
`Season = { id, kind: "christmas"|"birthday"|"anniversary"|"other", name, date, overallBudgetCents, isActive, archived }`
Only one season can be active at a time; setting `isActive: true` deactivates the others.

| Method | Path | Notes |
|---|---|---|
| GET | `/seasons` | Newest date first. |
| POST | `/seasons` | |
| PATCH | `/seasons/:id` | |
| GET | `/seasons/:id/budgets` | `[{ personId, budgetCents, stockingBudgetCents }]` |
| PUT | `/seasons/:id/budgets/:personId` | `{ budgetCents, stockingBudgetCents? }` (upsert) |

## Gifts
```
Gift = {
  id, seasonId: number|null, recipientId,
  title, description, url, imageUrl,
  category: "main"|"stocking"|"experience"|"clothing"|"book"|"other",
  status: "idea"|"planned"|"ordered"|"received"|"wrapped"|"given"|"returned",
  wished: boolean, priority: 1|2|3,
  estPriceCents: number|null, actualPriceCents: number|null,
  store, orderNumber, trackingUrl, returnBy: string|null,
  giverIds: number[],
  createdBy, updatedBy, createdAt, updatedAt
}
```
| Method | Path | Notes |
|---|---|---|
| GET | `/gifts` | Filters: `seasonId` (`none` = the ideas inbox), `recipientId`, `status` (comma-separated), `store`, `category`, `giverId`, `wished=1`, `q` (searches title, description, and store). |
| POST | `/gifts` | `title` and `recipientId` are required. |
| PATCH | `/gifts/:id` | Partial update; `giverIds`, if present, replaces the whole list. |
| DELETE | `/gifts/:id` | |
| GET | `/stores` | Distinct store names, most used first (for autocomplete). |

## Dashboard
`GET /dashboard?seasonId=` (defaults to the active season)
```
{
  season,
  totals: { budgetCents, spentCents, committedCents, remainingCents, giftCount },
  people: [{ personId, hidden, budgetCents, stockingBudgetCents, spentCents, committedCents,
             giftCount, stockingCount, countsByStatus: Record<status, number> }],
  fairness: [{ personId, spentCents, committedCents, giftCount }],   // kids only
  attention: {
    returnsSoon:        [{ giftId, title, recipientId, returnBy, level: "amber"|"red" }],
    orderedNotReceived: [{ giftId, title, recipientId, store }],
    receivedNotWrapped: [{ giftId, title, recipientId }]
  }
}
```

### Money rules
- **Effective price** = `actualPriceCents ?? estPriceCents ?? 0`
- **Spent** = the sum of effective prices for gifts with status `ordered`, `received`, `wrapped`, or `given`
- **Committed** = the sum of effective prices for gifts with status `planned`
- `idea` and `returned` gifts count toward neither.
- **Remaining** = budget − spent − committed. For the totals, the budget is the season's `overallBudgetCents`.
- **Return-by warning:** applies to gifts with status `ordered`, `received`, or `wrapped` that have a `returnBy` date. It's `red` if `returnBy` is before today, and `amber` if it's within the next 7 days.

### Surprise rule (enforced server-side on every route)
A gift is **hidden** from the signed-in user when `gift.recipientId === user.personId` and the gift's season is neither archived nor past (season `date` < today). Ideas-inbox gifts with no season are always hidden from their recipient.
- Hidden gifts never appear in `/gifts`, and `GET`, `PATCH`, or `DELETE` on one returns 404.
- On the dashboard, the user's own person entry has `hidden: true` and zeros for every number. All `totals`, `fairness`, and `attention` values leave out hidden gifts.
- `/stores` is unaffected, since it reveals nothing about specific gifts.
- Creating a gift for yourself is allowed (it becomes hidden right away).

---

# Phase 2 additions

The Phase 1 rules still apply: cents, `{ error }` errors, the session cookie, and the **surprise rule on every route**.

## Activity feed
`GET /activity?limit=30&seasonId=` → `[{ id, userId, userName, action: "created"|"updated"|"deleted", summary, giftId|null, recipientId|null, seasonId|null, at }]`, newest first.
- Rows about a gift that is hidden from the viewer (same rule as the gift: recipient = the viewer and the season isn't past or archived; no season = hidden) are **left out entirely**.
- `summary` is human-readable, e.g. `Added "LEGO tree house" for Ava` or `Marked "Fuzzy socks" as wrapped`. Status changes get their own wording.
- `seasonId` is an optional filter.

## Link preview (auto-fill)
`POST /link-preview` with `{ url }` → `{ title, imageUrl, priceCents|null, store }`. Every field is `""` or `null` when it can't be found.
- The server fetches the page: http(s) URLs only, 5-second timeout, first 1 MB read, a browser-like User-Agent, at most 3 redirects.
- **Blocked targets:** localhost, private and link-local IPs, and non-standard ports.
- **What it reads:** `og:title`, `twitter:title`, or `<title>`; `og:image` (resolved to an absolute URL); price from `product:price:amount`, `og:price:amount`, `itemprop="price"`, or JSON-LD `offers.price`; store from `og:site_name`, or else the hostname without `www.`, title-cased (e.g. `Target`).
- **Failures:** it never throws on a remote failure. A remote failure returns 200 with empty fields plus `"blocked": true` when the site refused (403/503/captcha). Only a malformed or disallowed URL returns 400.
- **Rate limit:** 30 requests per user per minute.

## CSV export / import
`GET /export.csv?seasonId=` (omit `seasonId` for all gifts) → `text/csv` with `Content-Disposition: attachment; filename="gifts-<season or all>.csv"`.
- Columns: `season,recipient,title,status,category,wished,priority,est_price,actual_price,store,url,order_number,tracking_url,return_by,from,description`.
- Prices are in dollars (`12.34`). `from` is people's names joined with ` & `. Gifts hidden from the viewer are excluded.

`POST /import` with `{ csv: string, seasonId: number|null, dryRun: boolean }` → `{ created: number, rows: [{ line, ok, error?, title?, recipient? }] }`. It accepts the same columns, in any order and any letter case; only `title` and `recipient` are required.
- `recipient` and `from` names are matched case-insensitively against people. Unknown names make that row an error; the import never auto-creates people.
- Invalid status or category values fall back to `idea` and `other`. Prices accept `$1,234.50`.
- `dryRun: true` validates without writing. Max 1,000 rows. The `season` column is ignored; `seasonId` from the body is used.

## Unchanged, computed client-side from `/gifts` + `/people`
The shopping list (by store), the wrapping and Christmas Eve checklist, the givers matrix, and the ideas inbox (`/gifts?seasonId=none`).
The dashboard already returns `stockingBudgetCents` and `stockingCount` per person. Phase 2 also adds `stockingSpentCents` and `stockingCommittedCents` to each `people[]` entry, using the same money rules but only for `category = "stocking"` (0 when hidden).

## Feedback changes (from first use)

### Budget allocation
`GET /dashboard` → `totals` gains:
- `allocatedCents`: the sum of `budgetCents` across person budgets for the season, counting only people who aren't archived and aren't `giverOnly`. **This includes the viewer's own budget**, since a budget amount isn't a surprise; only gifts are hidden.
- `unallocatedCents` = `overallBudgetCents − allocatedCents`. A negative value means **over-allocated**.

The UI shows "Allocated $X of $Y · $Z unallocated", or a warning "Over-allocated by $Z", on the dashboard pot card and above the Settings budgets table (live as budgets are edited).

### Giver-only people (Santa)
`Person` gains `giverOnly: boolean` (default `false`). Migration: add the column and set it to `true` for the seeded Santa.
- Giver-only people **can be chosen in "From"** but are never recipients.
- `POST`/`PATCH /gifts` with a giver-only `recipientId` → 400. `PUT` budgets for a giver-only person → 400. `PATCH /people/:id` setting `giverOnly: true` on someone who already receives gifts → 409.
- The dashboard's `people[]`, `fairness`, and allocation all exclude giver-only people.
- UI: giver-only people never appear in recipient pickers, dashboard person cards, budgets tables, or givers-matrix columns. On the People screen they get a small separate section, "Gift tags (givers only)", e.g. 🎅 Santa. The person form has a toggle "Only gives gifts (a label like Santa)". Nothing in the frontend matches on the name "Santa" any more.

---

# Phase 3 additions (part A: features that don't need file storage)

The usual rules still apply: cents, `{ error }`, the session cookie, and **the surprise rule on every route**. New migrations start at `0004`.

## History and the "given before" warning
- `GET /history?personId=` → `[{ season: Season, gifts: Gift[] }]`, newest season first. Only seasons other than the active one; ideas-inbox gifts are excluded; the surprise rule applies (past seasons are visible to their recipient because the rule lifts once the date has passed).
- `GET /gifts/similar?recipientId=&title=&excludeId=` → `[{ giftId, title, seasonName, seasonDate, status }]`, max 5. Matches the same recipient in **other** seasons, where the normalized titles are equal or one contains the other (lowercase, punctuation stripped, collapsed whitespace, both at least 4 characters). Gifts with status `returned` or `idea` are excluded. Hidden gifts are excluded.
- UI: the gift form shows "🔁 Looks like Ava got *LEGO Set* in Christmas 2025" while typing (debounced) and after save. The person page gets a **History** section, grouped by year.

## Kids' name draw
`exchange_draws(season_id, giver_person_id, recipient_person_id, created_at)`.
- `GET /seasons/:id/draw` → `[{ giverId, recipientId }]`
- `POST /seasons/:id/draw` with `{ participantIds: number[], avoidPreviousSeason: boolean }` → `[{ giverId, recipientId }]`
  - At least 2 participants. All must be non-giver-only and not archived.
  - Nobody draws themselves. When `avoidPreviousSeason` is set, it avoids the pairing from the most recent earlier season of the same kind, if one exists; if that's impossible, it falls back and returns a `"note"`.
  - It's a random derangement using `crypto.getRandomValues`, and it **replaces** any existing draw.
  - Response: `{ pairs, note? }`.
- `DELETE /seasons/:id/draw` → `{ ok: true }`
- The draw is visible to both parents; kids don't log in.
- UI: a Lists → "Name draw" page with a participant picker (kids preselected), a draw button with a short reveal animation, and the pairs. Each pair has "+ gift" (prefills the recipient and giver), and the pair shows ✓ once a gift exists in the season with that giver and recipient.

## Price-drop watch
New gift columns: `watch_price` (bool, default 0), `last_seen_price_cents`, `lowest_seen_price_cents`, `last_checked_at`, `price_dropped_at`.
- `Gift` gains `watchPrice`, `lastSeenPriceCents`, `lowestSeenPriceCents`, `lastCheckedAt`, `priceDroppedAt`.
- A **Cron Trigger once a day** (`"crons": ["17 13 * * *"]`) checks up to 25 watched gifts that have a `url` and status `idea` or `planned`, oldest checked first.
  - It reuses the link-preview fetcher and parser with all the same SSRF guards.
  - When the price found is lower than the previous `last_seen_price_cents` (or lower than `est_price_cents` on the first check) by at least $1 or 5%, it sets `price_dropped_at` and writes an activity row `Price dropped on "X": $59.99 → $44.99` (no user, attributed to the system; the activity feed shows "Price watch").
  - Failures are skipped silently, but `last_checked_at` is still updated.
- `POST /gifts/:id/check-price` → the updated Gift. Same logic, on demand; limited to 10 per user per minute.
- UI: a "Watch price" toggle in the gift form, shown when there's a URL. Badges "⬇ Price drop" and a "Lowest $X" line on cards. A "Check now" button.

## Markdown notes
Gift `description` and person `notes` are rendered as Markdown in read views: bold, italics, links, lists, line breaks. Raw HTML is **not** rendered: escape it, and allow only `http(s)`/`mailto` links with `rel="noopener noreferrer" target="_blank"`. Use a small, well-known library such as `marked` plus `DOMPurify`, pinned, or a minimal custom renderer with tests. Edit views stay as plain textareas with a "Markdown supported" hint.

## Birthday and anniversary seasons
`seasons` gains `honoree_person_id` (nullable). `Season` gains `honoreeId: number|null`.
- For kind `birthday`, it's required. For `anniversary`, it's optional and means both parents.
- Creating a birthday season with an honoree auto-suggests the name "Ava's Birthday 2027" and the date from the person's `birthday` (next occurrence).
- The dashboard for a birthday season shows the honoree card first. The fairness strip is hidden for birthday seasons.
- The surprise rule is unchanged.
- UI: the season switcher groups seasons as Christmas, Birthdays, Other. The People page shows "🎂 in N days" when a birthday is within 60 days, with a "Plan birthday" button that creates the season.

## Passkeys (Face ID / Touch ID)
`passkeys(id, user_id, credential_id unique, public_key, counter, transports, name, created_at, last_used_at)`. Built with `@simplewebauthn/server` (pinned; must run on Workers) and `@simplewebauthn/browser`.
- RP ID = the request hostname (`gifts.nielsonlife.com` in production, `localhost` in dev). Origin is checked against the request origin. Challenges are stored server-side with a 5-minute TTL (a D1 table), single use.
- `POST /auth/passkey/register/options` (signed in) → options. `POST /auth/passkey/register/verify` with `{ response, name }` → `{ ok }`.
- `POST /auth/passkey/login/options` (public) → options (discoverable credentials, no email needed). `POST /auth/passkey/login/verify` (public, counts toward the login rate limit) → `{ user }` and sets the session cookie, exactly like password login.
- `GET /auth/passkeys` → `[{ id, name, createdAt, lastUsedAt }]`. `DELETE /auth/passkeys/:id`.
- UI: the login page gets a "Sign in with Face ID / passkey" button, shown when `window.PublicKeyCredential` exists. In Settings → Security: "Add a passkey" (default name from the user agent, e.g. "iPhone"), plus a list with remove. Password login stays.

# Phase 3 part B: dropped
Receipt photos, avatars, and nightly backups are out of scope by decision. D1 Time Travel and CSV export cover recovery.

# Phase 3 part C: gifts for several people and family gifts

## Model
- New table `gift_recipients(gift_id, person_id)` with a primary key on both and cascade on gift delete. Backfill it from `gifts.recipient_id`.
- New column `gifts.is_family` (bool, default 0).
- New column `seasons.family_budget_cents` (default 0).
- `gifts.recipient_id` is retired. Rebuild the table if needed to drop or relax it, preserving all data (D1: `PRAGMA defer_foreign_keys = true` inside the migration).
- `Gift` JSON: `recipientIds: number[]` (empty when `isFamily`) and `isFamily: boolean`. **`recipientId` is removed.**
- Create/update rules:
  - Exactly one of these must hold: `isFamily: true` with `recipientIds` empty, or `recipientIds` with 1–10 distinct people (not giver-only, not archived). Otherwise 400.
  - `PATCH` with `recipientIds` replaces the whole list.
- `Season` JSON gains `familyBudgetCents`.

## Money
- Overall totals count every gift **once**, at full effective price.
- Per-person `spentCents` and `committedCents`: each recipient gets an **even share**, `floor(price / n)`. The remainder cents go one each to the recipients in ascending `person_id` order, so the shares always add up to the price. The stocking figures, fairness, and `giftCount` work the same way; `giftCount` counts the gift once for each recipient.
- Family gifts don't count toward any person. The dashboard gains `family: { budgetCents, spentCents, committedCents, giftCount }`.
- `totals.allocatedCents` = the sum of person budgets **plus** `familyBudgetCents`.

## Surprise rule (updated)
- A non-family gift is hidden from the viewer when `viewer.personId ∈ recipientIds` and the season isn't past or archived (the ideas inbox counts as never past).
- **Family gifts are never hidden.**
- Activity rows store `recipient_ids` (a JSON text column). A row is hidden when the viewer is in its logged recipients **or** in the gift's current recipients.
- Everything else follows these definitions: history, similar, export, the givers matrix, and name-draw ✓.

## Endpoints
- `GET /gifts?recipientId=` matches any recipient. `recipientId=family` returns family gifts.
- `GET /history?personId=` includes multi-person gifts that the person is a recipient of.
- `GET /gifts/similar?recipientIds=1,2&title=&excludeId=` matches when any recipient overlaps.
- `PUT /seasons/:id/family-budget` with `{ budgetCents }` → the updated Season.
- CSV: the `recipient` column holds names joined with ` & `, or `Family`. Import accepts the same, case-insensitively.
- Activity summaries: `Added "Trampoline" for Ava & Ben`, `Added "Board game" for the family`.

## Clarifications (as implemented)
- `PATCH /gifts/:id`: `{ isFamily: true }` alone clears the recipients; a non-empty `recipientIds` alone sets `isFamily: false`. Any other combination must already be valid. The archived check applies to people being **added**, so editing a gift whose recipient was archived later still works.
- `GET /dashboard` attention items (`returnsSoon`, `orderedNotReceived`, `receivedNotWrapped`) carry `recipientIds` and `isFamily` instead of `recipientId`.
- Activity items gain `recipientIds: number[]` (as logged; `[]` for family gifts and imports). `recipientId` stays, as the first logged recipient or `null`.
- `GET /gifts/similar` also accepts `recipientIds=family` (matches family gifts) and the old single `recipientId=`.
- Import rows' `recipient` echoes the matched names joined with ` & `, or `Family`. Archived people and duplicate names in one cell are row errors.

## UI
- Gift form "For": multi-select chips of people (the same style as "From"), plus a **"🏠 Whole family"** chip that is exclusive (it clears the person chips and vice versa).
  - A hint shows how the cost is split, e.g. "$150 each".
  - Family gifts show "Not a surprise; visible to both of you".
- Cards and the table show "Ava & Ben" or "🏠 Family".
- Gift list filter: a "Family" option, and a person filter that matches any recipient.
- Dashboard:
  - a Family card (budget, spent+committed, count) after the person cards
  - person cards and fairness use the split shares
  - multi-person gifts carry a small "shared" marker in the person's lists
- Settings budgets table: a "🏠 Family" row with its own budget input, included in the live allocation summary.
- Shopping, wrapping, and the Christmas Eve checklist list multi-person gifts once, as "for Ava & Ben", or under a "Family" group for Christmas Eve.
- Givers matrix: a multi-person gift fills every recipient's column.

---

# Phase 4: My wishlist

## Definition
A **wishlist item** belongs to a user when the gift has `createdBy = user.id`, `recipientIds = [user.personId]` (exactly one recipient, `isFamily` false), and `wished = true`. Gifts that someone else created for you, even with `wished` set, are **not** wishlist items and stay fully hidden. Multi-recipient and family gifts are never wishlist items.

## Data
New gift column `withdrawn_at` (nullable timestamp). `Gift` JSON gains `withdrawnAt: string|null` and `isWishlistItem: boolean` (true when the definition holds, from any viewer's perspective).

## Owner's view (the recipient)
Wishlist items stay **hidden** from their owner in all existing routes (`/gifts`, dashboard, activity, history, export, similar, draw). They are reachable only through:
- `GET /wishlist` → `[WishItem]`, newest first, excluding withdrawn items. Includes items in the ideas inbox and in seasons that aren't past or archived. Once a season is past, the normal rules already show the item as a normal gift.
- `WishItem = { id, title, description, url, imageUrl, category, priority, estPriceCents, seasonId: number|null, createdAt, updatedAt }`. **Only these fields**: no status, actual price, store, order or tracking numbers, return-by date, givers, watch, or withdrawn fields. Never derive anything from those fields (no ordering, filtering, or 4xx that depends on them).
- `POST /wishlist` with `{ title, url?, imageUrl?, description?, category?, priority?, estPriceCents?, seasonId? }` creates a gift with the viewer as sole recipient, `wished` true, and `status` "idea". It returns a WishItem.
- `PATCH /wishlist/:id`: only the WishItem fields (and `seasonId` only while the gift is still in the inbox or a season, never in a way that reveals anything). It returns a WishItem. It returns 404 unless the item is the viewer's own and not withdrawn.
- `DELETE /wishlist/:id` → `{ ok: true }`. It **always** soft-withdraws (sets `withdrawn_at`) and never hard-deletes, regardless of status.
- Activity rows for wishlist actions (`Added "X" to their wishlist`, `Updated wishlist item "X"`, `Removed "X" from their wishlist`) are visible to other users and hidden from the owner, as usual.

## Everyone else (e.g. the spouse)
- Wishlist items appear as normal gifts, with `isWishlistItem: true` and `withdrawnAt`. The spouse can update any field.
- The UI shows a "🎁 From Darrin's wishlist" badge, using the creator's display name.
- Withdrawn items show "No longer wanted" with a gentle style. They're included in money totals only if their status counts (unchanged money rules), so a bought-then-withdrawn gift still counts until it's returned or deleted.
- The spouse can still hard-delete the gift as usual.
- Gift list filter: "Wishlist items".
- Dashboard attention list: add "Withdrawn wishes" for withdrawn items with status ordered, received, or wrapped (a possible return).

## UI
- **Lists hub:** a "My wishlist" tile, first in the list.
- **`/wishlist` page:**
  - Quick-add (title + optional link with the existing auto-fill), a list of cards showing title, link, image, notes, priority, and price, each with the badge "On your list".
  - Edit sheet; "Remove from my list" with a confirm ("Stephanie will see that you no longer want this").
  - Empty state: "Add things you'd love. Stephanie sees them; you'll never see if they were bought."
- **Gift form:** choosing yourself as the only recipient while creating a new gift shows a hint linking to "Add to My wishlist instead", which is the recommended path. Saving still works as before, and the gift is auto-marked `wished` (it becomes a wishlist item).

## Clarifications (as implemented)
- Migration `0007` adds `gifts.withdrawn_at` and `gifts.wish_snapshot`. The snapshot is the owner's own copy of the WishItem fields (plus their own `updatedAt`), written only by the owner's `POST`/`PATCH /wishlist` (or by creating/importing a wished gift for themselves alone). `GET`/`PATCH /wishlist` responses are built from it, so nothing the spouse changes on the gift (status, prices, store, givers, title, season) changes them. Existing wishlist items are backfilled, with `updatedAt` = `createdAt`.
- `PATCH /wishlist/:id`: edits are copied to the live gift too. `seasonId` moves the live gift only while it is still in the season the owner last chose; if the spouse has moved it, only the owner's snapshot changes (the response is the same either way). A `seasonId` must be `null` or a season that is neither past nor archived, else 400. Unknown fields (e.g. `status`) are 400.
- `PATCH`/`DELETE /wishlist/:id` return `404 { "error": "Wish not found" }` for anything that isn't the viewer's own, live, non-withdrawn wishlist item.
- `GET /gifts?wishlist=1` returns only wishlist items (`wishlist=0`: none).
- `GET /dashboard` → `attention.withdrawnWishes: [{ giftId, title, recipientIds, isFamily, status, store, withdrawnAt }]`.
- Activity rows for wishlist actions use action `created` / `updated` (removing is a soft withdraw, so it is `updated`).
- `GET /stores` never counts the viewer's own wishlist items.
- `GET /users` → `[{ id, displayName, personId }]` (no emails): display names for the wishlist badge and the remove confirmation.
