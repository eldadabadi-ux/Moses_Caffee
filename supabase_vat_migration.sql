-- ============================================================
-- VAT Migration — run this in Supabase SQL Editor
-- Adds VAT breakdown columns to receipts + user_settings table
-- ============================================================

-- 1. Add VAT columns to receipts
ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS amount_before_vat numeric(12,2),
  ADD COLUMN IF NOT EXISTS vat_amount         numeric(12,2),
  ADD COLUMN IF NOT EXISTS vat_rate           numeric(5,2) DEFAULT 18.0;

-- 2. Back-fill existing receipts (assume 18% VAT)
UPDATE receipts
SET vat_rate          = 18.0,
    amount_before_vat = ROUND(amount / 1.18, 2),
    vat_amount        = ROUND(amount - amount / 1.18, 2)
WHERE amount_before_vat IS NULL
  AND amount > 0;

-- 3. User settings table (VAT rate + display preference)
CREATE TABLE IF NOT EXISTS user_settings (
  user_id       uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  vat_rate      numeric(5,2) NOT NULL DEFAULT 18.0,
  show_with_vat boolean      NOT NULL DEFAULT true,
  updated_at    timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_settings ON user_settings;
CREATE POLICY own_settings ON user_settings
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
