-- ============================================================================
-- supabase_event_quotes.sql — הצעות מחיר לאירועי קייטרינג (דרישת לקוח 17, חלק ב')
--
-- להריץ ב-Supabase SQL Editor. בטוח להריץ יותר מפעם אחת (idempotent).
--
-- שייך לספר האירועים ולא לבית הקפה: הצעת מחיר היא מה שמשה **גובה**, לא מה
-- שהוציא, ולכן אסור שתגיע לסטטיסטיקות ההוצאות. טבלה נפרדת ולא קבלה עם דגל,
-- כי הצורה שונה באמת — ללקוח יש שם, מספר אורחים, תוקף וסטטוס, ואין מסמך סרוק.
--
-- השורות הן jsonb כמו receipts.items, כך שמודול היחידות מתמחר אותן עם אותו קוד
-- שמתמחר רכישה — וזה מה שהופך את "כמה הרווחנו מהאירוע" לשאלה שאפשר לענות עליה.
-- ============================================================================

CREATE TABLE IF NOT EXISTS event_quotes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id         uuid REFERENCES organizations(id) ON DELETE CASCADE,

  title          text NOT NULL,
  customer_name  text,
  customer_phone text,
  customer_email text,
  event_date     date,
  guests         integer,

  items          jsonb NOT NULL DEFAULT '[]'::jsonb,
  vat_rate       numeric NOT NULL DEFAULT 18,
  margin_pct     numeric,
  discount_pct   numeric,

  status         text NOT NULL DEFAULT 'draft',
  valid_until    date,
  notes          text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_quotes_status_chk') THEN
    ALTER TABLE event_quotes ADD CONSTRAINT event_quotes_status_chk
      CHECK (status IN ('draft', 'sent', 'accepted', 'declined'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS event_quotes_user_idx ON event_quotes(user_id);
CREATE INDEX IF NOT EXISTS event_quotes_org_idx  ON event_quotes(org_id);
CREATE INDEX IF NOT EXISTS event_quotes_date_idx ON event_quotes(event_date);

-- אותה עמדת בידוד כמו כל טבלת דייר: RLS לשני הכיוונים, ועוד ה-trigger שמצמיד
-- בעלות בכתיבה של משתמש קצה (מדיניות permissive מחוברות ב-OR, כך ש-RLS לבדה
-- לא מונעת org_id זר בכתיבה).
ALTER TABLE event_quotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_event_quotes ON event_quotes;
CREATE POLICY own_event_quotes ON event_quotes
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS org_event_quotes ON event_quotes;
CREATE POLICY org_event_quotes ON event_quotes
  FOR ALL TO authenticated
  USING (org_id IN (SELECT current_org_ids()))
  WITH CHECK (org_id IN (SELECT current_org_ids()));

DROP TRIGGER IF EXISTS event_quotes_enforce_org ON event_quotes;
CREATE TRIGGER event_quotes_enforce_org
  BEFORE INSERT OR UPDATE ON event_quotes
  FOR EACH ROW EXECUTE FUNCTION enforce_own_org();

-- ============================================================================
-- אימות: npm run test:security  (הבדיקות מכסות גם את הטבלה הזו)
-- ============================================================================
