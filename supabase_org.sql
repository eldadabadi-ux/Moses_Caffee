-- ============================================================
-- Stage B1 — Multi-tenant foundation (organizations + memberships)
-- Run ONCE in Supabase → SQL Editor → New query → Run.
--
-- SAFE / ADDITIVE: this script does NOT remove anything. It adds new tables,
-- a nullable org_id to existing tables, backfills one organization per existing
-- user, and adds membership-based RLS *alongside* the existing user_id RLS.
-- Because multiple permissive policies are OR'd, access is never reduced — the
-- current single-tenant app keeps working unchanged.
--
-- 👉 Recommended: take a backup / DB snapshot before running (Supabase →
--    Database → Backups), as with any migration touching live data.
-- ============================================================

-- ── 1. organizations ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  slug                text UNIQUE,
  plan                text NOT NULL DEFAULT 'pilot',
  features            jsonb NOT NULL DEFAULT '{}'::jsonb,
  logo                text,                              -- base64 data URL (business logo)
  business_name       text,
  vat_rate            numeric(5,2) NOT NULL DEFAULT 18.0,
  subscription_status text NOT NULL DEFAULT 'trialing',  -- trialing|active|past_due|canceled
  trial_ends_at       timestamptz,
  billing_customer_id text,
  owner_id            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ── 2. memberships (user ↔ organization) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS memberships (
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','admin','member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user_id_idx ON memberships(user_id);

-- ── 3. Helper: orgs the current user belongs to ──────────────────────────────
-- SECURITY DEFINER so it can read memberships without tripping memberships' own
-- RLS (prevents recursive policy evaluation). Takes no user input.
CREATE OR REPLACE FUNCTION current_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM memberships WHERE user_id = auth.uid()
$$;

-- ── 4. org_id on existing tables (nullable for now; enforced NOT NULL later) ──
ALTER TABLE receipts      ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE categories    ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS receipts_org_id_idx   ON receipts(org_id);
CREATE INDEX IF NOT EXISTS categories_org_id_idx ON categories(org_id);

-- ── 5. Backfill: one organization per existing user, copy branding, set org_id ─
-- Idempotent: only creates an org for users that don't already have a membership.
DO $$
DECLARE
  u       RECORD;
  new_org uuid;
BEGIN
  FOR u IN
    SELECT DISTINCT uid FROM (
      SELECT user_id AS uid FROM receipts
      UNION SELECT user_id FROM categories
      UNION SELECT user_id FROM user_settings
    ) s
    WHERE s.uid IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = s.uid)
  LOOP
    INSERT INTO organizations (name, business_name, logo, vat_rate, owner_id, plan, subscription_status)
    VALUES (
      COALESCE(NULLIF((SELECT business_name FROM user_settings WHERE user_id = u.uid), ''), 'העסק שלי'),
      (SELECT business_name FROM user_settings WHERE user_id = u.uid),
      (SELECT logo          FROM user_settings WHERE user_id = u.uid),
      COALESCE((SELECT vat_rate FROM user_settings WHERE user_id = u.uid), 18.0),
      u.uid, 'pilot', 'active'
    )
    RETURNING id INTO new_org;

    INSERT INTO memberships (org_id, user_id, role)
    VALUES (new_org, u.uid, 'owner')
    ON CONFLICT DO NOTHING;

    UPDATE receipts      SET org_id = new_org WHERE user_id = u.uid AND org_id IS NULL;
    UPDATE categories    SET org_id = new_org WHERE user_id = u.uid AND org_id IS NULL;
    UPDATE user_settings SET org_id = new_org WHERE user_id = u.uid AND org_id IS NULL;
  END LOOP;
END $$;

-- ── 6. RLS for the new tables ─────────────────────────────────────────────────
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships   ENABLE ROW LEVEL SECURITY;

-- Members can read their organization; members may update its settings (branding,
-- VAT). (Role-restricting updates to owner/admin is a later refinement.)
DROP POLICY IF EXISTS read_own_orgs ON organizations;
CREATE POLICY read_own_orgs ON organizations
  FOR SELECT TO authenticated
  USING (id IN (SELECT current_org_ids()));

DROP POLICY IF EXISTS update_own_orgs ON organizations;
CREATE POLICY update_own_orgs ON organizations
  FOR UPDATE TO authenticated
  USING (id IN (SELECT current_org_ids()))
  WITH CHECK (id IN (SELECT current_org_ids()));

-- Users can see their own membership rows (needed for the client to resolve its
-- org). Inserts/updates to memberships happen server-side (service-role) only.
DROP POLICY IF EXISTS read_own_memberships ON memberships;
CREATE POLICY read_own_memberships ON memberships
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ── 7. Membership-based RLS on data tables — ADDED ALONGSIDE the existing
--       own_receipts / own_categories policies (permissive policies are OR'd,
--       so this only ADDS access for a user to their own org's rows; the
--       user_id policies remain and nothing is reduced). ────────────────────────
DROP POLICY IF EXISTS org_receipts ON receipts;
CREATE POLICY org_receipts ON receipts
  FOR ALL TO authenticated
  USING (org_id IN (SELECT current_org_ids()))
  WITH CHECK (org_id IN (SELECT current_org_ids()));

DROP POLICY IF EXISTS org_categories ON categories;
CREATE POLICY org_categories ON categories
  FOR ALL TO authenticated
  USING (org_id IN (SELECT current_org_ids()))
  WITH CHECK (org_id IN (SELECT current_org_ids()));

-- ============================================================
-- Verify after running:
--   SELECT id, name, business_name FROM organizations;            -- one row per user
--   SELECT * FROM memberships;                                    -- owner row(s)
--   SELECT count(*) FROM receipts   WHERE org_id IS NULL;         -- expect 0
--   SELECT count(*) FROM categories WHERE org_id IS NULL;         -- expect 0
-- The single-tenant app keeps working unchanged. Next step (B2): the app starts
-- reading the org via memberships and branding from organizations.
-- ============================================================
