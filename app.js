const CFG = window.ETHAN_CERT_CONFIG || {};
const app = document.getElementById('app-shell');
const toastBox = document.getElementById('toast-container');
const DEMO_KEY = 'ethan_certificate_demo_v1';
const HAS_SUPABASE = Boolean((CFG.supabaseUrl || '').trim() && (CFG.supabaseAnonKey || '').trim());
const state = {
  mode: 'preview', sb: null, user: null, tab: 'overview', certificates: [], students: [], audit: [],
  lastIssued: null, reissueFrom: null, loading: false, publicMode: false, installPrompt: null
};

const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const todayISO = () => new Date().toISOString().slice(0,10);
const fmtDate = value => {
  if (!value) return '—';
  const d = new Date(String(value).length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(d.getTime()) ? String(value) : new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric'}).format(d);
};
const initials = value => String(value || 'E').trim().split(/\s+/).slice(0,2).map(s=>s[0]||'').join('').toUpperCase();
const recipientName = c => c?.students?.full_name || c?.full_name || c?.recipient_name || 'Unnamed recipient';
const recipientEmail = c => c?.students?.email || c?.email || '';
const statusLabel = status => ({active:'Active',revoked:'Revoked',suspended:'Suspended',demo:'Demo only'}[status] || status || 'Unknown');
const statusClass = status => status === 'active' ? 'pill-green' : status === 'revoked' ? 'pill-red' : status === 'suspended' ? 'pill-amber' : 'pill-demo';
const isVerifyHost = location.hostname.toLowerCase().startsWith('verify.');

function toast(message, kind='') {
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  toastBox.appendChild(node);
  setTimeout(()=>node.remove(), 3600);
}
function demoStore() {
  try { return JSON.parse(localStorage.getItem(DEMO_KEY) || 'null'); } catch { return null; }
}
function saveDemoStore(data) { localStorage.setItem(DEMO_KEY, JSON.stringify(data)); }
function seedDemoStore() {
  let data = demoStore();
  if (data) return data;
  const token = 'demo-eda-certificate-token-0001';
  data = {
    certificates: [{
      id:'demo-1', certificate_number:'DEMO-EDA-CERT-2026-000001', verification_token:token,
      students:{id:'demo-student-1',full_name:'Sample Ethan Learner',email:'sample@example.com',phone:''},
      award_title:'CERTIFICATE OF COMPLETION', programme_name:'Professional Digital Skills Training',
      course_title:'Digital Skills Foundations', duration:'8 Weeks', date_completed:'2026-10-27', issued_at:'2026-11-03',
      status:'demo', grade:'Completed', signatory_name:CFG.defaultSignatory || 'Mr. Abayomi Peter Oyenuga',
      signatory_title:CFG.defaultSignatoryTitle || 'Founder', remarks:'Illustrative preview record. Not an official award.'
    }],
    students:[{id:'demo-student-1',full_name:'Sample Ethan Learner',email:'sample@example.com',phone:'',created_at:'2026-11-03'}],
    audit:[{id:'demo-log-1',action:'DEMO RECORD CREATED',details:{certificate_number:'DEMO-EDA-CERT-2026-000001'},created_at:'2026-11-03T10:00:00Z'}],
    verifications:0, sequence:1
  };
  saveDemoStore(data); return data;
}
function loadDemoData() {
  const data = seedDemoStore();
  state.certificates = data.certificates || [];
  state.students = data.students || [];
  state.audit = data.audit || [];
}
async function loadExternalScript(src, globalName) {
  if (globalName && window[globalName]) return window[globalName];
  const existing = [...document.scripts].find(s => s.src === src);
  if (existing) return new Promise((resolve,reject)=>{ if (globalName && window[globalName]) resolve(window[globalName]); else { existing.addEventListener('load',()=>resolve(window[globalName])); existing.addEventListener('error',reject); }});
  await new Promise((resolve,reject)=>{ const script=document.createElement('script'); script.src=src; script.async=true; script.onload=resolve; script.onerror=()=>reject(new Error('Could not load a required browser library. Check your internet connection.')); document.head.appendChild(script); });
  return globalName ? window[globalName] : true;
}

async function init() {
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); state.installPrompt = event; });
  const params = new URLSearchParams(location.search);
  const publicIdentifier = params.get('verify') || params.get('number') || '';
  if (isVerifyHost || publicIdentifier) {
    state.publicMode = true;
    await initSupabaseIfConfigured();
    renderPublicVerify(publicIdentifier);
    if (publicIdentifier) runPublicVerification(publicIdentifier);
    return;
  }
  if (HAS_SUPABASE) {
    try {
      await initSupabaseIfConfigured();
      const {data:{session}} = await state.sb.auth.getSession();
      if (session) {
        state.user = session.user; state.mode = 'live';
        const {data:isAdmin,error:roleError}=await state.sb.rpc('is_admin');
        if(roleError || isAdmin!==true){await state.sb.auth.signOut();state.mode='preview';renderLogin('This account is not authorised to access the Ethan certificate registry. Ask the owner to provision your administrator access.');return;}
        await loadAdminData(); renderApp();
      } else renderLogin();
    } catch (error) {
      renderLogin(error.message || 'Unable to connect to Supabase.');
    }
  } else renderLogin();
}
async function initSupabaseIfConfigured() {
  if (!HAS_SUPABASE || state.sb) return;
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.49.8');
  state.sb = createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });
}

function renderLogin(errorMessage='') {
  app.innerHTML = `
    <main class="login-shell">
      <section class="login-brand">
        <div class="login-brand-content">
          <div class="brand-lockup"><img src="/assets/brand-mark.svg" alt="Ethan Certificate mark"><div><strong>ETHAN CERTIFICATE</strong><small>ISSUANCE &amp; VERIFICATION SYSTEM</small></div></div>
          <h1>Issue with confidence.<br><span>Verify with trust.</span></h1>
          <p>A secure certificate registry for Ethan Digital Academy. Create professional awards, issue unique certificate IDs and give employers a simple way to verify authenticity.</p>
          <div class="login-features">
            <div class="login-feature"><b>01 · ISSUE</b><span>Professional certificates with unique IDs.</span></div>
            <div class="login-feature"><b>02 · VERIFY</b><span>Public QR and certificate-number checks.</span></div>
            <div class="login-feature"><b>03 · PROTECT</b><span>Controlled access and audit history.</span></div>
          </div>
        </div>
        <div class="login-foot">A brand of ${esc(CFG.issuerParent || 'ALLON-MAADIAH INTERNATIONAL LIMITED')} · RC ${esc(CFG.issuerRc || '1364788')}</div>
      </section>
      <section class="login-form-side">
        <div class="login-card">
          <img class="mini-logo" src="/assets/ethan-certificate-logo.png" alt="Ethan Certificate">
          <div class="eyebrow">ADMINISTRATOR ACCESS</div>
          <h2>Welcome back</h2>
          <p>Sign in to manage Ethan Digital Academy certificates. Public verification does not require an account.</p>
          ${errorMessage ? `<div class="helper-note" style="margin-bottom:14px;color:#9f2938">${esc(errorMessage)}</div>` : ''}
          ${HAS_SUPABASE ? `
            <form id="login-form">
              <div class="field"><label for="login-email">Administrator email <span class="req">*</span></label><input id="login-email" name="email" type="email" autocomplete="username" required placeholder="admin@example.com"></div>
              <div class="field"><label for="login-password">Password <span class="req">*</span></label><input id="login-password" name="password" type="password" autocomplete="current-password" required placeholder="Enter your password"></div>
              <button class="btn btn-primary" type="submit" id="login-submit">Sign in securely <span>→</span></button>
            </form>` : `
            <div class="helper-note"><strong>Setup required:</strong> Connect your Supabase project in <code>config.js</code> to enable real administrator accounts, permanent certificate records and public verification.</div>
            <button class="btn btn-primary" id="demo-login">Open preview dashboard <span>→</span></button>`}
          <div class="login-divider">OR</div>
          <button class="btn btn-outline" id="open-verification">Open public verification page</button>
          <div class="login-footnote">Administrator accounts are provisioned by the Ethan owner. Public sign-up is intentionally disabled. Never share a Supabase service-role key in the browser.</div>
        </div>
      </section>
    </main>`;
  $('#login-form')?.addEventListener('submit', handleLogin);
  $('#demo-login')?.addEventListener('click', startDemo);
  $('#open-verification')?.addEventListener('click', ()=>{ location.href = `${location.origin}/?verify=`; });
}
async function handleLogin(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const button = $('#login-submit'); button.disabled=true; button.textContent='Signing in…';
  try {
    await initSupabaseIfConfigured();
    const {data,error} = await state.sb.auth.signInWithPassword({email:form.get('email'),password:form.get('password')});
    if (error) throw error;
    state.user=data.user; state.mode='live';
    const {data:isAdmin,error:roleError}=await state.sb.rpc('is_admin');
    if(roleError || isAdmin!==true){await state.sb.auth.signOut();state.mode='preview';throw new Error('This account is not authorised to access the Ethan certificate registry. Ask the owner to provision your administrator access.');}
    await loadAdminData(); renderApp();
    toast('Signed in successfully.','success');
  } catch(error) { toast(error.message || 'Sign-in failed.','error'); button.disabled=false; button.innerHTML='Sign in securely <span>→</span>'; }
}
function startDemo() {
  state.mode='demo'; state.user={email:'preview@ethandigitalacademy.org',name:'Preview Administrator'};
  loadDemoData(); renderApp(); toast('Preview mode only — demo records are not official certificates.');
}
async function signOut() {
  if (state.mode==='live' && state.sb) await state.sb.auth.signOut();
  state.mode='preview'; state.user=null; state.certificates=[]; state.students=[]; renderLogin();
}

async function loadAdminData() {
  if (state.mode==='demo') { loadDemoData(); return; }
  const [certs,students,logs] = await Promise.all([
    state.sb.from('certificates').select('*,students(full_name,email,phone)').order('issued_at',{ascending:false}).limit(500),
    state.sb.from('students').select('*').order('created_at',{ascending:false}).limit(500),
    state.sb.from('audit_logs').select('*').order('created_at',{ascending:false}).limit(100)
  ]);
  if (certs.error) throw certs.error;
  if (students.error) throw students.error;
  state.certificates=certs.data || []; state.students=students.data || []; state.audit=logs.data || [];
}

function renderApp() {
  const demo = state.mode==='demo';
  app.innerHTML = `
    <div class="app-layout">
      <aside class="sidebar" id="sidebar">
        <div class="side-brand"><img src="/assets/brand-mark.svg" alt="ED"><div><b>ETHAN CERTIFICATE</b><small>ISSUE · VERIFY · AUTHENTICATE</small></div></div>
        <div class="side-label">Workspace</div>
        <nav class="nav-list">
          <button class="nav-item" data-tab="overview"><span class="nav-ico">▦</span>Overview</button>
          <button class="nav-item" data-tab="issue"><span class="nav-ico">✚</span>Issue certificate</button>
          <button class="nav-item" data-tab="registry"><span class="nav-ico">▤</span>Certificate registry</button>
          <button class="nav-item" data-tab="students"><span class="nav-ico">♙</span>Students</button>
          <button class="nav-item" data-tab="verify"><span class="nav-ico">⌕</span>Verify a certificate</button>
          <button class="nav-item" data-tab="activity"><span class="nav-ico">◷</span>Activity log</button>
        </nav>
        <div class="side-label">System</div>
        <nav class="nav-list"><button class="nav-item" data-tab="settings"><span class="nav-ico">⚙</span>Settings &amp; setup</button></nav>
        <div class="sidebar-bottom"><div class="side-user"><div class="avatar">${esc(initials(state.user?.email || 'Ethan'))}</div><div><b>${esc(state.mode==='demo'?'Preview administrator':(state.user?.email || 'Administrator'))}</b><small>${demo?'LOCAL DEMO MODE':'AUTHENTICATED ADMIN'}</small></div><button id="signout" title="Sign out">↗</button></div></div>
      </aside>
      <section class="main-area">
        <header class="topbar"><div class="topbar-left"><button class="icon-btn mobile-menu" id="mobile-menu" aria-label="Open navigation">☰</button><div class="topbar-label">Ethan Digital Academy <strong>/ Certificate Registry</strong></div></div><div class="topbar-right">${demo?'<span class="pill pill-demo"><span class="dot"></span>Preview only</span>':'<span class="pill pill-green"><span class="dot"></span>Secure session</span>'}<button class="btn btn-outline btn-small" id="install-app">Install app</button></div></header>
        <main class="content" id="page-root"></main>
      </section>
    </div>`;
  $$('.nav-item',app).forEach(btn=>btn.addEventListener('click',()=>{state.tab=btn.dataset.tab;$('#sidebar').classList.remove('open');renderPage();}));
  $('#signout').addEventListener('click',signOut);
  $('#mobile-menu').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
  $('#install-app').addEventListener('click',installApp);
  renderPage();
}
async function installApp() {
  if (state.installPrompt) { state.installPrompt.prompt(); await state.installPrompt.userChoice; state.installPrompt=null; }
  else toast('To install, use your browser menu and choose “Install Ethan Certificate” or “Add to Home Screen”.');
}
function renderPage() {
  $$('.nav-item',app).forEach(btn=>btn.classList.toggle('active',btn.dataset.tab===state.tab));
  const root=$('#page-root'); if(!root) return;
  const pages={overview:renderOverview,issue:renderIssue,registry:renderRegistry,students:renderStudents,verify:renderVerifyAdmin,activity:renderActivity,settings:renderSettings};
  root.innerHTML=(pages[state.tab]||renderOverview)();
  bindPageEvents();
}
function pageHead(eyebrow,title,subtitle,action='') { return `<div class="content-head"><div><div class="eyebrow">${eyebrow}</div><h1 class="page-title">${title}</h1><p class="page-subtitle">${subtitle}</p></div>${action}</div>`; }
function demoNotice() { return state.mode==='demo' ? `<div class="demo-banner"><strong>PREVIEW MODE — NOT AN OFFICIAL REGISTRY.</strong> Records created here stay in this browser only. Connect Supabase and deploy the database schema before issuing real certificates or enabling public verification.</div>` : ''; }
function renderOverview() {
  const total=state.certificates.length, active=state.certificates.filter(c=>c.status==='active').length, revoked=state.certificates.filter(c=>c.status==='revoked').length, studentCount=state.students.length;
  const recent=state.certificates.slice(0,6);
  return `${pageHead('ACADEMY REGISTRY','Certificate overview','Monitor certificate issuance, student records and verification activity.',`<button class="btn btn-primary" data-tab="issue">＋ Issue certificate</button>`)}${demoNotice()}
    <div class="stats-grid">
      <div class="panel stat-card"><div class="stat-top">Certificates issued <span class="stat-ico">▤</span></div><div class="stat-value">${total}</div><div class="stat-foot">Total records in this registry</div></div>
      <div class="panel stat-card"><div class="stat-top">Active certificates <span class="stat-ico">✓</span></div><div class="stat-value">${active}</div><div class="stat-foot">Currently valid awards</div></div>
      <div class="panel stat-card"><div class="stat-top">Students <span class="stat-ico">♙</span></div><div class="stat-value">${studentCount}</div><div class="stat-foot">Recipient profiles recorded</div></div>
      <div class="panel stat-card"><div class="stat-top">Revoked certificates <span class="stat-ico">⊘</span></div><div class="stat-value">${revoked}</div><div class="stat-foot">Records no longer valid</div></div>
    </div>
    <div class="overview-grid">
      <section class="panel panel-pad"><div class="section-head"><div><h3>Recently issued certificates</h3><p>Latest records added to the registry</p></div><button class="btn btn-outline btn-small" data-tab="registry">View registry →</button></div>
        ${recent.length?`<div class="table-wrap"><table><thead><tr><th>Recipient</th><th>Certificate ID</th><th>Programme</th><th>Status</th><th></th></tr></thead><tbody>${recent.map(c=>`<tr><td><div class="row-main"><div class="student-initial">${esc(initials(recipientName(c)))}</div><div><b>${esc(recipientName(c))}</b><small>${esc(recipientEmail(c))}</small></div></div></td><td>${esc(c.certificate_number)}</td><td>${esc(c.programme_name||c.course_title||'—')}</td><td><span class="pill ${statusClass(c.status)}">${statusLabel(c.status)}</span></td><td><button class="btn btn-soft btn-small" data-action="preview" data-id="${esc(c.id)}">View</button></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty-state"><div class="empty-icon">▤</div><strong>No certificates yet</strong>Issue your first certificate to start building the registry.</div>`}
      </section>
      <section class="panel panel-pad"><div class="section-head"><div><h3>Quick actions</h3><p>Common certificate tasks</p></div></div><div class="quick-list">
        <button class="quick-action" data-tab="issue"><span class="quick-icon">✚</span><span><b>Issue a new certificate</b><small>Create a certificate for a learner</small></span><span class="quick-arrow">›</span></button>
        <button class="quick-action" data-tab="registry"><span class="quick-icon">▤</span><span><b>Manage certificate registry</b><small>Search, view and manage issued awards</small></span><span class="quick-arrow">›</span></button>
        <button class="quick-action" data-tab="verify"><span class="quick-icon">⌕</span><span><b>Verify a certificate</b><small>Check an ID or QR verification token</small></span><span class="quick-arrow">›</span></button>
        <button class="quick-action" data-tab="settings"><span class="quick-icon">⚙</span><span><b>Complete system setup</b><small>Connect database and configure access</small></span><span class="quick-arrow">›</span></button>
      </div></section>
    </div>`;
}
function renderIssue() {
  const previous=state.reissueFrom;
  return `${pageHead('CERTIFICATE MANAGEMENT',previous?'Reissue / correct certificate':'Issue a certificate',previous?`Create a replacement for ${esc(previous.certificate_number)}. The new record will be linked to the previous certificate.`:'Create a new official Ethan Digital Academy certificate. A unique certificate number and QR verification link are generated automatically.',previous?'<button class="btn btn-outline" id="cancel-reissue">Cancel reissue</button>':'')}${demoNotice()}
    <section class="panel panel-pad"><div class="section-head"><div><h3>Recipient and programme details</h3><p>Enter the information exactly as it should appear on the certificate.</p></div><span class="pill pill-blue">${previous?'Replacement':'New issuance'}</span></div>
      <form id="issue-form">
        <div class="form-grid">
          <div class="field"><label>Student full name <span class="req">*</span></label><input name="full_name" value="${esc(previous?recipientName(previous):'')}" required maxlength="140" placeholder="Enter the recipient's full name"></div>
          <div class="field"><label>Student email</label><input name="email" type="email" value="${esc(previous?recipientEmail(previous):'')}" maxlength="180" placeholder="student@example.com"><small>Optional. Used for student records, not shown on public verification.</small></div>
          <div class="field"><label>Phone number</label><input name="phone" value="${esc(previous?(previous.students?.phone||''):'')}" maxlength="40" placeholder="Optional contact number"></div>
          <div class="field"><label>Certificate title <span class="req">*</span></label><select name="award_title" required><option value="CERTIFICATE OF COMPLETION" ${previous?.award_title==='CERTIFICATE OF COMPLETION'?'selected':''}>Certificate of Completion</option><option value="CERTIFICATE OF ACHIEVEMENT" ${previous?.award_title==='CERTIFICATE OF ACHIEVEMENT'?'selected':''}>Certificate of Achievement</option><option value="PROFESSIONAL CERTIFICATE" ${previous?.award_title==='PROFESSIONAL CERTIFICATE'?'selected':''}>Professional Certificate</option><option value="CERTIFICATE OF PARTICIPATION" ${previous?.award_title==='CERTIFICATE OF PARTICIPATION'?'selected':''}>Certificate of Participation</option></select></div>
          <div class="field"><label>Programme name <span class="req">*</span></label><input name="programme_name" value="${esc(previous?.programme_name||'')}" required maxlength="180" placeholder="e.g. Professional Digital Skills Training"></div>
          <div class="field"><label>Course / specialisation <span class="req">*</span></label><input name="course_title" value="${esc(previous?.course_title||'')}" required maxlength="180" placeholder="e.g. Digital Marketing and Social Media"></div>
          <div class="field"><label>Duration</label><input name="duration" value="${esc(previous?.duration||'')}" maxlength="80" placeholder="e.g. 8 Weeks"></div>
          <div class="field"><label>Date completed <span class="req">*</span></label><input name="date_completed" type="date" value="${esc(previous?.date_completed||todayISO())}" required></div>
          <div class="field"><label>Grade / result</label><input name="grade" value="${esc(previous?.grade||'')}" maxlength="80" placeholder="e.g. Completed / Distinction"></div>
          <div class="field"><label>Date issued</label><input name="date_issued" type="date" value="${todayISO()}" required></div>
          <div class="field"><label>Authorised signatory</label><input name="signatory_name" value="${esc(previous?.signatory_name||CFG.defaultSignatory||'Mr. Abayomi Peter Oyenuga')}" maxlength="140"></div>
          <div class="field"><label>Signatory title</label><input name="signatory_title" value="${esc(previous?.signatory_title||CFG.defaultSignatoryTitle||'Founder')}" maxlength="100"></div>
          <div class="field full"><label>Additional statement (optional)</label><textarea name="remarks" maxlength="500" placeholder="A short commendation or note for the certificate.">${esc(previous?`Replacement certificate for ${previous.certificate_number}. ${previous.remarks||''}`:'')}</textarea></div>
        </div>
        <div class="helper-note" style="margin-top:16px">${previous?`<strong>Replacement record:</strong> this certificate will be linked to ${esc(previous.certificate_number)}. The previous record remains ${esc(statusLabel(previous.status).toLowerCase())}.<br>`:''}<strong>Certificate ID:</strong> generated automatically when issued. Each official certificate receives a unique registry number and a QR code linked to the public verification page. Do not reuse certificate numbers.</div>
        <div class="form-actions"><button class="btn btn-outline" type="reset">Clear form</button><button class="btn btn-primary" id="issue-submit" type="submit">Issue certificate <span>→</span></button></div>
      </form>
    </section>`;
}
function renderRegistry() {
  const rows=state.certificates;
  return `${pageHead('OFFICIAL RECORDS','Certificate registry','Search, view, download or change the status of issued certificates.',`<button class="btn btn-primary" data-tab="issue">＋ Issue certificate</button>`)}${demoNotice()}
    <section class="panel panel-pad"><div class="section-head"><div><h3>All certificates</h3><p>${rows.length} record${rows.length===1?'':'s'} in the registry</p></div><div class="toolbar"><input class="search-input" id="registry-search" placeholder="Search name, ID or course…"><button class="btn btn-outline btn-small" id="refresh-registry">↻ Refresh</button></div></div>
    <div id="registry-table">${registryTable(rows)}</div></section>`;
}
function registryTable(rows) {
  if(!rows.length) return `<div class="empty-state"><div class="empty-icon">▤</div><strong>No certificate records found</strong>Try another search or issue a new certificate.</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>Recipient</th><th>Certificate number</th><th>Programme / course</th><th>Date issued</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows.map(c=>`<tr><td><div class="row-main"><div class="student-initial">${esc(initials(recipientName(c)))}</div><div><b>${esc(recipientName(c))}</b><small>${esc(recipientEmail(c))}</small></div></div></td><td><b>${esc(c.certificate_number)}</b></td><td>${esc(c.programme_name||c.course_title||'—')}<small class="muted" style="display:block;margin-top:3px">${esc(c.course_title||'')}</small></td><td>${fmtDate(c.issued_at||c.date_issued)}</td><td><span class="pill ${statusClass(c.status)}">${statusLabel(c.status)}</span></td><td><div class="registry-actions"><button class="btn btn-soft btn-small" data-action="preview" data-id="${esc(c.id)}">View / PDF</button>${c.status==='active'?`<button class="btn btn-outline btn-small" data-action="status" data-status="suspended" data-id="${esc(c.id)}">Suspend</button><button class="btn btn-danger btn-small" data-action="status" data-status="revoked" data-id="${esc(c.id)}">Revoke</button>`:c.status==='suspended'?`<button class="btn btn-outline btn-small" data-action="status" data-status="active" data-id="${esc(c.id)}">Reactivate</button><button class="btn btn-danger btn-small" data-action="status" data-status="revoked" data-id="${esc(c.id)}">Revoke</button><button class="btn btn-soft btn-small" data-action="reissue" data-id="${esc(c.id)}">Reissue</button>`:`<button class="btn btn-soft btn-small" data-action="reissue" data-id="${esc(c.id)}">Reissue</button>`}</div></td></tr>`).join('')}</tbody></table></div>`;
}
function renderStudents() {
  const rows=state.students;
  return `${pageHead('LEARNER RECORDS','Students','Student profiles are created or updated when certificates are issued.')}${demoNotice()}
    <section class="panel panel-pad"><div class="section-head"><div><h3>Registered recipients</h3><p>${rows.length} student profile${rows.length===1?'':'s'}</p></div><input class="search-input" id="students-search" placeholder="Search students…" style="max-width:260px"></div><div id="students-table">${studentsTable(rows)}</div></section>`;
}
function studentsTable(rows) {
  if(!rows.length) return `<div class="empty-state"><div class="empty-icon">♙</div><strong>No students yet</strong>Student profiles will appear here after certificate issuance.</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>Student</th><th>Email</th><th>Phone</th><th>Certificates</th><th>Created</th></tr></thead><tbody>${rows.map(s=>{const count=state.certificates.filter(c=>(c.student_id&&c.student_id===s.id)||(c.students?.id&&c.students.id===s.id)).length;return `<tr><td><div class="row-main"><div class="student-initial">${esc(initials(s.full_name))}</div><b>${esc(s.full_name)}</b></div></td><td>${esc(s.email||'—')}</td><td>${esc(s.phone||'—')}</td><td>${count}</td><td>${fmtDate(s.created_at)}</td></tr>`}).join('')}</tbody></table></div>`;
}
function renderVerifyAdmin() {
  return `${pageHead('PUBLIC REGISTRY CHECK','Verify a certificate','Enter a certificate number or verification token to check its current registry status.')}${demoNotice()}
    <section class="panel panel-pad"><div class="section-head"><div><h3>Certificate lookup</h3><p>Search by certificate ID or scan token.</p></div></div><form id="admin-verify-form" class="verify-search"><input id="admin-verify-input" placeholder="e.g. EDA-CERT-2026-000001" required><button class="btn btn-primary" type="submit">Verify certificate</button></form><div id="admin-verify-result" class="verify-result"></div></section>`;
}
function renderActivity() {
  const logs=state.audit;
  return `${pageHead('SECURITY & HISTORY','Activity log','Review administrative actions and certificate registry events.')}${demoNotice()}
    <section class="panel panel-pad"><div class="section-head"><div><h3>Recent activity</h3><p>Latest 100 audit entries</p></div></div>${logs.length?`<div class="table-wrap"><table><thead><tr><th>Action</th><th>Details</th><th>Timestamp</th></tr></thead><tbody>${logs.map(log=>`<tr><td><b>${esc(log.action||'Activity')}</b></td><td>${esc(JSON.stringify(log.details||{}))}</td><td>${fmtDate(log.created_at)}</td></tr>`).join('')}</tbody></table></div>`:`<div class="empty-state"><div class="empty-icon">◷</div><strong>No activity yet</strong>Registry actions will appear here.</div>`}</section>`;
}
function renderSettings() {
  return `${pageHead('PLATFORM CONFIGURATION','Settings & setup','Issuer identity, security and deployment readiness.')}${demoNotice()}
    <div class="overview-grid">
      <section class="panel panel-pad"><div class="section-head"><div><h3>Official issuer identity</h3><p>Displayed on issued certificates and verification results.</p></div><span class="pill pill-blue">Option A · Single issuer</span></div>
        <div class="field" style="margin-bottom:13px"><label>Issuing institution</label><input value="${esc(CFG.issuerName||'Ethan Digital Academy')}" readonly></div>
        <div class="field" style="margin-bottom:13px"><label>Parent company</label><input value="${esc(CFG.issuerParent||'ALLON-MAADIAH INTERNATIONAL LIMITED')}" readonly></div>
        <div class="field" style="margin-bottom:13px"><label>Registration number</label><input value="RC ${esc(CFG.issuerRc||'1364788')}" readonly></div>
        <div class="field"><label>Certificate numbering format</label><input value="EDA-CERT-YYYY-000001 (automatic)" readonly></div>
      </section>
      <section class="panel panel-pad"><div class="section-head"><div><h3>Connection status</h3><p>Production services required for official issuance.</p></div>${HAS_SUPABASE?'<span class="pill pill-green">Configured</span>':'<span class="pill pill-amber">Not connected</span>'}</div>
        <div class="quick-list"><div class="quick-action"><span class="quick-icon">▣</span><span><b>Supabase database</b><small>${HAS_SUPABASE?'Connection details are present in config.js.':'Add project URL and anon key in config.js.'}</small></span></div><div class="quick-action"><span class="quick-icon">♙</span><span><b>Administrator access</b><small>Provision the owner account in Supabase Auth, then add its user ID to admin_users.</small></span></div><div class="quick-action"><span class="quick-icon">⌕</span><span><b>Public verification</b><small>Use verify.ethandigitalacademy.org as a domain alias to this deployment.</small></span></div></div>
      </section>
    </div>
    <section class="panel panel-pad" style="margin-top:16px"><div class="section-head"><div><h3>Production security checklist</h3><p>Complete these steps before issuing official certificates.</p></div></div><div class="quick-list"><div class="helper-note"><strong>1.</strong> Run <code>database/schema.sql</code> in the Supabase SQL Editor.</div><div class="helper-note"><strong>2.</strong> Create the owner account in Supabase Authentication, then run the owner-promotion SQL in <code>docs/ADMIN-SETUP.md</code>.</div><div class="helper-note"><strong>3.</strong> Add the Supabase project URL and anon/publishable key to <code>config.js</code>. Never use the service_role key in frontend code.</div><div class="helper-note"><strong>4.</strong> Deploy this folder to Vercel and attach both certificate and verify domains.</div><div class="helper-note"><strong>5.</strong> Test issuing, PDF download, QR verification, revoked status and access controls before using real learner records.</div></div></section>`;
}

function bindPageEvents() {
  $$('[data-tab]', $('#page-root')).forEach(btn=>btn.addEventListener('click',()=>{state.tab=btn.dataset.tab;renderPage();}));
  $('#issue-form')?.addEventListener('submit',handleIssueSubmit);
  $('#cancel-reissue')?.addEventListener('click',()=>{state.reissueFrom=null;renderPage();});
  $('#registry-search')?.addEventListener('input',event=>{const q=event.target.value.toLowerCase();const rows=state.certificates.filter(c=>[recipientName(c),c.certificate_number,c.programme_name,c.course_title,recipientEmail(c)].join(' ').toLowerCase().includes(q));$('#registry-table').innerHTML=registryTable(rows);bindRegistryActions();});
  $('#students-search')?.addEventListener('input',event=>{const q=event.target.value.toLowerCase();const rows=state.students.filter(s=>[s.full_name,s.email,s.phone].join(' ').toLowerCase().includes(q));$('#students-table').innerHTML=studentsTable(rows);});
  $('#refresh-registry')?.addEventListener('click',async()=>{try{await loadAdminData();renderPage();toast('Registry refreshed.','success')}catch(e){toast(e.message,'error')}});
  $('#admin-verify-form')?.addEventListener('submit',async event=>{event.preventDefault();const value=$('#admin-verify-input').value.trim();$('#admin-verify-result').innerHTML='<div class="loading-inline"><span class="spinner"></span> Checking registry…</div>';const result=await verifyIdentifier(value);$('#admin-verify-result').innerHTML=verificationCard(result);});
  bindRegistryActions();
}
function bindRegistryActions() {
  $$('[data-action="preview"]',app).forEach(btn=>btn.addEventListener('click',()=>{const cert=state.certificates.find(c=>String(c.id)===btn.dataset.id);if(cert)openCertificate(cert);}));
  $$('[data-action="status"]',app).forEach(btn=>btn.addEventListener('click',()=>changeCertificateStatus(btn.dataset.id,btn.dataset.status)));
  $$('[data-action="reissue"]',app).forEach(btn=>btn.addEventListener('click',()=>startReissue(btn.dataset.id)));
}

async function handleIssueSubmit(event) {
  event.preventDefault();
  const form=new FormData(event.currentTarget);
  const payload={
    p_full_name:String(form.get('full_name')||'').trim(),p_email:String(form.get('email')||'').trim()||null,
    p_phone:String(form.get('phone')||'').trim()||null,p_award_title:String(form.get('award_title')||'CERTIFICATE OF COMPLETION'),
    p_programme_name:String(form.get('programme_name')||'').trim(),p_course_title:String(form.get('course_title')||'').trim(),
    p_duration:String(form.get('duration')||'').trim()||null,p_date_completed:String(form.get('date_completed')||todayISO()),
    p_date_issued:String(form.get('date_issued')||todayISO()),p_grade:String(form.get('grade')||'').trim()||null,
    p_remarks:String(form.get('remarks')||'').trim()||null,p_signatory_name:String(form.get('signatory_name')||CFG.defaultSignatory||'Mr. Abayomi Peter Oyenuga'),
    p_signatory_title:String(form.get('signatory_title')||CFG.defaultSignatoryTitle||'Founder'),
    p_reissued_from:state.reissueFrom?.id||null
  };
  const button=$('#issue-submit');button.disabled=true;button.innerHTML='<span class="spinner"></span> Issuing…';
  try {
    let cert;
    if(state.mode==='demo') {
      const data=seedDemoStore();data.sequence=(data.sequence||1)+1;
      const number=`DEMO-EDA-CERT-${new Date().getFullYear()}-${String(data.sequence).padStart(6,'0')}`;
      const studentId=payload.p_email ? `demo-${payload.p_email.toLowerCase().replace(/[^a-z0-9]/g,'-')}` : `demo-student-${Date.now()}`;
      let student=data.students.find(s=>payload.p_email && s.email?.toLowerCase()===payload.p_email.toLowerCase());
      if(!student){student={id:studentId,full_name:payload.p_full_name,email:payload.p_email,phone:payload.p_phone,created_at:new Date().toISOString()};data.students.unshift(student)}else{student.full_name=payload.p_full_name;student.phone=payload.p_phone;}
      cert={id:`demo-${Date.now()}`,certificate_number:number,verification_token:crypto.randomUUID?crypto.randomUUID():`demo-${Date.now()}`,students:student,student_id:student.id,reissued_from:payload.p_reissued_from,award_title:payload.p_award_title,programme_name:payload.p_programme_name,course_title:payload.p_course_title,duration:payload.p_duration,date_completed:payload.p_date_completed,issued_at:payload.p_date_issued,status:'demo',grade:payload.p_grade,remarks:payload.p_remarks,signatory_name:payload.p_signatory_name,signatory_title:payload.p_signatory_title};
      data.certificates.unshift(cert);data.audit.unshift({id:`log-${Date.now()}`,action:payload.p_reissued_from?'DEMO CERTIFICATE REISSUED':'DEMO CERTIFICATE ISSUED',details:{certificate_number:number,reissued_from:payload.p_reissued_from},created_at:new Date().toISOString()});saveDemoStore(data);loadDemoData();
    } else {
      const {data,error}=await state.sb.rpc('issue_certificate',payload);if(error)throw error;cert=Array.isArray(data)?data[0]:data;
      await loadAdminData();cert=state.certificates.find(c=>c.id===cert.id)||cert;
    }
    state.lastIssued=cert;state.reissueFrom=null;toast(`Certificate issued: ${cert.certificate_number}`,'success');
    state.tab='registry';renderPage();
    openCertificate(cert);
  } catch(error) { toast(error.message||'Unable to issue certificate.','error'); }
  finally {button.disabled=false;button.innerHTML='Issue certificate <span>→</span>';}
}
function startReissue(id) {
  const cert=state.certificates.find(c=>String(c.id)===String(id));if(!cert)return;
  if(cert.status==='active'){toast('Suspend or revoke the original certificate before reissuing it.','error');return;}
  state.reissueFrom=cert;state.tab='issue';renderPage();toast('Review the prefilled details, correct what is needed, then issue the replacement.');
}

async function changeCertificateStatus(id, nextStatus) {
  const cert=state.certificates.find(c=>String(c.id)===String(id));if(!cert)return;
  const label=statusLabel(nextStatus).toLowerCase();
  const reason=nextStatus==='active'?'':prompt(`${label[0].toUpperCase()+label.slice(1)} ${cert.certificate_number}? Enter the reason for the audit record:`);
  if(reason===null)return;
  if(nextStatus!=='active' && !reason.trim()){toast('A reason is required for suspension or revocation.','error');return;}
  try {
    if(state.mode==='demo') {
      const data=seedDemoStore();const item=data.certificates.find(c=>c.id===id);if(item){item.status=nextStatus;item.status_reason=reason?.trim()||null;item.revoked_at=nextStatus==='revoked'?new Date().toISOString():null;}
      data.audit.unshift({id:`log-${Date.now()}`,action:`DEMO CERTIFICATE ${nextStatus.toUpperCase()}`,details:{certificate_number:cert.certificate_number,reason:reason?.trim()||null},created_at:new Date().toISOString()});saveDemoStore(data);loadDemoData();
    } else {
      const {error}=await state.sb.rpc('set_certificate_status',{p_certificate_id:id,p_status:nextStatus,p_reason:reason?.trim()||null});if(error)throw error;await loadAdminData();
    }
    renderPage();toast(`Certificate status changed to ${label}.`,'success');
  } catch(error){toast(error.message||'Could not update certificate status.','error');}
}

async function verifyIdentifier(identifier) {
  if(!identifier) return {status:'not_found'};
  if(state.mode==='demo' || !HAS_SUPABASE) {
    const data=seedDemoStore();const cert=data.certificates.find(c=>String(c.certificate_number).toLowerCase()===identifier.toLowerCase()||String(c.verification_token).toLowerCase()===identifier.toLowerCase());
    data.verifications=(data.verifications||0)+1;saveDemoStore(data);
    if(!cert)return {status:'not_found'};
    return {status:cert.status==='demo'?'demo':cert.status,certificate_number:cert.certificate_number,recipient_name:recipientName(cert),award_title:cert.award_title,programme_name:cert.programme_name,course_title:cert.course_title,date_completed:cert.date_completed,date_issued:cert.issued_at,issuer_name:CFG.issuerName||'Ethan Digital Academy',duration:cert.duration};
  }
  try {const {data,error}=await state.sb.rpc('verify_certificate',{p_identifier:identifier});if(error)throw error;return data||{status:'not_found'};}
  catch(error){return {status:'error',message:error.message||'Verification service unavailable.'};}
}
function verificationCard(result) {
  if(!result || result.status==='not_found') return `<div class="verify-invalid-note"><strong>Certificate not found.</strong> Check the certificate number and try again. This result does not authenticate the submitted document.</div>`;
  if(result.status==='error') return `<div class="verify-invalid-note"><strong>Verification unavailable.</strong> ${esc(result.message||'Please try again later.')}</div>`;
  const demo=result.status==='demo';const active=result.status==='active';
  const title=demo?'DEMO RECORD — NOT OFFICIAL':active?'VALID CERTIFICATE':result.status==='revoked'?'REVOKED CERTIFICATE':'SUSPENDED CERTIFICATE';
  const statusClassName=active?'pill-green':demo?'pill-demo':'pill-red';
  return `<div class="verify-result-card"><div class="verify-result-head"><h3>${title}</h3><span class="pill ${statusClassName}">${demo?'Demo only':statusLabel(result.status)}</span></div><div class="verify-result-body"><div class="verify-fields">
    <div class="verify-field"><span>Certificate holder</span><b>${esc(result.recipient_name||'—')}</b></div>
    <div class="verify-field"><span>Certificate number</span><b>${esc(result.certificate_number||'—')}</b></div>
    <div class="verify-field"><span>Programme</span><b>${esc(result.programme_name||'—')}</b></div>
    <div class="verify-field"><span>Course / specialisation</span><b>${esc(result.course_title||'—')}</b></div>
    <div class="verify-field"><span>Certificate title</span><b>${esc(result.award_title||'—')}</b></div>
    <div class="verify-field"><span>Date completed</span><b>${fmtDate(result.date_completed)}</b></div>
    <div class="verify-field"><span>Date issued</span><b>${fmtDate(result.date_issued)}</b></div>
    <div class="verify-field"><span>Issuing institution</span><b>${esc(result.issuer_name||CFG.issuerName||'Ethan Digital Academy')}</b></div>
  </div>${active?'<div class="verify-valid-note"><strong>Registry match confirmed.</strong> This certificate matches an active record in the official Ethan Digital Academy certificate registry.</div>':demo?'<div class="verify-invalid-note"><strong>Preview record only.</strong> This is sample data stored in a local browser. It is not an official certificate and cannot be independently authenticated.</div>':`<div class="verify-invalid-note"><strong>This certificate is not currently valid.</strong> Its registry status is ${esc(statusLabel(result.status).toLowerCase())}. Contact Ethan Digital Academy for clarification.</div>`}</div></div>`;
}

function renderPublicVerify(initial='') {
  app.innerHTML=`<main class="verify-shell"><header class="verify-top"><div class="verify-brand"><img src="/assets/brand-mark.svg" alt="ED"><div><b>ETHAN CERTIFICATE</b><small>OFFICIAL PUBLIC VERIFICATION</small></div></div><a class="btn btn-outline btn-small" href="${esc(CFG.appUrl||'https://certificate.ethandigitalacademy.org')}">Administrator login</a></header>
    <section class="verify-hero"><div class="eyebrow">ETHAN DIGITAL ACADEMY · CERTIFICATE REGISTRY</div><h1>Verify a certificate.</h1><p>Confirm whether a certificate was issued by Ethan Digital Academy and check its current registry status. Scan the certificate QR code or enter its unique certificate number below.</p></section>
    <section class="panel verify-card"><div class="section-head"><div><h3>Certificate verification</h3><p>Enter the certificate number exactly as printed on the certificate.</p></div><span class="pill pill-blue">Public service</span></div><form id="public-verify-form" class="verify-search"><input id="public-verify-input" value="${esc(initial)}" placeholder="EDA-CERT-2026-000001" autocomplete="off" required><button class="btn btn-primary" type="submit">Verify now →</button></form><div id="public-verify-result" class="verify-result">${HAS_SUPABASE?'':'<div class="helper-note" style="margin-top:18px"><strong>Preview environment:</strong> the live public registry becomes available after the Supabase database is connected and the application is deployed. Local demo records are not official verification records.</div>'}</div></section>
    <footer class="verify-footer">Issued by <strong>${esc(CFG.issuerName||'Ethan Digital Academy')}</strong>, a brand of ${esc(CFG.issuerParent||'ALLON-MAADIAH INTERNATIONAL LIMITED')} (RC ${esc(CFG.issuerRc||'1364788')}). A positive result confirms a matching registry record; it does not replace independent checks required by an employer or institution.</footer></main>`;
  $('#public-verify-form').addEventListener('submit',async event=>{event.preventDefault();const value=$('#public-verify-input').value.trim();$('#public-verify-result').innerHTML='<div class="loading-inline"><span class="spinner"></span> Checking the official registry…</div>';const result=await runPublicVerification(value);$('#public-verify-result').innerHTML=verificationCard(result);});
}
async function runPublicVerification(identifier) {
  const result=await verifyIdentifier(identifier);
  const target=$('#public-verify-result');if(target)target.innerHTML=verificationCard(result);
  return result;
}

function buildCertificateMarkup(c) {
  const demo=state.mode==='demo'||c.status==='demo';
  const verifyBase=(CFG.verifyUrl||location.origin).replace(/\/$/,'');
  const verifyUrl=`${verifyBase}/?verify=${encodeURIComponent(c.verification_token||c.certificate_number)}`;
  const recipient=recipientName(c);const issued=c.issued_at||c.date_issued||todayISO();
  const awardSubtitle=String(c.award_title||'CERTIFICATE OF COMPLETION').replace(/^CERTIFICATE\s*/i,'').replace(/\s*CERTIFICATE$/i,'')||'OF COMPLETION';
  return `<div class="certificate-paper" id="certificate-paper">
    ${demo?'<div class="cert-watermark">DEMO ONLY</div>':''}
    <div class="cert-inner">
      <div class="cert-top"><div class="cert-seal"><div><span>✦</span>ETHAN<br>DIGITAL<br>ACADEMY</div></div><img class="cert-logo" src="/assets/ethan-certificate-logo.png" alt="Ethan Certificate"><div class="cert-number"><b>CERTIFICATE NO.</b>${esc(c.certificate_number||'')}</div></div>
      <div class="cert-kicker">This is to certify that</div>
      <h1 class="cert-title">CERTIFICATE</h1><div class="cert-subtitle">${esc(awardSubtitle)}</div>
      <div class="cert-rule"></div>
      <div class="cert-recipient-label">has been awarded to</div>
      <div class="cert-recipient">${esc(recipient)}</div>
      <div class="cert-completed">for successfully completing the programme</div>
      <div class="cert-course">${esc(c.programme_name||c.course_title||'Professional Digital Skills Training')}</div>
      <p class="cert-description">${esc(c.remarks||'and demonstrating the knowledge, commitment and practical skills required for successful completion.')}</p>
      <div class="cert-details"><div class="cert-detail"><b>Course / Specialisation</b><span>${esc(c.course_title||'—')}</span></div><div class="cert-detail"><b>Duration</b><span>${esc(c.duration||'—')}</span></div><div class="cert-detail"><b>Result</b><span>${esc(c.grade||'Completed')}</span></div></div>
      <div class="cert-bottom"><div class="cert-qr-block"><div class="cert-qr" id="certificateQr" data-verify-url="${esc(verifyUrl)}"></div><div class="cert-qr-text"><b>VERIFY CERTIFICATE</b><span>Scan to verify this award<br>${esc(c.certificate_number||'')}</span></div></div><div class="cert-sign"><div class="cert-signature-line"></div><b>${esc(c.signatory_name||CFG.defaultSignatory||'Mr. Abayomi Peter Oyenuga')}</b><span>${esc(c.signatory_title||'Founder')} · Ethan Digital Academy</span></div><div class="cert-date"><b>${fmtDate(issued)}</b><span>DATE OF ISSUE</span><div style="margin-top:10px;font-size:9px;color:#6b7c8e">Completed: ${fmtDate(c.date_completed)}</div></div></div>
      <div class="cert-footer-line">${esc(CFG.issuerName||'ETHAN DIGITAL ACADEMY')} · LEARN. BUILD. GROW. LEAD. · ${demo?'DEMO PREVIEW — NOT VALID':'OFFICIAL REGISTRY RECORD'}</div>
    </div>
  </div>`;
}
async function openCertificate(c) {
  const backdrop=document.createElement('div');backdrop.className='modal-backdrop';backdrop.id='certificate-modal';
  backdrop.innerHTML=`<div class="modal"><div class="modal-head"><h3>Certificate preview · ${esc(c.certificate_number||'')}</h3><div class="modal-actions"><button class="btn btn-primary btn-small" id="download-certificate-pdf">Download PDF</button><button class="btn btn-outline btn-small" id="print-certificate">Print</button><button class="icon-btn" id="close-certificate" aria-label="Close">×</button></div></div><div class="modal-body">${buildCertificateMarkup(c)}</div></div>`;
  document.body.appendChild(backdrop);
  $('#close-certificate',backdrop).addEventListener('click',()=>backdrop.remove());
  backdrop.addEventListener('click',event=>{if(event.target===backdrop)backdrop.remove();});
  $('#print-certificate',backdrop).addEventListener('click',()=>window.print());
  $('#download-certificate-pdf',backdrop).addEventListener('click',()=>downloadCertificatePdf(c));
  try {
    await loadExternalScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js','QRCode');
    const qr=$('#certificateQr',backdrop);if(qr && window.QRCode){new QRCode(qr,{text:qr.dataset.verifyUrl,width:150,height:150,colorDark:'#102b55',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M});}
  } catch(error) { const qr=$('#certificateQr',backdrop);if(qr)qr.innerHTML='<span style="font-size:8px;text-align:center;color:#8a5c08">QR unavailable<br>connect online</span>'; }
}
async function downloadCertificatePdf(c) {
  const button=$('#download-certificate-pdf');button.disabled=true;button.textContent='Preparing PDF…';
  try {
    await loadExternalScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js','html2canvas');
    await loadExternalScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js','jspdf');
    const paper=$('#certificate-paper');
    const canvas=await window.html2canvas(paper,{scale:2,backgroundColor:'#ffffff',useCORS:true,logging:false});
    const {jsPDF}=window.jspdf;const pdf=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
    pdf.addImage(canvas.toDataURL('image/png'),'PNG',0,0,297,210,undefined,'FAST');
    pdf.save(`${(c.certificate_number||'ETHAN-CERTIFICATE').replace(/[^A-Za-z0-9-]/g,'_')}.pdf`);
    toast('Certificate PDF downloaded.','success');
  } catch(error) { toast(error.message||'PDF export failed. Try Print and choose Save as PDF.','error'); }
  finally {button.disabled=false;button.textContent='Download PDF';}
}

window.addEventListener('online',()=>{if(state.mode==='live')toast('Connection restored.','success')});
init().catch(error=>{app.innerHTML=`<div class="boot-screen"><div class="boot-mark">ED</div><div class="boot-title">ETHAN CERTIFICATE</div><div class="boot-sub">${esc(error.message||'Application could not start.')}</div></div>`;});
