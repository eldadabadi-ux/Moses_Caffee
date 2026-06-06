-- ============================================================
-- user_settings — enables cross-device sync of logo + all settings.
-- Run ONCE in Supabase → SQL Editor → New query → Run.
-- After this, the logo/VAT/reminder you set on one device appear on all devices.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_settings (
  user_id         uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  vat_rate        numeric(5,2) NOT NULL DEFAULT 18.0,
  show_with_vat   boolean      NOT NULL DEFAULT true,
  logo            text,                 -- base64 data URL of the business logo
  business_name   text,
  reminder_timing text         DEFAULT 'start',  -- 'start' | 'mid' | 'end'
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

-- If the table already existed without the newer columns, add them:
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS logo            text;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS business_name   text;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS reminder_timing text DEFAULT 'start';

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_settings ON user_settings;
CREATE POLICY own_settings ON user_settings
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
