-- ============================================================
-- Fix — cross-tenant WRITE isolation on org-scoped tables  (v2 — pins BOTH cols)
-- Run ONCE in Supabase → SQL Editor → New query → Run.  Idempotent & safe.
--
-- ROOT CAUSE: `receipts` and `categories` each carry TWO permissive RLS policies
--   OR'd together — own_* (user_id = auth.uid()) and org_* (org_id ∈ current_org_ids()).
--   Because permissive policies are OR'd, a write only has to satisfy ONE of them,
--   so an authenticated user could stamp a row with ANOTHER user's user_id and/or
--   another org's org_id and have that tenant read it. Proven live by
--   tests/security/rls.pentest.test.js.
--
-- FIX (root cause, not a band-aid): on every END-USER write, pin BOTH ownership
--   columns to the caller — user_id = auth.uid(), org_id = the caller's own
--   membership org (or NULL if they have none). A foreign user_id/org_id is then
--   impossible to write, so no row can ever surface in another tenant. Service-role
--   writes (auth.uid() IS NULL — server Functions, seeding, migrations) are left
--   untouched, so nothing server-side changes.
--
-- NOTE: in a future MULTI-user org, pinning user_id on UPDATE would reassign an
--   edited row to the editor. Harmless today (one member per org). The cleaner
--   long-term SSOT is to drop the own_* policies and make org_id the sole
--   boundary once every user is guaranteed a membership — see ARCHITECTURE-AUDIT.
-- ============================================================

CREATE OR REPLACE FUNCTION enforce_own_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  my_org uuid;
BEGIN
  -- Only bind for a real end-user session; service-role (auth.uid() IS NULL)
  -- keeps full control of both columns (server Functions, seeding, migrations).
  IF auth.uid() IS NOT NULL THEN
    SELECT org_id INTO my_org FROM memberships WHERE user_id = auth.uid() LIMIT 1;
    NEW.user_id := auth.uid();   -- cannot attribute the row to another user
    NEW.org_id  := my_org;       -- your own org, or NULL — never a foreign org
  END IF;
  RETURN NEW;
END $$;

-- ── receipts: enforce on both INSERT and UPDATE (replaces the old fill trigger) ─
DROP TRIGGER IF EXISTS receipts_fill_org_id ON receipts;
DROP TRIGGER IF EXISTS receipts_enforce_org ON receipts;
CREATE TRIGGER receipts_enforce_org
  BEFORE INSERT OR UPDATE ON receipts
  FOR EACH ROW EXECUTE FUNCTION enforce_own_org();

-- ── categories: same ─────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS categories_fill_org_id ON categories;
DROP TRIGGER IF EXISTS categories_enforce_org ON categories;
CREATE TRIGGER categories_enforce_org
  BEFORE INSERT OR UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION enforce_own_org();

-- ============================================================
-- VERIFY after running:  npm run test:security   →  expect  # pass 9  # fail 0
-- Existing rows are untouched; only future end-user writes are pinned to the
-- caller. The old fill_org_id() function is left in place (now unused).
-- ============================================================
