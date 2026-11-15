# Family Gift List: Plan

A small private web app for the two of us to plan and track Christmas gifts for the kids and for each other. It covers ideas, purchases, budgets, stores, and who each gift is "from".

Status: **planning**. No code has been written yet.

---

## 1. Goals

| Goal | What it means in the app |
|---|---|
| Shared list | We both sign in (through Cloudflare Access), see the same data live, and either of us can add or edit. |
| What we want to get vs. what we got | Every gift has a status, from *Idea* through *Given*. |
| Budgets | Each recipient has a budget, the season has an overall budget, and the app shows spent and remaining for both. |
| Where we bought it | Store, link, price paid, order number, and return-by date on each gift. |
| Who it's from | Each gift has one or more givers (Mom, Dad, a kid, "Santa", or "Mom & Dad"). We help the kids buy for each other, so the app also tracks who actually paid. |
| Keep surprises | Gifts for one of us are hidden from that person. |

**Non-goals for v1:** public wishlists, Secret Santa draws, native mobile apps, and extended family. The data model leaves room for these later.

---

## 2. Core concepts and data model

```
Season ─┬─< PersonBudget >── Person ──(optional)── User (login)
        │                     ▲  ▲
        └─< Gift ─────────────┘  │   recipient
              │                  │
              └─< GiftGiver >────┘   "from" (many-to-many)
```

### Tables

**users**: the two of us, identified by the email Cloudflare Access verifies.
`id, email, display_name, person_id (links to the matching Person), created_at`

**people**: everyone who gives or receives, including the two of us. Kids don't need logins.
`id, name, kind (parent | kid | other), color, emoji, birthday, sizes (JSON: shirt, pants, shoe…), interests, notes, sort_order, archived`
Also one pseudo-person, **Santa**, with kind = `other`, so a gift can be "from Santa".

**seasons**: one per year, so history is kept and next year starts clean.
`id, year, name ("Christmas 2026"), overall_budget, is_active`

**person_budgets**: how much we plan to spend on each person this season.
`season_id, person_id, budget_amount, stocking_budget_amount (optional)`

**gifts**: the main table.
| Field | Notes |
|---|---|
| `season_id` | Leave it null for "someday" ideas in the year-round inbox. |
| `recipient_id` | Person |
| `title`, `description`, `url`, `image_url` | The link is pasted in; the title and image can be auto-filled in Phase 2. |
| `category` | `main`, `stocking`, `experience`, `clothing`, `book`, `other` |
| `status` | `idea → planned → ordered → received → wrapped → given`, plus `returned` |
| `priority` | 1–3 (must-have / nice / maybe) |
| `est_price`, `actual_price` | Budget math uses the actual price when it's set and the estimate otherwise. |
| `store` | Free text with autocomplete from past entries (Amazon, Target, Costco…). |
| `order_number`, `tracking_url`, `return_by` | |
| `purchased_by_user_id` | Which of us bought it. |
| `paid_by_person_id` | Who paid. When a kid gives a gift we paid for, this is still us. |
| `hiding_spot` | "Garage top shelf", so we can find it on Christmas Eve. |
| `notes` | |
| `created_by_user_id`, `updated_by_user_id`, timestamps | Activity history. |

**gift_givers**: who the tag says it's from (many-to-many).
`gift_id, person_id`. For example, Jack's gift is from Emma, and a big gift is from Mom + Dad.

**activity_log** (optional, cheap to add): `user_id, gift_id, action, at`. It powers a "recent changes" feed, so you can see what your spouse added.

### The surprise rule (important)
When the signed-in user's `person_id` is the gift's `recipient_id`, the app hides that gift from them everywhere: lists, counts, and dollar totals. Their own budget card shows "🤫 hidden". The rule is enforced in the **API**, not just the UI. It turns off after Dec 26, or when the season is archived.

---

## 3. Screens (v1)

1. **Dashboard**
   - Overall season budget: spent, committed (planned + ordered), and remaining, with a progress bar.
   - One card per person showing budget and spent, gift count by status, and a stocking-stuffer count.
   - **Fairness strip**: the kids side by side by $ and number of gifts, so things stay even.
   - "Needs attention": returns closing soon, ordered but not received, received but not wrapped.
2. **Person page**: one person's gifts grouped by status, their sizes and interests, their budget, and an "Add gift" button.
3. **All gifts**: a table or card list with filters (person, status, store, category, from, purchased-by) and sorting. Status changes inline in one tap.
4. **Givers view ("From")**: what each kid is giving, to whom, and what it cost. Use it to make sure every kid has a gift for each sibling and parent.
5. **Shopping list**: unpurchased *planned* gifts grouped by **store**, for taking to Target.
6. **Wrapping and Christmas Eve view**: received-but-unwrapped gifts with their hiding spots, plus a checklist of what goes under the tree from whom.
7. **Ideas inbox**: year-round ideas with no season yet. Jot one down in July and promote it to this year later.
8. **Settings**: people (sizes, colors), seasons and budgets, CSV export.

Mobile-first. Most use will be on a phone in a store or on the couch. Add "Add to Home Screen" support (a PWA manifest) so it feels like an app.

---

## 4. Tech stack (Cloudflare: Workers + D1)

Everything runs on Cloudflare, where `nielsonlife.com` DNS already lives. That means one account, no servers, and no DNS or SSL setup by hand.

| Layer | Choice | Why |
|---|---|---|
| Runtime | **Cloudflare Workers** (JavaScript/TypeScript, with Node compatibility turned on) | Free plan and no server to manage. It also doesn't sleep the way Hostinger's Node apps do. |
| API framework | **Hono** | An Express-style router built for Workers. Express itself doesn't run well on Workers. |
| Frontend | **React + Vite** (or Preact), with Tailwind | Built to static files and served by the same Worker through **Workers Static Assets**. |
| Database | **Cloudflare D1** (SQLite) | Built in, free tier, point-in-time restore ("Time Travel"). Two people will use a tiny fraction of the free limits. |
| ORM / migrations | **Drizzle ORM** (supports D1), plus `wrangler d1 migrations` | Typed queries; migrations live in the repo. |
| Auth | **Cloudflare Access** (Zero Trust, free for up to 50 users) with a policy that allows only our two email addresses | No login code or password storage in the app. Cloudflare shows a one-time-code login, and the Worker reads the verified email from the Access JWT (`Cf-Access-Jwt-Assertion`) to know who's signed in. That's how the surprise rule knows who's looking. |
| Photos (Phase 3) | **R2** | For receipt photos and images, if we ever want them. |

Repo layout (planned):
```
/src/worker   Hono API, Access JWT check, Drizzle schema
/migrations   D1 SQL migrations
/web          React (Vite) app → built to /web/dist (served as static assets)
wrangler.jsonc  Worker config: D1 binding, assets dir, custom domain route
/docs         This plan + feature ideas
```

**API sketch:**
`GET /api/me` (from the Access identity),
`GET/POST/PATCH/DELETE /api/people`, `/api/seasons`, `/api/budgets`, `/api/gifts`,
`GET /api/dashboard?season=2026` (all totals computed server-side, with the surprise rule applied),
`GET /api/export.csv`.

**Trade-offs vs. Hostinger + Node/MySQL**
- **Pros:** DNS and SSL are automatic because the zone is already on Cloudflare. It's free. Branches get preview URLs. There are no cold-start sleeps. Login is handled for us.
- **Cons:** Workers are not full Node.js, so a few npm packages (anything with native code) won't run. The free plan's CPU time per request is small, which is fine for simple CRUD. The database is SQLite instead of MySQL, which makes no practical difference at our size.
- **Fallback:** Hostinger Business/Cloud running Node + MySQL, or PHP + MySQL on any Hostinger plan. The schema carries over almost unchanged.

---

## 5. Build phases

**Phase 1: MVP, to use this Christmas**
- Access-protected app, people, a season with budgets, and gift CRUD with status, store, price, and givers
- Dashboard with overall and per-person budget bars
- Surprise rule
- Mobile layout
- Deploy to the subdomain

**Phase 2: Quality of life**
- Shopping-list-by-store, wrapping, and Christmas Eve views
- Fairness strip, Givers view
- Ideas inbox, activity feed ("Darrin added 2 gifts")
- Paste a link to auto-fill the title, image, and price (the Worker fetches the page's Open Graph tags)
- CSV export and import (bring in an existing spreadsheet)
- PWA install

**Phase 3: Nice extras.** See [FEATURE-IDEAS.md](FEATURE-IDEAS.md).

---

## 6. Deployment plan (Cloudflare + GitHub)

Target URL: `https://gifts.nielsonlife.com` (placeholder subdomain; any name works).

### One-time setup
1. **GitHub.** The code lives in `darrin912/gift-list` (private). Production deploys from the `main` branch.
2. **Create the D1 database.** Use the Cloudflare dashboard (*Storage & Databases → D1 → Create*, named `gift-list`) or run `npx wrangler d1 create gift-list`. Put its ID in `wrangler.jsonc`. An ID isn't a secret, so it's safe to commit.
3. **Connect the repo with Workers Builds.** In the dashboard, go to *Workers & Pages → Create → Import a repository* and pick `darrin912/gift-list`.
   - Build command: `npm ci && npm run build`
   - Deploy command: `npx wrangler d1 migrations apply gift-list --remote && npx wrangler deploy`
   - Production branch: `main`. Other branches get preview URLs.
4. **Custom domain.** In the Worker, go to *Settings → Domains & Routes → Add → Custom domain* and enter `gifts.nielsonlife.com`. Because the zone is already in this Cloudflare account, the DNS record and certificate are created automatically. There are no A records or IPs to manage.
5. **Lock it down with Access.** Go to *Zero Trust → Access → Applications → Add → Self-hosted*, enter `gifts.nielsonlife.com`, and add a policy that allows two emails: ours. Also protect the `*.workers.dev` URL, or turn it off, so the app can't be reached around Access. Turn preview URLs off too, or protect them the same way.
6. **App config** (set as Worker variables, not secrets):
   - `ACCESS_TEAM_DOMAIN` (e.g. `nielsonlife.cloudflareaccess.com`)
   - `ACCESS_AUD`: the Access application's audience tag, which the Worker uses to verify the JWT
   - `USER_MAP`: maps each email to a person, so the app knows who's signed in and which gifts to hide

### Day-to-day
- `git push` to `main` → Workers Builds runs migrations, builds, and deploys.
- Feature branches get their own preview URL, which is handy for trying changes before merging.
- Local dev: `npx wrangler dev` runs the Worker and a local D1.

### Things to know
- **Cost: $0.** On the Workers Free plan, Cloudflare enforces D1's daily row read and write limits (since Sept 1, 2026). Two people tracking a few dozen gifts will be nowhere near them. If we ever hit them, the Workers Paid plan ($5/month) removes them.
- **Backups.** D1 Time Travel can restore the database to an earlier point in time. The CSV export button gives us our own copy. A scheduled Worker that emails or stores a nightly export is a Phase 3 option.
- **No secrets in the repo.** With Access doing auth, there are no passwords or session secrets to store at all.
- **Hostinger isn't needed for this app.** It stays available as a fallback.

---

## 7. Open questions for us

1. Subdomain name: `gifts.`, `christmas.`, `santa.`?
2. Which two email addresses should Cloudflare Access allow?
3. Kids' names and ages, so the seed data and colors can be set up.
4. Should the kids ever see anything, such as a read-only "my wishlist" page? Not in v1 is the suggestion.
5. Does "from Mom & Dad" count against one shared parent pot, or should spending be split between us?
6. Track birthdays now, or keep it Christmas-only? Seasons make it easy to add later.
