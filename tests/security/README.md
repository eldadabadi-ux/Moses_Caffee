# Security tests — cross-tenant RLS isolation (ISO/IEC 27001:2022 · A.8.28)

`rls.pentest.test.js` proves that a user signed into **org A** can never read or
write **org B**'s rows on the tenant tables (`receipts`, `categories`,
`user_settings`). It is the automated proof of the app's #1 property — that one
café's financial records are invisible to another.

## What it does

1. Uses the **service-role** key to provision two throwaway tenants:
   two users (`pentest_a_*` / `pentest_b_*@moses-test.local`), two organizations,
   memberships, and one synthetic receipt / category / settings row each.
2. Signs in as each **ordinary user** (anon key + password) so Row-Level Security
   actually applies, then asserts zero cross-tenant read/write leakage.
3. **Tears everything down** — deletes the synthetic rows and both users.

It never touches real business data — only its own `PENTEST_*` fixtures.

> ⚠️ There is no separate test database, so it runs against the **live** Supabase
> project. That is safe here because every fixture is synthetic and always
> removed; a leak (if one existed) could only ever expose these dummy rows.

## How to run

1. Copy the template and fill it in (values from **Supabase → Settings → API**):
   ```bash
   cp .env.test.example .env.test
   ```
   `SUPABASE_URL` and `SUPABASE_ANON_KEY` are pre-filled. Paste your
   **service_role** key into `SUPABASE_SERVICE_ROLE_KEY`.
   `.env.test` is git-ignored — the key never leaves your machine.

2. Run it (no `npm install` needed — it uses Node's built-in test runner):
   ```bash
   npm run test:security
   ```

Expected: all tests pass (`# pass N`, `# fail 0`). Without `.env.test`, the suite
**skips** cleanly instead of failing, so `npm test` is safe in any environment.

## If a test fails

A failure is a real isolation gap — do not "fix the test". Fix the RLS policy so
the invariant holds, then re-run. See `docs/ARCHITECTURE-AUDIT-2026.md` (finding
C2) and the guardrails in `CLAUDE.md`.
