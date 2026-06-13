-- ============================================================
-- receipts-app — suppliers (contact info overlay on vendors)
-- Run ONCE in Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Cost stats are derived from `receipts`; this table only holds contact info.
-- `name` matches receipts.vendor_name (per user).
-- ============================================================

CREATE TABLE IF NOT EXISTS suppliers (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  phone       text,
  email       text,
  address     text,
  whatsapp    text,
  supplies    text,                       -- free text: what they supply
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One supplier record per (user, name)
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_user_name_idx ON suppliers(user_id, name);
CREATE INDEX IF NOT EXISTS suppliers_user_id_idx ON suppliers(user_id);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_suppliers ON suppliers;
CREATE POLICY own_suppliers ON suppliers
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
