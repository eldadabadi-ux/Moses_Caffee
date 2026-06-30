-- ════════════════════════════════════════════════════════════════════════════
-- supabase_mail.sql — connected-mailbox ingestion (Gmail). Run once in the
-- Supabase SQL editor (project dsoucojqjrodxozcbicf). Idempotent.
--
-- Stores ONE connection per user/provider. The refresh token is stored ENCRYPTED
-- (AES-GCM, server-side key) — the DB never holds it in plaintext. Only the
-- server (service-role) reads/writes this table; the browser never sees tokens.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.mail_connections (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  org_id             uuid,
  provider           text not null default 'gmail',           -- 'gmail' | 'outlook'
  email              text,                                     -- the connected mailbox address
  refresh_token_enc  text not null,                            -- AES-GCM(base64) — never plaintext
  last_internal_date bigint default 0,                         -- Gmail internalDate (ms) of last imported msg
  status             text not null default 'active',           -- 'active' | 'error' | 'revoked'
  last_error         text,
  last_scan_at       timestamptz,
  created_at         timestamptz not null default now(),
  unique (user_id, provider)
);

create index if not exists mail_connections_user_idx on public.mail_connections (user_id);

-- RLS: NO client policies — the browser never reads or writes this table (so the
-- encrypted token is never exposed to the client). ALL access is server-side via
-- the service-role key (which bypasses RLS). Connection status is surfaced to the
-- UI through GET /api/mail/status.
alter table public.mail_connections enable row level security;
