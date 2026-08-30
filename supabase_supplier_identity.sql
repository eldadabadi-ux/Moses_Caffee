-- ============================================================================
-- supabase_supplier_identity.sql — שכבת זהות לספקים (audit R1)
--
-- להריץ ב-Supabase SQL Editor (Run). בטוח להריץ יותר מפעם אחת (idempotent).
--
-- ROOT CAUSE שהקובץ הזה סוגר: `receipts.vendor_name` הוא טקסט חופשי שמודל ה-OCR
-- כותב מחדש בכל סריקה, ולכן ספק אחד מתפצל להרבה רשומות ("קטיף"/"קתוף"/"קמץ",
-- "מיזן"/"מייזן", "י.י. אגס"/"אגס"). כל סינון, השוואה, תובנה ודו"ח שנבנים מעל
-- מחרוזת כזו שגויים מיסודם.
--
-- FIX: `suppliers` הופכת לישות קנונית עם מפתח אמיתי; `receipts.supplier_id`
-- מצביע אליה; ו-`supplier_aliases` זוכרת כל איות שראינו וקישרנו — כך שכל
-- אישור של המשתמש מלמד את המערכת ולא חוזר על עצמו.
--
-- EXPAND/CONTRACT: הקובץ הזה רק *מוסיף*. `vendor_name` נשאר על השורה כמקור
-- אמת לתצוגה עד שכל הקריאות עברו ל-supplier_id; אין כאן שום שינוי שובר.
-- ============================================================================

-- ── 1. suppliers — ישות קנונית ────────────────────────────────────────────────
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS org_id       uuid REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS merged_into  uuid REFERENCES suppliers(id)     ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_from text DEFAULT 'manual';

COMMENT ON COLUMN suppliers.org_id       IS 'תחום הארגון (canonical tenant scope)';
COMMENT ON COLUMN suppliers.merged_into  IS 'אם הספק מוזג לספק אחר — היעד. NULL = ספק פעיל';
COMMENT ON COLUMN suppliers.created_from IS 'manual | scan | merge';

-- מילוי לאחור: כל ספק קיים מקבל את הארגון של בעליו.
UPDATE suppliers s
   SET org_id = m.org_id
  FROM memberships m
 WHERE m.user_id = s.user_id
   AND s.org_id IS NULL;

CREATE INDEX IF NOT EXISTS suppliers_org_id_idx      ON suppliers(org_id);
CREATE INDEX IF NOT EXISTS suppliers_merged_into_idx ON suppliers(merged_into) WHERE merged_into IS NOT NULL;

-- ── 2. supplier_aliases — כל איות שראינו וקישרנו ─────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_aliases (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id  uuid        NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id       uuid        REFERENCES organizations(id) ON DELETE CASCADE,
  alias        text        NOT NULL,          -- כפי שנסרק, לתצוגה
  alias_norm   text        NOT NULL,          -- normalizeVendor() — מפתח ההתאמה
  source       text        NOT NULL DEFAULT 'scan_confirmed',  -- scan_confirmed | merge | manual
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  supplier_aliases      IS 'איותים חלופיים של שם ספק — נלמדים מאישורי המשתמש';
COMMENT ON COLUMN supplier_aliases.alias_norm IS 'תוצאת normalizeVendor() ב-functions/api/_lib/supplierMatch.js';

-- איות מנורמל אחד מצביע על ספק אחד בלבד, לכל משתמש.
CREATE UNIQUE INDEX IF NOT EXISTS supplier_aliases_user_norm_idx ON supplier_aliases(user_id, alias_norm);
CREATE INDEX IF NOT EXISTS supplier_aliases_supplier_idx ON supplier_aliases(supplier_id);
CREATE INDEX IF NOT EXISTS supplier_aliases_org_idx      ON supplier_aliases(org_id);

-- ── 3. receipts.supplier_id — הקישור עצמו ────────────────────────────────────
ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL;

COMMENT ON COLUMN receipts.supplier_id IS
  'הספק הקנוני. vendor_name נשאר כטקסט שנסרק בפועל (מקור אמת לתצוגה עד להשלמת המעבר).';

CREATE INDEX IF NOT EXISTS receipts_supplier_id_idx ON receipts(supplier_id) WHERE supplier_id IS NOT NULL;

-- ── 4. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE supplier_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_supplier_aliases ON supplier_aliases;
CREATE POLICY own_supplier_aliases ON supplier_aliases
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS org_supplier_aliases ON supplier_aliases;
CREATE POLICY org_supplier_aliases ON supplier_aliases
  FOR ALL TO authenticated
  USING (org_id IN (SELECT current_org_ids()))
  WITH CHECK (org_id IN (SELECT current_org_ids()));

-- suppliers כבר היתה user-scoped בלבד; מוסיפים את שכבת הארגון כמו בשאר הטבלאות.
DROP POLICY IF EXISTS org_suppliers ON suppliers;
CREATE POLICY org_suppliers ON suppliers
  FOR ALL TO authenticated
  USING (org_id IN (SELECT current_org_ids()))
  WITH CHECK (org_id IN (SELECT current_org_ids()));

-- ── 5. בידוד כתיבה — אותו trigger שמגן על receipts/categories ─────────────────
-- בלעדיו משתמש יכול היה לכתוב שורה עם user_id/org_id של דייר אחר, כי מדיניות
-- permissive מחוברות ב-OR (ראה supabase_rls_org_enforce.sql).
DROP TRIGGER IF EXISTS suppliers_enforce_org ON suppliers;
CREATE TRIGGER suppliers_enforce_org
  BEFORE INSERT OR UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION enforce_own_org();

DROP TRIGGER IF EXISTS supplier_aliases_enforce_org ON supplier_aliases;
CREATE TRIGGER supplier_aliases_enforce_org
  BEFORE INSERT OR UPDATE ON supplier_aliases
  FOR EACH ROW EXECUTE FUNCTION enforce_own_org();

-- ============================================================================
-- אימות אחרי הרצה:
--   SELECT count(*) FROM suppliers WHERE org_id IS NULL;   -- expect 0
--   SELECT count(*) FROM supplier_aliases;                 -- 0 עד המיזוג הראשון
--   npm run test:security                                  -- expect pass, 0 fail
-- ============================================================================
