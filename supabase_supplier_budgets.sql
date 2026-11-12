-- ============================================================================
-- supabase_supplier_budgets.sql — תקציב לספק (דרישת לקוח 11.11.26, סעיף 1)
--
-- להריץ ב-Supabase SQL Editor. בטוח להריץ יותר מפעם אחת (idempotent).
--
-- הלקוח סוגר עם ספק תקציב שנתי/רבעוני/חודשי בתחילת התקופה; כל מסמך הוצאה
-- (קבלה/תעודת משלוח) מוריד מהיתרה. הניצול עצמו **לא** נשמר כאן — הוא נגזרת
-- של הקבלות ומחושב בקריאה (SSOT כספי: המקור היחיד לסכומים הוא receipts).
-- הטבלה מחזיקה רק את ההגדרה: סכום, תקופה, וסף ההתראה שהלקוח בחר.
--
-- תקציב אחד פעיל לספק (UNIQUE user_id+supplier_id) — שינוי תקופה/סכום הוא
-- עדכון של אותה שורה, לא שורה חדשה, כך שאין "תקציבים כפולים" מתחרים.
-- ============================================================================

CREATE TABLE IF NOT EXISTS supplier_budgets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id       uuid REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id  uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,

  period       text    NOT NULL DEFAULT 'monthly',   -- monthly | quarterly | annual
  amount       numeric NOT NULL,                     -- the budget for one period, ILS
  alert_pct    integer NOT NULL DEFAULT 80,          -- % used that fires the warning

  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_budgets_period_chk') THEN
    ALTER TABLE supplier_budgets ADD CONSTRAINT supplier_budgets_period_chk
      CHECK (period IN ('monthly', 'quarterly', 'annual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_budgets_amount_chk') THEN
    ALTER TABLE supplier_budgets ADD CONSTRAINT supplier_budgets_amount_chk
      CHECK (amount > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_budgets_alert_chk') THEN
    ALTER TABLE supplier_budgets ADD CONSTRAINT supplier_budgets_alert_chk
      CHECK (alert_pct BETWEEN 1 AND 100);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS supplier_budgets_one_per_supplier
  ON supplier_budgets(user_id, supplier_id);
CREATE INDEX IF NOT EXISTS supplier_budgets_org_idx ON supplier_budgets(org_id);

-- אותה עמדת בידוד כמו כל טבלת דייר: RLS לשני הכיוונים, ועוד ה-trigger שמצמיד
-- בעלות בכתיבה של משתמש קצה (מדיניות permissive מחוברות ב-OR, כך ש-RLS לבדה
-- לא מונעת org_id זר בכתיבה).
ALTER TABLE supplier_budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_supplier_budgets ON supplier_budgets;
CREATE POLICY own_supplier_budgets ON supplier_budgets
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS org_supplier_budgets ON supplier_budgets;
CREATE POLICY org_supplier_budgets ON supplier_budgets
  FOR ALL TO authenticated
  USING (org_id IN (SELECT current_org_ids()))
  WITH CHECK (org_id IN (SELECT current_org_ids()));

DROP TRIGGER IF EXISTS supplier_budgets_enforce_org ON supplier_budgets;
CREATE TRIGGER supplier_budgets_enforce_org
  BEFORE INSERT OR UPDATE ON supplier_budgets
  FOR EACH ROW EXECUTE FUNCTION enforce_own_org();

-- ============================================================================
-- אימות: npm run test:security  (הבדיקות מכסות גם את הטבלה הזו)
-- ============================================================================
