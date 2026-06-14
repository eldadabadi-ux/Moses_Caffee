-- ============================================================
-- receipts-app — multi-channel inbound + private file storage
-- Run ONCE in Supabase → SQL Editor → New query → Run.
-- Safe to re-run (idempotent).
-- ============================================================

-- ── receipts: ingestion source, processing status, file pointer, ERP-readiness ──
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS source        text NOT NULL DEFAULT 'manual';
  -- 'manual' | 'scan' | 'email' | 'share' | 'link'
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS status        text NOT NULL DEFAULT 'ready';
  -- 'ready' | 'pending' | 'requires_manual_action' | 'draft' | 'failed'
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS storage_path  text;          -- object key in the private 'receipts' bucket
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS source_meta   jsonb;         -- { sender, subject, source_url, message_id, ... }
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS external_erp_id text;        -- future accounting-system linkage
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS sync_status   text NOT NULL DEFAULT 'not_synced';
  -- 'not_synced' | 'pending' | 'synced' | 'error'

-- Fast lookup of receipts awaiting review (email/link inbound).
CREATE INDEX IF NOT EXISTS receipts_status_idx ON receipts(user_id, status) WHERE status <> 'ready';

-- ── user_settings: per-user opaque inbound email alias ─────────────────────────
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS inbound_alias text;
CREATE UNIQUE INDEX IF NOT EXISTS user_settings_inbound_alias_idx
  ON user_settings(inbound_alias) WHERE inbound_alias IS NOT NULL;

-- ============================================================
-- Private Storage bucket for original receipt files
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', false)
ON CONFLICT (id) DO NOTHING;

-- RLS on storage.objects — a user may only touch files under their own
-- top-level folder ( ${user_id}/... ). Service-role (server) bypasses RLS and
-- writes inbound files to the resolved owner's folder.
DROP POLICY IF EXISTS receipts_files_select ON storage.objects;
CREATE POLICY receipts_files_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'receipts' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS receipts_files_insert ON storage.objects;
CREATE POLICY receipts_files_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'receipts' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS receipts_files_update ON storage.objects;
CREATE POLICY receipts_files_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'receipts' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'receipts' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS receipts_files_delete ON storage.objects;
CREATE POLICY receipts_files_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'receipts' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================
-- After running: the app can store receipt files privately and
-- accept inbound receipts (email/link/share) in later phases.
-- ============================================================
