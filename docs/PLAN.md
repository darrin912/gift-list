# Family Gift List: Plan

A small private web app for the two of us to plan and track Christmas gifts for the kids and for each other. It covers ideas, purchases, budgets, stores, and who each gift is "from".

Status: **planning**. No code has been written yet.

---

## 1. Goals

| Goal | What it means in the app |
|---|---|
| Shared list | We both log in, see the same data live, and either of us can add or edit. |
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

**users**: the two logins.
`id, email, display_name, password_hash, person_id (links to the matching Person), created_at`

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

## 4. Tech stack (chosen for the easiest Hostinger deploy)

| Layer | Choice | Why |
|---|---|---|
| Runtime | **Node.js 20/22 LTS** | Hostinger's "Node.js web app" deploys straight from GitHub and rebuilds on every push. |
| Server | **Express** (one app serves the API and the built frontend) | It's one process, one deploy, and Hostinger auto-detects it. |
| Frontend | **React + Vite** (or Preact for something lighter), with Tailwind for styling | Fast to build, responsive by default. |
| Database | **MySQL** (included in the Hostinger plan) | According to Hostinger's guides, MySQL is the only database engine on these plans. Using it also avoids the question of whether a SQLite file survives redeploys. |
| ORM / migrations | **Drizzle ORM** (or Prisma) | Typed queries; migrations live in the repo. |
| Auth | Email + password for exactly two users, an httpOnly session cookie, and bcrypt hashes. The two accounts are seeded from env vars on first boot. No sign-up page. | Simplest option with no third-party dependency. |
| Optional extra lock | **Cloudflare Access** (Zero Trust free tier) in front of the subdomain, using a one-time code by email | A second gate that needs no extra code. See §6. |

Repo layout (planned):
```
/server      Express app, API routes, auth, db schema & migrations
/web         React (Vite) app; builds to /web/dist, served by Express
/docs        This plan + feature ideas
package.json root scripts: build, start, migrate, seed
```

**API sketch:**
`POST /api/login`, `POST /api/logout`, `GET /api/me`,
`GET/POST/PATCH/DELETE /api/people`, `/api/seasons`, `/api/budgets`, `/api/gifts`,
`GET /api/dashboard?season=2026` (all totals computed server-side, with the surprise rule applied),
`GET /api/export.csv`.

**Fallback if the Hostinger plan has no Node.js support:** the same app as **PHP + MySQL** (for example Laravel, or plain PHP with a small Alpine.js frontend). Every Hostinger plan runs PHP, and hPanel's Git deploy pulls from GitHub. Section 6 explains how to check.

---

## 5. Build phases

**Phase 1: MVP, to use this Christmas**
- Login for two users, people, a season with budgets, and gift CRUD with status, store, price, and givers
- Dashboard with overall and per-person budget bars
- Surprise rule
- Mobile layout
- Deploy to the subdomain

**Phase 2: Quality of life**
- Shopping-list-by-store, wrapping, and Christmas Eve views
- Fairness strip, Givers view
- Ideas inbox, activity feed ("Darrin added 2 gifts")
- Paste a link to auto-fill the title, image, and price (server-side Open Graph fetch)
- CSV export and import (bring in an existing spreadsheet)
- PWA install

**Phase 3: Nice extras.** See [FEATURE-IDEAS.md](FEATURE-IDEAS.md).

---

## 6. Deployment plan (Hostinger + GitHub + Cloudflare)

Target URL: `https://gifts.nielsonlife.com` (placeholder subdomain; any name works).

### One-time setup
1. **Check the Hostinger plan.** In hPanel, look for **Websites → Add Website → Node.js web app**. According to Hostinger's pricing pages, Node.js apps need **Business** web hosting (up to 5 Node apps) or a **Cloud** plan. If that option is missing, either upgrade or use the PHP fallback.
2. **GitHub.** The code lives in `darrin912/gift-list` (private). Production deploys from the `main` branch.
3. **Create the app in hPanel.** Go to *Add Website → Node.js web app → Import Git repository*, install the **Hostinger GitHub App** when prompted, and choose `darrin912/gift-list` and the `main` branch. Hostinger auto-detects the settings; confirm them:
   - Node version: 22 (or 20)
   - Build command: `npm ci && npm run build`
   - Entry file / start: `server/dist/index.js` (or `npm start`)
4. **Create a MySQL database** in hPanel (*Databases → MySQL*) and note its host, database name, user, and password.
5. **Set environment variables** in the Node.js app settings, then restart the app so it reads them:
   ```
   DATABASE_URL=mysql://USER:PASS@HOST:3306/DBNAME
   SESSION_SECRET=<long random string>
   USER1_EMAIL=…   USER1_PASSWORD=…   (used only for first-boot seeding)
   USER2_EMAIL=…   USER2_PASSWORD=…
   NODE_ENV=production
   ```
   The app runs its migrations automatically on start.
6. **Attach the subdomain in hPanel.** In the app's domain settings, add `gifts.nielsonlife.com`. hPanel then shows the IP address (or CNAME target) to point DNS at.
7. **Add the DNS record in Cloudflare.** In the `nielsonlife.com` zone, go to **DNS → Add record**:
   - Type **A**, name `gifts`, value = the Hostinger IP from step 6 (use a CNAME instead if hPanel gives a hostname)
   - Proxy status **DNS only (grey cloud)** for now, so Hostinger can issue the free SSL certificate
8. **SSL.** Once the certificate shows active in hPanel, you can switch the Cloudflare record to **Proxied (orange)**. If you do, set Cloudflare *SSL/TLS mode = Full (strict)* to avoid redirect loops. Staying grey-cloud is also fine.
9. **Optional: Cloudflare Access.** This needs the orange cloud. Go to *Zero Trust → Access → Applications → Self-hosted*, enter `gifts.nielsonlife.com`, and add a policy that allows only our two email addresses. Anyone else gets a Cloudflare login wall before they ever reach the app.

### Day-to-day
- `git push` to `main` → Hostinger rebuilds and redeploys automatically.
- Do feature work on branches and merge to `main` when ready.

### Things to know
- **Cold starts.** Hostinger stops idle Node.js apps and starts them again on the next request, so the first page load after a quiet period is a few seconds slower. That's fine for two users.
- **Backups.** Hostinger's daily backups include the MySQL database. The app will also have a "Download CSV" button for our own copy.
- **Secrets** stay in hPanel env vars and are never committed to the repo.
- **Verify before relying on these steps.** They come from Hostinger docs and support articles as summarized in search results. `docs.hostinger.com` was blocked from this research session, and the Hostinger connector failed to connect, so I couldn't check the docs or the actual account. Confirm the menu names and plan details in hPanel.

---

## 7. Open questions for us

1. Subdomain name: `gifts.`, `christmas.`, `santa.`?
2. Which Hostinger plan is it? Does hPanel show the Node.js web app option? If not, choose between upgrading and the PHP fallback.
3. Kids' names and ages, so the seed data and colors can be set up.
4. Should the kids ever see anything, such as a read-only "my wishlist" page? Not in v1 is the suggestion.
5. Does "from Mom & Dad" count against one shared parent pot, or should spending be split between us?
6. Track birthdays now, or keep it Christmas-only? Seasons make it easy to add later.
