# Architecture & Quality Audit — receipts-app ("Moses Coffee")

**Date:** 7 July 2026 · **Auditor role:** Senior Staff Engineer
**Scope:** Frontend (`src/`), Backend (`functions/api/`), DB interaction layer.
**Principles enforced:** SSOT (single source for every financial calc) · Root-Cause-First (no band-aids).

> **Status: this is a read-only blueprint. No code has been changed.** Refactoring waits for your
> approval, per severity order below.

> **Update — 8 Jul 2026 (execution kickoff).** Re-verified against the live DB and the ISO‑27001 work done since:
> - **Guardrails (Step 4) are now in place** — `CLAUDE.md` carries the binding "Engineering Guardrails" section.
> - **C1 partially mitigated** — S1.4 moved *new* scans to Supabase Storage (`storage_path` + a tiny inline
>   thumbnail). Still open: the list query is still `select('*')`, there is still no pagination, and legacy
>   base64 receipts were not back‑filled.
> - **C2 tenancy model verified LIVE = `org_id` / `memberships` / `current_org_ids()`.** The `tenant_id` variant in
>   `supabase/migrations/20260609_multi_tenant.sql` was **never applied** (no `tenants`/`profiles` tables in the DB) —
>   it is a dead, contradictory migration and should be deleted (schema‑level SSOT footgun). The cross‑tenant
>   isolation test C2 calls for now lives at **`tests/security/rls.pentest.test.js`** (run: `npm run test:security`).
> - **C2 CLOSED — a live vulnerability was found and fixed.** The new test caught a real **cross-tenant write leak**:
>   because `receipts`/`categories` carry two OR'd permissive policies (`own_*` by `user_id`, `org_*` by `org_id`), an
>   authenticated user could write a row stamped with another tenant's `user_id`/`org_id` that the other tenant could
>   then read. Fixed at the root in **`supabase_rls_org_enforce.sql`** — an `enforce_own_org` trigger pins both
>   ownership columns to the caller on every end-user write. Isolation suite now passes **9/9**. Cleaner long-term
>   SSOT: drop the `own_*` policies once every user is guaranteed a membership.

---

## Executive summary

receipts-app has a **clean currency/classification core** but two **structural liabilities that hurt
the highest-priority concerns**: receipt images live as base64 **inside DB rows** and the main list
loads **all of them at once**, and there is **no automated cross-tenant isolation test** despite this
being multi-client financial data.

| Dimension | Verdict |
|---|---|
| Step 1 — SSOT / DRY | 🟢 currency + classification are SSOT · 🟠 god component, schema band-aids |
| Step 2 — Multi-tenancy / Security | 🔴 RLS present but **unverified** (no pentest) · mixed user_id/org_id model |
| Step 3 — Scalability / Performance | 🔴 base64 images in-row + load-all list |
| Step 4 — Guardrails | 🔴 no `CLAUDE.md` at all |

---

## CRITICAL

### C1 — Receipt images stored base64 in-row **and** the list loads them all
- **Location:** schema `receipts.receipt_image text` (base64 JPEG) + `src/pages/ReceiptsPage.jsx:576`
  → `.from('receipts').select('*').is('archived_at', null)` (no column projection, no pagination).
- **Problem:** every visit to the receipts list pulls **every** receipt row **including full-resolution
  base64 images** into browser memory. At a few hundred receipts this is tens/hundreds of MB per load →
  memory exhaustion, slow first paint, huge egress. This is the single biggest scalability risk.
- **Root cause:** binary data in a text column (should be object storage) + `select('*')` + no paging.
- **Refactor (root cause):** move images to **Supabase Storage** (bucket + signed URLs; keep a
  `receipt_image_path` column), migrate existing rows off `receipt_image`, then change the list to
  **projected columns only** (no image) with **keyset pagination** and lazy-loaded thumbnails.

### C2 — No automated cross-tenant isolation test (highest-priority property is unverified)
- **Location:** RLS exists (`supabase_schema.sql`, `supabase_org.sql` — `user_id`/`org_id` + `current_org_ids()`),
  but there is **no** equivalent of crm-law's `tests/security/rls.pentest.test.js`.
- **Problem:** isolation of multiple clients' financial records is the stated #1 priority, yet nothing
  proves tenant A can't read tenant B. A single mis-scoped policy or service-role query would leak
  silently.
- **Root cause:** missing test coverage for the isolation invariant; also a **mixed tenancy model**
  (`user_id` on original tables, `org_id` added later) that is easy to get wrong per query.
- **Refactor (root cause):** add a two-tenant `org_id` pentest (sign in as A, assert 0 rows / denied on
  B's `receipts`/`categories`/`user_settings` for SELECT/UPDATE/INSERT-with-foreign-org); add a
  SECURITY DEFINER audit for functions selecting tenant tables without an `org_id` predicate. Decide
  one canonical scope (`org_id`) and make every policy + service-role query use it.

---

## MAJOR

### M1 — Band-aid "fallback ladder" around uncertain schema columns
- **Location:** `src/pages/ReceiptsPage.jsx` inserts/updates (~lines 1011-1017, 1084-1100): try with
  `vatCols`+`docCols` → on error retry with `vatCols` → on error retry without.
- **Problem:** this is exactly the banned pattern — code guessing whether DB columns exist and silently
  degrading. It hides schema drift and can write inconsistent rows (some with VAT cols, some without).
- **Root cause:** the VAT/`doc_type` migration isn't guaranteed applied in every environment, so code
  defends against a missing schema instead of the schema being authoritative.
- **Refactor (root cause):** make the migration the source of truth — apply it in all environments,
  verify columns exist, then **delete the fallback ladder** and write a single deterministic insert.

### M2 — "God component" ReceiptsPage
- **Location:** `src/pages/ReceiptsPage.jsx` (**2,049** lines) mixes data access, VAT column handling,
  category-tree loading, insert/update, and full UI.
- **Root cause:** no layering (data hooks / domain logic / presentation).
- **Refactor:** extract `useReceipts` (data + pagination), a `receiptWrite` service (single insert/update
  path), and presentational sub-components.

### M3 — Two extraction paths with different privacy profiles
- **Location:** client `src/lib/ocrService.js` (local Tesseract, "no external AI") **vs** server
  `functions/api/scan-receipt.js` (Gemini — sends the image to Google).
- **Problem:** the privacy story ("local OCR, nothing leaves the device") and the Gemini path coexist
  without a single documented canonical route → SSOT-of-behaviour and privacy ambiguity.
- **Refactor:** decide the canonical extraction path; if Gemini is used, document consent + reconcile
  the "local only" claim; share one extraction result contract between paths.

---

## OPTIMIZATION

- **O1 — Currency SSOT is correct** (`functions/api/_lib/fxRate.js`, Bank-of-Israel official rate).
  Keep; add a guardrail forbidding a second FX implementation client-side.
- **O2 — Category naming** `src/lib/categoryNormalize.js` (client) vs deterministic
  `functions/api/_lib/classifyReceipt.js` (server) — verify canonicalisation can't drift; consider a
  shared constant list.
- **O3 — Dashboard aggregation** (`src/lib/categoryStats.js`) is client-side; `pageCache.js`/`prefetch.js`
  already help. At scale, prefer server summary tables.
- **O4 — Pagination is used in 9 spots** but not the main receipts list (C1) — standardise one paging
  helper across list views.

## What is already good (do not "fix")
- Currency SSOT (`fxRate.js`); local-first OCR option; category classification separated
  (client orchestrates, server classifies with a deterministic safety net); rate limiting + auth on
  endpoints; security headers.

## Approval gate
On approval, refactoring proceeds **C1 → C2 → M1**, each with a root-cause explanation and a
no-behavior-change verification (build + new isolation test + spot-check scan/list/totals).
