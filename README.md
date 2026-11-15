# gift-list

A private family gift tracker for Christmas: ideas, purchases, per-person and overall budgets, stores, and who each gift is from.

- [Plan](docs/PLAN.md)
- [Feature ideas from research](docs/FEATURE-IDEAS.md)

## Deploy

Hosted on Cloudflare Workers + D1 at `https://gifts.nielsonlife.com`.

- **Auto-deploy:** Workers Builds watches `main`. Every push runs
  `npm ci && npm run build`, then
  `npx wrangler d1 migrations apply gift-list --remote && npx wrangler deploy`.
- **Create a login** (there's no sign-up page): `npm run user:create -- --remote`.
  Reset a password with `npm run user:create -- --remote --reset-password`.
- **Local dev:** `npm run db:migrate:local`, `npm run user:create`, then `npm run dev` (API + built web on :8787)
  or `npm --prefix web run dev` for the Vite dev server (proxies `/api` to :8787).
- **Checks:** `npm run typecheck && npm test`, and in `web/`: `npm run typecheck && npm test && npm run build`.
