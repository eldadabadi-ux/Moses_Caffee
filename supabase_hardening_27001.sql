-- ============================================================================
-- supabase_hardening_27001.sql — ISO/IEC 27001:2022 hardening (S1.1)
-- Controls: A.8.3 (tenant separation), A.8.2/A.9.2 (least privilege), A.8.7 (integrity)
--
-- Run ONCE in Supabase → SQL Editor, AFTER supabase_org.sql.
-- Safe & idempotent (re-runnable). Take a DB backup first (Dashboard → Database → Backups).
-- Self-contained: (re)creates the fill_org_id() trigger fn and current_org_ids()
-- helper if they don't already exist, so it does NOT depend on the optional
-- supabase_org_hardening.sql having been run.
-- ============================================================================

-- ── 0. Ensure the shared helpers exist (idempotent CREATE OR REPLACE) ────────
-- current_org_ids(): orgs the current user belongs to (used by RLS policies).
CREATE OR REPLACE FUNCTION current_org_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT org_id FROM memberships WHERE user_id = auth.uid() $$;

-- fill_org_id(): auto-fills org_id from the user's membership on insert.
CREATE OR REPLACE FUNCTION fill_org_id()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.org_id IS NULL THEN
    NEW.org_id := (SELECT org_id FROM memberships WHERE user_id = NEW.user_id LIMIT 1);
  END IF;
  RETURN NEW;
END $$;

-- ── 1. suppliers → org-aware (A.8.3 multi-tenant separation) ────────────────
-- Adds org_id, auto-fills it server-side (so the client can't create an org-less
-- row), and makes suppliers visible org-wide (in addition to the owning user).
-- The (user_id, name) unique index is KEPT so the existing upsert keeps working.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS suppliers_org_id_idx ON suppliers(org_id);

-- Auto-fill org_id on insert (reuses the shared trigger function).
DROP TRIGGER IF EXISTS suppliers_fill_org_id ON suppliers;
CREATE TRIGGER suppliers_fill_org_id BEFORE INSERT ON suppliers
  FOR EACH ROW EXECUTE FUNCTION fill_org_id();

-- Backfill any existing rows.
UPDATE suppliers s SET org_id = (SELECT org_id FROM memberships m WHERE m.user_id = s.user_id LIMIT 1)
  WHERE s.org_id IS NULL;

-- Org-scoped read/write (in addition to the existing own_suppliers user policy).
DROP POLICY IF EXISTS org_suppliers ON suppliers;
CREATE POLICY org_suppliers ON suppliers
  FOR ALL TO authenticated
  USING (org_id IN (SELECT current_org_ids()))
  WITH CHECK (org_id IN (SELECT current_org_ids()));

-- ── 2. user_settings → guarantee org_id (A.8.3) ─────────────────────────────
-- Auto-fill on insert + backstop existing rows, then enforce NOT NULL.
DROP TRIGGER IF EXISTS user_settings_fill_org_id ON user_settings;
CREATE TRIGGER user_settings_fill_org_id BEFORE INSERT ON user_settings
  FOR EACH ROW EXECUTE FUNCTION fill_org_id();

UPDATE user_settings u SET org_id = (SELECT org_id FROM memberships m WHERE m.user_id = u.user_id LIMIT 1)
  WHERE u.org_id IS NULL;

-- Only enforce NOT NULL if there are no stragglers left (avoids failing on a
-- user who has no membership yet — should never happen after the backfill).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_settings WHERE org_id IS NULL) THEN
    ALTER TABLE user_settings ALTER COLUMN org_id SET NOT NULL;
  END IF;
END $$;

-- ── 3. Least privilege on SECURITY DEFINER helpers (A.8.2 / A.9.2) ──────────
-- current_org_ids() is needed by authenticated users' RLS; anon/public don't.
REVOKE EXECUTE ON FUNCTION current_org_ids()  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION current_org_ids()  TO authenticated;
REVOKE EXECUTE ON FUNCTION fill_org_id()      FROM PUBLIC;  -- trigger-only; defensive

-- ── 4. Data-integrity constraint (A.8.7) ────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'receipts_amount_nonneg_chk') THEN
    ALTER TABLE receipts ADD CONSTRAINT receipts_amount_nonneg_chk CHECK (amount >= 0);
  END IF;
END $$;

-- Verify (all should return 0):
--   SELECT count(*) FROM suppliers     WHERE org_id IS NULL;
--   SELECT count(*) FROM user_settings WHERE org_id IS NULL;
