-- ════════════════════════════════════════════════════════════════════════════
-- supabase_mail_cron.sql — schedule automatic mailbox scanning every 30 minutes,
-- entirely inside Supabase (no GitHub Action / Cloudflare Worker needed). This is
-- the simplest scheduler: it just pings the already-deployed /api/mail/cron.
-- Run once in the Supabase SQL editor (project dsoucojqjrodxozcbicf).
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Enable the scheduler + HTTP extensions (Database → Extensions, or here):
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2) Schedule the scan. ⚠️ Replace <<CRON_SECRET>> with the SAME value you set as
--    the CRON_SECRET environment variable on the Cloudflare Pages project
--    "moses-caffee". (Re-running this block updates the schedule.)
select cron.unschedule('mail-scan') where exists (select 1 from cron.job where jobname = 'mail-scan');

select cron.schedule(
  'mail-scan',
  '*/30 * * * *',
  $$
  select net.http_post(
    url     := 'https://moses-caffee.pages.dev/api/mail/cron',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<<CRON_SECRET>>')
  );
  $$
);

-- To stop automatic scanning later:  select cron.unschedule('mail-scan');
