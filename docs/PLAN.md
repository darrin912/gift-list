# Family Gift List: Plan

A small private web app for the two of us to plan and track Christmas gifts for the kids and for each other, and later for birthdays too. It tracks ideas, purchases, budgets, stores, and who each gift is "from".

- **URL:** `https://gifts.nielsonlife.com`
- **Hosting:** Cloudflare Workers + D1, auto-deployed from GitHub
- **Status:** planning. No code has been written yet.

---

## 1. Decisions so far

| Topic | Decision |
|---|---|
| Subdomain | `gifts.nielsonlife.com` |
| Hosting | Cloudflare (Workers + D1 + R2), deployed from `darrin912/gift-list` on GitHub |
| Login | **The app's own email + password login** for exactly two accounts (no Cloudflare account or Cloudflare login page needed). There is no sign-up page. |
| People | Kids are added by hand in the app. Nothing is pre-seeded except the two of us and "Santa". |
| Money | **One shared pot.** There's no "who paid" or "who bought it" tracking and no reimbursements. Budgets are per recipient plus one overall. |
| "From" | Still tracked (Mom, Dad, Mom & Dad, a kid, Santa). It's only for the gift tag and the givers checklist, not for money. |
| Scope | Every feature from the research is in, **except** the grandparent read-only link and the hiding-spot field. |

---

## 2. Data model

```
Season ─┬─< PersonBudget >── Person ──(optional)── User (login)
        │                     ▲  ▲
        └─< Gift ─────────────┘  │   recipient
              │                  │
              ├─< GiftGiver >────┘   "from" (many-to-many)
              └─< Attachment (receipt photos, R2)
```

**users**: our two logins.
`id, email, display_name, password_hash, password_salt, person_id, theme_pref, created_at`
**sessions**: `id (random token hash), user_id, expires_at, created_at, user_agent`
**passkeys** (Phase 3): `id, user_id, credential_id, public_key, counter, created_at`

**people**: everyone who gives or receives.
`id, name, kind (parent | kid | other), color, emoji, avatar_key (R2, optional), birthday, sizes (JSON: shirt, pants, shoe, …), likes, dislikes, notes (Markdown), sort_order, archived`
The two of us plus **Santa** (kind `other`) are created at setup. We add the kids from the People screen.

**seasons**: one per occasion, so Christmas 2026, Christmas 2027, and later birthdays each start clean and history is kept.
`id, kind (christmas | birthday | anniversary | other), name, date, overall_budget, is_active, archived`

**person_budgets**: `season_id, person_id, budget, stocking_budget`

**gifts**
| Field | Notes |
|---|---|
| `season_id` | Leave it null for the year-round **ideas inbox**. |
| `recipient_id` | Person |
| `title`, `description` (Markdown), `url`, `image_url` | Paste a link to auto-fill the title, image, and price. |
| `category` | `main`, `stocking`, `experience`, `clothing`, `book`, `other` |
| `status` | `idea → planned → ordered → received → wrapped → given`, plus `returned` |
| `wished` | The recipient asked for it (a "wishlist" item, e.g. from a letter to Santa). |
| `priority` | 1–3 |
| `est_price`, `actual_price` | Totals use the actual price when it's set and the estimate otherwise. |
| `store` | Free text with autocomplete. |
| `order_number`, `tracking_url`, `return_by` | |
| `watch_price`, `last_seen_price`, `last_checked_at` | For the price-drop watch. |
| `created_by`, `updated_by`, timestamps | Only for the activity feed, not for money. |

**gift_givers**: `gift_id, person_id` (who the tag says it's from).
**attachments**: `id, gift_id, r2_key, content_type, created_at` (receipt photos).
**activity_log**: `user_id, gift_id, action, summary, at`
**exchange_draws** (kids' name draw): `season_id, giver_person_id, recipient_person_id`

### The surprise rule
When the signed-in user's `person_id` is a gift's `recipient_id`, the **API** hides that gift from them everywhere: lists, search, counts, dollar totals, the activity feed, and CSV export. Their budget card shows "🤫 hidden". The rule lifts once the season's date has passed, or when the season is archived.

---

## 3. Screens

1. **Dashboard**
   - Shared-pot summary: overall budget, **spent**, **committed** (planned + ordered), and **remaining**
   - Per-person cards showing budget and spent, count by status, and stocking count
   - **Fairness strip**: the kids side by side by $ and number of gifts
   - **Needs attention**: returns closing soon (amber, then red), ordered but not received, received but not wrapped
   - **Recent activity**: "Stephanie added 2 gifts for Emma"
2. **Person page**: their gifts by status, wishlist items, sizes, likes and dislikes, their budget, and past years' gifts ("what did we get them last year?")
3. **All gifts**: switch between **table and card views**, filter by person, status, store, category, "from", or wishlist, and change status in one tap
4. **Givers checklist**: a matrix of kid (giver) × family member (recipient), showing whether each kid has a gift for every sibling and parent
5. **Shopping list**: unpurchased gifts grouped by **store**
6. **Wrapping and Christmas Eve**: what still needs wrapping, and a checklist of what goes under the tree and from whom
7. **Ideas inbox**: year-round ideas with no season yet; promote one to a season later
8. **Kids' name draw**: randomly assigns which kid buys for which sibling (no one draws themselves; option to avoid last year's pairing)
9. **History**: past seasons, browsable by year and by person
10. **Settings**: people, seasons and budgets, CSV import and export, change password, passkeys, theme (light, dark, or holiday)

Mobile-first and installable to the phone home screen (PWA).

---

## 4. Tech stack

| Layer | Choice |
|---|---|
| Runtime | **Cloudflare Workers** (TypeScript) |
| API | **Hono** (an Express-style router for Workers) |
| Frontend | **React + Vite** with Tailwind, served by the same Worker as static assets |
| Database | **Cloudflare D1** (SQLite), through **Drizzle ORM**, with migrations kept in the repo |
| Files | **Cloudflare R2** for receipt photos and avatars |
| Scheduled jobs | **Cron Triggers** for the nightly backup and price-drop checks |

### Login design (no Cloudflare account needed)
- Email and password are checked against the `users` table. Passwords are hashed with **PBKDF2-SHA256 through WebCrypto**, which is built into Workers and runs fast enough for the free plan.
- On success the app sets a random session token in an `HttpOnly; Secure; SameSite=Lax` cookie and stores the token's hash in `sessions`. Sessions last about 90 days, so we rarely log in again on our phones.
- **Rate limiting:** after 5 failed attempts per email or IP in 15 minutes, the app makes you wait.
- **No sign-up page.** The two accounts are created once with a script, `npm run user:create`. It asks for the email, display name, and password, then writes the hashed password to D1. The emails aren't stored in the repo.
- **Change password** is in Settings. A forgotten password is reset by re-running the script.
- **Phase 3: passkeys.** Sign in with Face ID or Touch ID on our phones.
- **Lock-down:** turn off the `*.workers.dev` URL and preview URLs (or put them behind Cloudflare Access), so the only way in is `gifts.nielsonlife.com` and its login page.

### Repo layout
```
/src/worker    Hono API, auth, surprise-rule filters, cron handlers
/src/db        Drizzle schema
/migrations    D1 SQL migrations
/web           React app → built to /web/dist
/scripts       user:create, import/export helpers
wrangler.jsonc Worker config: D1, R2, cron, assets, custom domain
/docs          plan + feature ideas
```

---

## 5. Build phases

The full scope is listed below. Each phase is usable on its own, so Phase 1 can go live for this Christmas.

**Phase 1: Core (target: live in early December)**
- Login, sessions, rate limiting, change password, user-create script
- People (with sizes, likes, and dislikes), seasons, budgets
- Gifts: full create/edit/delete with status, category (main or stocking), store, prices, order and tracking numbers, return-by date, wishlist flag, and givers
- Surprise rule
- Dashboard: shared pot, per-person cards, fairness strip, needs-attention list (including return-by warnings)
- All-gifts list with filters
- Mobile layout, deploy to `gifts.nielsonlife.com`

**Phase 2: Christmas helpers**
- Shopping list by store, wrapping and Christmas Eve checklist, givers checklist
- Ideas inbox, activity feed
- Paste a link to auto-fill the title, image, and price (best effort, since some stores like Amazon often block it)
- CSV import and export, table and card views
- PWA install, dark and holiday themes
- Separate stocking budget per person

**Phase 3: Extras**
- History by year and person, plus a "given before" warning
- Kids' name draw
- Receipt photo upload (R2), person avatars
- Markdown notes
- Price-drop watch (daily cron, best effort)
- Nightly backup of the database to R2
- Passkeys (Face ID / Touch ID)
- Birthday and anniversary seasons

---

## 6. Deployment plan (Cloudflare + GitHub)

### One-time setup
1. **D1:** create a database called `gift-list` in the dashboard (*Storage & Databases → D1*) or with `npx wrangler d1 create gift-list`. Put its ID in `wrangler.jsonc`.
2. **R2** (Phase 3): create a bucket called `gift-list-files`.
3. **Workers Builds:** go to *Workers & Pages → Create → Import a repository*, choose `darrin912/gift-list`, and set:
   - Build command: `npm ci && npm run build`
   - Deploy command: `npx wrangler d1 migrations apply gift-list --remote && npx wrangler deploy`
   - Production branch: `main`
4. **Custom domain:** in the Worker, go to *Settings → Domains & Routes → Add → Custom domain* and enter `gifts.nielsonlife.com`. Cloudflare creates the DNS record and certificate automatically.
5. **Turn off** the `workers.dev` route and preview URLs (or protect them with Access).
6. **Create our two accounts:** run `npm run user:create` twice, once for each of us. Then sign in and add the kids.

### Day-to-day
- `git push` to `main` → database migrations run, then build, then deploy.
- `npx wrangler dev` for local development, with a local D1.

### Cost and limits
- $0 on the Workers Free plan. D1's daily read and write limits (enforced since Sept 1, 2026) are far beyond what two people will use. If we ever needed more, the Workers Paid plan ($5/month) lifts them.
- Backups: D1 Time Travel (point-in-time restore), the nightly R2 export, and the CSV download.

