# החבורה שלי — MVP

משחק שמטפטף בהדרגה צמדי תמונות בעלי אותו שם. הילד רואה משחק; מנגנון ההתקדמות נשמר מאחורי הקלעים.

> Auto-deploy test: 2026-08-14

## Stack
- Cloudflare Worker — API + game engine
- Cloudflare D1 — families, players, characters, state, sessions, events, confusions
- Cloudflare R2 — two images + recorded audio per character
- Workers Static Assets — UI

## מה כבר עובד
- יצירת משפחה ושחקן
- אזור הורה
- העלאת שם + 2 תמונות + קובץ/הקלטת קול
- שמירה ב-D1 + R2
- משחק "איפה ...?"
- התחלה עם 3 דמויות
- score פנימי לפי הצלחות/טעויות
- טפטוף דמות חדשה לאחר יציבות בסיסית
- שמירת בלבולים בין דמויות
- שמירת sessions/events
- המשך מצב מהשרת לאחר סגירה ופתיחה מחדש

## הקמה ב-Cloudflare

```bash
npm install
npx wrangler login
npx wrangler d1 create name-pairs-db
npx wrangler r2 bucket create name-pairs-media
```

העתק את `database_id` שחוזר מ-D1 אל `wrangler.jsonc` במקום `REPLACE_WITH_D1_DATABASE_ID`.

הפעל migrations בענן:

```bash
npm run db:remote
```

פיתוח:

```bash
npm run dev
```

פריסה:

```bash
npm run deploy
```

## הערות MVP
- כרגע מזהי family/player נשמרים ב-localStorage רק לצורך זיהוי המכשיר; כל מצב המשחק והתוכן נשמרים בענן.
- אזור ההורה עדיין ללא PIN אמיתי. זה הפריט הראשון שכדאי להוסיף לפני שימוש חיצוני.
- endpoint של media מוגש דרך ה-Worker כדי שה-R2 bucket לא יצטרך להיות ציבורי.
- מנגנון הטפטוף ראשוני: כל הדמויות הפעילות צריכות לפחות 4 ניסיונות ו-72% הצלחה לפני צירוף דמות נוספת.
