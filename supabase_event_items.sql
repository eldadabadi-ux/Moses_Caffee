-- ============================================================================
-- supabase_event_items.sql — קטלוג הפריטים של האירועים (בקשת לקוח 19.11.26)
--
-- להריץ ב-Supabase SQL Editor. בטוח להריץ יותר מפעם אחת (idempotent).
--
-- למה טבלה נפרדת ולא שימוש במוצרים שנסרקו מהקבלות: מה שמוכרים באירוע אינו מה
-- שקונים מהספק. "מגש פירות", "מגש סנדוויצ'ים" או "שתייה קלה" הם פריטי מכירה
-- עם מחיר מכירה משלהם, בעוד שהקבלות מחזיקות חומרי גלם במחירי עלות. ערבוב
-- השניים ברשימה אחת גרם להשלמה אוטומטית שמציעה חומרי גלם ולמחירים שגויים.
--
-- המחיר כאן הוא ברירת מחדל בלבד: הצעת מחיר שומרת את השורות שלה ב-jsonb, כך
-- ששינוי מחיר עתידי בקטלוג אינו משנה הצעות שכבר נשלחו ללקוח.
-- ============================================================================

CREATE TABLE IF NOT EXISTS event_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id      uuid REFERENCES organizations(id) ON DELETE CASCADE,

  name        text NOT NULL,
  unit        text NOT NULL DEFAULT 'יח''',
  unit_price  numeric,
  notes       text,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- פריט אחד לכל שם אצל אותו משתמש — הוספה חוזרת מעדכנת מחיר ולא מכפילה שורה.
CREATE UNIQUE INDEX IF NOT EXISTS event_items_user_name_idx ON event_items(user_id, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS event_items_org_idx ON event_items(org_id);

-- אותה עמדת בידוד כמו כל טבלת דייר: RLS לשני הכיוונים + trigger שמצמיד בעלות.
ALTER TABLE event_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_event_items ON event_items;
CREATE POLICY own_event_items ON event_items
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS org_event_items ON event_items;
CREATE POLICY org_event_items ON event_items
  FOR ALL TO authenticated
  USING (org_id IN (SELECT current_org_ids()))
  WITH CHECK (org_id IN (SELECT current_org_ids()));

DROP TRIGGER IF EXISTS event_items_enforce_org ON event_items;
CREATE TRIGGER event_items_enforce_org
  BEFORE INSERT OR UPDATE ON event_items
  FOR EACH ROW EXECUTE FUNCTION enforce_own_org();

-- ============================================================================
-- אימות: npm run test:security
-- ============================================================================
