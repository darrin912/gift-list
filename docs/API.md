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
