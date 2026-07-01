# קליטת קבלות מהמייל — הפעלה, אבטחה ותאימות (Gmail + Outlook)

מדריך זה ריכוזי לכל מה שצריך כדי להפעיל את חיבור תיבת-המייל (Gmail / Outlook) שסורק את
תיבת הלקוח, מאתר קבלות/חשבוניות ומכניס אותן למערכת בסטטוס **"ממתין לאישור"**.

> הפיצ'ר **כבוי כברירת מחדל** לכל הלקוחות: כרטיס "קליטת קבלות מהמייל" בהגדרות מוסתר עד
> שמגדירים `GOOGLE_CLIENT_ID`/`MICROSOFT_CLIENT_ID` + `MAIL_TOKEN_KEY` ב-Cloudflare. אין שום
> השפעה על לקוחות קיימים עד ההפעלה.

---

## 1) בסיס הנתונים (Supabase)

הרץ ב-SQL Editor של הפרויקט (אם עוד לא הורצו):

1. `supabase_inbound.sql` — הבאקט הפרטי `receipts` + העמודות `source`,`status`,`storage_path`,`source_meta` בטבלת `receipts`.
2. `supabase_mail.sql` — טבלת `mail_connections` (עם RLS, ללא policy ללקוח — גישה רק דרך service-role מהשרת).
3. `supabase_mail_cron.sql` — (אופציונלי, לסריקה אוטומטית) job של pg_cron שקורא ל-`/api/mail/cron` כל 30 דק'.
   לפני ההרצה החלף את ה-placeholder `<<CRON_SECRET>>` בערך הסודי שתבחר (זהה ל-`CRON_SECRET` שב-Cloudflare).

---

## 2) Google OAuth (Gmail)

1. [console.cloud.google.com](https://console.cloud.google.com) → צור פרויקט.
2. **APIs & Services → Library** → הפעל **Gmail API**.
3. **OAuth consent screen**: User type = **External**; מלא שם אפליקציה, מייל תמיכה, לוגו, דומיין
   (`moses-caffee.pages.dev`), קישור למדיניות הפרטיות (`/privacy`) ולתנאי השימוש.
   - Scopes → הוסף `.../auth/gmail.readonly`.
   - **Test users** → הוסף את המיילים של Moshe והלקוחות הראשונים (עד 100). במצב "Testing" הפיצ'ר
     עובד מלא — רק מוצגת אזהרת "אפליקציה לא מאומתת" שאפשר לאשר.
4. **Credentials → Create Credentials → OAuth client ID** → Web application.
   - **Authorized redirect URI**: `https://moses-caffee.pages.dev/api/mail/callback`
   - שמור את **Client ID** ו-**Client Secret**.

## 3) Microsoft (Outlook) — אופציונלי

1. [portal.azure.com](https://portal.azure.com) → **Microsoft Entra ID → App registrations → New registration**.
   - Supported account types: *Accounts in any organizational directory and personal Microsoft accounts*.
   - Redirect URI (Web): `https://moses-caffee.pages.dev/api/mail/callback`
2. **API permissions → Microsoft Graph → Delegated** → `Mail.Read`, `offline_access`, `openid`, `email` → Grant.
3. **Certificates & secrets → New client secret** → שמור את הערך.
4. שמור את **Application (client) ID**.

---

## 4) סודות ב-Cloudflare Pages (פרויקט `moses-caffee`)

Settings → Environment variables (Production **וגם** Preview), הצפן כ-Secret:

| שם | ערך |
|---|---|
| `GOOGLE_CLIENT_ID` | מ-Google |
| `GOOGLE_CLIENT_SECRET` | מ-Google |
| `MICROSOFT_CLIENT_ID` | מ-Azure (רק אם מפעילים Outlook) |
| `MICROSOFT_CLIENT_SECRET` | מ-Azure |
| `MAIL_TOKEN_KEY` | מחרוזת אקראית חזקה (≥32 תווים) — מפתח ההצפנה של האסימונים |
| `MAIL_REDIRECT_URI` | `https://moses-caffee.pages.dev/api/mail/callback` (אופציונלי; ברירת מחדל = origin נוכחי) |
| `CRON_SECRET` | מחרוזת אקראית — מגן על `/api/mail/cron` (זהה לזה שב-SQL של pg_cron) |

> כבר קיימים בפרויקט: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`/`VITE_SUPABASE_URL`, מפתח Gemini.
> **`MAIL_TOKEN_KEY` הוא קריטי** — אם משנים אותו, כל האסימונים המוצפנים הקיימים נפסלים והלקוחות
> יצטרכו לחבר מחדש.

לאחר הגדרת הסודות — Deploy מחדש (או הרץ שוב את הפריסה) כדי שייטענו.

---

## 5) סריקה אוטומטית (Cron)

Cloudflare **Pages** לא תומך ב-cron. שלוש חלופות (בחר אחת):

1. **Supabase pg_cron** (מומלץ, פועל כבר בתוך ה-DB) — `supabase_mail_cron.sql`.
2. **Cloudflare Worker** — תיקיית `mail-scan-worker/` (דורש טוקן עם הרשאת Workers Scripts; `wrangler deploy`).
3. **GitHub Actions** — workflow מתוזמן שקורא ל-`/api/mail/cron` (דורש טוקן עם הרשאת `workflow`).

כולם פשוט שולחים POST ל-`/api/mail/cron` עם הכותרת `x-cron-secret: <CRON_SECRET>`.

---

## 6) אבטחה — מה בנוי במערכת

- **גישת קריאה בלבד** — `gmail.readonly` / `Mail.Read`. אין הרשאת שליחה/מחיקה.
- **אסימונים מוצפנים במנוחה** — refresh token מוצפן AES-GCM (`mailCrypto.js`, מפתח = SHA-256 של `MAIL_TOKEN_KEY`).
  אצל Microsoft, ה-refresh token מתחלף (rotation) ונשמר מחדש מוצפן בכל רענון.
- **הדפדפן לא רואה אסימונים** — כל התקשורת מול הספקים בצד השרת (Pages Functions). ה-UI מדבר רק עם `/api/mail/*`.
- **State חתום (HMAC)** ל-OAuth עם TTL של 15 דק' — מונע CSRF/החלפת state.
- **מזעור נתונים** — סורקים רק מיילים עם קבצים מצורפים + מילות-מפתח קבלה/חשבונית; שומרים רק את קובץ
  הקבלה + נתונים שחולצו + מטא-דאטה מינימלי (נושא/שולח/message-id) ל-dedup. אין העתקה של התיבה.
- **בידוד רב-דיירי** — `mail_connections` עם RLS ללא policy ללקוח; גישה רק דרך service-role.
- **אנושי-בלולאה** — כל קבלה שנקלטת נכנסת כ-`status='pending'` ומאושרת רק ידנית.
- **ניתוק** — מוחק את החיבור + האסימון, וב-Gmail גם מבטל את ההרשאה מול Google (`/revoke`).

---

## 7) תאימות ואימות (לפני השקה ציבורית רחבה)

**חסם ידוע:** `gmail.readonly` הוא **Restricted scope**. לשימוש ציבורי (מעבר ל-100 test users)
נדרש **OAuth app verification + הערכת אבטחה שנתית (CASA)** מטעם Google — עלות וזמן (שבועות-חודשים).
Microsoft Graph `Mail.Read` דורש publisher verification דומה.

מסלולי פעולה:

- **פיילוט עכשיו (מומלץ):** להישאר במצב Google **"Testing"** עם test users מפורשים (Moshe + לקוחות
  ראשונים). עובד מלא, רק אזהרת "אפליקציה לא מאומתת".
- **השקה בקנה מידה:** או לממן את אימות Google/CASA, או לעבור למודל **forward-to-alias** (הלקוח מעביר
  קבלות לכתובת שלנו — דורש רק דומיין ~$10/שנה, בלי restricted scope). להכריע לפני השקה ציבורית.

**דרישות תאימות שכבר טופלו:**
- מדיניות הפרטיות עודכנה (סעיף 4 — חיבור תיבת מייל: קריאה בלבד, מזעור נתונים, אישור ידני, ניתוק,
  והצהרת **Google API Services User Data Policy / Limited Use**).
- Google/Microsoft נוספו לרשימת ספקי המשנה בהצהרת הפרטיות.

---

## 8) בדיקת קבלה (Acceptance)

1. הוסף Gmail בדיקה כ-test user ב-Google. שלח אליו מייל עם PDF/תמונת קבלה.
2. הגדרות → קליטת קבלות מהמייל → **חבר את Gmail** → אשר → חזרה לאתר עם "תיבת המייל חוברה ✓".
3. **סרוק עכשיו** → קבלה `pending` מופיעה עם ספק/סכום נכונים; הקובץ המקורי נפתח דרך signed URL.
4. סריקה שנייה **לא** יוצרת כפילות (dedup לפי message-id).
5. **נתק** מסיר את החיבור והאסימון. (חזור על 2-5 עבור Outlook אם הופעל.)
