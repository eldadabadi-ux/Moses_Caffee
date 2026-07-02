-- ============================================================================
-- supabase_doctype.sql — הבחנה בין תעודות משלוח / חשבוניות מרכזות / קבלות
-- + תשתית התאמות (Reconciliation)
--
-- להריץ ב-Supabase SQL Editor (Run). בטוח להריץ יותר מפעם אחת (idempotent).
-- האפליקציה עובדת תקין גם לפני הרצת הקובץ (fallback), אבל אישור התאמות
-- ("אשר התאמה" בעמוד התאמות) דורש אותו.
-- ============================================================================

-- 1. עמודות חדשות על טבלת receipts
ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS doc_type           text DEFAULT 'receipt',
  ADD COLUMN IF NOT EXISTS doc_number         text,
  ADD COLUMN IF NOT EXISTS matched_invoice_id uuid REFERENCES receipts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reconciliation     jsonb;

COMMENT ON COLUMN receipts.doc_type           IS 'receipt | delivery_note | summary_invoice';
COMMENT ON COLUMN receipts.doc_number         IS 'מספר תעודה/חשבונית כפי שמודפס על המסמך';
COMMENT ON COLUMN receipts.matched_invoice_id IS 'על תעודת משלוח: החשבונית המרכזת שאליה הותאמה';
COMMENT ON COLUMN receipts.reconciliation     IS 'על חשבונית מרכזת: תמונת מצב של ההתאמה המאושרת';

-- 2. Backfill — כל הרשומות הקיימות הן קבלות רגילות
UPDATE receipts SET doc_type = 'receipt' WHERE doc_type IS NULL;

-- 3. אינדקסים חלקיים (רק לשורות שאינן ברירת מחדל — זול ומהיר)
CREATE INDEX IF NOT EXISTS receipts_doc_type_idx
  ON receipts(user_id, doc_type) WHERE doc_type <> 'receipt';
CREATE INDEX IF NOT EXISTS receipts_matched_invoice_idx
  ON receipts(matched_invoice_id) WHERE matched_invoice_id IS NOT NULL;

-- 4. אילוץ ערכים חוקיים (ADD CONSTRAINT אין לו IF NOT EXISTS — לכן DO block)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'receipts_doc_type_chk') THEN
    ALTER TABLE receipts ADD CONSTRAINT receipts_doc_type_chk
      CHECK (doc_type IN ('receipt', 'delivery_note', 'summary_invoice'));
  END IF;
END $$;

-- הערה: אין צורך במדיניות RLS חדשה — העמודות יורשות את המדיניות הקיימת
-- על receipts (own_receipts / org_receipts, FOR ALL).
