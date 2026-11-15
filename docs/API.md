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
