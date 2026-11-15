-- ============================================================================
-- supabase_client_accounts.sql — כרטיס לקוח למפעיל המערכת (15.11.26)
--
-- להריץ ב-Supabase SQL Editor. בטוח להריץ יותר מפעם אחת (idempotent).
--
-- מערכת ניהול הלקוחות של בעל המערכת: לכל ארגון (= לקוח) כרטיס אחד עם פרטי
-- הקשר, המחיר החודשי, הפיצ'רים שנרכשו ומחירם, ואופן התשלום. זהו מידע עסקי
-- של המפעיל — לא של הדיירים — ולכן אין עליו שום מדיניות RLS לדיירים:
-- RLS מופעל בלי אף policy, כך שרק service-role (קונסולת האדמין, בעלים+2FA)
-- קורא וכותב. דייר לעולם לא רואה את התמחור של עצמו או של אחרים.
-- ============================================================================

CREATE TABLE IF NOT EXISTS client_accounts (
  org_id         uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,

  contact_name   text,
  contact_phone  text,
  contact_email  text,

  monthly_price  numeric NOT NULL DEFAULT 0,      -- מה הלקוח משלם בחודש, ₪
  -- הפיצ'רים שנרכשו ומחירם: { "<flag_key>": { "price": <number> } }
  -- המפתחות הם מפתחות המודולים של feature_flags (bot_tools, insights...).
  features       jsonb NOT NULL DEFAULT '{}'::jsonb,

  payment_method text,                             -- bank_transfer / standing_order / bit / credit_card / check / other
  payment_notes  text,                             -- פרטי חשבון, יום חיוב, אסמכתאות...

  status         text NOT NULL DEFAULT 'active',
  started_at     date,                             -- תחילת ההתקשרות
  notes          text,

  updated_at     timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_accounts_status_chk') THEN
    ALTER TABLE client_accounts ADD CONSTRAINT client_accounts_status_chk
      CHECK (status IN ('active', 'trial', 'paused', 'churned'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_accounts_payment_chk') THEN
    ALTER TABLE client_accounts ADD CONSTRAINT client_accounts_payment_chk
      CHECK (payment_method IS NULL OR payment_method IN
        ('bank_transfer', 'standing_order', 'bit', 'credit_card', 'check', 'other'));
  END IF;
END $$;

-- נעילה מוחלטת לדיירים: RLS פעיל, אפס policies → רק service-role ניגש.
ALTER TABLE client_accounts ENABLE ROW LEVEL SECURITY;

-- רישום ב-ledger (אחרי ההרצה):
--   npm run migrations -- --mark=supabase_client_accounts.sql
