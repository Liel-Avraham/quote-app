/* =========================================================
   app.js — הצעת מחיר בקליק (גרסת SaaS)
   =========================================================
   הערה חשובה על אבטחה: אין כאן שום קוד שמסתיר נתונים של
   משתמש אחר "בצד הלקוח". כל שורה שנטענת מגיעה כבר מסוננת
   מהשרת דרך Row Level Security (ראה supabase-schema.sql).
   הסינון הנוסף כאן (eq('user_id', uid)) הוא רק בשביל בהירות
   קוד - גם בלעדיו האבטחה הייתה שלמה.
   ========================================================= */
(function(){
  "use strict";

  const VAT_RATE = 0.18; // מקום יחיד לשינוי שיעור המע"מ בעתיד

  // מפתחות ה-localStorage של הגרסה הישנה (לצורך זיהוי וייבוא בלבד)
  const LEGACY_LS_BUSINESS = 'hzb_business_v1';
  const LEGACY_LS_QUOTES = 'hzb_quotes_v1';
  const LEGACY_LS_DRAFT = 'hzb_active_draft_v1';

  /* =========================================================
     מצב גלובלי (בזיכרון, לא ב-localStorage)
  ========================================================= */
  let currentUser = null;      // { id, email }
  let business = null;         // שורת business_profiles
  let quotes = [];             // מערך הצעות מהענן
  let searchTerm = '';
  let statusFilter = 'all';
  let migrationDismissed = false;
let remoteDraft = null;

   
  const STATUS_LABELS = {draft:'טיוטה', sent:'נשלחה', approved:'אושרה', cancelled:'בוטלה'};
  const STATUS_BADGE_CLASS = {draft:'badge-draft', sent:'badge-sent', approved:'badge-approved', cancelled:'badge-cancelled'};

  /* =========================================================
     כלי עזר כלליים
  ========================================================= */
  function escapeHtml(str){
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML; // בטוח להצגת טקסט - לא לשימוש בתוך attribute מוטמע
  }
  // בטוח לשימוש בתוך attribute מוטמע במחרוזת (למשל src="${...}") - מגן גם על גרשיים,
  // מה שescapeHtml לא עושה (ראה ההערה מעל)
  function escapeAttr(str){
    return String(str == null ? '' : str)
      .replace(/&/g,'&amp;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;');
  }
  function fmt(n){
    return (Number(n)||0).toLocaleString('he-IL', {minimumFractionDigits:2, maximumFractionDigits:2});
  }
  function todayISO(){
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function showToast(msg, isError){
    const t = document.getElementById('saveToast');
    t.textContent = msg;
    t.classList.toggle('error-toast', !!isError);
    t.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(()=> t.classList.remove('show'), isError ? 3200 : 1800);
  }
  // הודעת שגיאה ידידותית ואחידה - לעולם לא טקסט טכני של השרת
  function friendlyError(action){
    showToast(action + '. הנתונים שלך לא נפגעו. נסו שוב.', true);
  }

  /* =========================================================
     סרגל מצב רשת
  ========================================================= */
  function updateNetworkBanner(){
    document.getElementById('networkBanner').classList.toggle('show', !navigator.onLine);
  }
  window.addEventListener('online', updateNetworkBanner);
  window.addEventListener('offline', updateNetworkBanner);

  /* =========================================================
     ניווט בין מסכים
  ========================================================= */
  function showView(name){
    document.querySelectorAll('[data-view]').forEach(el => el.style.display = 'none');
    const el = document.getElementById('view-' + name);
    el.style.display = 'block';
    el.classList.remove('view');
    void el.offsetWidth;
    el.classList.add('view');
    window.scrollTo(0, 0);
  }

  /* =========================================================
     ============  A U T H E N T I C A T I O N  ============
  ========================================================= */

  function mapAuthError(err, context){
    const msg = (err && err.message) ? err.message.toLowerCase() : '';
    if(context === 'login'){
      // בכוונה לא מבדילים בין "אימייל לא קיים" ל"סיסמה שגויה"
      return 'האימייל או הסיסמה אינם נכונים.';
    }
    if(context === 'signup'){
      if(msg.includes('already') || msg.includes('registered') || msg.includes('exists')){
        return 'האימייל כבר רשום במערכת';
      }
      if(msg.includes('password')){
        return 'הסיסמה קצרה מדי';
      }
      if(msg.includes('email')){
        return 'האימייל שהוזן אינו תקין';
      }
    }
    return 'אירעה שגיאה. נסו שוב בעוד רגע.';
  }

  function renderAuthForm(mode){
    const area = document.getElementById('authFormArea');

    if(mode === 'login'){
      area.innerHTML = `
        <div class="auth-logo">🧾</div>
        <div class="auth-title">התחברות</div>
        <div class="auth-sub">הצעת מחיר בקליק</div>
        <div class="error-box" id="authErrorBox"><ul id="authErrorList"></ul></div>
        <div class="field">
          <label for="loginEmail">אימייל</label>
          <input type="email" id="loginEmail" placeholder="you@example.com" autocomplete="username">
        </div>
        <div class="field">
          <label for="loginPassword">סיסמה</label>
          <input type="password" id="loginPassword" placeholder="הסיסמה שלך" autocomplete="current-password">
        </div>
        <div class="auth-forgot-row"><button type="button" id="toForgot">שכחתי סיסמה</button></div>
        <div class="actions">
          <button class="btn-primary" id="btnLogin">התחברות</button>
        </div>
        <div class="auth-switch">אין לך חשבון? <button type="button" id="toSignup">הרשמה</button></div>
      `;
      document.getElementById('toForgot').addEventListener('click', ()=> renderAuthForm('forgot'));
      document.getElementById('toSignup').addEventListener('click', ()=> renderAuthForm('signup'));
      document.getElementById('btnLogin').addEventListener('click', doLogin);
      ['loginEmail','loginPassword'].forEach(id=>{
        document.getElementById(id).addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });
      });
    }

    else if(mode === 'signup'){
      area.innerHTML = `
        <div class="auth-logo">🧾</div>
        <div class="auth-title">הרשמה</div>
        <div class="auth-sub">יצירת חשבון חדש - חינם</div>
        <div class="error-box" id="authErrorBox"><ul id="authErrorList"></ul></div>
        <div class="field">
          <label for="signupEmail">אימייל</label>
          <input type="email" id="signupEmail" placeholder="you@example.com" autocomplete="username">
        </div>
        <div class="field">
          <label for="signupPassword">סיסמה</label>
          <input type="password" id="signupPassword" placeholder="לפחות 6 תווים" autocomplete="new-password">
        </div>
        <div class="field" style="margin-bottom:0;">
          <label for="signupPassword2">אימות סיסמה</label>
          <input type="password" id="signupPassword2" placeholder="הקלידו שוב" autocomplete="new-password">
        </div>
        <div class="actions" style="margin-top:16px;">
          <button class="btn-primary" id="btnSignup">הרשמה</button>
        </div>
        <div class="auth-switch">יש לך כבר חשבון? <button type="button" id="toLogin">התחברות</button></div>
      `;
      document.getElementById('toLogin').addEventListener('click', ()=> renderAuthForm('login'));
      document.getElementById('btnSignup').addEventListener('click', doSignup);
    }

    else if(mode === 'forgot'){
      area.innerHTML = `
        <div class="auth-logo">🔑</div>
        <div class="auth-title">איפוס סיסמה</div>
        <div class="auth-sub">נשלח אליך קישור לאיפוס באימייל</div>
        <div class="error-box" id="authErrorBox"><ul id="authErrorList"></ul></div>
        <div class="success-box" id="authSuccessBox">נשלח אימייל עם קישור לאיפוס הסיסמה. בדקו את תיבת הדואר (וגם את תיקיית הספאם).</div>
        <div class="field" style="margin-bottom:0;">
          <label for="forgotEmail">אימייל</label>
          <input type="email" id="forgotEmail" placeholder="you@example.com">
        </div>
        <div class="actions" style="margin-top:16px;">
          <button class="btn-primary" id="btnForgot">שליחת קישור לאיפוס</button>
        </div>
        <div class="auth-switch"><button type="button" id="toLoginBack">חזרה להתחברות</button></div>
      `;
      document.getElementById('toLoginBack').addEventListener('click', ()=> renderAuthForm('login'));
      document.getElementById('btnForgot').addEventListener('click', doForgotPassword);
    }

    else if(mode === 'reset'){
      area.innerHTML = `
        <div class="auth-logo">🔑</div>
        <div class="auth-title">קביעת סיסמה חדשה</div>
        <div class="auth-sub">הקישור אומת בהצלחה</div>
        <div class="error-box" id="authErrorBox"><ul id="authErrorList"></ul></div>
        <div class="field">
          <label for="resetPassword">סיסמה חדשה</label>
          <input type="password" id="resetPassword" placeholder="לפחות 6 תווים">
        </div>
        <div class="field" style="margin-bottom:0;">
          <label for="resetPassword2">אימות סיסמה</label>
          <input type="password" id="resetPassword2" placeholder="הקלידו שוב">
        </div>
        <div class="actions" style="margin-top:16px;">
          <button class="btn-primary" id="btnResetPw">שמירת סיסמה חדשה</button>
        </div>
      `;
      document.getElementById('btnResetPw').addEventListener('click', doResetPassword);
    }

    else if(mode === 'checkEmail'){
      area.innerHTML = `
        <div class="auth-logo">📧</div>
        <div class="auth-title">כמעט סיימנו</div>
        <div class="auth-sub">שלחנו אימייל אימות לכתובת שהזנת. אשרו אותו ואז התחברו.</div>
        <div class="actions" style="margin-top:16px;">
          <button class="btn-primary" id="btnBackToLoginFromCheck">חזרה להתחברות</button>
        </div>
      `;
      document.getElementById('btnBackToLoginFromCheck').addEventListener('click', ()=> renderAuthForm('login'));
    }
  }

  function showAuthErrors(list){
    const box = document.getElementById('authErrorBox');
    const ul = document.getElementById('authErrorList');
    if(!box) return;
    if(!list.length){ box.classList.remove('show'); return; }
    ul.innerHTML = list.map(e => `<li>${escapeHtml(e)}</li>`).join('');
    box.classList.add('show');
    const sBox = document.getElementById('authSuccessBox');
    if(sBox) sBox.classList.remove('show');
  }

  function isValidEmail(v){
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  async function doLogin(){
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errors = [];
    if(!email || !isValidEmail(email)) errors.push('האימייל שהוזן אינו תקין');
    if(!password) errors.push('יש להזין סיסמה');
    if(errors.length){ showAuthErrors(errors); return; }

    const btn = document.getElementById('btnLogin');
    btn.disabled = true; btn.textContent = 'מתחבר...';
    try{
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if(error){ showAuthErrors([mapAuthError(error, 'login')]); return; }
      // onAuthStateChange יטפל בהמשך (טעינת נתונים ומעבר לדף הבית)
    }catch(e){
      showAuthErrors(['אין חיבור לשרת כרגע. בדקו את החיבור לאינטרנט ונסו שוב.']);
    }finally{
      btn.disabled = false; btn.textContent = 'התחברות';
    }
  }

  async function doSignup(){
    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;
    const password2 = document.getElementById('signupPassword2').value;
    const errors = [];
    if(!email || !isValidEmail(email)) errors.push('האימייל שהוזן אינו תקין');
    if(!password || password.length < 6) errors.push('הסיסמה קצרה מדי');
    if(password !== password2) errors.push('הסיסמאות אינן זהות');
    if(errors.length){ showAuthErrors(errors); return; }

    const btn = document.getElementById('btnSignup');
    btn.disabled = true; btn.textContent = 'נרשם...';
    try{
      const { data, error } = await sb.auth.signUp({ email, password });
      if(error){ showAuthErrors([mapAuthError(error, 'signup')]); return; }
      if(data && data.session){
        // אימות אוטומטי מופעל בפרויקט - יש session מיד, onAuthStateChange יטפל בהמשך
      } else {
        // דרוש אימות אימייל לפני התחברות
        renderAuthForm('checkEmail');
      }
    }catch(e){
      showAuthErrors(['אין חיבור לשרת כרגע. בדקו את החיבור לאינטרנט ונסו שוב.']);
    }finally{
      btn.disabled = false; btn.textContent = 'הרשמה';
    }
  }

  async function doForgotPassword(){
    const email = document.getElementById('forgotEmail').value.trim();
    if(!email || !isValidEmail(email)){ showAuthErrors(['האימייל שהוזן אינו תקין']); return; }
    const btn = document.getElementById('btnForgot');
    btn.disabled = true; btn.textContent = 'שולח...';
    try{
      const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname
      });
      // לא חושפים אם האימייל קיים במערכת או לא - תמיד אותה הודעה
      showAuthErrors([]);
      document.getElementById('authSuccessBox').classList.add('show');
    }catch(e){
      showAuthErrors(['אין חיבור לשרת כרגע. בדקו את החיבור לאינטרנט ונסו שוב.']);
    }finally{
      btn.disabled = false; btn.textContent = 'שליחת קישור לאיפוס';
    }
  }

  async function doResetPassword(){
    const p1 = document.getElementById('resetPassword').value;
    const p2 = document.getElementById('resetPassword2').value;
    const errors = [];
    if(!p1 || p1.length < 6) errors.push('הסיסמה קצרה מדי');
    if(p1 !== p2) errors.push('הסיסמאות אינן זהות');
    if(errors.length){ showAuthErrors(errors); return; }

    const btn = document.getElementById('btnResetPw');
    btn.disabled = true; btn.textContent = 'שומר...';
    try{
      const { error } = await sb.auth.updateUser({ password: p1 });
      if(error){ showAuthErrors(['לא הצלחנו לעדכן את הסיסמה. נסו לבקש קישור חדש.']); return; }
      showToast('הסיסמה עודכנה בהצלחה');
      await afterLogin();
    }catch(e){
      showAuthErrors(['אין חיבור לשרת כרגע. בדקו את החיבור לאינטרנט ונסו שוב.']);
    }finally{
      btn.disabled = false; btn.textContent = 'שמירת סיסמה חדשה';
    }
  }

  async function doLogout(){
    try{ await sb.auth.signOut(); }catch(e){}
    currentUser = null; business = null; quotes = [];
    renderAuthForm('login');
    showView('auth');
  }

  /* =========================================================
     טעינת נתוני האפליקציה אחרי התחברות
  ========================================================= */
  async function afterLogin(){
    showView('loading');
    try{
      const { data: { session } } = await sb.auth.getSession();
      if(!session){ renderAuthForm('login'); showView('auth'); return; }
      currentUser = session.user;

      business = await ensureBusinessProfile();
      quotes = await loadQuotesFromCloud();
      await loadRemoteDraft();

      showView('home');
      renderHome();
      checkLegacyMigration();
    }catch(e){
      showToast('לא הצלחנו לטעון את הנתונים שלך. בדקו את החיבור לאינטרנט ונסו לרענן.', true);
      showView('home');
      renderHome();
    }
  }

  async function ensureBusinessProfile(){
    let { data, error } = await sb.from('business_profiles').select('*').eq('user_id', currentUser.id).maybeSingle();
    if(error) throw error;
    if(!data){
      const created = await sb.from('business_profiles').insert({}).select().single();
      if(created.error) throw created.error;
      data = created.data;
    }
    return data;
  }

  async function loadQuotesFromCloud(){
    const { data, error } = await sb.from('quotes')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('updated_at', { ascending:false });
    if(error) throw error;
    return data || [];
  }

  async function loadRemoteDraft(){
    try{
      const { data, error } = await sb.from('drafts').select('draft').eq('user_id', currentUser.id).maybeSingle();
      if(error) throw error;
      remoteDraft = (data && data.draft) ? data.draft : null;
    }catch(e){
      remoteDraft = null; // כשל בטעינת טיוטה לא אמור לחסום את שאר האפליקציה
    }
  }

  /* =========================================================
     אתחול: בדיקת session קיים + מאזין לשינויים
  ========================================================= */
  let authListenerReady = false;

  sb.auth.onAuthStateChange((event, session) => {
    if(event === 'PASSWORD_RECOVERY'){
      renderAuthForm('reset');
      showView('auth');
      return;
    }
    if(!authListenerReady) return; // מתעלמים מהאירוע הראשוני - מטופל ב-init() למטה
    if(event === 'SIGNED_IN'){
      afterLogin();
    } else if(event === 'SIGNED_OUT'){
      currentUser = null; business = null; quotes = [];
      renderAuthForm('login');
      showView('auth');
    }
  });

  async function init(){
    updateNetworkBanner();
    showView('loading');
    try{
      const { data: { session } } = await sb.auth.getSession();
      if(session){
        await afterLogin();
      } else {
        renderAuthForm('login');
        showView('auth');
      }
    }catch(e){
      renderAuthForm('login');
      showView('auth');
    }
    authListenerReady = true;
  }


  /* =========================================================
     ============  מיגרציה מ-localStorage לענן  ============
  ========================================================= */
  function readLegacyData(){
    let legacyBusiness = null, legacyQuotes = [], legacyDraft = null;
    try{ const b = localStorage.getItem(LEGACY_LS_BUSINESS); if(b) legacyBusiness = JSON.parse(b); }catch(e){}
    try{ const q = localStorage.getItem(LEGACY_LS_QUOTES); if(q) legacyQuotes = JSON.parse(q) || []; }catch(e){}
    try{ const d = localStorage.getItem(LEGACY_LS_DRAFT); if(d) legacyDraft = JSON.parse(d); }catch(e){}
    return { legacyBusiness, legacyQuotes, legacyDraft };
  }

  function hasLegacyData(){
    const { legacyBusiness, legacyQuotes, legacyDraft } = readLegacyData();
    return !!(legacyBusiness || (legacyQuotes && legacyQuotes.length) || legacyDraft);
  }

  function renderDraftBanner(){
    const box = document.getElementById('draftBanner');
    if(!remoteDraft){ box.innerHTML=''; return; }
    const label = remoteDraft.editingId ? ('עריכה של הצעה #' + remoteDraft.number) : ('הצעה חדשה #' + remoteDraft.number);
    box.innerHTML = `
      <div class="draft-banner">
        📝 יש לך <b>${escapeHtml(label)}</b> שלא הושלמה.
        <div class="btn-row">
          <button class="resume-btn" id="resumeDraftBtn">המשך עריכה</button>
          <button class="discard-btn" id="discardDraftBtn">מחיקת טיוטה</button>
        </div>
      </div>`;
    document.getElementById('resumeDraftBtn').addEventListener('click', function(){
      openFormWithData(remoteDraft, remoteDraft.editingId || null, remoteDraft.number);
    });
    document.getElementById('discardDraftBtn').addEventListener('click', async function(){
      if(!confirm('למחוק את הטיוטה שלא נשמרה?')) return;
      await clearRemoteDraft();
      renderDraftBanner();
    });
  }

  function checkLegacyMigration(){
    const box = document.getElementById('migrationBanner');
    if(migrationDismissed || !hasLegacyData()){ box.innerHTML=''; return; }
    const { legacyQuotes } = readLegacyData();
    box.innerHTML = `
      <div class="migration-banner">
        📦 מצאנו <b>${legacyQuotes.length}</b> הצעות מחיר שנשמרו במכשיר הזה מגרסה קודמת.
        אפשר לייבא אותן לחשבון החדש שלך כדי לגשת אליהן מכל מכשיר.
        <div class="btn-row">
          <button class="import-btn" id="btnImportLegacy">ייבוא לחשבון</button>
          <button class="skip-btn" id="btnSkipLegacy">דילוג</button>
        </div>
      </div>`;
    document.getElementById('btnImportLegacy').addEventListener('click', runMigr
