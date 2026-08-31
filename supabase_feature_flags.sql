-- ============================================================================
-- supabase_feature_flags.sql — דגלי פיצ'ר (ביקורת יולי: "אין דרך לשחרר כבוי")
--
-- להריץ ב-Supabase SQL Editor. בטוח להריץ יותר מפעם אחת (idempotent).
--
-- אין סביבת staging, וכל שחרור הולך ישר לעסק חי. דגלים הם התחליף שמתאים למצב
-- הזה: לשחרר את הקוד כבוי, להדליק לדייר הבדיקות, להסתכל מול התנהגות אמיתית,
-- ורק אז להדליק לבית הקפה — הכל בלי פריסה, ועם דרך חזרה מיידית.
--
-- שתי רמות: שורה גלובלית (org_id IS NULL) קובעת ברירת מחדל לכולם, ושורה עם
-- org_id דורסת אותה לדייר מסוים. דגל בלי אף שורה נופל לברירת המחדל שבקוד —
-- כך שדגל חדש שנשלח הוא כבוי מעצם הבנייה ולא מתוך זכירה להוסיף שורה.
-- ============================================================================

CREATE TABLE IF NOT EXISTS feature_flags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key        text NOT NULL,
  org_id     uuid REFERENCES organizations(id) ON DELETE CASCADE,
  enabled    boolean NOT NULL DEFAULT false,
  note       text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- NULL שונה מ-NULL באינדקס ייחודי רגיל, ולכן לשורה הגלובלית יש אינדקס חלקי משלה.
CREATE UNIQUE INDEX IF NOT EXISTS feature_flags_global_idx ON feature_flags(key) WHERE org_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS feature_flags_org_idx    ON feature_flags(key, org_id) WHERE org_id IS NOT NULL;

ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

-- לקריאה: הלקוח חייב לדעת מה להציג. משתמש רואה את ברירות המחדל הגלובליות ואת
-- הדריסות של הארגון **שלו** — לעולם לא את מצב ההשקה של דייר אחר.
DROP POLICY IF EXISTS read_feature_flags ON feature_flags;
CREATE POLICY read_feature_flags ON feature_flags
  FOR SELECT TO authenticated
  USING (org_id IS NULL OR org_id IN (SELECT current_org_ids()));

-- כתיבה: service-role בלבד. דגל הוא החלטת פריסה, לא משהו שמשתמש קצה מדליק.
-- אין מדיניות INSERT/UPDATE/DELETE = חסום.

-- ============================================================================
-- איך מדליקים/מכבים (מה-SQL Editor, בלי פריסה):
--
--   -- כבה פיצ'ר לכולם:
--   INSERT INTO feature_flags (key, org_id, enabled, note)
--   VALUES ('events_book', NULL, false, 'הושבת זמנית')
--   ON CONFLICT (key) WHERE org_id IS NULL
--   DO UPDATE SET enabled = EXCLUDED.enabled, note = EXCLUDED.note, updated_at = now();
--
--   -- הדלק רק לדייר הבדיקות:
--   INSERT INTO feature_flags (key, org_id, enabled, note)
--   SELECT 'events_book', id, true, 'בדיקה לפני השקה' FROM organizations WHERE name = 'מנהל קבלות'
--   ON CONFLICT (key, org_id) WHERE org_id IS NOT NULL
--   DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now();
--
--   -- מה מוגדר כרגע:
--   SELECT f.key, o.name AS org, f.enabled, f.note
--     FROM feature_flags f LEFT JOIN organizations o ON o.id = f.org_id
--    ORDER BY f.key, o.name NULLS FIRST;
-- ============================================================================
