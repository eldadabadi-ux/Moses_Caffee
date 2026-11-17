# Environment variables — the full server surface

> Retired 17.11.2026 with the OAuth mail-scan channel (replaced by the inbound
> email Worker): `CRON_SECRET`, `GOOGLE_CLIENT_ID/SECRET`,
> `MICROSOFT_CLIENT_ID/SECRET`, `MAIL_REDIRECT_URI`, `MAIL_TOKEN_KEY` — safe to
> delete from the Pages project settings.

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
| `CHAT_MODEL` | `functions/api/chat.js` | optional Claude model override for the assistant (default `claude-sonnet-4-6`) |
| `GEMINI_API_KEY` | `functions/api/_lib/extractReceipt.js` | receipt OCR/extraction |
| `GEMINI_MODEL` | `extractReceipt.js` | optional primary-model override |
| `GEMINI_FALLBACK_MODEL` | `extractReceipt.js` | optional fallback-model override |
| `INBOUND_SECRET` | `functions/api/inbound.js` + the email Worker | shared secret the inbound email Worker must present (set the SAME value on both) |
| `INBOUND_DOMAIN` | `functions/api/inbound/alias.js` | the domain personal inbound addresses live on (`eldadai.co.il`); until set, the address is reserved but inactive |
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
