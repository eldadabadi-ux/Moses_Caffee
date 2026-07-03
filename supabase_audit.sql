-- ============================================================================
-- supabase_audit.sql — append-only, hash-chained audit log (S1.2)
-- Controls: A.8.15 (logging), A.8.16 (monitoring), A.8.7 (integrity / tamper-evidence)
--
-- Run ONCE in Supabase → SQL Editor (after supabase_org.sql). Idempotent.
-- Writes happen server-side only (service-role, in Cloudflare Functions); the
-- client can READ its own org's entries but can never INSERT/UPDATE/DELETE.
-- Each row hashes the previous row's hash → any edit/delete breaks the chain.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS audit_log (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id     uuid        REFERENCES organizations(id) ON DELETE SET NULL,
  user_id    uuid,                       -- actor (no FK: survives user deletion for the trail)
  action     text        NOT NULL,       -- e.g. 'customer_onboarded', 'account_deleted'
  target     text,                       -- opaque id/label of the affected object
  meta       jsonb,                      -- small, PII-free context
  prev_hash  text,
  row_hash   text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_org_idx     ON audit_log(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log(created_at DESC);

-- ── Hash-chain trigger (tamper-evidence) ────────────────────────────────────
-- SECURITY DEFINER + pinned search_path. An advisory lock serialises appends so
-- concurrent inserts can't fork the chain.
CREATE OR REPLACE FUNCTION audit_log_chain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE prev text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit_log_chain'));
  NEW.created_at := COALESCE(NEW.created_at, now());
  prev := (SELECT row_hash FROM audit_log ORDER BY id DESC LIMIT 1);
  NEW.prev_hash := prev;
  NEW.row_hash := encode(digest(
    COALESCE(prev,'') || COALESCE(NEW.action,'') || COALESCE(NEW.target,'') ||
    COALESCE(NEW.meta::text,'') || COALESCE(NEW.user_id::text,'') ||
    COALESCE(NEW.org_id::text,'') || NEW.created_at::text,
    'sha256'), 'hex');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS audit_log_chain_trg ON audit_log;
CREATE TRIGGER audit_log_chain_trg BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_chain();

-- ── RLS: members read their org's log; nobody (authenticated) writes it ──────
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS read_org_audit ON audit_log;
CREATE POLICY read_org_audit ON audit_log
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT current_org_ids()));
-- No INSERT/UPDATE/DELETE policies → deny-all for authenticated. Service-role
-- (server-side) bypasses RLS to append entries.

-- Block direct edits/deletes even by the table owner via SQL, keeping it
-- append-only from the app's perspective (service-role can still insert).
REVOKE UPDATE, DELETE ON audit_log FROM authenticated, anon;

-- ── Integrity verifier: recompute the whole SHA-256 chain ───────────────────
-- Returns ok=false + the first offending row id if ANY row's content was edited
-- or a link broken. Recomputes with the exact same formula as the trigger, using
-- Postgres' own jsonb::text so serialisation matches byte-for-byte (a JS recompute
-- can't guarantee that). Server-side only (called via service-role RPC).
CREATE OR REPLACE FUNCTION verify_audit_chain()
RETURNS TABLE(ok boolean, broken_id bigint, checked bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  r      audit_log%ROWTYPE;
  prev   text := '';
  expect text;
  n      bigint := 0;
BEGIN
  FOR r IN SELECT * FROM audit_log ORDER BY id ASC LOOP
    n := n + 1;
    -- 1) linkage: prev_hash must equal the previous row's row_hash
    IF coalesce(r.prev_hash, '') <> prev THEN
      ok := false; broken_id := r.id; checked := n; RETURN NEXT; RETURN;
    END IF;
    -- 2) content: recompute this row's hash and compare
    expect := encode(digest(
      coalesce(r.prev_hash,'') || coalesce(r.action,'') || coalesce(r.target,'') ||
      coalesce(r.meta::text,'') || coalesce(r.user_id::text,'') ||
      coalesce(r.org_id::text,'') || r.created_at::text, 'sha256'), 'hex');
    IF r.row_hash IS DISTINCT FROM expect THEN
      ok := false; broken_id := r.id; checked := n; RETURN NEXT; RETURN;
    END IF;
    prev := r.row_hash;
  END LOOP;
  ok := true; broken_id := NULL; checked := n; RETURN NEXT;
END $$;

REVOKE ALL   ON FUNCTION verify_audit_chain() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION verify_audit_chain() TO service_role;

-- Verify chain continuity (should return 0 broken links):
--   SELECT count(*) FROM (
--     SELECT row_hash, LAG(row_hash) OVER (ORDER BY id) AS prev_actual, prev_hash
--     FROM audit_log
--   ) t WHERE prev_hash IS DISTINCT FROM prev_actual AND id > (SELECT min(id) FROM audit_log);
