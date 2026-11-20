-- ============================================================================
-- supabase_event_multiday.sql — אירוע רב-יומי (בקשת לקוח 20.11.26)
--
-- להריץ ב-Supabase SQL Editor. בטוח להריץ יותר מפעם אחת (idempotent).
--
-- כנס נמשך כמה ימים, ולכן להצעה דרוש תאריך סיום. נשמר כעמודה ולא כרשימת
-- תאריכים: אירוע הוא טווח רציף, וטווח מאפשר לשאול "אילו אירועים נופלים
-- בחודש הזה" בשאילתה אחת. ריק = אירוע של יום אחד, כפי שהיה עד היום.
-- ============================================================================

ALTER TABLE event_quotes ADD COLUMN IF NOT EXISTS event_end_date date;

-- סיום לפני התחלה הוא תמיד שגיאת הקלדה.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_quotes_dates_chk') THEN
    ALTER TABLE event_quotes ADD CONSTRAINT event_quotes_dates_chk
      CHECK (event_end_date IS NULL OR event_date IS NULL OR event_end_date >= event_date);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS event_quotes_end_date_idx ON event_quotes(event_end_date);

-- ============================================================================
-- אימות: npm run test:security
-- ============================================================================
