# receipts-app ("Moses Coffee") — Claude Working Rules

## Architecture quick reference
- **Frontend:** React 19 + Vite + Tailwind (PWA).
- **Backend:** Cloudflare Pages Functions (`functions/api/`) + Supabase (Postgres + RLS + Auth).
- **Deploy:** `npm run deploy` → Cloudflare Pages project `moses-caffee`, branch `master`.
  **OpenNext/native tooling note:** builds/deploys for the sister site run from WSL; keep Node tooling
  consistent.
- **Multi-tenant:** `org_id` (via `organizations` + `memberships` + `current_org_ids()`), layered over
  the original `user_id` scoping. **`org_id` is the canonical tenant scope.**
  Live tenants are **fully independent businesses** — see "Tenant separation" below. There is no shared
  data between them and no plan for any.
- **OCR:** local Tesseract (`src/lib/ocrService.js`) is the privacy-first path; `functions/api/scan-receipt.js`
  uses Gemini. Know which path a change touches (see audit M3).

## Canonical modules (SSOT — never duplicate)
- **Currency:** `functions/api/_lib/fxRate.js` (Bank of Israel official rate). No client-side FX.
- **Classification:** client `src/lib/recategorize.js` orchestrates; server `functions/api/recategorize.js`
  + `_lib/classifyReceipt.js` classify. Don't add a third categorization path.
- **Category naming:** `src/lib/categoryNormalize.js`.

## Tenant separation (HARD REQUIREMENT — stated by the product owner, 30 Aug 2026)

Each account is a **separate real business**. Today: `moshek@cet.ac.il` (org `Cet_Coffee`) is the live
café; `eldadabadi@gmail.com` (org `מנהל קבלות`) is the development/testing tenant. More businesses will
be added, each independent.

**There is to be no connection or shared data between tenants — ever.** This is not a preference to be
traded off; treat any change that would blur the boundary as a rejected request under guardrail 5.

Concretely, that rules out:
- "global" or "shared" suppliers, categories, products or price benchmarks across accounts
- cross-tenant analytics, "how do you compare to other cafés" features, or any aggregate that mixes
  tenants — even anonymised, unless the product owner asks for it explicitly and separately
- adding one user to another's organization to "have a look", including for support or debugging.
  Reproduce with the testing tenant instead, or ask the owner of the data to run it themselves.
- any query, tool or report whose tenant scope comes from the client rather than the session

Every table that holds business data carries BOTH `user_id` and `org_id`, has RLS enabled, and has an
`enforce_own_org` trigger pinning both columns on end-user writes (permissive policies are OR'd, so RLS
alone does not stop a foreign `org_id` on a write). Receipt files live in Storage under `${user_id}/…`
with matching object policies. `memberships` has no INSERT policy — a user cannot join another org.

`tests/security/rls.pentest.test.js` is the regression net: it provisions two throwaway tenants and
proves neither can read or write the other's receipts, categories, suppliers, aliases or settings, join
their org, or reach their files. **A new tenant table, or a new endpoint that reads one, requires a test
here before it ships.**

## Migrations

Schema changes are loose `supabase_*.sql` files in the repo root, each written to
be idempotent, applied by hand in the Supabase SQL editor. `schema_migrations` is
the ledger of which ones actually ran, and `npm run ship` refuses to release when
a file on disk has not been recorded — shipping code whose migration is still
pending is an outage no test catches, because the tests run against a database
where someone happened to run the SQL.

```
npm run migrations                          # applied / pending / changed
npm run migrations -- --mark=<file>.sql     # after running it in the SQL editor
```

The runner deliberately does NOT execute SQL: applying DDL needs a privileged
connection, and an RPC that runs arbitrary SQL would be a far worse hole than the
problem it solves. Moving to `supabase db push` is the eventual fix; it needs the
CLI linked with the database password.

`supabase/migrations/20260609_multi_tenant.sql` was never applied and references
tables that do not exist (July audit). It is dead — delete it rather than run it.

## Known debt (see `docs/ARCHITECTURE-AUDIT-2026.md`)
- ~~Receipt images are base64 in the DB row~~ — closed (C1): images live in Storage, the list carries no
  image bytes. Legacy rows still hold base64 until `npm run cleanup` runs.
- ~~No cross-tenant isolation test~~ — closed (C2), and extended to the supplier tables and Storage.
- `ReceiptsPage.jsx` is a ~2,000-line god component (M2). Its schema "fallback ladders" are now removed.

---

## Engineering Guardrails (BINDING — read before any change)

These rules bind all future work in this repo, to prevent the "vibe-coding" debt found in the July 2026
architecture audit (`docs/ARCHITECTURE-AUDIT-2026.md`).

1. **Root-Cause-First — no band-aids.** Never apply a hot-fix, wrapper, or try/catch fallback that hides
   a defect. Before ANY fix, state the root cause in one sentence. If it is a schema/contract problem,
   fix the schema/contract. (Banned example, live in this repo: the insert "fallback ladder" that retries
   without VAT columns — make the migration authoritative instead.)
2. **SSOT for financial logic.** VAT/currency/itemized totals have exactly ONE implementation. Currency
   lives in `functions/api/_lib/fxRate.js`. Never inline FX math in a component or duplicate it.
3. **Tenant isolation is non-negotiable.** Every query and endpoint scopes the tenant **server-side via
   RLS** using `org_id` — never a client-supplied filter as the sole guard. Service-role queries carry an
   explicit `org_id` predicate. New tenant tables need an isolation test before shipping.
   **Encode every client-supplied value that enters a PostgREST query string.** A raw `#` ends the URL at
   the fragment, so the `&org_id=eq.…` predicate is never sent — and service-role requests have no RLS
   backstop. (This was live in `functions/api/suppliers/*` on 30 Aug 2026.)
   See "Tenant separation" above: tenants are separate businesses, and nothing is shared between them.
4. **No binary blobs in DB rows.** Images/files go to object storage (Supabase Storage) with a path
   reference — never base64 in a text column, and never `select('*')` an image column into a list.
5. **Reject architecture/security-violating requests.** If a request would duplicate financial logic,
   bypass tenant isolation, store blobs in rows, load unbounded lists, or add a band-aid — do NOT
   implement it as asked. Explain the risk and propose the clean alternative first.
6. **Keep components thin.** Pages render; data lives in hooks; domain logic lives in pure helpers.
