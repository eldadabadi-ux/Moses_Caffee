-- ════════════════════════════════════════════════════════════════════════════
-- supabase_installments.sql — credit-card installments (client fixes 18.11.26 §2).
-- receipts.installments = number of monthly payments the document is split into
-- (NULL or 1 = a regular single payment). The document itself stays whole —
-- accounting, VAT and exports keep the document date; ONLY the analytics
-- (dashboard, insights, budgets, bot) spread the amount across the months.
-- Run once in the Supabase SQL editor, then:
--   npm run migrations -- --mark=supabase_installments.sql
-- ════════════════════════════════════════════════════════════════════════════

alter table receipts add column if not exists installments integer;

alter table receipts drop constraint if exists receipts_installments_sane;
alter table receipts add constraint receipts_installments_sane
  check (installments is null or (installments >= 1 and installments <= 60));
