-- ============================================================================
-- supabase_receipt_books.sql — סוגי קבלות שהמשתמש מגדיר בעצמו (בקשת לקוח 20.11.26)
--
-- להריץ ב-Supabase SQL Editor. בטוח להריץ יותר מפעם אחת (idempotent).
--
-- עד היום היו בדיוק שני ספרים — בית הקפה ואירועים — והם קבועים בקוד. כעת ניתן
-- להוסיף סוגים נוספים (קייטרינג חיצוני, חנות, פרויקט מסוים וכו').
--
-- המשמעות הפיננסית לא משתנה (החלטת המפעיל 20.11.26): הדשבורד, התובנות,
-- התקציבים והעוזר ממשיכים לספור את בית הקפה בלבד, וכל סוג אחר מנוהל בנפרד —
-- בדיוק כפי שספר האירועים מתנהג היום.
-- ============================================================================

-- האילוץ הישן הגביל לשני ערכים; כעת מגבילים רק את הצורה, כדי שלא ייכנסו ערכים
-- חופשיים שישברו השוואות.
ALTER TABLE receipts DROP CONSTRAINT IF EXISTS receipts_book_chk;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'receipts_book_fmt_chk') THEN
    ALTER TABLE receipts ADD CONSTRAINT receipts_book_fmt_chk
      CHECK (book ~ '^[a-z0-9_-]{2,24}$');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS receipt_books (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id     uuid REFERENCES organizations(id) ON DELETE CASCADE,

  key        text NOT NULL CHECK (key ~ '^[a-z0-9_-]{2,24}$'),
  label      text NOT NULL,
  icon       text,
  sort_order integer NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- מפתח אחד לכל משתמש; 'cafe' ו-'events' שמורים לקוד ואינם נשמרים כאן.
CREATE UNIQUE INDEX IF NOT EXISTS receipt_books_user_key_idx ON receipt_books(user_id, key);
CREATE INDEX IF NOT EXISTS receipt_books_org_idx ON receipt_books(org_id);

ALTER TABLE receipt_books ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_receipt_books ON receipt_books;
CREATE POLICY own_receipt_books ON receipt_books
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS org_receipt_books ON receipt_books;
CREATE POLICY org_receipt_books ON receipt_books
  FOR ALL TO authenticated
  USING (org_id IN (SELECT current_org_ids()))
  WITH CHECK (org_id IN (SELECT current_org_ids()));

DROP TRIGGER IF EXISTS receipt_books_enforce_org ON receipt_books;
CREATE TRIGGER receipt_books_enforce_org
  BEFORE INSERT OR UPDATE ON receipt_books
  FOR EACH ROW EXECUTE FUNCTION enforce_own_org();

-- ============================================================================
-- אימות: npm run test:security
-- ============================================================================
