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

# Phase 3 part B (waiting on a storage decision)
Receipt photos, avatars, and nightly backups need file storage. Not part of this round.
