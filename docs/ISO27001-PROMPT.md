# ISO/IEC 27001:2022 — Prompt לשיחה חדשה | receipts-app (Moses Coffee)

> הודעה ראשונה לשיחה החדשה עם Claude Code.
> פתח Claude Code כשהתיקיית העבודה היא: `C:\Users\Eldad Abadi\Desktop\claude code projects\receipts-app`
> העתק את כל הטקסט שמתחת לקו הכפול והדבק כהודעה ראשונה.

---

════════════════════════════════════════
PROMPT — העתק מכאן
════════════════════════════════════════

אני רוצה לבצע הערכת אבטחה מלאה ויישום בקרות ISO/IEC 27001:2022 לאפליקציית הקבלות שלי.

---

## פרטי הפרויקט

| שדה | ערך |
|-----|-----|
| שם | receipts-app (moses-caffee) |
| נתיב | `C:\Users\Eldad Abadi\Desktop\claude code projects\receipts-app` |
| גרסה | 1.70.1 |
| Frontend | React 19 + Vite 8 + Tailwind CSS v4 |
| מסד נתונים | Supabase (PostgreSQL + RLS + Auth) |
| Deploy | Cloudflare Pages (`npm run deploy` → project: `moses-caffee`) |
| OCR / AI | Tesseract.js — רץ **מקומית בדפדפן** (אין קריאות לAPI חיצוני) |
| Multi-tenant | כן — טבלאות `organizations` + `memberships` + `org_id` על כל טבלה |
| סוג נתונים | תמונות קבלות (base64 ב-DB), נתוני ספקים, סכומים, פריטי מע"מ |
| אימות | Supabase Auth (user_id RLS) |

## מה כבר קיים במערכת (אל תיצור שוב)

- **RLS** על כל הטבלאות: `receipts`, `categories`, `user_settings`, `organizations`, `memberships`
- **Multi-tenant isolation**: פונקציית `current_org_ids()` + `fill_org_id()` trigger + `org_id NOT NULL`
- **Security headers** ב-`dist/_headers`: HSTS, X-Frame-Options, X-Content-Type-Options, CSP, Referrer-Policy, Permissions-Policy
- **SECURITY DEFINER** על `current_org_ids()` ו-`fill_org_id()`

## רקע — מה עשיתי בפרויקט קודם (CRM משפטי)

ביצעתי תהליך ISO 27001 מלא על פרויקט אחר. אני רוצה לחזור על אותה מתודולוגיה כאן, מותאמת לפרויקט הקבלות. הבקרות שיושמו שם (כמסגרת ייחוס):

- A.8.24 — הצפנת שדות רגישים AES-256-GCM
- A.8.15/A.8.16 — audit log append-only עם hash-chain (pgcrypto SHA-256)
- A.8.28 — RLS penetration tests (Jest)
- A.5.17 — MFA/AAL2 לנתיבי Admin בלבד
- A.8.23 — security headers
- A.8.12 — rate limiting + bot protection

---

## מה אני רוצה שתעשה

### שלב 0 — Gap Assessment (קודם לכל)

קרא את כל הקוד בפרויקט וספר לי:
1. מה **כבר קיים** מבחינת אבטחה (אל תציע לבנות מחדש דברים קיימים)
2. מה **חסר** לפי Annex A — ממוין לפי סיכון: קריטי / גבוה / בינוני / נמוך
3. שים לב במיוחד ל:
   - `receipt_image text` — תמונות קבלות מאוחסנות כ-base64 ישירות בעמודת DB (נתון רגיש מאוד)
   - `ai_summary jsonb` — תוצאות OCR עשויות להכיל PII
   - Admin panel — איך מוגן? מי יכול לגשת?
   - האם security headers ב-`dist/_headers` מיוצרים אוטומטית ב-build או ידנית?
   - SECURITY DEFINER functions — האם מוגנות כראוי?
4. הצג טבלת ממצאים **לפני שאתה כותב שורת קוד**. המתן לאישורי.

### שלב 1 — בקרות טכניות (לאחר אישורי)

יישם בקרות לפי סדר עדיפות. לכל בקרה ציין:
- מספר Annex A (A.X.XX)
- מה בדיוק ישתנה
- SQL migrations — הצג לביצוע ידני ב-Supabase SQL Editor (אל תריץ בעצמך)

### שלב 2 — תיעוד רשמי (לאחר שלב 1)

צור בתיקיית `docs/`:
- `SECURITY-REPORT-ISO27001-2026.md` — דוח מפורט בעברית
- `SECURITY-REPORT-ISO27001-2026.html` — HTML עם RTL, צבעים, מוכן להדפסה ל-PDF (Ctrl+P → "Enable background graphics")
- `IT-SECURITY-SUMMARY-2026.pptx` — מצגת PowerPoint ~8 שקפים לישיבה עם מנהל IT

---

## אילוצים חשובים

1. **אל תיגע בנתוני production** ללא גיבוי ואישורי מפורש
2. **Secrets** — אך ורק ב-Cloudflare Pages dashboard (Environment Variables), לעולם לא ב-code
3. **Deploy** — `npm run deploy` → project `moses-caffee` → branch `master`
4. **SQL Migrations** — הצג SQL לביצוע ידני בלבד (Supabase → SQL Editor)
5. **security headers** — חשוב לוודא שמיוצרים אוטומטית ב-build ולא רק ב-dist ידני
6. **לא** Windows Server / Apache — זה Cloudflare Pages, אין `.htaccess`

---

## התחל עכשיו

בצע **שלב 0 בלבד** — קרא את כל הפרויקט והכן טבלת gap assessment. אל תכתוב קוד עד שאאשר.

════════════════════════════════════════
סוף ה-PROMPT
════════════════════════════════════════

---

## טיפים לשיחה

- אחרי gap assessment: "אשר, תתחיל שלב 1" כדי להתחיל יישום
- אחרי כל בקרה: "תקין, המשך לבאה"
- SQL שהוא מציג: העתק ל-Supabase → SQL Editor → הרץ → חזור עם "הצלחה" או עם הודעת השגיאה
- אם הוא מבקש להריץ פקודת wrangler secret: הרץ ב-PowerShell — הוא יבקש ממך להדביק את הערך
