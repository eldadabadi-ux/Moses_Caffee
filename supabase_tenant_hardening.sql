-- ============================================================================
-- supabase_tenant_hardening.sql — סגירת עמודת הדייר האחרונה שלא הוצמדה
--
-- להריץ ב-Supabase SQL Editor. בטוח להריץ יותר מפעם אחת (idempotent).
--
-- ל-user_settings יש מדיניות אחת בלבד (own_settings: user_id = auth.uid()) ולכן
-- אין דרך לקרוא שורה של דייר אחר. אבל שום דבר לא הצמיד את org_id — כלומר משתמש
-- יכול היה לחתום את שורת ההגדרות *שלו* במזהה ארגון של מישהו אחר. היום אף קריאה
-- לא מסננת הגדרות לפי ארגון, וזו הסיבה היחידה שזו עדיין לא דליפה — בדיוק סוג
-- החור הסמוי שהופך לדליפה ברגע שמישהו יכתוב `user_settings?org_id=eq.X`.
--
-- אותו שומר שכבר מגן על receipts / categories / suppliers / supplier_aliases:
-- בכתיבה של משתמש קצה, שתי עמודות הבעלות מוצמדות לקורא. כתיבות service-role
-- (auth.uid() IS NULL) שומרות שליטה מלאה.
-- ============================================================================

DROP TRIGGER IF EXISTS user_settings_enforce_org ON user_settings;
CREATE TRIGGER user_settings_enforce_org
  BEFORE INSERT OR UPDATE ON user_settings
  FOR EACH ROW EXECUTE FUNCTION enforce_own_org();

-- ============================================================================
-- אימות: npm run test:security  →  22 בדיקות, 0 כשלים
-- ============================================================================
