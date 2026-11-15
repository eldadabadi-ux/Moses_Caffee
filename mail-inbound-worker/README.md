# mail-inbound-worker — קליטת קבלות במייל (שירות עצמי)

Worker של Cloudflare Email Routing. כל הודעה שמגיעה לדומיין הקליטה מנותבת לכאן,
ה-Worker מפענח את ה-MIME, ושולח את הקבצים המצורפים ל-`/api/inbound` של האפליקציה
(אימות בסוד משותף). כל ה-OCR, שיוך הספק והאחסון קורים שם — ה-Worker רק מעביר.

## דרישות מוקדמות

1. **דומיין** המנוהל ב-Cloudflare (הדומיין שבחרת לכתובות הקליטה) — הוא גם ערך
   `INBOUND_DOMAIN` שתגדיר על פרויקט ה-Pages.
2. **הרצת המיגרציה** `supabase_inbound.sql` ב-Supabase (יוצרת את
   `user_settings.inbound_alias`). ודא דרך `npm run migrations`.

## שלבי הקמה (פעם אחת)

1. **התקנה ופריסה של ה-Worker**
   ```bash
   cd mail-inbound-worker
   npm install
   npx wrangler deploy
   ```

2. **הגדרת הסוד המשותף** (אותו ערך בשני המקומות):
   ```bash
   # כאן על ה-Worker:
   npx wrangler secret put INBOUND_SECRET
   ```
   ואז על פרויקט ה-Pages (Settings → Environment variables) הוסף:
   - `INBOUND_SECRET` — אותו ערך בדיוק.
   - `INBOUND_DOMAIN` — דומיין הקליטה (למשל `receipts-inbox.com`).

3. **עדכון `wrangler.toml`** — ודא ש-`INBOUND_API_URL` מצביע על ה-Pages החי:
   `https://<pages-project>.pages.dev/api/inbound` (או דומיין מותאם).

4. **Cloudflare Email Routing** (בדשבורד → הדומיין → Email):
   - Enable Email Routing (יוסיף רשומות MX/TXT — אשר).
   - **Routing rules → Catch-all address → Action: Send to a Worker →
     `mail-inbound-worker`**. כך כל alias@הדומיין מגיע ל-Worker.
     (לחלופין אפשר כלל פר-כתובת, אך catch-all מתאים לשירות עצמי.)

5. **בדיקה**: שלח מייל עם קבלה מצורפת לכתובת האישית שמופיעה במסך
   "הגדרות → קליטת מייל אוטומטית". תוך דקה הקבלה תופיע ב"קבלות" בסטטוס "ממתינה",
   לאישור כמו בסריקה. ל-debug: `npx wrangler tail`.

## אבטחה

- `/api/inbound` דוחה כל בקשה ללא הסוד הנכון (403).
- כתובת לא מוכרת או הודעה כפולה (לפי message-id) מתקבלות אך לא מיובאות שוב.
- רק קבצים מסוג תמונה/PDF עד 10MB מועברים ל-OCR.
