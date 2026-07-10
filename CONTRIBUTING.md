# Contributing — receipts-app ("Moses Coffee")

This project follows two non-negotiable engineering principles. The full, binding rules live in
[`CLAUDE.md` → Engineering Guardrails](./CLAUDE.md) (auto-loaded by Claude Code) and the current
technical-debt map is in [`docs/ARCHITECTURE-AUDIT-2026.md`](./docs/ARCHITECTURE-AUDIT-2026.md).

## The two rules that override everything

1. **SSOT (Single Source of Truth).** Every financial calculation — currency conversion, VAT, itemized
   totals — has exactly one implementation and is imported, never re-typed. Currency lives in
   `functions/api/_lib/fxRate.js`.
2. **Root-Cause-First.** No band-aids, wrappers, or quick-fixes. State the root cause first; fix it at
   the origin (schema / core helper), not the call site.

## Before you (or an AI agent) write code

- **Tenant isolation** is enforced server-side by RLS using `org_id` — never by a client filter alone;
  it is the #1 priority and needs an isolation test for every tenant table.
- **No binary blobs in DB rows** — receipt images/files go to object storage with a path reference.
- **Reject** any request that would duplicate financial logic, bypass isolation, store blobs in rows,
  load unbounded lists, or add a band-aid; propose the clean alternative first.
- **Keep pages thin** — data in hooks, logic in pure helpers, rendering in components.

## Deploy

`npm run deploy` → Cloudflare Pages project `moses-caffee`, branch `master`. Architectural refactors
from the audit are done in severity order (Critical → Major) with a no-behavior-change verification each.
