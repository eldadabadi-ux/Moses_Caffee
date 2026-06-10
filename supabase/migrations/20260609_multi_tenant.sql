-- ============================================================================
--  Multi-Tenant foundation for receipts-app
--  Mirrors the proven crm-law pattern: tenants + profiles + get_user_tenant_id()
--  + per-tenant RLS + the same SuperAdmin. Adds a NON-BREAKING insert trigger so
--  the current app keeps working before its code is updated.
--
--  APPLY:  Supabase → SQL Editor → paste → Run   (or `supabase db push`).
--  ⚠️ BACK UP FIRST. Idempotent — safe to re-run.
--
--  SuperAdmin (platform owner) = eldadabadi@gmail.com  (same as the CRM).
--  Change every occurrence below if your Supabase login differs.
-- ============================================================================

create extension if not exists pgcrypto;

-- ── 1) tenants ───────────────────────────────────────────────────────────────
create table if not exists public.tenants (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  slug                text unique not null,
  is_active           boolean not null default true,
  -- SaaS fields used by later phases (features / branding / billing):
  plan                text not null default 'pro',
  features            jsonb not null default '{}'::jsonb,
  logo                text,
  business_name       text,
  vat_rate            numeric(5,2) not null default 18,
  subscription_status text not null default 'active',     -- trialing|active|past_due|canceled
  trial_ends_at       timestamptz,
  billing_customer_id text,
  created_at          timestamptz not null default now()
);
alter table public.tenants enable row level security;

drop policy if exists tenants_superadmin on public.tenants;
create policy tenants_superadmin on public.tenants for all to authenticated
  using  (auth.email() = 'eldadabadi@gmail.com')
  with check (auth.email() = 'eldadabadi@gmail.com');

-- ── 2) profiles (one per user → belongs to one tenant) ──────────────────────
create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  email      text,
  full_name  text,
  role       text default 'admin',                        -- owner|admin|member|viewer
  tenant_id  uuid references public.tenants(id),
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;

-- ── 3) tenant-of-current-user helper (SECURITY DEFINER → no RLS recursion) ──
create or replace function public.get_user_tenant_id()
returns uuid language sql stable security definer set search_path = public as $$
  select tenant_id from public.profiles where id = auth.uid()
$$;

drop policy if exists tenants_member_read on public.tenants;
create policy tenants_member_read on public.tenants for select to authenticated
  using (id = public.get_user_tenant_id());

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or tenant_id = public.get_user_tenant_id() or auth.email() = 'eldadabadi@gmail.com');
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or auth.email() = 'eldadabadi@gmail.com');
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated
  with check (id = auth.uid());

-- ── 4) tenant_id on data tables (nullable first) ────────────────────────────
alter table public.receipts   add column if not exists tenant_id uuid references public.tenants(id);
alter table public.categories add column if not exists tenant_id uuid references public.tenants(id);

-- ── 5) Backfill: create tenant #1, profiles for existing users, migrate rows ─
do $$
declare v_tenant uuid;
begin
  insert into public.tenants (name, slug, business_name, plan)
  values ('Moses Caffee', 'moses-caffee', 'מנהל קבלות', 'pro')
  on conflict (slug) do nothing;
  select id into v_tenant from public.tenants where slug = 'moses-caffee';

  insert into public.profiles (id, email, role, tenant_id)
  select u.id, u.email, 'admin', v_tenant
  from auth.users u
  where not exists (select 1 from public.profiles p where p.id = u.id)
  on conflict (id) do nothing;
  update public.profiles   set tenant_id = v_tenant where tenant_id is null;

  update public.receipts   set tenant_id = v_tenant where tenant_id is null;
  update public.categories set tenant_id = v_tenant where tenant_id is null;
end $$;

-- ── 6) Auto-create a profile for every new signup (mirror CRM) ──────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $func$
begin
  insert into public.profiles (id, email, role, tenant_id)
  values (new.id, new.email, 'admin',
    coalesce((new.raw_user_meta_data->>'tenant_id')::uuid,
             (select id from public.tenants where is_active order by created_at limit 1)))
  on conflict (id) do nothing;
  return new;
end $func$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 7) NON-BREAKING: auto-fill tenant_id on data INSERTs (until app sends it) ─
create or replace function public.set_tenant_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tenant_id is null then new.tenant_id := public.get_user_tenant_id(); end if;
  return new;
end $$;
drop trigger if exists receipts_set_tenant   on public.receipts;
drop trigger if exists categories_set_tenant on public.categories;
create trigger receipts_set_tenant   before insert on public.receipts   for each row execute function public.set_tenant_id();
create trigger categories_set_tenant before insert on public.categories for each row execute function public.set_tenant_id();

-- ── 8) Enforce NOT NULL + indexes ───────────────────────────────────────────
alter table public.receipts   alter column tenant_id set not null;
alter table public.categories alter column tenant_id set not null;
create index if not exists receipts_tenant_idx   on public.receipts(tenant_id);
create index if not exists categories_tenant_idx on public.categories(tenant_id);

-- ── 9) Row-Level Security — per-tenant isolation (mirror CRM) ────────────────
alter table public.receipts   enable row level security;
alter table public.categories enable row level security;

drop policy if exists own_receipts on public.receipts;
drop policy if exists receipts_tenant_isolation on public.receipts;
create policy receipts_tenant_isolation on public.receipts for all to authenticated
  using  (tenant_id = public.get_user_tenant_id() or auth.email() = 'eldadabadi@gmail.com')
  with check (tenant_id = public.get_user_tenant_id() or auth.email() = 'eldadabadi@gmail.com');

drop policy if exists own_categories on public.categories;
drop policy if exists categories_tenant_isolation on public.categories;
create policy categories_tenant_isolation on public.categories for all to authenticated
  using  (tenant_id = public.get_user_tenant_id() or auth.email() = 'eldadabadi@gmail.com')
  with check (tenant_id = public.get_user_tenant_id() or auth.email() = 'eldadabadi@gmail.com');

-- ── 10) Append-only audit trail (sensitive actions) ─────────────────────────
create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  tenant_id  uuid, user_id uuid, action text not null, target text, ip text, meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_tenant_idx on public.audit_log(tenant_id, created_at desc);
alter table public.audit_log enable row level security;
drop policy if exists audit_tenant_read on public.audit_log;
create policy audit_tenant_read on public.audit_log for select to authenticated
  using (tenant_id = public.get_user_tenant_id() or auth.email() = 'eldadabadi@gmail.com');

-- ============================================================================
--  After running: existing data → "Moses Caffee" tenant; existing user gets a
--  profile in it; the current app keeps working (RLS allows the user's tenant,
--  the trigger fills tenant_id). Next: port `useTenant` from the CRM, gate
--  features, add domains + Israeli billing. Service-role Functions MUST scope
--  every query by tenant_id (service-role bypasses RLS).
-- ============================================================================
