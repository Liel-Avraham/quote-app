/* =========================================================
   config.js — הגדרות חיבור ל-Supabase
   =========================================================
   ה-URL וה-Publishable/Anon key כאן מיועדים להיות פומביים -
   הם נשלחים לדפדפן של כל מבקר באתר, וזה תקין ובטוח.
   ההגנה האמיתית על הנתונים היא ב-Row Level Security במסד
   הנתונים (ראה supabase-schema.sql), לא בהסתרת המפתח הזה.

   לעולם אין להכניס לכאן service_role key או כל מפתח אחר
   שמתחיל ב-"secret" — מפתח כזה מבטל את כל ההגנה.
   ========================================================= */
const SUPABASE_URL = 'https://zxqzwymupfbxegndssoq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_F5VrrBVP1Fz71weL31KySg_wqhMGQw-';

// יצירת לקוח Supabase יחיד לשימוש בכל האפליקציה
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

