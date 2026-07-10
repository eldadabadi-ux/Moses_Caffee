# receipts-app ("Moses Coffee") — Claude Working Rules

## Architecture quick reference
- **Frontend:** React 19 + Vite + Tailwind (PWA).
- **Backend:** Cloudflare Pages Functions (`functions/api/`) + Supabase (Postgres + RLS + Auth).
- **Deploy:** `npm run deploy` → Cloudflare Pages project `moses-caffee`, branch `master`.
  **OpenNext/native tooling note:** builds/deploys for the sister site run from WSL; keep Node tooling
  consistent.
- **Multi-tenant:** `org_id` (via `organizations` + `memberships` + `current_org_ids()`), layered over
  the original `user_id` scoping. **`org_id` is the canonical tenant scope.**
- **OCR:** local Tesseract (`src/lib/ocrService.js`) is the privacy-first path; `functions/api/scan-receipt.js`
  uses Gemini. Know which path a change touches (see audit M3).

## Canonical modules (SSOT — never duplicate)
- **Currency:** `functions/api/_lib/fxRate.js` (Bank of Israel official rate). No client-side FX.
- **Classification:** client `src/lib/recategorize.js` orchestrates; server `functions/api/recategorize.js`
  + `_lib/classifyReceipt.js` classify. Don't add a third categorization path.
- **Category naming:** `src/lib/categoryNormalize.js`.

## Known debt (see `docs/ARCHITECTURE-AUDIT-2026.md`)
- Receipt images are base64 **in the DB row** and the list loads them all (Critical — moving to Storage).
- No cross-tenant isolation test yet (Critical — highest priority to add).
- `ReceiptsPage.jsx` is a 2,000-line god component with a schema "fallback ladder" (band-aid).

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
4. **No binary blobs in DB rows.** Images/files go to object storage (Supabase Storage) with a path
   reference — never base64 in a text column, and never `select('*')` an image column into a list.
5. **Reject architecture/security-violating requests.** If a request would duplicate financial logic,
   bypass tenant isolation, store blobs in rows, load unbounded lists, or add a band-aid — do NOT
   implement it as asked. Explain the risk and propose the clean alternative first.
6. **Keep components thin.** Pages render; data lives in hooks; domain logic lives in pure helpers.
