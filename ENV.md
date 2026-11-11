# Environment variables — the full server surface

There was no single list of the variables this system needs; this file is it.
Names only — values live in the Cloudflare Pages project settings (production)
and in local `.env` / `.env.test` files that are git-ignored.

## Frontend build (Vite) — `.env` locally, GitHub repo secrets for deploy

| Variable | Used by | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | `src/lib/supabase.js` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | `src/lib/supabase.js` | Supabase anon (public) key |

## Tooling — `.env.test` locally (migrations ledger, security tests, eval)

| Variable | Used by | Purpose |
|---|---|---|
| `SUPABASE_URL` | `scripts/migrations.mjs`, `tests/security/*` | Supabase project URL |
| `SUPABASE_ANON_KEY` | `tests/security/*` | anon key for pentest clients |
| `SUPABASE_SERVICE_ROLE_KEY` | `scripts/migrations.mjs`, `tests/security/*` | privileged key — never ships to a client |
| `GEMINI_API_KEY` | `scripts/eval-scan.mjs` (via `extractReceipt`) | required to run the scan eval locally |

## Cloudflare Pages Functions (production runtime) — set in the Pages project

| Variable | Used by | Purpose |
|---|---|---|
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | `functions/api/_lib/auth.js` and all endpoints | server-side DB access |
| `ANTHROPIC_API_KEY` | `functions/api/chat.js` | the business assistant (Claude) |
| `GEMINI_API_KEY` | `functions/api/_lib/extractReceipt.js` | receipt OCR/extraction |
| `GEMINI_MODEL` | `extractReceipt.js` | optional primary-model override |
| `GEMINI_FALLBACK_MODEL` | `extractReceipt.js` | optional fallback-model override |
| `CRON_SECRET` | `functions/api/mail/cron.js` | shared secret the scheduler must present |
| `CRON_TARGET` | `mail-scan-worker/src/index.js` | URL the worker pings (worker secret) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | `functions/api/mail/connect.js`, `callback.js` | Gmail OAuth app |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | same | Outlook/Graph OAuth app |
| `MAIL_REDIRECT_URI` | `mail/connect.js` | pinned OAuth redirect (falls back to `${origin}/api/mail/callback`) |
| `MAIL_TOKEN_KEY` | `functions/api/_lib/mailCrypto.js` | AES-GCM key for stored refresh tokens — rotating it invalidates every stored token |
| `ALLOWED_ORIGIN` | `functions/api/_lib/response.js` | CORS allow-list |
| `SUPERADMIN_EMAIL` | `functions/api/admin/onboard.js`, `audit.js` | platform-owner account |

## Bindings (Cloudflare, not env vars)

| Binding | Used by | Purpose |
|---|---|---|
| `RATE_LIMIT` (KV namespace) | `functions/api/_lib/rateLimit.js` | per-user rate limiting |

## GitHub repo secrets (deploy workflow)

`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
— consumed by `.github/workflows/deploy.yml`.

## Rules

- A new env var is added HERE in the same commit that introduces it.
- Secrets never appear in code, in this file, in `wrangler.toml`, or in committed `.env.example` values.
