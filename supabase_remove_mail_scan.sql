-- ════════════════════════════════════════════════════════════════════════════
-- supabase_remove_mail_scan.sql — retire the Gmail/Outlook OAuth mail-scan
-- channel (17.11.2026). The self-service inbound address (@eldadai.co.il →
-- Email Worker → /api/inbound) replaces it; the OAuth scanner, its cron and its
-- connections table are no longer referenced by any code.
-- Run once in the Supabase SQL editor, then:
--   npm run migrations -- --mark=supabase_remove_mail_scan.sql
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Stop the half-hourly scan ping (job created by supabase_mail_cron.sql).
select cron.unschedule('mail-scan')
where exists (select 1 from cron.job where jobname = 'mail-scan');

-- 2) Drop the OAuth connections table (verified empty before removal — the
--    single stale row, a dead gmail connection, was deleted on 17.11.2026).
drop table if exists mail_connections;
