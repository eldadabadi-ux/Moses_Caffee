-- ============================================================================
-- supabase_events_book.sql — ספרי חשבונות נפרדים (דרישת לקוח 17)
--
-- להריץ ב-Supabase SQL Editor (Run). בטוח להריץ יותר מפעם אחת (idempotent).
--
-- משה מקיים אירועי קייטרינג לצד בית הקפה. הקבלות, תעודות המשלוח והחשבוניות
-- המרכזות שלהם צריכות להיות מקוטלגות בנפרד ו**לא** להיכנס לסטטיסטיקות ולתובנות
-- של בית הקפה.
--
-- זה ממד, ובכוונה לא קטגוריה: קטגוריה בשם "אירועים" היתה מחלחלת לכל התפלגות,
-- גרף והשוואה — בדיוק מה שהדרישה שוללת. `book` גם אורתוגונלי ל-`doc_type`:
-- תעודת משלוח של אירוע היא עדיין תעודת משלוח.
--
-- Expand-only: כל שורה קיימת הופכת ל-'cafe', שזה מה שהיא כבר היתה.
-- ============================================================================

ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS book text NOT NULL DEFAULT 'cafe';

COMMENT ON COLUMN receipts.book IS
  'הספר שאליו שייך המסמך: cafe (ברירת מחדל) | events (קייטרינג). אורתוגונלי ל-doc_type.';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'receipts_book_chk') THEN
    ALTER TABLE receipts ADD CONSTRAINT receipts_book_chk CHECK (book IN ('cafe', 'events'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS receipts_book_idx     ON receipts(user_id, book) WHERE book <> 'cafe';
CREATE INDEX IF NOT EXISTS receipts_org_book_idx ON receipts(org_id, book)  WHERE book <> 'cafe';

-- ============================================================================
-- אימות אחרי הרצה:
--   SELECT book, count(*) FROM receipts GROUP BY book;   -- expect all 'cafe'
-- ============================================================================
