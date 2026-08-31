# SafeTube Player — הוראות עבודה מלאות לקורסר (v3)

## ⚠️ קרא את זה קודם, לפני שאתה נוגע בקוד

זה מסמך ל-AI שעובד על קוד production. **הכללים בסעיף "גבולות עבודה" הם לא
הצעות — הם תנאי סף.** אם אתה לא בטוח אם משהו מותר, עצור ותשאל את המשתמש
לפני שאתה עורך קוד.

---

## גבולות עבודה — קרא לפני כל שורת קוד

1. **אל תערוך את הקבצים הבאים בשום מצב — גם לא "תיקון קטן" או "שיפור אגבי":**
   - `CleanPlayer.tsx`
   - `youtubeEmbedUrl.ts`
   - `MainActivity.java` (בפרט חלקי media/cookies)
   - `streamApi.ts`
   אם אתה חושב שהבעיה שאתה פותר דורשת לגעת באחד מהם — **תעצור ותשאל את
   המשתמש קודם.** אל תניח שזה "מספיק קטן שזה בסדר".

2. **עבוד בצעד אחד בכל פעם.** אל תבצע את כל השלבים בסעיף "סדר עבודה" ברצף
   אחד. תבצע שלב אחד, תעצור, תן למשתמש לבדוק על מכשיר אמיתי שהנגן עדיין
   עובד (סרטון נטען ומתנגן כרגיל), ורק אחרי אישור תמשיך לשלב הבא.

3. **לפני שאתה מתחיל — ודא שיש git commit נקי.** אם אין, בקש מהמשתמש
   לעשות commit לפני שממשיכים. עבוד ב-branch נפרד, לא ב-main.

4. **אסור להחזיר / להוסיף:**
   - YouTube IFrame API (`useYoutubeIframePlayer`) — גרם בעבר ל-
     `insertBefore` crashes.
   - Media Bridge / googlevideo / hls.js בנתיב אנדרואיד — גרם בעבר לקיפאון
     נגן אחרי כ-1 שנייה.

5. **אם משהו לא ברור או שנראה לך שצריך refactor רחב יותר ממה שהתבקשת —
   תעצור ותסביר למה, במקום להרחיב את השינוי בעצמך.**

---

## הקשר המוצרי

SafeTube היא אפליקציית **בקרת הורים** ל-YouTube:
- ההורה בוחר מראש אילו ערוצים מאושרים לילד.
- הילד צופה רק בהם, בלי פרסומות, בלי גלישה חופשית ביוטיוב.
- **מטרת UX מרכזית: הילד ירגיש שהוא צופה ביוטיוב האמיתי** (זו הדרך
  להיגמל בהדרגה מיוטיוב הרגיל — לא ע"י ממשק "לילדים" שמרגיש מזויף).

מזה נובעת גישת העבודה: **לא מסתירים UI לגיטימי של יוטיוב. חוסמים רק
נתיבי בריחה מהסנדבוקס.**

---

## קדוש / FROZEN — נתיב הניגון (חוזר, לשם הדגשה)

מסלול ניגון אנדרואיד תקין:
```
Tap video → CleanPlayer → CleanPlayerYoutubeIframe →
plain <iframe src=youtube.com/embed> → native YouTube controls
```
זה עובד. אל תשנה את הארכיטקטורה הזו. כל עבודה על fullscreen/swipe היא
**מסביב** לנתיב הזה, לא בתוכו.

כללי הגנה קיימים בפרויקט: `.cursor/rules/protect-playback.mdc`,
`android-player.mdc` — קרא אותם לפני שמתחילים.

---

## החלטות מוצר סופיות

### 1. UI נייטיבי של יוטיוב בתוך הנגן
mute, progress bar, כפתור fullscreen של יוטיוב עצמו — **נשארים כמו שהם.**
לא מסתירים, לא מרפדים ב-overlay, לא מחליפים בכפתורים משלנו.

### 2. מה כן חוסמים — פונקציונלית, לא ויזואלית
- Share / שיתוף חיצוני
- "Watch on YouTube" וכל ניווט שיוצא מהאפליקציה
- הצעות סרטונים (related/suggested) שמובילות לתוכן לא מאושר
- תגובות

**איך:** ליירוט קליקים/ניווט ברמת deep-link handler / WebView, לא CSS
overlay מעל ה-iframe (overlay לא אמין — זז עם orientation/theater/safe-area).
**לפני שבונים מנגנון חדש** — בדוק ב-`youtubeEmbedUrl.ts` אילו embed params
כבר קיימים (`rel=0`, `modestbranding=1` וכו') — ייתכן שחלק מהחסימה כבר קיימת.

### 3. Fullscreen — יעד: native אמיתי, לא CSS theater
- הבעיה הנוכחית: `html.safetube-theater` מדמה מסך מלא ב-CSS בלבד, ולא
  ממלא מסך אמין ב-WebView. נלחם עם safe-area / system bars / orientation lock.
- יעד: immersive mode אמיתי באנדרואיד (הסתרת system bars ברמת
  Activity/WebView, לא CSS), בתיאום עם `MediaPlaybackPlugin` הקיים.
- וידאו ארוך במסך מלא: **letterbox** (16:9 מלא, פסים שחורים אם צריך) —
  לא crop, לא stretch. מונע חיתוך כותרות עבריות.
- שורט במסך מלא: פורטרט מלא (9:16), נעילת פורטרט.

### 4. שורטים — swipe בין סרטונים
קיים ועובד (`KidShortsLane`). **לא לגעת, לא לשנות.**

### 5. וידאו ארוך — swipe לסרטון הבא (פיצ'ר חדש, לא קיים היום)
- זה **לא** קיים ב-YouTube iframe embed המקורי. יש לבנות מאפס.
- מימוש: SafeTube תופס gesture **מחוץ** לאזור ה-iframe (container/overlay
  שמעביר click-through לנגן אך תופס swipe/pan), ובתגובה מחליף `src` של
  ה-iframe לסרטון הבא מה-queue הקיים ב-`ChildWatchPlayerShell`.
- **חשוב:** המעבר לא יהיה חלק כמו באפליקציית יוטיוב המקורית (אין גישה
  ל-preload ברמת native). MVP: swap src + loading state קצר, בלי preload.
  אופטימיזציה — בשלב מאוחר יותר, לא ב-pass הראשון.

### 6. Short vs Long — שתי state machines נפרדות לגמרי
לא flag משותף ("portrait or landscape" מבוסס דגל בודד) — זה מקור ה-race
condition שגרם לבאג שראינו (תוכן אנכי בתוך chrome אופקי). כל אחד עם זיהוי,
נעילת אוריינטציה, ולוגיקת fullscreen נפרדים.

---

## סדר עבודה (שלב אחד בכל פעם — ראה גבולות עבודה #2)

1. הפרדת long-video expand flow מ-short expand flow — בקוד, לא רק CSS class.
2. immersive fullscreen native לאנדרואיד, במקום `html.safetube-theater`.
   Letterbox, לא stretch.
3. Event interception ל-share / watch-on-youtube / suggested-videos.
4. Swipe-to-next לוידאו ארוך — פיצ'ר נפרד, לא נוגע ב-KidShortsLane.
5. בדיקה על מכשיר אמיתי: וידאו ארוך + שורט, expand, swipe, שני כיוונים.

---

## קבצים מרכזיים לקריאה (לא כולם לעריכה — ראה גבולות עבודה)
- `src/components/player/CleanPlayer.tsx` — **FROZEN, לא לעריכה**
- `src/components/kid/ChildWatchPlayerShell.tsx`
- `src/hooks/usePlayerTouchGestures.ts`
- `src/lib/playerTheater.ts` (יוחלף בהדרגה בלוגיקה native)
- `src/lib/playerOrientation.ts`
- `src/index.css` (theater block, ~שורות 336–510 — יצומצם)
- `src/components/kid/KidShortsLane.tsx` — לא לגעת
- `.cursor/rules/protect-playback.mdc`
- `youtubeEmbedUrl.ts` — **FROZEN, לא לעריכה**, רק לקריאה לבדיקת embed params

---

## תזכורת אחרונה
אם באמצע העבודה אתה (קורסר) מגלה שמשהו מהמפורט כאן לא מסתדר עם המציאות
בקוד — **תעצור ותסביר את הפער למשתמש**, אל תאלתר פתרון שסוטה מהכללים
למעלה בלי לשאול.
