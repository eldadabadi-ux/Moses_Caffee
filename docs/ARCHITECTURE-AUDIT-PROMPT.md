# Architecture & Quality Audit — Prompt לשיחה חדשה | receipts-app (Moses Coffee)

> הודעה ראשונה לשיחה חדשה עם Claude Code.
> פתח את השיחה כשתיקיית העבודה היא: `C:\Users\Eldad Abadi\Desktop\claude code projects\receipts-app`
> העתק את כל הטקסט שמתחת לקו הכפול והדבק כהודעה ראשונה.

---

════════════════════════════════════════
PROMPT — העתק מכאן
════════════════════════════════════════

אתה פועל כ-Senior Staff Engineer. בצע על הפרויקט הזה (receipts-app / Moses Coffee) את אותו תהליך ביקורת-ושיפור ארכיטקטורה שבוצע בהצלחה על פרויקט ה-CRM המשפטי שלי (crm-law) — ביקורת קריאה-בלבד, Blueprint, אישור שלי, ביצוע מדורג עם סביבת בדיקות, ותיעוד.

## שני עקרונות מחייבים (ללא חריגים)

1. **SSOT** — לכל חישוב לוגי (מע"מ, המרת מטבע, סכימת פריטים, קטגוריזציה) יש מקור-אמת אחד בדיוק. אסורה כפילות לוגיקה בין frontend ל-backend.
2. **Root-Cause-First** — אסורים תיקוני פלסטר, wrappers ו-fallbacks שמסתירים פגם. כל תיקון מתחיל בהצהרת שורש-הבעיה במשפט אחד, ומתוקן במקור (schema / helper קנוני), לא בנקודת הקריאה.

## פרטי הפרויקט

| שדה | ערך |
|-----|-----|
| נתיב | `C:\Users\Eldad Abadi\Desktop\claude code projects\receipts-app` |
| Stack | React 19 + Vite 8 + Tailwind v4, Supabase (RLS), Cloudflare Pages Functions |
| Deploy | `npm run deploy` → פרויקט `moses-caffee`, branch `master` |
| GitHub | `eldadabadi-ux/Moses_Caffee` (repo קיים ומחובר) |
| Multi-tenant | `organizations` + `memberships`, עמודת `org_id`, פונקציית `current_org_ids()` (SECURITY DEFINER) |
| OCR | Tesseract.js מקומי בדפדפן + נתיבי שרת (`functions/api/scan-receipt.js`) |
| AI Bot | `functions/api/chat.js` — אותה תבנית כמו בבוט של ה-CRM |
| ISO 27001 | בוצע בשיחה קודמת — `docs/SECURITY-REPORT-ISO27001-2026.md` קיים. אל תבנה מחדש בקרות קיימות |
| Snyk | הפרויקט יצא נקי בסריקות 4.7.2026 — נדרש רק אימות מחדש |

## מה בוצע ב-crm-law (ההשוואה שלך) — לשחזר כאן

1. **ביקורת 4 שלבים** (קריאה-בלבד) → מסמך `docs/ARCHITECTURE-AUDIT-2026.md` עם ממצאים מסווגים **Critical / Major / Optimization**, לכל ממצא: מיקום מדויק, שורש-בעיה, ותיאור הריפקטור (בלי קוד בשלב זה).
2. **עצירה לאישור** לפני כל שינוי קוד.
3. **ביצוע מדורג לפי חומרה** — כל שינוי: build ירוק → פריסה לסביבת בדיקות → אימות שלי מול נתונים אמיתיים → רק אז production.
4. **Guardrails מחייבים** — סעיף "Engineering Guardrails" ב-`CLAUDE.md`.
5. **עדכון דוחות** — commit+push לכל אבן-דרך, ועדכון דוח ה-ISO בסוף (רק מה שבאמת בוצע — בלי ירוק כוזב).

## שלב 0 — ביקורת (קריאה-בלבד, לפני הכל)

### Step 1 — SSOT & DRY
נקודות חמות ידועות מראש (זוהו בסריקה מקדימה — התחל מהן):
- `src/lib/recategorize.js` **מול** `functions/api/recategorize.js` — חשד כבד לכפילות לוגיקת קטגוריזציה client/server.
- `src/lib/ocrService.js` (client) **מול** `functions/api/scan-receipt.js` + `functions/api/_lib/extractReceipt.js` (server) — שני מסלולי חילוץ קבלות; הגדר חוזה חילוץ קנוני אחד.
- `src/lib/categoryNormalize.js` + `categoryStats.js` + `itemAggregation.js` **מול** `functions/api/_lib/classifyReceipt.js` — היכן מתבצעת נורמליזציית קטגוריות, פעמיים?
- **חיובי לאימות:** `functions/api/_lib/fxRate.js` (שער יציג בנק ישראל) הוא ה-SSOT למטבע — ודא שאין המרות מטבע כפולות בצד לקוח.
- לוגיקה עסקית בתוך רכיבי UI: בדוק במיוחד `ReceiptsPage.jsx`, `DashboardPage.jsx`, `ReconciliationPage.jsx`, `CategoriesPage.jsx`, `SuppliersPage.jsx`.
- רכיבים משוכפלים (טבלאות, גרפים, סרגלי סינון) → מועמדים לרכיב משותף.

### Step 2 — Multi-Tenancy & Security (עדיפות עליונה)
- עבור על **כל** שאילתת DB וכל endpoint: בידוד `org_id` נאכף **בצד שרת דרך RLS** (`current_org_ids()`), לעולם לא רק ע"י פילטר מהלקוח. שאילתות service-role חייבות predicate מפורש של org.
- **פער ידוע:** אין `tests/` בכלל — ל-crm-law יש `tests/security/rls.pentest.test.js` (שני tenants, אימות בידוד). בנה מקבילה עם שני orgs סינתטיים. זה Critical.
- כל endpoint פיננסי/קבצים עובר `requireUser`/`requireMember` (`functions/api/_lib/auth.js`) לפני כל לוגיקה.
- `receipt_image` מאוחסן base64 בתוך שורת DB — חשיפת data-at-rest + payload כבד (גם Step 3). הצע מעבר ל-Supabase Storage כריפקטור שורש.
- בדוק את שרשרת סריקת המייל (`functions/api/mail/*`, `mail-scan-worker/`) — טוקנים, הצפנה (`mailCrypto.js`), והפרדת org.

### Step 3 — Scalability & Performance
- **`functions/api/chat.js` — בדיקה ראשונה:** זו אותה תבנית כמו בבוט ה-CRM, ששם נמצאה בעיה קריטית (C1): בניית פרומפט מכל שורות הנתונים ללא תקרה → גדילת טוקנים בלתי חסומה. ב-crm-law תוקן כך: **תקרת `LIST_CAP = 250` על רשימות הפירוט בלבד, כל הסכומים/ספירות נשארים מחושבים על המערכים המלאים** (מדויקים), עם הערת "מוצגות N מתוך M". אם הדפוס קיים כאן — החל את אותו תיקון בדיוק. אסור לחתוך את ה-fetch עצמו בלי להעביר סכומים ל-aggregates (זה יעוות מספרים = הפלסטר האסור).
- Pagination: `ReceiptsPage` — האם נטען הכל בבת אחת (`select` בלי `.range()`)? הצע cursor/infinite-scroll מקצה-לקצה.
- Aggregation של dashboard בצד לקוח (`categoryStats.js`) — הצע summary queries או cache (יש כבר `pageCache.js`/`prefetch.js` — השתמש בקיים).
- פעולות כבדות (OCR, `pdfUtils.js`, `imageUtils.js`, סריקת מייל) — מחוץ למחזור request/response (`waitUntil`/רקע).

### Step 4 — Guardrails
הוסף ל-`CLAUDE.md` הקיים סעיף "Engineering Guardrails (BINDING)" בנוסח שנקבע ב-crm-law: (1) Root-Cause-First — אין hotfix בלי הצהרת שורש; (2) SSOT פיננסי — מצביע לקבצים הקנוניים שתקבע; (3) בידוד org_id לא-מתפשר + חובת isolation test לטבלה חדשה; (4) דחיית בקשות שמפרות ארכיטקטורה/בידוד — הסבר והצע חלופה; (5) רכיבים רזים — עמודים מרנדרים, לוגיקה ב-helpers טהורים.

## תוצר שלב 0
`docs/ARCHITECTURE-AUDIT-2026.md` — ממצאים ב-Critical/Major/Optimization + טבלת סיכום. **עצור והמתן לאישורי לפני כל שינוי קוד.**

## שלב 1 — ביצוע (רק אחרי אישורי, לפי סדר חומרה)

**תשתית בדיקות תחילה:** צור פרויקט Cloudflare Pages בשם `receipts-testing` (`npx wrangler pages project create receipts-testing --production-branch=master`) והוסף script ל-package.json: `"deploy:testing": "npm run build && wrangler pages deploy dist --project-name receipts-testing --branch=master --commit-dirty=true"`. שים לב: הסביבה חולקת את ה-DB האמיתי — היא מאמתת קוד, לא מריצה ניסויים הרסניים על נתונים. אם ל-Functions נדרשים secrets — עצור ותנחה אותי להגדירם בדשבורד (אל תנסה להזרים ערכי סודות בעצמך).

לכל תיקון: build ירוק → `deploy:testing` → אני מאמת → commit+push → ורק אחרי אישורי המפורש `npm run deploy` ל-production.

## אילוצים קשיחים

1. **נתוני production אמיתיים** — אסור לגעת/לשנות נתונים. SQL migrations מוצגים לי לביצוע ידני ב-Supabase SQL Editor בלבד.
2. **Secrets** — רק בדשבורד Cloudflare. לעולם לא בקוד, לא ב-git, לא בפלט.
3. **גיבוי** — commit+push ל-`Moses_Caffee` בכל אבן-דרך. לפני כל commit: ודא שאין קבצי סודות ב-staging (`git check-ignore`, סריקת diff).
4. **npm overrides** — אם תצטרך override לתלות: **ממוקד לחבילה** (nested), לא גלובלי. לקח מ-crm-law: override גלובלי של brace-expansion 5.x שבר eslint ו-build (minimatch ישן צריך default callable).
5. **בסוף** — עדכן את `docs/SECURITY-REPORT-ISO27001-2026.md` (סעיף חדש + גרסה) רק עם מה שבאמת בוצע; מה שדורש אותי → טבלת "פעולות לטיפולך".
6. הרץ `npm audit` לאימות שאין Critical/High חדשים (הפרויקט היה נקי ב-4.7.2026).

## התחל עכשיו
בצע את **שלב 0 בלבד** — קרא את הקוד, כתוב את ה-Blueprint, והצג לי טבלת ממצאים מסכמת. אל תשנה שום קובץ מלבד יצירת מסמך ה-audit עד לאישורי.

════════════════════════════════════════
סוף ה-PROMPT
════════════════════════════════════════

---

## טיפים לניהול השיחה (כמו שעבד ב-crm-law)

- אחרי ה-Blueprint: אשר עם "אשר, תתחיל ביצוע לפי הסדר" או בחר ממצאים ספציפיים.
- הוא יעצור לפני כל פריסה ל-production ויבקש אישור מפורש — זה מכוון (מנגנון בטיחות). ענה "מאשר פריסה ל-production" כשתרצה.
- אם הוא נחסם על פקודת secrets: היכנס לדשבורד Cloudflare → הפרויקט → Settings → Variables and Secrets והדבק שם בעצמך.
- SQL שהוא מציג: העתק ל-Supabase → SQL Editor → הרץ → חזור עם "הצלחה" או הודעת השגיאה.
- לאימות בסביבת הבדיקות: היכנס ל-receipts-testing.pages.dev עם המשתמש הרגיל שלך והשווה מספרים למה שאתה מכיר.
