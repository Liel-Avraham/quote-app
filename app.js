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
    document.getElementById('btnImportLegacy').addEventListener('click', runMigration);
    document.getElementById('btnSkipLegacy').addEventListener('click', function(){
      migrationDismissed = true;
      box.innerHTML = '';
    });
  }

  async function runMigration(){
    const btn = document.getElementById('btnImportLegacy');
    if(btn){ btn.disabled = true; btn.textContent = 'מייבא...'; }

    const { legacyBusiness, legacyQuotes, legacyDraft } = readLegacyData();

    try{
      // 1) עדכון פרופיל העסק - רק שדות שלא הוגדרו כבר בענן, ומספור שלא יתנגש
      if(legacyBusiness){
        const highestLegacyNumber = (legacyQuotes||[]).reduce((max,q)=> Math.max(max, Number(q.number)||0), 0);
        const desiredNext = Math.max(
          business.next_quote_number || 1001,
          Number(legacyBusiness.nextNumber) || 1001,
          highestLegacyNumber + 1
        );
        const profileUpdate = {
          business_name: business.business_name || legacyBusiness.name || '',
          phone: business.phone || legacyBusiness.phone || '',
          logo_base64: business.logo_base64 || legacyBusiness.logo || null,
          next_quote_number: desiredNext
        };
        const { data, error } = await sb.from('business_profiles')
          .update(profileUpdate).eq('user_id', currentUser.id).select().single();
        if(error) throw error;
        business = data;
      }

      // 2) ייבוא ההצעות - upsert כדי שניסיון חוזר יהיה בטוח ולא ייצור כפילויות
      if(legacyQuotes && legacyQuotes.length){
        const rows = legacyQuotes.map(q => ({
          user_id: currentUser.id,
          quote_number: q.number,
          customer_name: q.customerName || '',
          customer_phone: '',
          quote_date: q.date || todayISO(),
          valid_days: q.validDays || 14,
          items: (q.rows||[]).map(r=>({desc:r.desc, qty:r.qty, price:r.price})),
          discount: q.discount || 0,
          vat_enabled: q.vatMode === 'with',
          payment_terms: q.payTerms || '',
          notes: q.notes || '',
          status: q.status || 'draft'
        }));
        const { error } = await sb.from('quotes').upsert(rows, { onConflict: 'user_id,quote_number' });
        if(error) throw error;
      }

      // 3) ייבוא טיוטה פעילה (אם קיימת)
      if(legacyDraft){
        const draftPayload = {
          bizName: legacyDraft.bizName, bizPhone: legacyDraft.bizPhone,
          customerName: legacyDraft.customerName, date: legacyDraft.date,
          validDays: legacyDraft.validDays, rows: legacyDraft.rows,
          discount: legacyDraft.discount, vatMode: legacyDraft.vatMode,
          payTerms: legacyDraft.payTerms, notes: legacyDraft.notes,
          number: legacyDraft.number || null
        };
        const { error } = await sb.from('drafts')
          .upsert({ user_id: currentUser.id, draft: draftPayload }, { onConflict: 'user_id' });
        if(error) throw error;
      }

      // 4) רק עכשיו, אחרי שהכל הצליח - מוחקים את הנתונים המקומיים
      localStorage.removeItem(LEGACY_LS_BUSINESS);
      localStorage.removeItem(LEGACY_LS_QUOTES);
      localStorage.removeItem(LEGACY_LS_DRAFT);

      quotes = await loadQuotesFromCloud();
      showToast('הייבוא הושלם בהצלחה — ' + (legacyQuotes||[]).length + ' הצעות מחיר יובאו');
      document.getElementById('migrationBanner').innerHTML = '';
      renderHome();
    }catch(e){
      showToast('הייבוא נכשל. הנתונים במכשיר שלך עדיין שמורים ולא נמחקו. אפשר לנסות שוב.', true);
      if(btn){ btn.disabled = false; btn.textContent = 'ייבוא לחשבון'; }
    }
  }


  /* =========================================================
     ============  חישוב סכומים (מע"מ + הנחה)  ============
  ========================================================= */
  // כאשר vatMode === 'with', המחיר שהוזן הוא המחיר הסופי ללקוח (כולל מע"מ).
  // ההנחה מופעלת על הסכום כולל המע"מ, ורק לאחר מכן מפרקים לאחור
  // ל"לפני מע"מ" + "מע"מ". סה"כ לתשלום = הסכום לאחר הנחה, ללא תוספת.
  function computeQuoteTotal(q){
    let subtotal = 0;
    (q.rows||[]).forEach(r => subtotal += (parseFloat(r.qty)||0) * (parseFloat(r.price)||0));
    const afterDiscount = Math.max(subtotal - (parseFloat(q.discount)||0), 0);
    let vat = 0, beforeVat = afterDiscount;
    if(q.vatMode === 'with'){
      beforeVat = afterDiscount / (1 + VAT_RATE);
      vat = afterDiscount - beforeVat;
    }
    const total = afterDiscount;
    return {subtotal, afterDiscount, beforeVat, vat, total};
  }

  // ממפה שורת quotes מהמסד (snake_case) לאובייקט הפנימי (camelCase) בו משתמש כל שאר הקוד
  function mapDbQuoteToApp(row){
    return {
      id: row.id,
      number: row.quote_number,
      bizName: business ? business.business_name : '',
      bizPhone: business ? business.phone : '',
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      date: row.quote_date,
      validDays: row.valid_days,
      rows: row.items || [],
      discount: Number(row.discount)||0,
      vatMode: row.vat_enabled ? 'with' : 'without',
      payTerms: row.payment_terms,
      notes: row.notes,
      status: row.status,
      updatedAt: row.updated_at
    };
  }


  /* =========================================================
     ============  דף הבית  ============
  ========================================================= */
  function renderHome(){
    renderDraftBanner();
    const area = document.getElementById('homeListArea');
    const summaryArea = document.getElementById('homeSummary');

    const appQuotes = quotes.map(mapDbQuoteToApp);
    let list = appQuotes.slice().sort((a,b)=> new Date(b.updatedAt) - new Date(a.updatedAt));

    // סיכום קטן
    const totalCount = appQuotes.length;
    const openCount = appQuotes.filter(q => q.status === 'draft' || q.status === 'sent').length;
    const approvedCount = appQuotes.filter(q => q.status === 'approved').length;
    summaryArea.innerHTML = totalCount ? `
      <div class="summary-row">
        <div class="summary-box"><div class="num">${totalCount}</div><div class="lbl">סה״כ הצעות</div></div>
        <div class="summary-box"><div class="num">${openCount}</div><div class="lbl">פתוחות</div></div>
        <div class="summary-box"><div class="num">${approvedCount}</div><div class="lbl">אושרו</div></div>
      </div>` : '';

    if(statusFilter !== 'all'){
      list = list.filter(q => q.status === statusFilter);
    }
    if(searchTerm.trim()){
      const s = searchTerm.trim().toLowerCase();
      list = list.filter(q =>
        (q.customerName||'').toLowerCase().includes(s) ||
        String(q.number||'').includes(s)
      );
    }

    let html = '';
    html += `
      <div class="search-row">
        <input type="text" id="searchInput" placeholder="🔍 חיפוש לפי לקוח או מספר הצעה">
        <select id="statusFilterSel">
          <option value="all">כל הסטטוסים</option>
          <option value="draft">טיוטה</option>
          <option value="sent">נשלחה</option>
          <option value="approved">אושרה</option>
          <option value="cancelled">בוטלה</option>
        </select>
      </div>`;

    if(appQuotes.length === 0){
      html += `
        <div class="empty-state">
          <div class="emoji">🧾</div>
          <h3>עדיין אין לך הצעות מחיר</h3>
          <p>צרו את ההצעה הראשונה שלכם תוך פחות מדקה.</p>
        </div>`;
    } else {
      html += `<div class="section-title">📋 היסטוריית הצעות (${list.length})</div>`;
      if(list.length === 0){
        html += `<div class="empty-state"><div class="emoji">🔍</div><h3>לא נמצאו תוצאות</h3><p>נסו חיפוש או סינון אחר.</p></div>`;
      } else {
        list.forEach(q=>{
          const totals = computeQuoteTotal(q);
          const dateStr = q.date ? new Date(q.date + 'T00:00:00').toLocaleDateString('he-IL') : '';
          html += `
            <div class="quote-card" data-id="${q.id}">
              <div class="qc-top">
                <div>
                  <div class="qc-num">#${q.number} · ${escapeHtml(q.customerName||'ללא שם')}</div>
                  <div class="qc-date">${dateStr}</div>
                </div>
                <div style="text-align:left;">
                  <div class="qc-total">${fmt(totals.total)} ₪</div>
                  <span class="badge ${STATUS_BADGE_CLASS[q.status]||'badge-draft'}">${STATUS_LABELS[q.status]||'טיוטה'}</span>
                </div>
              </div>
              <div class="qc-actions">
                <button class="qc-icon-btn open-btn">👁️ פתיחה</button>
                <button class="qc-icon-btn dup-btn">🔁 שכפול</button>
                <button class="qc-icon-btn danger del-btn">🗑️ מחיקה</button>
                <select class="status-quick-sel" title="שינוי סטטוס">
                  <option value="draft">טיוטה</option>
                  <option value="sent">נשלחה</option>
                  <option value="approved">אושרה</option>
                  <option value="cancelled">בוטלה</option>
                </select>
              </div>
            </div>`;
        });
      }
    }

    area.innerHTML = html;

    const searchInput = document.getElementById('searchInput');
    if(searchInput){
      searchInput.value = searchTerm; // property - בטוח, לא attribute מוטמע
      searchInput.addEventListener('input', function(){
        searchTerm = this.value;
        renderHome();
        const si = document.getElementById('searchInput');
        si.focus();
        si.setSelectionRange(si.value.length, si.value.length);
      });
    }
    const statusSel = document.getElementById('statusFilterSel');
    if(statusSel){
      statusSel.value = statusFilter;
      statusSel.addEventListener('change', function(){
        statusFilter = this.value;
        renderHome();
      });
    }

    area.querySelectorAll('.quote-card').forEach(card=>{
      const id = card.dataset.id;
      const q = appQuotes.find(x=>x.id===id);
      const sel = card.querySelector('.status-quick-sel');
      if(sel) sel.value = q.status || 'draft';

      card.querySelector('.open-btn').addEventListener('click', ()=> openQuoteInPreview(id));
      card.querySelector('.dup-btn').addEventListener('click', (e)=>{ e.stopPropagation(); duplicateQuote(id); });
      card.querySelector('.del-btn').addEventListener('click', (e)=>{ e.stopPropagation(); deleteQuote(id); });
      sel.addEventListener('click', e=> e.stopPropagation());
      sel.addEventListener('change', function(){ setQuoteStatus(id, this.value); });
    });
  }

  async function setQuoteStatus(id, status){
    const prevQuotes = quotes;
    try{
      const { data, error } = await sb.from('quotes')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id).eq('user_id', currentUser.id)
        .select().single();
      if(error) throw error;
      quotes = quotes.map(q => q.id === id ? data : q);
      renderHome();
      showToast('הסטטוס עודכן');
    }catch(e){
      quotes = prevQuotes;
      friendlyError('לא הצלחנו לעדכן את הסטטוס');
      renderHome();
    }
  }

  async function deleteQuote(id){
    const q = quotes.find(x=>x.id===id);
    if(!q) return;
    if(!confirm(`למחוק את הצעה מספר #${q.quote_number} (${q.customer_name||''})? הפעולה אינה הפיכה.`)) return;
    try{
      const { error } = await sb.from('quotes').delete().eq('id', id).eq('user_id', currentUser.id);
      if(error) throw error;
      quotes = quotes.filter(x=>x.id!==id);
      renderHome();
      showToast('ההצעה נמחקה');
    }catch(e){
      friendlyError('לא הצלחנו למחוק את ההצעה');
    }
  }

  async function duplicateQuote(id){
    const orig = quotes.find(x=>x.id===id);
    if(!orig) return;
    try{
      const { data: newNumber, error: rpcErr } = await sb.rpc('next_quote_number');
      if(rpcErr) throw rpcErr;
      const payload = {
        quote_number: newNumber,
        customer_name: orig.customer_name,
        customer_phone: orig.customer_phone,
        quote_date: todayISO(),
        valid_days: orig.valid_days,
        items: orig.items,
        discount: orig.discount,
        vat_enabled: orig.vat_enabled,
        payment_terms: orig.payment_terms,
        notes: orig.notes,
        status: 'draft'
      };
      const { data, error } = await sb.from('quotes').insert(payload).select().single();
      if(error) throw error;
      quotes = [data, ...quotes];
      showToast('ההצעה שוכפלה — מספר חדש: #' + newNumber);
      openFormWithData(mapDbQuoteToApp(data), data.id);
    }catch(e){
      friendlyError('לא הצלחנו לשכפל את ההצעה');
    }
  }

  function openQuoteInPreview(id){
    const q = quotes.find(x=>x.id===id);
    if(!q) return;
    renderPreviewDoc(mapDbQuoteToApp(q));
    showView('preview');
  }

  /* =========================================================
     ============  הגדרות עסק  ============
  ========================================================= */
  function renderSettingsForm(){
    document.getElementById('setBizName').value = business.business_name || '';
    document.getElementById('setBizPhone').value = business.phone || '';
    document.getElementById('setBizEmail').value = business.email || '';
    document.getElementById('setBizAddress').value = business.address || '';
    document.getElementById('setBizNumber').value = business.business_number || '';
    document.getElementById('setDefaultPayTerms').value = business.default_payment_terms || '';
    document.getElementById('setNextNumber').value = business.next_quote_number || 1001;
    renderLogoPreview();
  }
  function renderLogoPreview(){
    const box = document.getElementById('logoPreviewBox');
    const removeBtn = document.getElementById('btnRemoveLogo');
    if(business.logo_base64){
      box.innerHTML = `<img src="${escapeAttr(business.logo_base64)}" alt="לוגו">`;
      removeBtn.style.display = 'inline-block';
    } else {
      box.innerHTML = `<span>🏷️</span>`;
      removeBtn.style.display = 'none';
    }
  }
  function handleLogoFile(file){
    if(!file) return;
    if(!file.type || !file.type.startsWith('image/')){
      showToast('יש להעלות קובץ תמונה בלבד', true);
      return;
        }
    const reader = new FileReader();
    reader.onload = function(e){
      const img = new Image();
      img.onload = async function(){
        const maxW = 260;
        const scale = Math.min(1, maxW / img.width);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0,0,w,h);
        ctx.drawImage(img,0,0,w,h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        try{
          const { data, error } = await sb.from('business_profiles')
            .update({ logo_base64: dataUrl }).eq('user_id', currentUser.id).select().single();
          if(error) throw error;
          business = data;
          renderLogoPreview();
          showToast('הלוגו נשמר');
        }catch(err){
          friendlyError('לא הצלחנו לשמור את הלוגו');
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  document.getElementById('logoInput').addEventListener('change', function(){
    if(this.files && this.files[0]) handleLogoFile(this.files[0]);
  });
  document.getElementById('btnRemoveLogo').addEventListener('click', async function(){
    if(!confirm('להסיר את הלוגו?')) return;
    try{
      const { data, error } = await sb.from('business_profiles')
        .update({ logo_base64: null }).eq('user_id', currentUser.id).select().single();
      if(error) throw error;
      business = data;
      renderLogoPreview();
      showToast('הלוגו הוסר');
    }catch(e){
      friendlyError('לא הצלחנו להסיר את הלוגו');
    }
  });
  document.getElementById('btnSaveSettings').addEventListener('click', async function(){
    const btn = this;
    const nn = parseInt(document.getElementById('setNextNumber').value);
    const payload = {
      business_name: document.getElementById('setBizName').value.trim(),
      phone: document.getElementById('setBizPhone').value.trim(),
      email: document.getElementById('setBizEmail').value.trim(),
      address: document.getElementById('setBizAddress').value.trim(),
      business_number: document.getElementById('setBizNumber').value.trim(),
      default_payment_terms: document.getElementById('setDefaultPayTerms').value.trim(),
      next_quote_number: (!isNaN(nn) && nn > 0) ? nn : (business.next_quote_number || 1001)
    };
    btn.disabled = true;
    try{
      const { data, error } = await sb.from('business_profiles')
        .update(payload).eq('user_id', currentUser.id).select().single();
      if(error) throw error;
      business = data;
      showToast('ההגדרות נשמרו');
      showView('home');
      renderHome();
    }catch(e){
      friendlyError('לא הצלחנו לשמור את ההגדרות');
    }finally{
      btn.disabled = false;
    }
  });
  document.getElementById('btnSettingsBack').addEventListener('click', function(){
    showView('home');
    renderHome();
  });
  document.getElementById('btnOpenSettings').addEventListener('click', function(){
    renderSettingsForm();
    showView('settings');
  });

  /* =========================================================
     ============  טופס הצעת מחיר  ============
  ========================================================= */
  const rowsContainer = document.getElementById('rowsContainer');
  const addRowBtn = document.getElementById('addRowBtn');
  const previewBtn = document.getElementById('previewBtn');
  const clearBtn = document.getElementById('clearBtn');
  const errorBox = document.getElementById('errorBox');
  const errorList = document.getElementById('errorList');

  let rowCounter = 0;
  let currentEditingId = null;      // null = הצעה חדשה, אחרת = מזהה השורה בענן
  let currentQuoteNumber = null;    // המספר שכבר הוקצה להצעה הזו (אמיתי, לא זמני)
  let draftSaveTimer = null;
  let remoteDraft = null;           // מטמון הטיוטה שנטענה בהתחברות

  function makeRow(data){
    rowCounter++;
    const div = document.createElement('div');
    div.className = 'service-row';
    div.dataset.rowId = rowCounter;
    div.innerHTML = `
      <div class="top-line">
        <span>שורה ${rowCounter}</span>
        <button type="button" class="remove-row-btn">✖ הסרה</button>
      </div>
      <div class="svc-grid">
        <div class="full field" style="margin-bottom:6px;">
          <label>תיאור *</label>
          <input type="text" class="desc-input" placeholder="לדוגמה: החלפת שקע חשמל">
        </div>
        <div class="field" style="margin-bottom:0;">
          <label>כמות *</label>
          <input type="number" class="qty-input" min="0.01" step="0.01" value="1">
        </div>
        <div class="field" style="margin-bottom:0;">
          <label>מחיר ליחידה (₪) *</label>
          <input type="number" class="price-input" min="0" step="0.01" placeholder="0">
        </div>
      </div>
      <div class="line-total">סה״כ לשורה: <span class="line-total-val">0.00</span> ₪</div>
    `;
    rowsContainer.appendChild(div);

    const descInput = div.querySelector('.desc-input');
    const qtyInput = div.querySelector('.qty-input');
    const priceInput = div.querySelector('.price-input');

    if(data){
      descInput.value = data.desc || '';
      qtyInput.value = (data.qty !== undefined && data.qty !== null) ? data.qty : 1;
      priceInput.value = (data.price !== undefined && data.price !== null) ? data.price : '';
    }

    div.querySelector('.remove-row-btn').addEventListener('click', function(){
      if(rowsContainer.children.length > 1){
        div.remove();
        renumberRows();
        scheduleDraftSave();
      } else {
        alert('חייבת להישאר לפחות שורה אחת.');
      }
    });

    function updateLineTotal(){
      const q = parseFloat(qtyInput.value) || 0;
      const p = parseFloat(priceInput.value) || 0;
      div.querySelector('.line-total-val').textContent = (q*p).toFixed(2);
    }
    [descInput, qtyInput, priceInput].forEach(inp=>{
      inp.addEventListener('input', function(){
        updateLineTotal();
        scheduleDraftSave();
      });
    });
    updateLineTotal();
    return div;
  }

  function renumberRows(){
    [...rowsContainer.children].forEach((row, idx)=>{
      row.querySelector('.top-line span').textContent = 'שורה ' + (idx+1);
    });
  }

  addRowBtn.addEventListener('click', function(){ makeRow(); });

  function clearInvalidStates(){
    document.querySelectorAll('.invalid').forEach(el => el.classList.remove('invalid'));
  }

  /* --- פתיחת טופס להצעה חדשה - מקצה מספר אמיתי מיד (כמו ספר חשבוניות) --- */
  async function openNewQuoteForm(){
    // אם יש טיוטה שמורה של הצעה חדשה (לא עריכה) - ממשיכים אותה במקום להקצות מספר נוסף
    if(remoteDraft && !remoteDraft.editingId){
      openFormWithData(remoteDraft, null, remoteDraft.number);
      showView('form');
      return;
    }

    showToast('מקצה מספר הצעה...');
    try{
      const { data: number, error } = await sb.rpc('next_quote_number');
      if(error) throw error;
      initFormForNew(number);
      showView('form');
    }catch(e){
      friendlyError('לא הצלחנו ליצור הצעה חדשה');
    }
  }

  function initFormForNew(number){
    currentEditingId = null;
    currentQuoteNumber = number;

    document.getElementById('formTitle').textContent = 'הצעת מחיר חדשה';
    rowsContainer.innerHTML = '';
    rowCounter = 0;
    makeRow();

    document.getElementById('quoteNumber').value = '#' + number;
    document.getElementById('quoteDate').value = todayISO();
    document.getElementById('validDays').value = 14;
    document.getElementById('bizName').value = business.business_name || '';
    document.getElementById('bizPhone').value = business.phone || '';
    document.getElementById('custName').value = '';
    document.getElementById('custPhone').value = '';
    document.getElementById('discount').value = '';
    document.getElementById('payTerms').value = business.default_payment_terms || '';
    document.getElementById('notes').value = '';
    document.querySelector('input[name=vat][value=with]').checked = true;

    clearInvalidStates();
    errorBox.classList.remove('show');
  }

  function openFormWithData(data, editingId, numberOverride){
    currentEditingId = editingId || null;
    currentQuoteNumber = numberOverride || data.number;

    document.getElementById('formTitle').textContent = currentEditingId ? ('עריכת הצעה #' + currentQuoteNumber) : 'הצעת מחיר חדשה';

    rowsContainer.innerHTML = '';
    rowCounter = 0;
    (data.rows && data.rows.length ? data.rows : [{desc:'',qty:1,price:''}]).forEach(r => makeRow(r));

    document.getElementById('quoteNumber').value = '#' + currentQuoteNumber;
    document.getElementById('quoteDate').value = data.date || todayISO();
    document.getElementById('validDays').value = data.validDays || 14;
    document.getElementById('bizName').value = data.bizName !== undefined ? data.bizName : (business.business_name || '');
    document.getElementById('bizPhone').value = data.bizPhone !== undefined ? data.bizPhone : (business.phone || '');
    document.getElementById('custName').value = data.customerName || '';
    document.getElementById('custPhone').value = data.customerPhone || '';
    document.getElementById('discount').value = data.discount || '';
    document.getElementById('payTerms').value = data.payTerms || '';
    document.getElementById('notes').value = data.notes || '';
    document.querySelector('input[name=vat][value="' + (data.vatMode || 'with') + '"]').checked = true;

    clearInvalidStates();
    errorBox.classList.remove('show');
    showView('form');
  }

  function validate(){
    clearInvalidStates();
    const errors = [];

    const bizName = document.getElementById('bizName');
    const bizPhone = document.getElementById('bizPhone');
    const custName = document.getElementById('custName');
    const quoteDate = document.getElementById('quoteDate');
    const validDays = document.getElementById('validDays');

    if(!bizName.value.trim()){ errors.push('יש להגדיר שם עסק ב-⚙️ הגדרות העסק'); bizName.classList.add('invalid'); }
    if(!bizPhone.value.trim()){ errors.push('יש להגדיר טלפון עסק ב-⚙️ הגדרות העסק'); bizPhone.classList.add('invalid'); }
    if(!custName.value.trim()){ errors.push('יש להזין שם לקוח'); custName.classList.add('invalid'); }
    if(!quoteDate.value){ errors.push('יש לבחור תאריך'); quoteDate.classList.add('invalid'); }
    const vd = parseFloat(validDays.value);
    if(isNaN(vd) || vd <= 0){ errors.push('תוקף ההצעה חייב להיות מספר חיובי'); validDays.classList.add('invalid'); }

    const rows = [...rowsContainer.children];
    let hasValidRow = false;
    rows.forEach((row, idx)=>{
      const descEl = row.querySelector('.desc-input');
      const qtyEl = row.querySelector('.qty-input');
      const priceEl = row.querySelector('.price-input');
      const desc = descEl.value.trim();
      const qty = parseFloat(qtyEl.value);
      const price = parseFloat(priceEl.value);

      const rowHasAnyInput = desc || qtyEl.value || priceEl.value;
      if(!rowHasAnyInput && rows.length > 1) return;

      let rowOk = true;
      if(!desc){ errors.push(`שורה ${idx+1}: חסר תיאור`); descEl.classList.add('invalid'); rowOk = false; }
      if(isNaN(qty) || qty <= 0){ errors.push(`שורה ${idx+1}: כמות לא תקינה`); qtyEl.classList.add('invalid'); rowOk = false; }
      if(isNaN(price) || price < 0){ errors.push(`שורה ${idx+1}: מחיר לא תקין`); priceEl.classList.add('invalid'); rowOk = false; }
      if(rowOk) hasValidRow = true;
    });
    if(!hasValidRow) errors.push('יש להזין לפחות שורת שירות/מוצר אחת תקינה');

    const discountEl = document.getElementById('discount');
    if(discountEl.value && parseFloat(discountEl.value) < 0){
      errors.push('הנחה לא יכולה להיות שלילית');
      discountEl.classList.add('invalid');
    }
    return errors;
  }

  function readFormData(){
    const rows = [...rowsContainer.children].map(row=>({
      desc: row.querySelector('.desc-input').value.trim(),
      qty: parseFloat(row.querySelector('.qty-input').value),
      price: parseFloat(row.querySelector('.price-input').value)
    })).filter(r => r.desc && !isNaN(r.qty) && r.qty > 0 && !isNaN(r.price) && r.price >= 0);

    return {
      bizName: document.getElementById('bizName').value.trim(),
      bizPhone: document.getElementById('bizPhone').value.trim(),
      customerName: document.getElementById('custName').value.trim(),
      customerPhone: document.getElementById('custPhone').value.trim(),
      date: document.getElementById('quoteDate').value,
      validDays: parseInt(document.getElementById('validDays').value) || 14,
      rows: rows,
      discount: parseFloat(document.getElementById('discount').value) || 0,
      vatMode: document.querySelector('input[name=vat]:checked').value,
      payTerms: document.getElementById('payTerms').value.trim(),
      notes: document.getElementById('notes').value.trim(),
      number: currentQuoteNumber,
      editingId: currentEditingId
    };
  }

  function scheduleDraftSave(){
    clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(async function(){
      if(document.getElementById('view-form').style.display !== 'block') return;
      const payload = readFormData();
      remoteDraft = payload;
      try{
        await sb.from('drafts').upsert(
          { user_id: currentUser.id, draft: payload, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        );
      }catch(e){
        // שמירת טיוטה נכשלת בשקט - לא מפריעים למשתמש באמצע הקלדה,
        // הנתונים עדיין נמצאים בטופס עצמו
      }
    }, 900);
  }
  document.getElementById('view-form').addEventListener('input', scheduleDraftSave);

  async function clearRemoteDraft(){
    remoteDraft = null;
    try{ await sb.from('drafts').delete().eq('user_id', currentUser.id); }catch(e){}
  }

  async function upsertQuoteFromForm(){
    const data = readFormData();
    const payload = {
      customer_name: data.customerName,
      customer_phone: data.customerPhone,
      quote_date: data.date,
      valid_days: data.validDays,
      items: data.rows,
      discount: data.discount,
      vat_enabled: data.vatMode === 'with',
      payment_terms: data.payTerms,
      notes: data.notes
    };

    if(currentEditingId){
      const { data: updated, error } = await sb.from('quotes')
        .update(payload).eq('id', currentEditingId).eq('user_id', currentUser.id)
        .select().single();
      if(error) throw error;
      quotes = quotes.map(q => q.id === currentEditingId ? updated : q);
      await clearRemoteDraft();
      return updated;
    } else {
      payload.quote_number = currentQuoteNumber;
      payload.status = 'draft';
      const { data: inserted, error } = await sb.from('quotes').insert(payload).select().single();
      if(error) throw error;
      quotes = [inserted, ...quotes];
      currentEditingId = inserted.id;
      await clearRemoteDraft();
      return inserted;
    }
  }

  previewBtn.addEventListener('click', async function(){
    const errors = validate();
    if(errors.length){
      errorList.innerHTML = errors.map(e => `<li>${escapeHtml(e)}</li>`).join('');
      errorBox.classList.add('show');
      errorBox.scrollIntoView({behavior:'smooth', block:'start'});
      return;
    }
    errorBox.classList.remove('show');
    const btn = this;
    btn.disabled = true;
    try{
      const q = await upsertQuoteFromForm();
      // עדכון שם/טלפון העסק בהצעה עצמה לצורך תצוגה (לא נשמר בטבלת quotes, מגיע מהפרופיל)
      renderPreviewDoc(mapDbQuoteToApp(q));
      showToast('ההצעה נשמרה');
      showView('preview');
    }catch(e){
      friendlyError('לא הצלחנו לשמור את ההצעה');
    }finally{
      btn.disabled = false;
    }
  });

  clearBtn.addEventListener('click', function(){
    if(currentEditingId){
      const q = quotes.find(x=>x.id===currentEditingId);
      if(q && confirm('לאפס שינויים ולחזור לנתונים השמורים של הצעה זו?')){
        clearRemoteDraft();
        openFormWithData(mapDbQuoteToApp(q), q.id);
      }
    } else {
      if(confirm('לאפס את כל שדות הטופס?')){
        clearRemoteDraft();
        initFormForNew(currentQuoteNumber);
      }
    }
  });

  document.getElementById('btnFormBack').addEventListener('click', function(){
    showView('home');
    renderHome();
  });
  document.getElementById('btnNewQuote').addEventListener('click', openNewQuoteForm);

  /* =========================================================
     ============  תצוגה מקדימה  ============
  ========================================================= */
  const quoteDoc = document.getElementById('quoteDoc');
  let previewQuoteId = null;

  function renderPreviewDoc(q){
    previewQuoteId = q.id;
    document.getElementById('statusSelect').value = q.status || 'draft';

    const dateObj = new Date((q.date || todayISO()) + 'T00:00:00');
    const dateStr = dateObj.toLocaleDateString('he-IL');
    const validUntil = new Date(dateObj);
    validUntil.setDate(validUntil.getDate() + (parseInt(q.validDays)||14));
    const validUntilStr = validUntil.toLocaleDateString('he-IL');

    const totals = computeQuoteTotal(q);

    const itemsHtml = (q.rows||[]).map(r=>{
      const lineTotal = (parseFloat(r.qty)||0) * (parseFloat(r.price)||0);
      return `<tr>
        <td class="desc">${escapeHtml(r.desc)}</td>
        <td>${Number(r.qty)||0}</td>
        <td>${fmt(r.price)} ₪</td>
        <td>${fmt(lineTotal)} ₪</td>
      </tr>`;
    }).join('');

    const subtotalLabel = q.vatMode === 'with' ? 'סכום לפני הנחה (כולל מע״מ)' : 'סכום לפני הנחה';
    let totalsHtml = `<div><span>${subtotalLabel}</span><span>${fmt(totals.subtotal)} ₪</span></div>`;
    if((q.discount||0) > 0){
      totalsHtml += `<div><span>הנחה</span><span>-${fmt(q.discount)} ₪</span></div>`;
    }
    if(q.vatMode === 'with'){
      totalsHtml += `<div><span>סכום לפני מע״מ</span><span>${fmt(totals.beforeVat)} ₪</span></div>`;
      totalsHtml += `<div><span>מע״מ (${Math.round(VAT_RATE*100)}%)</span><span>${fmt(totals.vat)} ₪</span></div>`;
    } else {
      totalsHtml += `<div><span>מע״מ</span><span>ללא מע״מ</span></div>`;
    }
    totalsHtml += `<div class="grand"><span>סה״כ לתשלום</span><span>${fmt(totals.total)} ₪</span></div>`;

    const bizNameFinal = q.bizName || business.business_name || '';
    const bizPhoneFinal = q.bizPhone || business.phone || '';
    const logoHtml = business.logo_base64 ? `<img src="${escapeAttr(business.logo_base64)}" alt="לוגו">` : '';
    const notesHtml = q.notes ? `<div class="notes-box"><b>הערות:</b> ${escapeHtml(q.notes)}</div>` : '';
    const bizNumberHtml = business.business_number ? `<div>ע.מ / ח.פ: ${escapeHtml(business.business_number)}</div>` : '';

    quoteDoc.innerHTML = `
      <div class="quote-head">
        <div class="biz">
          ${logoHtml}
          <div>
            <h2>${escapeHtml(bizNameFinal)}</h2>
            <div>טלפון: ${escapeHtml(bizPhoneFinal)}</div>
            ${bizNumberHtml}
          </div>
        </div>
        <div class="meta">
          <div>מס׳ הצעה: <b>#${q.number}</b></div>
          <div>תאריך: ${dateStr}</div>
          <div>בתוקף עד: ${validUntilStr}</div>
        </div>
      </div>

      <div class="quote-title">הצעת מחיר</div>

      <div class="cust-box">לכבוד: <b>${escapeHtml(q.customerName)}</b></div>

      <table class="items">
        <thead>
          <tr>
            <th style="width:40%;">תיאור</th>
            <th>כמות</th>
            <th>מחיר ליח׳</th>
            <th>סה״כ</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>

      <div class="totals">${totalsHtml}</div>

      <div class="pay-terms">
        <b>תנאי תשלום:</b><br>
        ${escapeHtml(q.payTerms).replace(/\n/g,'<br>')}
      </div>
      ${notesHtml}

      <div class="quote-footer">
       הכלי מיועד ליצירת הצעות מחיר ואינו מהווה תחליף לתוכנת הנהלת חשבונות או לייעוץ מקצועי.
      </div>
    `;
  }

  document.getElementById('statusSelect').addEventListener('change', function(){
    if(!previewQuoteId) return;
    setQuoteStatus(previewQuoteId, this.value);
  });
  document.getElementById('printBtn').addEventListener('click', function(){ window.print(); });
  document.getElementById('waBtn').addEventListener('click', function(){
    const q = quotes.find(x=>x.id===previewQuoteId);
    if(!q) return;
    const appQ = mapDbQuoteToApp(q);
    const totals = computeQuoteTotal(appQ);
    const bizNameFinal = business.business_name || '';
    const bizPhoneFinal = business.phone || '';
    const msg =
`שלום ${appQ.customerName},
מצורפת הצעת מחיר מספר #${appQ.number}.
סה"כ לתשלום: ${fmt(totals.total)} ₪.

בברכה,
${bizNameFinal}
${bizPhoneFinal}`;
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
  });
  document.getElementById('editFromPreviewBtn').addEventListener('click', function(){
    const q = quotes.find(x=>x.id===previewQuoteId);
    if(!q) return;
    openFormWithData(mapDbQuoteToApp(q), q.id);
  });
  document.getElementById('duplicateFromPreviewBtn').addEventListener('click', function(){
    if(!previewQuoteId) return;
    duplicateQuote(previewQuoteId);
  });
  document.getElementById('homeFromPreviewBtn').addEventListener('click', function(){
    showView('home');
    renderHome();
  });

  /* =========================================================
     ============  חשבון  ============
  ========================================================= */
  document.getElementById('btnOpenAccount').addEventListener('click', function(){
    document.getElementById('accEmail').textContent = currentUser.email || '—';
    document.getElementById('accPlan').textContent = (business.plan || 'free').toUpperCase();
    document.getElementById('pwErrorBox').classList.remove('show');
    document.getElementById('pwSuccessBox').classList.remove('show');
    document.getElementById('newPassword').value = '';
    document.getElementById('newPassword2').value = '';
    showView('account');
  });
  document.getElementById('btnAccountBack').addEventListener('click', function(){
    showView('home'); renderHome();
  });

  document.getElementById('btnChangePassword').addEventListener('click', async function(){
    const p1 = document.getElementById('newPassword').value;
    const p2 = document.getElementById('newPassword2').value;
    const errBox = document.getElementById('pwErrorBox');
    const errList = document.getElementById('pwErrorList');
    const okBox = document.getElementById('pwSuccessBox');
    okBox.classList.remove('show');

    const errors = [];
    if(!p1 || p1.length < 6) errors.push('הסיסמה קצרה מדי');
    if(p1 !== p2) errors.push('הסיסמאות אינן זהות');
    if(errors.length){
      errList.innerHTML = errors.map(e=>`<li>${escapeHtml(e)}</li>`).join('');
      errBox.classList.add('show');
      return;
    }
    errBox.classList.remove('show');

    const btn = this;
    btn.disabled = true;
    try{
      const { error } = await sb.auth.updateUser({ password: p1 });
      if(error) throw error;
      okBox.classList.add('show');
      document.getElementById('newPassword').value = '';
      document.getElementById('newPassword2').value = '';
    }catch(e){
      errList.innerHTML = `<li>לא הצלחנו לעדכן את הסיסמה. נסו שוב.</li>`;
      errBox.classList.add('show');
    }finally{
      btn.disabled = false;
    }
  });

  document.getElementById('btnLogout').addEventListener('click', async function(){
    if(!confirm('להתנתק מהחשבון?')) return;
    await doLogout();
  });

  document.getElementById('btnDeleteAccount').addEventListener('click', async function(){
    const sure = confirm('פעולה זו תמחק לצמיתות את כל ההצעות, פרטי העסק והטיוטה שלך. לא ניתן לשחזר. להמשיך?');
    if(!sure) return;
    const typed = prompt('להמשך, הקלידו "מחיקה" (בלי המרכאות):');
    if(typed !== 'מחיקה'){
      showToast('המחיקה בוטלה');
      return;
    }
    const btn = this;
    btn.disabled = true;
    try{
      const uid = currentUser.id;
      const delQuotes = await sb.from('quotes').delete().eq('user_id', uid);
      if(delQuotes.error) throw delQuotes.error;
      const delDrafts = await sb.from('drafts').delete().eq('user_id', uid);
      if(delDrafts.error) throw delDrafts.error;
      const delProfile = await sb.from('business_profiles').delete().eq('user_id', uid);
      if(delProfile.error) throw delProfile.error;

      showToast('כל הנתונים שלך נמחקו');
      await doLogout();
      alert('כל הנתונים שלך נמחקו בהצלחה. שימו לב: כתובת האימייל שלך עדיין רשומה במערכת ההתחברות (ריקה מנתונים). אם תרצו להסיר גם אותה לחלוטין, זו פנייה שצריך לבצע מול מנהל המערכת.');
    }catch(e){
      friendlyError('לא הצלחנו למחוק את כל הנתונים');
    }finally{
      btn.disabled = false;
    }
  });


  /* =========================================================
     אתחול
  ========================================================= */
  init();
})();
