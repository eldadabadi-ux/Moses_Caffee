-- ============================================================
-- receipts-app — Supabase schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ============================================================

-- ── categories ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  parent_id   uuid        REFERENCES categories(id) ON DELETE SET NULL,
  level       int         NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 3),
  sort_order  int         NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS categories_user_id_idx  ON categories(user_id);
CREATE INDEX IF NOT EXISTS categories_parent_id_idx ON categories(parent_id);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_categories ON categories;
CREATE POLICY own_categories ON categories
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── receipts ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS receipts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vendor_name     text,
  receipt_date    date,
  amount          numeric(12,2) NOT NULL DEFAULT 0,
  currency        text         NOT NULL DEFAULT 'ILS',
  category_id     uuid         REFERENCES categories(id) ON DELETE SET NULL,
  category_text   text,                    -- display name for fast rendering
  items           jsonb,                   -- AI-extracted line items
  receipt_image   text,                    -- base64 data URL (JPEG, compressed to 1600px)
  ai_extracted    boolean      NOT NULL DEFAULT false,
  ai_summary      jsonb,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS receipts_user_id_idx      ON receipts(user_id);
CREATE INDEX IF NOT EXISTS receipts_receipt_date_idx  ON receipts(receipt_date DESC);
CREATE INDEX IF NOT EXISTS receipts_archived_at_idx   ON receipts(archived_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS receipts_category_id_idx   ON receipts(category_id);

ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_receipts ON receipts;
CREATE POLICY own_receipts ON receipts
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- After running this script:
-- 1. Go to Authentication → Users → Add user (set email + password)
-- 2. Copy the Project URL and anon key from Settings → API
-- 3. Paste them into .env:
--    VITE_SUPABASE_URL=https://your_project.supabase.co
--    VITE_SUPABASE_ANON_KEY=your-anon-key
-- ============================================================
