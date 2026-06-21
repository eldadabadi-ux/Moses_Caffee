-- ============================================================
-- Stage B4 hardening — guarantee org_id is always set
-- Run ONCE in Supabase → SQL Editor, AFTER supabase_org.sql has run.
--
-- Safe: it auto-fills org_id server-side on every insert (so the client can
-- never create an org-less row), backfills any stragglers, then enforces
-- NOT NULL. Existing data is untouched except for filling missing org_id.
-- ============================================================

-- Auto-fill org_id from the user's membership whenever an insert omits it.
CREATE OR REPLACE FUNCTION fill_org_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.org_id IS NULL THEN
    NEW.org_id := (SELECT org_id FROM memberships WHERE user_id = NEW.user_id LIMIT 1);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS receipts_fill_org_id ON receipts;
CREATE TRIGGER receipts_fill_org_id BEFORE INSERT ON receipts
  FOR EACH ROW EXECUTE FUNCTION fill_org_id();

DROP TRIGGER IF EXISTS categories_fill_org_id ON categories;
CREATE TRIGGER categories_fill_org_id BEFORE INSERT ON categories
  FOR EACH ROW EXECUTE FUNCTION fill_org_id();

-- Backstop: fill any rows that still have a null org_id (there should be none).
UPDATE receipts   r SET org_id = (SELECT org_id FROM memberships m WHERE m.user_id = r.user_id LIMIT 1) WHERE r.org_id IS NULL;
UPDATE categories c SET org_id = (SELECT org_id FROM memberships m WHERE m.user_id = c.user_id LIMIT 1) WHERE c.org_id IS NULL;

-- Now that every row has an org_id (and the trigger keeps it that way), enforce it.
ALTER TABLE receipts   ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE categories ALTER COLUMN org_id SET NOT NULL;

-- Verify: both should return 0.
--   SELECT count(*) FROM receipts   WHERE org_id IS NULL;
--   SELECT count(*) FROM categories WHERE org_id IS NULL;
