-- ============================================================================
-- supabase_mail_multi.sql — כמה תיבות מייל לאותו חשבון (דרישת לקוח 14)
--
-- להריץ ב-Supabase SQL Editor. בטוח להריץ יותר מפעם אחת (idempotent).
--
-- המפתח הקודם היה UNIQUE (user_id, provider) — כלומר כתובת Gmail אחת למשתמש,
-- וחיבור כתובת שנייה **דרס בשקט** את הראשונה (ה-upsert ב-mail/callback.js
-- ממזג לפי אותו מפתח). בית קפה עם orders@ ו-accounts@ יכול היה לסרוק רק אחת
-- מהן, בלי שום דרך לדעת איזו.
--
-- המפתח החדש הוא (user_id, provider, email). חיבור מחדש של אותה כתובת עדיין
-- מרענן את אותה שורה במקום ליצור כפילות.
-- ============================================================================

-- שורות קיימות עשויות להיות ללא email (שליפת הפרופיל היא best-effort) —
-- ניתן להן ערך יציב כדי שאפשר יהיה לבנות את האינדקס.
UPDATE mail_connections
   SET email = COALESCE(NULLIF(email, ''), provider || ':' || id::text)
 WHERE email IS NULL OR email = '';

ALTER TABLE mail_connections ALTER COLUMN email SET NOT NULL;

ALTER TABLE mail_connections DROP CONSTRAINT IF EXISTS mail_connections_user_id_provider_key;
DROP INDEX IF EXISTS mail_connections_user_provider_email_idx;
CREATE UNIQUE INDEX mail_connections_user_provider_email_idx
  ON mail_connections (user_id, provider, email);

-- כדי להתריע על חיבור שפג בלי להציק בכל ריצה יומית.
ALTER TABLE mail_connections
  ADD COLUMN IF NOT EXISTS error_since      timestamptz,
  ADD COLUMN IF NOT EXISTS last_notified_at timestamptz;

COMMENT ON COLUMN mail_connections.error_since IS
  'מתי החיבור התחיל להיכשל; מתאפס בסריקה מוצלחת';
COMMENT ON COLUMN mail_connections.last_notified_at IS
  'מתי הודענו למשתמש לאחרונה, כדי שההתראה לא תחזור כל יום';

CREATE INDEX IF NOT EXISTS mail_connections_org_idx ON mail_connections (org_id);

-- ============================================================================
-- אימות:
--   SELECT user_id, provider, email, status, error_since FROM mail_connections;
-- ============================================================================
