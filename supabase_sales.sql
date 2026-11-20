-- ============================================================================
-- supabase_sales.sql — צד ההכנסות (בקשת לקוח 20.11.26)
--
-- להריץ ב-Supabase SQL Editor. בטוח להריץ יותר מפעם אחת (idempotent).
--
-- ⚠️ תוספת בלבד: הסקריפט יוצר שתי טבלאות חדשות ואינו נוגע באף טבלה קיימת,
-- באף עמודה ובאף שורה. זהו תנאי מחייב (הנחיה 7 ב-CLAUDE.md) — מודול חדש אינו
-- יכול לפגוע בלקוח קיים. המודול כבוי כברירת מחדל, ולכן גם לאחר ההרצה שום לקוח
-- לא יראה דבר עד שיודלק לו הדגל `sales` בקונסולת הניהול.
--
-- שתי רמות פירוט, כמו היחס בין קבלה לפריטיה:
--   sales_days  — שורה אחת ליום עסקים. תמיד קיימת (הזנה ידנית או דוח קופה).
--   sales_lines — פריט שנמכר, אופציונלי. קיים רק כשמקור הנתונים יודע לפרט.
-- כשקיימות שורות ליום, הסכום היומי נגזר מהן בזמן קריאה ולעולם אינו נשמר פעמיים
-- (אותה עמדת SSOT כמו installments.js).
-- ============================================================================

CREATE TABLE IF NOT EXISTS sales_days (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id         uuid REFERENCES organizations(id) ON DELETE CASCADE,

  business_date  date NOT NULL,
  gross          numeric NOT NULL DEFAULT 0,      -- מחזור כולל מע"מ
  vat            numeric,                          -- מע"מ, כשידוע
  transactions   integer,                          -- מספר עסקאות
  by_payment     jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {cash, card, other}

  -- מאיפה הגיע היום הזה: הזנה ידנית, דוח סגירה שנקלט, ייבוא קובץ או API.
  source         text NOT NULL DEFAULT 'manual',
  storage_path   text,                             -- הדוח המקורי, אם נשמר
  book           text NOT NULL DEFAULT 'cafe',     -- אותו ממד כמו בקבלות
  notes          text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_days_source_chk') THEN
    ALTER TABLE sales_days ADD CONSTRAINT sales_days_source_chk
      CHECK (source IN ('manual', 'z_report', 'import', 'api'));
  END IF;
END $$;

-- יום אחד לכל תאריך בכל ספר — הזנה חוזרת מעדכנת ולא מכפילה מחזור.
CREATE UNIQUE INDEX IF NOT EXISTS sales_days_user_date_book_idx
  ON sales_days(user_id, business_date, book);
CREATE INDEX IF NOT EXISTS sales_days_org_idx  ON sales_days(org_id);
CREATE INDEX IF NOT EXISTS sales_days_date_idx ON sales_days(business_date);

CREATE TABLE IF NOT EXISTS sales_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id         uuid REFERENCES organizations(id) ON DELETE CASCADE,
  day_id         uuid REFERENCES sales_days(id) ON DELETE CASCADE,

  business_date  date NOT NULL,
  hour           smallint CHECK (hour IS NULL OR (hour >= 0 AND hour <= 23)),
  product_name   text NOT NULL,
  product_key    text,          -- צורה מנורמלת, לחיבור מול עלות הרכישה
  qty            numeric NOT NULL DEFAULT 1,
  unit           text,
  unit_price     numeric,
  line_total     numeric NOT NULL DEFAULT 0,
  category_text  text,
  book           text NOT NULL DEFAULT 'cafe',

  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sales_lines_user_date_idx ON sales_lines(user_id, business_date);
CREATE INDEX IF NOT EXISTS sales_lines_org_idx       ON sales_lines(org_id);
CREATE INDEX IF NOT EXISTS sales_lines_product_idx   ON sales_lines(user_id, product_key);
CREATE INDEX IF NOT EXISTS sales_lines_day_idx       ON sales_lines(day_id);

-- ── בידוד דיירים: מחזור הוא הנתון המסחרי הרגיש ביותר במערכת ────────────────
ALTER TABLE sales_days  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_sales_days ON sales_days;
CREATE POLICY own_sales_days ON sales_days
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS org_sales_days ON sales_days;
CREATE POLICY org_sales_days ON sales_days
  FOR ALL TO authenticated
  USING (org_id IN (SELECT current_org_ids())) WITH CHECK (org_id IN (SELECT current_org_ids()));

DROP POLICY IF EXISTS own_sales_lines ON sales_lines;
CREATE POLICY own_sales_lines ON sales_lines
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS org_sales_lines ON sales_lines;
CREATE POLICY org_sales_lines ON sales_lines
  FOR ALL TO authenticated
  USING (org_id IN (SELECT current_org_ids())) WITH CHECK (org_id IN (SELECT current_org_ids()));

DROP TRIGGER IF EXISTS sales_days_enforce_org ON sales_days;
CREATE TRIGGER sales_days_enforce_org
  BEFORE INSERT OR UPDATE ON sales_days
  FOR EACH ROW EXECUTE FUNCTION enforce_own_org();

DROP TRIGGER IF EXISTS sales_lines_enforce_org ON sales_lines;
CREATE TRIGGER sales_lines_enforce_org
  BEFORE INSERT OR UPDATE ON sales_lines
  FOR EACH ROW EXECUTE FUNCTION enforce_own_org();

-- ============================================================================
-- אימות: npm run test:security
-- ============================================================================
