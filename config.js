/* =========================================================
   config.js — הגדרות חיבור ל-Supabase
   ========================================================= */
const SUPABASE_URL = 'https://zxqzwymupfbxgndssoq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_F5VrrBVP1Fz71weL31KySg_wqhMGQw-';

// יצירת לקוח Supabase יחיד לשימוש בכל האפליקציה
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
