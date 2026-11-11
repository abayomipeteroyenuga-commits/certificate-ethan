const CFG = window.ETHAN_CERT_CONFIG || {};
const app = document.getElementById('app-shell');
const toastBox = document.getElementById('toast-container');
const DEMO_KEY = 'ethan_certificate_demo_v1';
const HAS_BACKEND = true;
const state = {
  mode: 'preview', api: null, user: null, tab: 'overview', certificates: [], students: [], audit: [],
  lastIssued: null, reissueFrom: null, loading: false, publicMode: false, installPrompt: null,
  adminRole: null, signingOut: false, demoData: null, bulkRows: [], bulkFileName: ''
};

const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const todayISO = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const fmtDate = value => {
  if (!value) return '—';
  const d = new Date(String(value).length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(d.getTime()) ? String(value) : new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric'}).format(d);
};
const initials = value => String(value || 'E').trim().split(/\s+/).slice(0,2).map(s=>s[0]||'').join('').toUpperCase();
const recipientName = c => c?.students?.full_name || c?.recipient_name || c?.full_name || 'Unnamed recipient';
const recipientEmail = c => c?.students?.email || c?.student_email || c?.email || '';
const recipientPhone = c => c?.students?.phone || c?.student_phone || c?.phone || '';
const statusLabel = status => ({active:'Active',revoked:'Revoked',suspended:'Suspended',expired:'Expired',demo:'Demo only'}[status] || status || 'Unknown');
const statusClass = status => status === 'active' ? 'pill-green' : status === 'revoked' ? 'pill-red' : status === 'suspended' || status === 'expired' ? 'pill-amber' : 'pill-demo';
const effectiveStatus = cert => cert?.status === 'active' && cert?.expiration_date && cert.expiration_date < todayISO() ? 'expired' : (cert?.status || 'unknown');
const canIssueCertificates = () => state.mode === 'demo' || ['owner','admin','issuer'].includes(state.adminRole);
const canManageCertificates = () => state.mode === 'demo' || ['owner','admin'].includes(state.adminRole);
const isVerifyHost = location.hostname.toLowerCase().startsWith('verify.') || location.hostname.toLowerCase() === 'ethan-certificate-verifier.onrender.com';

function toast(message, kind='') {
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  toastBox.appendChild(node);
  setTimeout(()=>node.remove(), 3600);
}
function demoStore() {
  if (state.demoData) return state.demoData;
  try { const data=JSON.parse(localStorage.getItem(DEMO_KEY) || 'null'); if(data) state.demoData=data; return data; } catch { return state.demoData; }
}
function saveDemoStore(data) {
  state.demoData=data;
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(data)); } catch { /* In-memory preview remains available when browser storage is blocked. */ }
}
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
  const hasPublicQuery = params.has('verify') || params.has('number');
  const publicIdentifier = params.get('verify') || params.get('number') || '';
  if (isVerifyHost || hasPublicQuery) {
    state.publicMode = true;
    await initNeonApiIfConfigured();
    renderPublicVerify(publicIdentifier);
    if (publicIdentifier) runPublicVerification(publicIdentifier);
    return;
  }
  if (HAS_BACKEND) {
    try {
      await initNeonApiIfConfigured();
      const sessionResult = await state.api.auth.getSession();
      if (sessionResult && sessionResult.error) throw sessionResult.error;
      const sessionData = sessionResult && sessionResult.data && typeof sessionResult.data === 'object'
        ? sessionResult.data
        : {};
      const session = sessionData.session || null;
      if (session) {
        state.user = session.user; state.mode = 'live';
        const {data:role,error:roleError}=await state.api.rpc('get_admin_role');
        if(roleError || !role){await state.api.auth.signOut({scope:'local'});state.mode='preview';state.user=null;renderLogin('This account is not authorised to access the Ethan certificate registry. Ask the owner to provision administrator access.');return;}
        state.adminRole = role;
        await loadAdminData(); renderApp();
      } else renderLogin();
    } catch (error) {
      renderLogin(error.message || 'Unable to connect to the Neon certificate service.');
    }
  } else renderLogin();
}
async function certificateApiCall(action, payload={}) {
  const apiOrigin = (isVerifyHost && !CFG.apiBaseUrl) ? 'https://ethan-certificate.onrender.com' : (CFG.apiBaseUrl || '');
  const endpoint = apiOrigin + '/api/certificate';
  const response = await fetch(endpoint, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ action, ...payload })
  });
  let body = {};
  try { body = await response.json(); } catch {}
  if (!response.ok) throw new Error(body.error || 'The certificate service could not complete the request.');
  return body.data;
}
function certificateApiResult(promise) {
  return promise.then(data => ({ data, error: null })).catch(error => ({ data: null, error }));
}
function createCertificateApiClient() {
  return {
    auth: {
      getSession: async () => {
        try {
          const response = await certificateApiCall('session');
          const session = response && typeof response === 'object' ? (response.session || null) : null;
          return { data: { session }, error: null };
        } catch (error) {
          return { data: { session: null }, error };
        }
      },
      signInWithPassword: ({ email, password }) => certificateApiResult(certificateApiCall('login', { email, password }).then(data => ({ user: data?.user || null }))),
      signOut: () => certificateApiResult(certificateApiCall('logout')),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
    },
    rpc: (name, args={}) => certificateApiResult(certificateApiCall('rpc', { name, args })),
    from: (table) => {
      const query = {
        orderBy: 'created_at',
        ascending: false,
        rowLimit: 100,
        select() { return this; },
        order(column, options={}) { this.orderBy = column; this.ascending = options.ascending === true; return this; },
        limit(value) { this.rowLimit = Number(value) || 100; return this; },
        then(resolve, reject) {
          return certificateApiResult(certificateApiCall('select', { table, orderBy: this.orderBy, ascending: this.ascending, limit: this.rowLimit })).then(resolve, reject);
        }
      };
      return query;
    }
  };
}
async function initNeonApiIfConfigured() {
  if (state.api) return;
  state.api = createCertificateApiClient();
}

function renderLogin(errorMessage='') {
  app.innerHTML = `
    <main class="login-shell">
      <section class="login-brand">
        <div class="login-brand-content">
          <div class="brand-lockup"><img src="/assets/ethan-digital-academy-logo.png" alt="Ethan Digital Academy logo"><div><strong>ETHAN CERTIFICATE</strong><small>ISSUANCE &amp; VERIFICATION SYSTEM</small></div></div>
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
          <img class="mini-logo" src="/assets/ethan-digital-academy-logo.png" alt="Ethan Digital Academy">
          <div class="eyebrow">ADMINISTRATOR ACCESS</div>
          <h2>Welcome back</h2>
          <p>Sign in to manage Ethan Digital Academy certificates. Public verification does not require an account.</p>
          ${errorMessage ? `<div class="helper-note" style="margin-bottom:14px;color:#9f2938">${esc(errorMessage)}</div>` : ''}
          ${HAS_BACKEND ? `
            <form id="login-form">
              <div class="field"><label for="login-email">Administrator email <span class="req">*</span></label><input id="login-email" name="email" type="email" autocomplete="username" required placeholder="admin@example.com"></div>
              <div class="field"><label for="login-password">Password <span class="req">*</span></label><input id="login-password" name="password" type="password" autocomplete="current-password" required placeholder="Enter your password"></div>
              <button class="btn btn-primary" type="submit" id="login-submit">Sign in securely <span>→</span></button>
            </form>
            <button class="btn btn-outline" type="button" id="first-access-toggle" style="margin-top:10px;width:100%">First-time migrated owner setup</button>
            <form id="first-access-form" hidden style="margin-top:14px">
              <div class="helper-note" style="margin-bottom:12px">Use the one-time migration key to set a new password for the migrated owner account. This setup can be completed only once.</div>
              <div class="field"><label for="setup-email">Administrator email</label><input id="setup-email" name="email" type="email" autocomplete="username" required></div>
              <div class="field"><label for="setup-token">One-time migration key</label><input id="setup-token" name="token" type="password" autocomplete="off" required></div>
              <div class="field"><label for="setup-password">New password</label><input id="setup-password" name="password" type="password" minlength="12" autocomplete="new-password" required></div>
              <div class="field"><label for="setup-confirm">Confirm new password</label><input id="setup-confirm" name="confirm" type="password" minlength="12" autocomplete="new-password" required></div>
              <button class="btn btn-primary" type="submit" id="first-access-submit">Activate Neon owner account <span>→</span></button>
            </form>` : `
            <div class="helper-note"><strong>Setup required:</strong> Neon database access is managed securely by the server. The browser does not connect directly to the database.</div>
            <button class="btn btn-primary" id="demo-login">Open preview dashboard <span>→</span></button>`}
          <div class="login-divider">OR</div>
          <button class="btn btn-outline" id="open-verification">Open public verification page</button>
          <div class="login-footnote">Administrator accounts are provisioned by the Ethan owner. Public sign-up is disabled. Never expose database credentials or bootstrap keys in the browser.</div>
        </div>
      </section>
    </main>`;
  $('#login-form')?.addEventListener('submit', handleLogin);
  $('#first-access-form')?.addEventListener('submit', handleFirstAccess);
  $('#first-access-toggle')?.addEventListener('click', () => {
    const setup = $('#first-access-form');
    const login = $('#login-form');
    const opening = setup.hidden;
    setup.hidden = !opening;
    if (login) login.hidden = opening;
    $('#first-access-toggle').textContent = opening ? 'Return to sign in' : 'First-time migrated owner setup';
  });
  $('#demo-login')?.addEventListener('click', startDemo);
  $('#open-verification')?.addEventListener('click', ()=>{ location.href = `${location.origin}/?verify=`; });
}
async function handleFirstAccess(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const email = String(form.get('email') || '').trim();
  const token = String(form.get('token') || '');
  const password = String(form.get('password') || '');
  const confirm = String(form.get('confirm') || '');
  if (password !== confirm) { toast('The new passwords do not match.','error'); return; }
  if (password.length < 12) { toast('Choose a password with at least 12 characters.','error'); return; }
  const button = $('#first-access-submit');
  button.disabled = true; button.textContent = 'Activating account…';
  try {
    await initNeonApiIfConfigured();
    const data = await certificateApiCall('bootstrap', { email, token, password });
    state.user = data.user; state.mode = 'live';
    const {data:role,error:roleError} = await state.api.rpc('get_admin_role');
    if (roleError || !role) throw new Error('The migrated owner role could not be confirmed. Contact the Ethan administrator.');
    state.adminRole = role;
    await loadAdminData(); renderApp();
    toast('Your Neon owner account is active.','success');
  } catch(error) {
    toast(error.message || 'Unable to activate the owner account.','error');
    button.disabled = false; button.innerHTML = 'Activate Neon owner account <span>→</span>';
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const button = $('#login-submit'); button.disabled=true; button.textContent='Signing in…';
  try {
    await initNeonApiIfConfigured();
    const {data,error} = await state.api.auth.signInWithPassword({email:form.get('email'),password:form.get('password')});
    if (error) throw error;
    state.user=data.user; state.mode='live';
    const {data:role,error:roleError}=await state.api.rpc('get_admin_role');
    if(roleError || !role){await state.api.auth.signOut({scope:'local'});state.mode='preview';state.user=null;throw new Error('This account is not authorised to access the Ethan certificate registry. Ask the owner to provision administrator access.');}
    state.adminRole=role;
    await loadAdminData(); renderApp();
    toast('Signed in successfully.','success');
  } catch(error) { toast(error.message || 'Sign-in failed.','error'); button.disabled=false; button.innerHTML='Sign in securely <span>→</span>'; }
}
function startDemo() {
  state.mode='demo'; state.adminRole='owner'; state.user={email:'preview@ethandigitalacademy.org',name:'Preview Administrator'};
  loadDemoData(); renderApp(); toast('Preview mode only — demo records are not official certificates.');
}
async function signOut() {
  if (state.signingOut) return;
  state.signingOut = true;
  const buttons = [$('#signout-topbar'), $('#signout-sidebar')].filter(Boolean);
  buttons.forEach(button => { button.disabled = true; button.dataset.originalText = button.textContent; button.textContent = 'Signing out…'; });
  try {
    if (state.mode === 'live' && state.api) {
      const { error } = await state.api.auth.signOut({ scope: 'local' });
      if (error) throw error;
    }
    state.mode='preview'; state.user=null; state.adminRole=null;
    state.certificates=[]; state.students=[]; state.audit=[]; state.reissueFrom=null; state.demoData=null;
    renderLogin();
    toast('You have signed out securely.','success');
  } catch (error) {
    toast(error.message || 'Sign out failed. Please try again.','error');
    buttons.forEach(button => { button.disabled = false; button.textContent = button.dataset.originalText || 'Sign out'; });
  } finally {
    state.signingOut = false;
  }
}

async function loadAdminData() {
  if (state.mode==='demo') { loadDemoData(); return; }
  const isViewer = state.adminRole === 'viewer';
  const certQuery = state.api.rpc('get_certificate_registry');
  const studentsQuery = isViewer
    ? Promise.resolve({ data: [], error: null })
    : state.api.from('students').select('*').order('created_at',{ascending:false}).limit(500);
  const logsQuery = isViewer
    ? Promise.resolve({ data: [], error: null })
    : state.api.from('audit_logs').select('*').order('created_at',{ascending:false}).limit(100);
  const [certs,students,logs] = await Promise.all([certQuery,studentsQuery,logsQuery]);
  if (certs.error) throw certs.error;
  if (students.error) throw students.error;
  if (logs.error) throw logs.error;
  state.certificates=certs.data || []; state.students=students.data || []; state.audit=logs.data || [];
}

function renderApp() {
  const demo = state.mode==='demo';
  const canIssue = canIssueCertificates();
  const roleLabel = ({owner:'OWNER',admin:'ADMINISTRATOR',issuer:'CERTIFICATE ISSUER',viewer:'READ-ONLY VIEWER'})[state.adminRole] || 'ADMIN';
  const signOutLabel = demo ? 'Exit preview' : 'Sign out';
  app.innerHTML = `
    <div class="app-layout">
      <aside class="sidebar" id="sidebar">
        <div class="side-brand"><img src="/assets/ethan-digital-academy-logo.png" alt="Ethan Digital Academy logo"><div><b>ETHAN CERTIFICATE</b><small>ISSUE · VERIFY · AUTHENTICATE</small></div></div>
        <div class="side-label">Workspace</div>
        <nav class="nav-list">
          <button class="nav-item" data-tab="overview"><span class="nav-ico">▦</span>Overview</button>
          ${canIssue ? '<button class="nav-item" data-tab="issue"><span class="nav-ico">✚</span>Issue certificate</button>' : ''}
          ${canIssue && state.mode === 'live' ? '<button class="nav-item" data-tab="bulk"><span class="nav-ico">▦</span>Bulk issue (CSV)</button>' : ''}
          <button class="nav-item" data-tab="registry"><span class="nav-ico">▤</span>Certificate registry</button>
          ${state.adminRole !== 'viewer' ? '<button class="nav-item" data-tab="students"><span class="nav-ico">♙</span>Students</button>' : ''}
          <button class="nav-item" data-tab="verify"><span class="nav-ico">⌕</span>Verify a certificate</button>
          ${state.adminRole !== 'viewer' ? '<button class="nav-item" data-tab="activity"><span class="nav-ico">◷</span>Activity log</button>' : ''}
        </nav>
        <div class="side-label">System</div>
        <nav class="nav-list"><button class="nav-item" data-tab="settings"><span class="nav-ico">⚙</span>Settings &amp; setup</button></nav>
        <div class="sidebar-bottom">
          <div class="side-user"><div class="avatar">${esc(initials(state.user?.email || 'Ethan'))}</div><div class="side-user-meta"><b>${esc(state.mode==='demo'?'Preview administrator':(state.user?.email || 'Administrator'))}</b><small>${demo?'LOCAL DEMO MODE':roleLabel}</small></div></div>
          <button class="side-signout" id="signout-sidebar" type="button"><span aria-hidden="true">↪</span>${signOutLabel}</button>
        </div>
      </aside>
      <section class="main-area">
        <header class="topbar"><div class="topbar-left"><button class="icon-btn mobile-menu" id="mobile-menu" aria-label="Open navigation">☰</button><div class="topbar-label">Ethan Digital Academy <strong>/ Certificate Registry</strong></div></div><div class="topbar-right">${demo?'<span class="pill pill-demo"><span class="dot"></span>Preview only</span>':'<span class="pill pill-green"><span class="dot"></span>Secure session</span>'}<span class="topbar-account" title="Signed in account">${esc(state.user?.email || 'Preview administrator')}</span><button class="btn btn-outline btn-small" id="install-app">Install app</button><button class="btn btn-danger btn-small topbar-signout" id="signout-topbar" type="button"><span aria-hidden="true">↪</span> ${signOutLabel}</button></div></header>
        <main class="content" id="page-root"></main>
      </section>
    </div>`;
  $$('.nav-item',app).forEach(btn=>btn.addEventListener('click',()=>{state.tab=btn.dataset.tab;$('#sidebar').classList.remove('open');renderPage();}));
  $('#signout-topbar').addEventListener('click',signOut);
  $('#signout-sidebar').addEventListener('click',signOut);
  $('#mobile-menu').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
  $('#install-app').addEventListener('click',installApp);
  renderPage();
}

async function installApp() {
  if (state.installPrompt) { state.installPrompt.prompt(); await state.installPrompt.userChoice; state.installPrompt=null; }
  else toast('To install, use your browser menu and choose “Install Ethan Certificate” or “Add to Home Screen”.');
}
function renderPage() {
  if (state.tab === 'issue' && !canIssueCertificates()) { state.tab = 'overview'; toast('Your account is not permitted to issue certificates.','error'); }
  if (state.tab === 'bulk' && (state.mode !== 'live' || !canIssueCertificates())) { state.tab = 'overview'; toast('CSV batch issuance requires an authorised live registry account.','error'); }
  if (state.tab === 'students' && state.adminRole === 'viewer') { state.tab = 'overview'; toast('Student contact records are restricted for read-only viewers.','error'); }
  if (state.tab === 'activity' && state.adminRole === 'viewer') { state.tab = 'overview'; toast('Activity logs are restricted to administrators and issuers.','error'); }
  $$('.nav-item',app).forEach(btn=>btn.classList.toggle('active',btn.dataset.tab===state.tab));
  const root=$('#page-root'); if(!root) return;
  const pages={overview:renderOverview,issue:renderIssue,bulk:renderBulkIssue,registry:renderRegistry,students:renderStudents,verify:renderVerifyAdmin,activity:renderActivity,settings:renderSettings};
  root.innerHTML=(pages[state.tab]||renderOverview)();
  bindPageEvents();
}
function pageHead(eyebrow,title,subtitle,action='') { return `<div class="content-head"><div><div class="eyebrow">${eyebrow}</div><h1 class="page-title">${title}</h1><p class="page-subtitle">${subtitle}</p></div>${action}</div>`; }
function demoNotice() { return state.mode==='demo' ? `<div class="demo-banner"><strong>PREVIEW MODE — NOT AN OFFICIAL REGISTRY.</strong> Records created here stay in this browser only. Connect the Neon server API before issuing real certificates or enabling public verification.</div>` : ''; }
function renderOverview() {
  const total=state.certificates.length, active=state.certificates.filter(c=>effectiveStatus(c)==='active').length, revoked=state.certificates.filter(c=>effectiveStatus(c)==='revoked').length, studentCount=state.adminRole==='viewer'?'—':state.students.length;
  const recent=state.certificates.slice(0,6);
  return `${pageHead('ACADEMY REGISTRY','Certificate overview','Monitor certificate issuance, student records and verification activity.',canIssueCertificates()?`<button class="btn btn-primary" data-tab="issue">＋ Issue certificate</button>`:'')}${demoNotice()}
    <div class="stats-grid">
      <div class="panel stat-card"><div class="stat-top">Certificates issued <span class="stat-ico">▤</span></div><div class="stat-value">${total}</div><div class="stat-foot">Total records in this registry</div></div>
      <div class="panel stat-card"><div class="stat-top">Active certificates <span class="stat-ico">✓</span></div><div class="stat-value">${active}</div><div class="stat-foot">Currently valid awards</div></div>
      <div class="panel stat-card"><div class="stat-top">Students <span class="stat-ico">♙</span></div><div class="stat-value">${studentCount}</div><div class="stat-foot">Recipient profiles recorded</div></div>
      <div class="panel stat-card"><div class="stat-top">Revoked certificates <span class="stat-ico">⊘</span></div><div class="stat-value">${revoked}</div><div class="stat-foot">Records no longer valid</div></div>
    </div>
    <div class="overview-grid">
      <section class="panel panel-pad"><div class="section-head"><div><h3>Recently issued certificates</h3><p>Latest records added to the registry</p></div><button class="btn btn-outline btn-small" data-tab="registry">View registry →</button></div>
        ${recent.length?`<div class="table-wrap"><table><thead><tr><th>Recipient</th><th>Certificate ID</th><th>Programme</th><th>Status</th><th></th></tr></thead><tbody>${recent.map(c=>`<tr><td><div class="row-main"><div class="student-initial">${esc(initials(recipientName(c)))}</div><div><b>${esc(recipientName(c))}</b><small>${esc(recipientEmail(c))}</small></div></div></td><td>${esc(c.certificate_number)}</td><td>${esc(c.programme_name||c.course_title||'—')}</td><td><span class="pill ${statusClass(effectiveStatus(c))}">${statusLabel(effectiveStatus(c))}</span></td><td><button class="btn btn-soft btn-small" data-action="preview" data-id="${esc(c.id)}">View</button></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty-state"><div class="empty-icon">▤</div><strong>No certificates yet</strong>Issue your first certificate to start building the registry.</div>`}
      </section>
      <section class="panel panel-pad"><div class="section-head"><div><h3>Quick actions</h3><p>Common certificate tasks</p></div></div><div class="quick-list">
        ${canIssueCertificates()?'<button class="quick-action" data-tab="issue"><span class="quick-icon">✚</span><span><b>Issue a new certificate</b><small>Create a certificate for a learner</small></span><span class="quick-arrow">›</span></button>':''}
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
          <div class="field full credential-fieldset"><div class="credential-fieldset-title">Credential details for employers and verification</div><small>These details make each award more informative and prepare the registry for future digital credential interoperability.</small></div>
          <div class="field full"><label>Achievement description</label><textarea name="achievement_description" maxlength="1200" placeholder="Describe what the learner knows or can do after completing this programme.">${esc(previous?.achievement_description||'')}</textarea></div>
          <div class="field full"><label>Achievement / earning criteria</label><textarea name="criteria_narrative" maxlength="1200" placeholder="What did the learner need to complete, demonstrate or pass to earn this certificate?">${esc(previous?.criteria_narrative||'')}</textarea></div>
          <div class="field full"><label>Skills and competencies</label><input name="skills_tags" maxlength="1000" value="${esc((previous?.skills_tags||[]).join(', '))}" placeholder="e.g. Spreadsheet analysis, Data entry, Digital communication"><small>Separate skills with commas. Up to 20 skill tags are saved.</small></div>
          <div class="field"><label>Framework / standard alignment (optional)</label><input name="framework_alignment" maxlength="180" value="${esc(previous?.framework_alignment||'')}" placeholder="e.g. Academy course competency framework"></div>
          <div class="field"><label>Credential expiry date (optional)</label><input name="expiration_date" type="date" min="${todayISO()}" value="${esc(previous?.expiration_date && previous.expiration_date>=todayISO()?previous.expiration_date:'')}"><small>Leave blank for credentials that do not expire.</small></div>
          <div class="field full"><label>Evidence link (optional, authorised staff only)</label><input name="evidence_url" type="url" maxlength="500" value="${esc(previous?.evidence_url||'')}" placeholder="https://.../"><small>Visible to authorised registry staff only. Never returned by public verification.</small></div>
        </div>
        <div class="helper-note" style="margin-top:16px">${previous?`<strong>Replacement record:</strong> this certificate will be linked to ${esc(previous.certificate_number)}. The previous record remains ${esc(statusLabel(effectiveStatus(previous)).toLowerCase())}.<br>`:''}<strong>Certificate ID:</strong> generated automatically when issued. Each official certificate receives a unique registry number and a QR code linked to the public verification page. Do not reuse certificate numbers.</div>
        <div class="form-actions"><button class="btn btn-outline" type="reset">Clear form</button><button class="btn btn-primary" id="issue-submit" type="submit">Issue certificate <span>→</span></button></div>
      </form>
    </section>`;
}

const BULK_CERTIFICATE_COLUMNS = [
  'full_name','email','phone','award_title','programme_name','course_title','duration',
  'date_completed','date_issued','grade','signatory_name','signatory_title','remarks',
  'achievement_description','criteria_narrative','skills_tags','expiration_date','framework_alignment'
];

function csvParse(text) {
  const input = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field.length === 0) quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (quoted) throw new Error('The CSV file contains an unclosed quotation mark.');
  if (field.length || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  return rows.filter(record => record.some(value => String(value || '').trim() !== ''));
}

function csvHeaderName(value) {
  const header = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const aliases = {
    student_name:'full_name', student_full_name:'full_name', recipient:'full_name', recipient_name:'full_name', name:'full_name',
    student_email:'email', email_address:'email', student_phone:'phone', phone_number:'phone',
    programme:'programme_name', program:'programme_name', programme_title:'programme_name',
    course:'course_title', course_name:'course_title', specialisation:'course_title', specialization:'course_title',
    completion_date:'date_completed', completed_date:'date_completed', issue_date:'date_issued', issued_date:'date_issued',
    result:'grade', achievement:'grade', expiry_date:'expiration_date', expires_on:'expiration_date',
    skills:'skills_tags', competencies:'skills_tags', criteria:'criteria_narrative', earning_criteria:'criteria_narrative',
    achievement_summary:'achievement_description'
  };
  return aliases[header] || header;
}

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(String(value) + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function createBulkRecord(row, rowNumber) {
  const data = {};
  BULK_CERTIFICATE_COLUMNS.forEach(column => { data[column] = String(row[column] ?? '').trim(); });
  const errors = [];
  if (!data.full_name) errors.push('Full name is required.');
  if (!data.programme_name) errors.push('Programme name is required.');
  if (!data.course_title) errors.push('Course title is required.');
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push('Email address is invalid.');
  if (data.full_name.length > 140) errors.push('Full name is longer than 140 characters.');
  if (data.programme_name.length > 180) errors.push('Programme name is longer than 180 characters.');
  if (data.course_title.length > 180) errors.push('Course title is longer than 180 characters.');
  const issueDate = data.date_issued || todayISO();
  if (!isValidIsoDate(data.date_completed)) errors.push('Date completed must use YYYY-MM-DD.');
  if (!isValidIsoDate(issueDate)) errors.push('Date issued must use YYYY-MM-DD.');
  if (isValidIsoDate(data.date_completed) && isValidIsoDate(issueDate) && data.date_completed > issueDate) errors.push('Completion date cannot be after issue date.');
  if (data.expiration_date && !isValidIsoDate(data.expiration_date)) errors.push('Expiry date must use YYYY-MM-DD.');
  if (data.expiration_date && isValidIsoDate(issueDate) && isValidIsoDate(data.expiration_date) && data.expiration_date < issueDate) errors.push('Expiry date cannot be earlier than issue date.');
  const allowedAwards = ['CERTIFICATE OF COMPLETION','CERTIFICATE OF ACHIEVEMENT','PROFESSIONAL CERTIFICATE','CERTIFICATE OF PARTICIPATION'];
  const award = (data.award_title || 'CERTIFICATE OF COMPLETION').toUpperCase();
  if (!allowedAwards.includes(award)) errors.push('Choose a supported certificate title.');
  const payload = {
    p_full_name:data.full_name, p_email:data.email || null, p_phone:data.phone || null, p_award_title:award,
    p_programme_name:data.programme_name, p_course_title:data.course_title, p_duration:data.duration || null,
    p_date_completed:data.date_completed, p_date_issued:issueDate, p_grade:data.grade || null,
    p_remarks:data.remarks || null, p_signatory_name:data.signatory_name || CFG.defaultSignatory || 'Mr. Abayomi Peter Oyenuga',
    p_signatory_title:data.signatory_title || CFG.defaultSignatoryTitle || 'Founder',
    p_achievement_description:data.achievement_description || null, p_criteria_narrative:data.criteria_narrative || null,
    p_skills_tags:data.skills_tags.split(/[;,]/).map(tag=>tag.trim()).filter(Boolean).slice(0,20),
    p_evidence_url:null, p_expiration_date:data.expiration_date || null,
    p_framework_alignment:data.framework_alignment || null, p_reissued_from:null
  };
  return {rowNumber,data,payload,errors,status:errors.length?'INVALID':'READY',certificateNumber:'',error:''};
}

function renderBulkIssue() {
  const rows = state.bulkRows || [];
  const ready = rows.filter(row=>row.status==='READY').length;
  const invalid = rows.filter(row=>row.status==='INVALID').length;
  const issued = rows.filter(row=>row.status==='ISSUED').length;
  const failed = rows.filter(row=>row.status==='FAILED').length;
  const table = rows.length
    ? '<div class="bulk-table-wrap"><table class="bulk-table"><thead><tr><th>Row</th><th>Recipient</th><th>Programme / course</th><th>Result</th></tr></thead><tbody>' +
      rows.map(row => '<tr><td>' + row.rowNumber + '</td><td><b>' + esc(row.data.full_name || '—') + '</b><small>' + esc(row.data.email || '') + '</small></td><td>' + esc(row.data.programme_name || '—') + '<small>' + esc(row.data.course_title || '') + '</small></td><td><span class="bulk-status ' + row.status.toLowerCase() + '">' + esc(row.status) + '</span>' +
        (row.certificateNumber ? '<small class="bulk-success-id">' + esc(row.certificateNumber) + '</small>' : '') +
        (row.errors.length ? '<small class="bulk-error">' + esc(row.errors.join(' ')) + '</small>' : row.error ? '<small class="bulk-error">' + esc(row.error) + '</small>' : '') +
        '</td></tr>').join('') + '</tbody></table></div>'
    : '<div class="empty-state"><div class="empty-icon">▦</div><strong>No CSV loaded</strong>Choose a CSV file to validate certificate recipients before issuance.</div>';
  return pageHead('BATCH CERTIFICATE MANAGEMENT','Bulk certificate issuance','Import a CSV file, review every row and issue certificates through the same secure registry workflow.','<button class="btn btn-outline" id="download-bulk-template">↓ Download CSV template</button>') +
    demoNotice() +
    '<div class="bulk-guidance"><div class="bulk-guidance-icon">✓</div><div><b>Controlled batch issuance</b><p>Upload up to 50 rows at a time. Every row is validated before any certificate is issued. Successful records receive unique IDs and audit entries in Neon.</p></div></div>' +
    '<section class="panel panel-pad bulk-upload-panel"><div class="section-head"><div><h3>1. Upload recipient list</h3><p>Use the provided CSV template. Dates must be formatted as YYYY-MM-DD.</p></div><span class="pill pill-blue">Maximum 50 rows</span></div>' +
    '<div class="bulk-upload-area"><div class="bulk-upload-symbol">↑</div><div><b>Select a CSV file</b><small>Comma-separated values · UTF-8 · Up to 50 certificates</small></div><input type="file" id="bulk-csv-file" accept=".csv,text/csv" aria-label="Choose certificate CSV file"></div>' +
    '<div class="bulk-upload-help">Required columns: <code>full_name</code>, <code>programme_name</code>, <code>course_title</code>, <code>date_completed</code>. The issue date defaults to today when left blank.</div>' +
    (state.bulkFileName ? '<div class="bulk-file-meta"><span>Loaded file: <b>' + esc(state.bulkFileName) + '</b></span><button class="btn btn-outline btn-small" id="clear-bulk">Clear file</button></div>' : '') +
    '</section>' +
    (rows.length ? '<section class="panel panel-pad bulk-preview-panel"><div class="section-head"><div><h3>2. Review and issue</h3><p>Rows with errors will be skipped; correct those rows and re-upload them separately.</p></div><div class="bulk-summary-chips"><span>' + rows.length + ' rows</span><span class="good">' + ready + ' ready</span><span class="bad">' + invalid + ' invalid</span><span class="done">' + issued + ' issued</span>' + (failed?'<span class="bad">' + failed + ' failed</span>':'') + '</div></div>' +
    table + '<div class="bulk-actions"><div class="bulk-progress-text" id="bulk-progress-text">' + (issued || failed ? issued + ' issued · ' + failed + ' failed' : ready + ' certificate(s) ready to issue') + '</div><div class="bulk-action-buttons"><button class="btn btn-outline btn-small" id="download-bulk-results" ' + (issued+failed===0?'disabled':'') + '>Download results</button><button class="btn btn-primary" id="issue-bulk-certificates" ' + (ready===0?'disabled':'') + '>Issue ' + ready + ' certificate(s) <span>→</span></button></div></div></section>' : '') +
    '<div class="bulk-security-note"><b>Important:</b> issuing creates official records and QR verification links immediately. Confirm recipient names, programme titles and completion dates before starting. Records are issued one by one; each can later be suspended or revoked with an audit reason.</div>';
}

function downloadBulkTemplate() {
  const csv = '\ufeff' + BULK_CERTIFICATE_COLUMNS.join(',') + '\r\n';
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href=url; link.download='ethan-certificate-bulk-issue-template.csv';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function downloadBulkResults() {
  const headers=['CSV row','Recipient','Email','Programme','Course','Status','Certificate number','Error'];
  const rows=(state.bulkRows||[]).map(item=>[item.rowNumber,item.data.full_name,item.data.email,item.data.programme_name,item.data.course_title,item.status,item.certificateNumber,item.errors.join(' ')||item.error]);
  const csv='\ufeff'+[headers,...rows].map(row=>row.map(value=>'"'+String(value??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);const link=document.createElement('a');
  link.href=url;link.download='ethan-certificate-batch-results-'+todayISO()+'.csv';
  document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

async function loadBulkCsv(file) {
  if(!file)return;
  if(!/\.csv$/i.test(file.name)&&file.type!=='text/csv'){toast('Choose a CSV file.','error');return;}
  try {
    const records=csvParse(await file.text());
    if(records.length<2)throw new Error('The CSV needs a header row and at least one recipient row.');
    const headers=records[0].map(csvHeaderName);
    if(new Set(headers).size!==headers.length)throw new Error('The CSV contains duplicate column headings.');
    const missing=['full_name','programme_name','course_title','date_completed'].filter(column=>!headers.includes(column));
    if(missing.length)throw new Error('Missing required columns: '+missing.join(', ')+'.');
    const rows=records.slice(1);
    if(rows.length>50)throw new Error('A maximum of 50 certificate rows can be uploaded at a time.');
    state.bulkRows=rows.map((values,index)=>{
      const row={};headers.forEach((header,position)=>{row[header]=values[position]||'';});
      return createBulkRecord(row,index+2);
    });
    state.bulkFileName=file.name;
    renderPage();
    toast('CSV checked: '+state.bulkRows.filter(row=>row.status==='READY').length+' ready, '+state.bulkRows.filter(row=>row.status==='INVALID').length+' with errors.','success');
  } catch(error){toast(error.message||'Could not read this CSV file.','error');}
}

async function issueBulkCertificates() {
  if(state.mode!=='live'||!canIssueCertificates()){toast('Sign in with an authorised registry account first.','error');return;}
  const ready=state.bulkRows.filter(row=>row.status==='READY');
  if(!ready.length){toast('There are no validated rows ready to issue.','error');return;}
  if(!confirm('You are about to issue '+ready.length+' official Ethan Digital Academy certificate(s). Continue only after checking every recipient and date.'))return;
  const button=$('#issue-bulk-certificates');
  if(button){button.disabled=true;button.textContent='Issuing batch…';}
  let successCount=0,failureCount=0;
  for(const item of ready){
    try{
      const result=await state.api.rpc('issue_certificate_v2',item.payload);
      if(result.error)throw result.error;
      const cert=Array.isArray(result.data)?result.data[0]:result.data;
      if(!cert||!cert.certificate_number)throw new Error('The registry did not return a certificate number.');
      item.status='ISSUED';item.certificateNumber=cert.certificate_number;successCount++;
    }catch(error){item.status='FAILED';item.error=error.message||'Issuance failed.';failureCount++;}
    const progress=$('#bulk-progress-text');
    if(progress)progress.textContent='Processing '+(successCount+failureCount)+' of '+ready.length+' · '+successCount+' issued · '+failureCount+' failed';
    if(button)button.textContent='Issuing '+(successCount+failureCount)+'/'+ready.length+'…';
  }
  try{await loadAdminData();}catch(error){toast('Batch completed, but dashboard refresh failed: '+error.message,'error');}
  renderPage();
  toast('Batch complete: '+successCount+' issued, '+failureCount+' failed.',failureCount?'error':'success');
}

function renderRegistry() {
  const rows=state.certificates;
  return `${pageHead('OFFICIAL RECORDS','Certificate registry','Search, view, download or change the status of issued certificates.',canIssueCertificates()?`<button class="btn btn-primary" data-tab="issue">＋ Issue certificate</button>`:'')}${demoNotice()}
    <section class="panel panel-pad"><div class="section-head"><div><h3>All certificates</h3><p>${rows.length} record${rows.length===1?'':'s'} in the registry</p></div><div class="toolbar"><input class="search-input" id="registry-search" placeholder="Search name, ID or course…">${state.adminRole !== 'viewer' ? '<button class="btn btn-outline btn-small" id="export-registry">↓ Export CSV</button>' : ''}<button class="btn btn-outline btn-small" id="refresh-registry">↻ Refresh</button></div></div>
    <div id="registry-table">${registryTable(rows)}</div></section>`;
}
function registryTable(rows) {
  if(!rows.length) return `<div class="empty-state"><div class="empty-icon">▤</div><strong>No certificate records found</strong>Try another search or issue a new certificate.</div>`;
  const canManage=canManageCertificates(), canIssue=canIssueCertificates();
  return `<div class="table-wrap"><table><thead><tr><th>Recipient</th><th>Certificate number</th><th>Programme / course</th><th>Date issued</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows.map(c=>{const status=effectiveStatus(c);let controls=`<button class="btn btn-soft btn-small" data-action="preview" data-id="${esc(c.id)}">View / PDF</button>`;if(canManage){controls+=status==='active'?`<button class="btn btn-outline btn-small" data-action="status" data-status="suspended" data-id="${esc(c.id)}">Suspend</button><button class="btn btn-danger btn-small" data-action="status" data-status="revoked" data-id="${esc(c.id)}">Revoke</button>`:status==='suspended'?`<button class="btn btn-outline btn-small" data-action="status" data-status="active" data-id="${esc(c.id)}">Reactivate</button><button class="btn btn-danger btn-small" data-action="status" data-status="revoked" data-id="${esc(c.id)}">Revoke</button><button class="btn btn-soft btn-small" data-action="reissue" data-id="${esc(c.id)}">Reissue</button>`:status==='expired'?`<button class="btn btn-soft btn-small" data-action="reissue" data-id="${esc(c.id)}">Reissue</button><button class="btn btn-danger btn-small" data-action="status" data-status="revoked" data-id="${esc(c.id)}">Revoke</button>`:`<button class="btn btn-soft btn-small" data-action="reissue" data-id="${esc(c.id)}">Reissue</button>`;}if(canIssue&&status!=='active'&&status!=='demo'&&!canManage){controls+=`<button class="btn btn-soft btn-small" data-action="reissue" data-id="${esc(c.id)}">Reissue</button>`;}return `<tr><td><div class="row-main"><div class="student-initial">${esc(initials(recipientName(c)))}</div><div><b>${esc(recipientName(c))}</b><small>${esc(recipientEmail(c))}</small></div></div></td><td><b>${esc(c.certificate_number)}</b></td><td>${esc(c.programme_name||c.course_title||'—')}<small class="muted" style="display:block;margin-top:3px">${esc(c.course_title||'')}</small></td><td>${fmtDate(c.issued_at||c.date_issued)}</td><td><span class="pill ${statusClass(status)}">${statusLabel(status)}</span></td><td><div class="registry-actions">${controls}</div></td></tr>`}).join('')}</tbody></table></div>`;
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
      <section class="panel panel-pad"><div class="section-head"><div><h3>Connection status</h3><p>Production services required for official issuance.</p></div>${HAS_BACKEND?'<span class="pill pill-green">Configured</span>':'<span class="pill pill-amber">Not connected</span>'}</div>
        <div class="quick-list"><div class="quick-action"><span class="quick-icon">▣</span><span><b>Neon database</b><small>${HAS_BACKEND?'The server-side Neon connection is configured.':'Configure DATABASE_URL in the Render service environment.'}</small></span></div><div class="quick-action"><span class="quick-icon">♙</span><span><b>Administrator access</b><small>Owner and staff roles are stored in the Neon admin_users table and enforced by the server API.</small></span></div><div class="quick-action"><span class="quick-icon">⌕</span><span><b>Public verification</b><small>Use verify.ethandigitalacademy.org as a domain alias to this deployment.</small></span></div></div>
      </section>
    </div>
    <section class="panel panel-pad" style="margin-top:16px"><div class="section-head"><div><h3>Global credential standards roadmap</h3><p>Designed around international credential data and verification practices.</p></div><span class="pill pill-amber">Readiness stage · not certified</span></div>
      <div class="standards-grid">
        <div class="standards-card"><b>1EdTech Open Badges 3.0</b><p>Credential records now capture achievement descriptions, earning criteria, skills and evidence references. Cryptographic badge signing and wallet exchange remain a future implementation.</p><a href="https://www.1edtech.org/standards/open-badges" target="_blank" rel="noopener">Read the standard ↗</a></div>
        <div class="standards-card"><b>W3C Verifiable Credentials 2.0</b><p>The W3C data model provides the global structure for issuer, learner, credential claims, validity and cryptographic proof. Ethan Certificate is not yet issuing signed VC 2.0 credentials.</p><a href="https://www.w3.org/TR/vc-data-model/" target="_blank" rel="noopener">Read the W3C specification ↗</a></div>
        <div class="standards-card"><b>Europass Digital Credentials</b><p>European practice demonstrates organisation-level electronic seals, portable credentials and automatic integrity checks. Qualified seals require a suitable trust-service provider and legal setup.</p><a href="https://europass.europa.eu/en/how-issue-european-digital-credentials-learning" target="_blank" rel="noopener">Read Europass guidance ↗</a></div>
      </div>
      <div class="helper-note" style="margin-top:12px"><strong>Honest status:</strong> Ethan Certificate currently provides database-backed online verification and QR lookup. It must not be marketed as W3C VC 2.0, Open Badges 3.0 certified, blockchain-backed or cryptographically signed until those features are implemented and independently tested.</div>
    </section>
    <section class="panel panel-pad" style="margin-top:16px"><div class="section-head"><div><h3>Administrator permissions</h3><p>Your current role: <strong>${esc((state.adminRole||'preview').toUpperCase())}</strong></p></div></div><div class="role-grid"><div><b>Owner / Administrator</b><span>Issue, view, suspend, revoke, reactivate and oversee records.</span></div><div><b>Certificate issuer</b><span>Issue and reissue certificates; view records. Cannot change status.</span></div><div><b>Read-only viewer</b><span>View certificate registry only. Cannot view student contact records or activity logs, or make changes.</span></div></div></section>
    <section class="panel panel-pad" style="margin-top:16px"><div class="section-head"><div><h3>Production security checklist</h3><p>Complete these steps before issuing official certificates.</p></div></div><div class="quick-list"><div class="helper-note"><strong>1.</strong> For a fresh database, run <code>database/schema.sql</code>. For an existing v1.0.2 database, run <code>database/migrations/001_global_credential_readiness.sql</code>.</div><div class="helper-note"><strong>2.</strong> Activate the migrated owner once using <strong>First-time migrated owner setup</strong> and the one-time migration key.</div><div class="helper-note"><strong>3.</strong> Keep <code>DATABASE_URL</code> and <code>CERTIFICATE_BOOTSTRAP_TOKEN</code> private in Render environment variables. Never put database credentials in <code>config.js</code>.</div><div class="helper-note"><strong>4.</strong> Deploy the <code>main</code> branch through Render. Attach both certificate and verify domains to the Render service.</div><div class="helper-note"><strong>5.</strong> Test issuing, PDF download, QR verification, revoked status and access controls before using real learner records.</div></div></section>`;
}

function bindPageEvents() {
  $$('[data-tab]', $('#page-root')).forEach(btn=>btn.addEventListener('click',()=>{state.tab=btn.dataset.tab;renderPage();}));
  $('#issue-form')?.addEventListener('submit',handleIssueSubmit);
  $('#cancel-reissue')?.addEventListener('click',()=>{state.reissueFrom=null;renderPage();});
  $('#download-bulk-template')?.addEventListener('click',downloadBulkTemplate);
  $('#bulk-csv-file')?.addEventListener('change',event=>loadBulkCsv(event.target.files?.[0]));
  $('#clear-bulk')?.addEventListener('click',()=>{state.bulkRows=[];state.bulkFileName='';renderPage();});
  $('#issue-bulk-certificates')?.addEventListener('click',issueBulkCertificates);
  $('#download-bulk-results')?.addEventListener('click',downloadBulkResults);
  $('#registry-search')?.addEventListener('input',event=>{const q=event.target.value.toLowerCase();const rows=state.certificates.filter(c=>[recipientName(c),c.certificate_number,c.programme_name,c.course_title,recipientEmail(c)].join(' ').toLowerCase().includes(q));$('#registry-table').innerHTML=registryTable(rows);bindRegistryActions();});
  $('#students-search')?.addEventListener('input',event=>{const q=event.target.value.toLowerCase();const rows=state.students.filter(s=>[s.full_name,s.email,s.phone].join(' ').toLowerCase().includes(q));$('#students-table').innerHTML=studentsTable(rows);});
  $('#refresh-registry')?.addEventListener('click',async()=>{try{await loadAdminData();renderPage();toast('Registry refreshed.','success')}catch(e){toast(e.message,'error')}});
  $('#export-registry')?.addEventListener('click',exportRegistryCsv);
  $('#admin-verify-form')?.addEventListener('submit',async event=>{event.preventDefault();const value=$('#admin-verify-input').value.trim();$('#admin-verify-result').innerHTML='<div class="loading-inline"><span class="spinner"></span> Checking registry…</div>';const result=await verifyIdentifier(value);$('#admin-verify-result').innerHTML=verificationCard(result);});
  bindRegistryActions();
}

function exportRegistryCsv() {
  if (!canManageCertificates() && state.adminRole !== 'issuer' && state.mode !== 'demo') {
    toast('Your account cannot export registry records.','error'); return;
  }
  const headers=['Certificate number','Recipient','Programme','Course','Award title','Date issued','Date completed','Expiry date','Status','Skills','Framework alignment'];
  const rows=state.certificates.map(c=>[c.certificate_number,recipientName(c),c.programme_name,c.course_title,c.award_title,c.issued_at,c.date_completed,c.expiration_date,effectiveStatus(c),(c.skills_tags||[]).join('; '),c.framework_alignment]);
  const csv=[headers,...rows].map(row=>row.map(value=>{let text=String(value??'');if(/^[=+\-@\t\r]/.test(text))text=`'${text}`;return `"${text.replace(/"/g,'""')}"`;}).join(',')).join('\r\n');
  const blob=new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`ethan-certificate-registry-${todayISO()}.csv`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast('Registry CSV exported.','success');
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
    p_achievement_description:String(form.get('achievement_description')||'').trim()||null,
    p_criteria_narrative:String(form.get('criteria_narrative')||'').trim()||null,
    p_skills_tags:String(form.get('skills_tags')||'').split(',').map(tag=>tag.trim()).filter(Boolean).slice(0,20),
    p_evidence_url:String(form.get('evidence_url')||'').trim()||null,
    p_expiration_date:String(form.get('expiration_date')||'').trim()||null,
    p_framework_alignment:String(form.get('framework_alignment')||'').trim()||null,
    p_reissued_from:state.reissueFrom?.id||null
  };
  if(!canIssueCertificates()){toast('Your account is not permitted to issue certificates.','error');return;}
  const button=$('#issue-submit');button.disabled=true;button.innerHTML='<span class="spinner"></span> Issuing…';
  try {
    let cert;
    if(state.mode==='demo') {
      const data=seedDemoStore();data.sequence=(data.sequence||1)+1;
      const number=`DEMO-EDA-CERT-${new Date().getFullYear()}-${String(data.sequence).padStart(6,'0')}`;
      const studentId=payload.p_email ? `demo-${payload.p_email.toLowerCase().replace(/[^a-z0-9]/g,'-')}` : `demo-student-${Date.now()}`;
      let student=data.students.find(s=>payload.p_email && s.email?.toLowerCase()===payload.p_email.toLowerCase());
      if(!student){student={id:studentId,full_name:payload.p_full_name,email:payload.p_email,phone:payload.p_phone,created_at:new Date().toISOString()};data.students.unshift(student)}else{student.full_name=payload.p_full_name;student.phone=payload.p_phone;}
      cert={id:`demo-${Date.now()}`,certificate_number:number,verification_token:crypto.randomUUID?crypto.randomUUID():`demo-${Date.now()}`,students:student,student_id:student.id,reissued_from:payload.p_reissued_from,award_title:payload.p_award_title,programme_name:payload.p_programme_name,course_title:payload.p_course_title,duration:payload.p_duration,date_completed:payload.p_date_completed,issued_at:payload.p_date_issued,status:'demo',grade:payload.p_grade,remarks:payload.p_remarks,signatory_name:payload.p_signatory_name,signatory_title:payload.p_signatory_title,achievement_description:payload.p_achievement_description,criteria_narrative:payload.p_criteria_narrative,skills_tags:payload.p_skills_tags,evidence_url:payload.p_evidence_url,expiration_date:payload.p_expiration_date,framework_alignment:payload.p_framework_alignment};
      data.certificates.unshift(cert);data.audit.unshift({id:`log-${Date.now()}`,action:payload.p_reissued_from?'DEMO CERTIFICATE REISSUED':'DEMO CERTIFICATE ISSUED',details:{certificate_number:number,reissued_from:payload.p_reissued_from},created_at:new Date().toISOString()});saveDemoStore(data);loadDemoData();
    } else {
      const {data,error}=await state.api.rpc('issue_certificate_v2',payload);if(error)throw error;cert=Array.isArray(data)?data[0]:data;
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
  if(effectiveStatus(cert)==='active'){toast('Suspend, revoke or allow the original certificate to expire before reissuing it.','error');return;}
  state.reissueFrom=cert;state.tab='issue';renderPage();toast('Review the prefilled details, correct what is needed, then issue the replacement.');
}

async function changeCertificateStatus(id, nextStatus) {
  if(!canManageCertificates()){toast('Only owners and administrators can change certificate status.','error');return;}
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
      const {error}=await state.api.rpc('set_certificate_status',{p_certificate_id:id,p_status:nextStatus,p_reason:reason?.trim()||null});if(error)throw error;await loadAdminData();
    }
    renderPage();toast(`Certificate status changed to ${label}.`,'success');
  } catch(error){toast(error.message||'Could not update certificate status.','error');}
}

async function verifyIdentifier(identifier) {
  if(!identifier) return {status:'not_found'};
  if(state.mode==='demo' || !HAS_BACKEND) {
    const data=seedDemoStore();const cert=data.certificates.find(c=>String(c.certificate_number).toLowerCase()===identifier.toLowerCase()||String(c.verification_token).toLowerCase()===identifier.toLowerCase());
    data.verifications=(data.verifications||0)+1;saveDemoStore(data);
    if(!cert)return {status:'not_found'};
    const demoStatus=cert.status==='active'&&cert.expiration_date&&cert.expiration_date<todayISO()?'expired':cert.status==='demo'?'demo':cert.status;
    return {status:demoStatus,certificate_number:cert.certificate_number,recipient_name:recipientName(cert),award_title:cert.award_title,programme_name:cert.programme_name,course_title:cert.course_title,date_completed:cert.date_completed,date_issued:cert.issued_at,issuer_name:CFG.issuerName||'Ethan Digital Academy',duration:cert.duration,achievement_description:cert.achievement_description,criteria_narrative:cert.criteria_narrative,skills_tags:cert.skills_tags||[],expiration_date:cert.expiration_date,framework_alignment:cert.framework_alignment};
  }
  try {const {data,error}=await state.api.rpc('verify_certificate',{p_identifier:identifier});if(error)throw error;return data||{status:'not_found'};}
  catch(error){return {status:'error',message:error.message||'Verification service unavailable.'};}
}
function verificationCard(result) {
  if(!result || result.status==='not_found') return `<div class="verify-invalid-note"><strong>Certificate not found.</strong> Check the certificate number and try again. This result does not authenticate the submitted document.</div>`;
  if(result.status==='error') return `<div class="verify-invalid-note"><strong>Verification unavailable.</strong> ${esc(result.message||'Please try again later.')}</div>`;
  const demo=result.status==='demo';const active=result.status==='active';const expired=result.status==='expired';
  const title=demo?'DEMO RECORD — NOT OFFICIAL':active?'VALID CERTIFICATE':expired?'EXPIRED CERTIFICATE':result.status==='revoked'?'REVOKED CERTIFICATE':'SUSPENDED CERTIFICATE';
  const statusClassName=active?'pill-green':demo?'pill-demo':expired||result.status==='suspended'?'pill-amber':'pill-red';
  const skills=Array.isArray(result.skills_tags)?result.skills_tags:[];
  return `<div class="verify-result-card"><div class="verify-result-head"><h3>${title}</h3><span class="pill ${statusClassName}">${demo?'Demo only':statusLabel(result.status)}</span></div><div class="verify-result-body"><div class="verify-fields">
    <div class="verify-field"><span>Certificate holder</span><b>${esc(result.recipient_name||'—')}</b></div>
    <div class="verify-field"><span>Certificate number</span><b>${esc(result.certificate_number||'—')}</b></div>
    <div class="verify-field"><span>Programme</span><b>${esc(result.programme_name||'—')}</b></div>
    <div class="verify-field"><span>Course / specialisation</span><b>${esc(result.course_title||'—')}</b></div>
    <div class="verify-field"><span>Certificate title</span><b>${esc(result.award_title||'—')}</b></div>
    <div class="verify-field"><span>Date completed</span><b>${fmtDate(result.date_completed)}</b></div>
    <div class="verify-field"><span>Date issued</span><b>${fmtDate(result.date_issued)}</b></div>
    <div class="verify-field"><span>Issuing institution</span><b>${esc(result.issuer_name||CFG.issuerName||'Ethan Digital Academy')}</b></div>
    ${result.expiration_date?`<div class="verify-field"><span>Valid until</span><b>${fmtDate(result.expiration_date)}</b></div>`:''}
    ${result.framework_alignment?`<div class="verify-field"><span>Framework alignment</span><b>${esc(result.framework_alignment)}</b></div>`:''}
  </div>
  ${result.achievement_description?`<div class="credential-public-detail"><b>Achievement description</b><p>${esc(result.achievement_description)}</p></div>`:''}
  ${result.criteria_narrative?`<div class="credential-public-detail"><b>Earning criteria</b><p>${esc(result.criteria_narrative)}</p></div>`:''}
  ${skills.length?`<div class="credential-public-detail"><b>Skills and competencies</b><div class="skill-tags">${skills.map(skill=>`<span>${esc(skill)}</span>`).join('')}</div></div>`:''}
  ${active?'<div class="verify-valid-note"><strong>Registry match confirmed.</strong> This certificate matches an active record in the official Ethan Digital Academy certificate registry.</div>':demo?'<div class="verify-invalid-note"><strong>Preview record only.</strong> This is sample data stored in a local browser. It is not an official certificate and cannot be independently authenticated.</div>':`<div class="verify-invalid-note"><strong>This certificate is not currently valid.</strong> Its registry status is ${esc(statusLabel(result.status).toLowerCase())}. Contact Ethan Digital Academy for clarification.</div>`}</div></div>`;
}

function renderPublicVerify(initial='') {
  app.innerHTML=`<main class="verify-shell"><header class="verify-top"><div class="verify-brand"><img src="/assets/ethan-digital-academy-logo.png" alt="Ethan Digital Academy logo"><div><b>ETHAN CERTIFICATE</b><small>OFFICIAL PUBLIC VERIFICATION</small></div></div><a class="btn btn-outline btn-small" href="${esc(CFG.appUrl||'https://certificate.ethandigitalacademy.org')}">Administrator login</a></header>
    <section class="verify-hero"><div class="eyebrow">ETHAN DIGITAL ACADEMY · CERTIFICATE REGISTRY</div><h1>Verify a certificate.</h1><p>Confirm whether a certificate was issued by Ethan Digital Academy and check its current registry status. Scan the certificate QR code or enter its unique certificate number below.</p></section>
    <section class="panel verify-card"><div class="section-head"><div><h3>Certificate verification</h3><p>Enter the certificate number exactly as printed on the certificate.</p></div><span class="pill pill-blue">Public service</span></div><form id="public-verify-form" class="verify-search"><input id="public-verify-input" value="${esc(initial)}" placeholder="EDA-CERT-2026-000001" autocomplete="off" required><button class="btn btn-primary" type="submit">Verify now →</button></form><div id="public-verify-result" class="verify-result">${HAS_BACKEND?'':'<div class="helper-note" style="margin-top:18px"><strong>Preview environment:</strong> the live public registry becomes available after the Neon database is connected and the application is deployed. Local demo records are not official verification records.</div>'}</div></section>
    <footer class="verify-footer">Issued by <strong>${esc(CFG.issuerName||'Ethan Digital Academy')}</strong>, a brand of ${esc(CFG.issuerParent||'ALLON-MAADIAH INTERNATIONAL LIMITED')} (RC ${esc(CFG.issuerRc||'1364788')}). A positive result confirms a matching registry record; it does not replace independent checks required by an employer or institution.</footer></main>`;
  $('#public-verify-form').addEventListener('submit',async event=>{event.preventDefault();const value=$('#public-verify-input').value.trim();$('#public-verify-result').innerHTML='<div class="loading-inline"><span class="spinner"></span> Checking the official registry…</div>';const result=await runPublicVerification(value);$('#public-verify-result').innerHTML=verificationCard(result);});
}
async function runPublicVerification(identifier) {
  const result=await verifyIdentifier(identifier);
  const target=$('#public-verify-result');if(target)target.innerHTML=verificationCard(result);
  return result;
}

function buildCertificateMarkup(c) {
  const demo = state.mode === 'demo' || c.status === 'demo';
  const verifyBase = (CFG.verifyUrl || location.origin).replace(/\/$/, '');
  const verifyUrl = `${verifyBase}/?verify=${encodeURIComponent(c.verification_token || c.certificate_number)}`;
  const recipient = recipientName(c);
  const issued = c.issued_at || c.date_issued || todayISO();
  const rawAward = String(c.award_title || 'CERTIFICATE OF COMPLETION').trim().toUpperCase();
  const awardSubtitle = rawAward === 'PROFESSIONAL CERTIFICATE'
    ? 'PROFESSIONAL CERTIFICATION'
    : rawAward.replace(/^CERTIFICATE\s*/i, '').replace(/\s*CERTIFICATE$/i, '') || 'OF COMPLETION';
  const programme = c.programme_name || c.course_title || 'Professional Digital Skills Training';
  const recipientClass = recipient.length > 34 ? ' is-long' : recipient.length > 25 ? ' is-medium' : '';
  const programmeClass = String(programme).length > 48 ? ' is-long' : '';
  return `<div class="certificate-paper" id="certificate-paper">
    <div class="cert-ornament" aria-hidden="true"><svg viewBox="0 0 320 390" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="#d7ad50" stroke-width="1.4"><circle cx="205" cy="190" r="142"/><circle cx="205" cy="190" r="119" stroke-dasharray="3 7"/><circle cx="205" cy="190" r="93"/><path d="M205 12v356M27 190h356M79 64l252 252M79 316 331 64" opacity=".65"/><path d="M205 48c79 0 142 63 142 142s-63 142-142 142S63 269 63 190 126 48 205 48Z" stroke-dasharray="2 9"/></g><g fill="#d7ad50"><circle cx="205" cy="48" r="4"/><circle cx="347" cy="190" r="4"/><circle cx="205" cy="332" r="4"/><circle cx="63" cy="190" r="4"/><circle cx="105" cy="90" r="3"/><circle cx="305" cy="90" r="3"/><circle cx="105" cy="290" r="3"/><circle cx="305" cy="290" r="3"/></g><path d="M205 93 224 171 302 190 224 209 205 287 186 209 108 190 186 171Z" fill="#d7ad50" opacity=".12"/></svg></div>
    ${demo ? '<div class="cert-watermark is-demo" aria-hidden="true">DEMO ONLY</div>' : '<div class="cert-watermark" aria-hidden="true">ED</div>'}
    <div class="cert-inner">
      <header class="cert-header">
        <div class="cert-brand"><img class="cert-logo" src="/assets/ethan-digital-academy-logo.png" alt="Ethan Digital Academy"><div class="cert-brand-caption"><b>OFFICIAL ACADEMY CREDENTIAL</b><span>PROFESSIONAL LEARNING · PRACTICAL EXCELLENCE</span></div></div>
        <div class="cert-header-right"><img class="cert-seal-art" src="/assets/certificate-seal.svg" alt=""><div class="cert-id"><span>REGISTRY REFERENCE</span><b>${esc(c.certificate_number || 'PENDING REGISTRY ID')}</b><small>SCAN TO VERIFY AUTHENTICITY</small></div></div>
      </header>
      <section class="cert-heading">
        <div class="cert-kicker">ETHAN DIGITAL ACADEMY · RECOGNITION OF LEARNING</div>
        <h1 class="cert-title">CERTIFICATE</h1>
        <div class="cert-award-label">${esc(awardSubtitle)}</div>
        <div class="cert-title-rule"><span></span><i>✦</i><span></span></div>
      </section>
      <section class="cert-main">
        <p class="cert-presented">THIS CERTIFICATE IS PROUDLY PRESENTED TO</p>
        <h2 class="cert-recipient${recipientClass}">${esc(recipient)}</h2>
        <p class="cert-completion">for successfully completing</p>
        <h3 class="cert-programme${programmeClass}">${esc(programme)}</h3>
        <p class="cert-note">${esc(c.remarks || 'in recognition of the knowledge, commitment and practical skills demonstrated throughout the programme.')}</p>
      </section>
      <section class="cert-details" aria-label="Programme details">
        <div class="cert-detail"><span>COURSE / SPECIALISATION</span><b>${esc(c.course_title || programme)}</b></div>
        <div class="cert-detail"><span>TRAINING DURATION</span><b>${esc(c.duration || '—')}</b></div>
        <div class="cert-detail"><span>RESULT / ACHIEVEMENT</span><b>${esc(c.grade || 'Completed')}</b></div>
      </section>
      ${(Array.isArray(c.skills_tags)&&c.skills_tags.length)?`<div class="cert-skill-strip"><span>SKILLS RECOGNISED</span><b>${esc(c.skills_tags.slice(0,6).join(' · '))}</b></div>`:''}
      <footer class="cert-footer">
        <div class="cert-signature"><div class="cert-sign-line"></div><b>${esc(c.signatory_name || CFG.defaultSignatory || 'Mr. Abayomi Peter Oyenuga')}</b><span>${esc(c.signatory_title || CFG.defaultSignatoryTitle || 'Founder')} · Ethan Digital Academy</span></div>
        <div class="cert-dates"><div><span>DATE OF ISSUE</span><b>${fmtDate(issued)}</b></div><div><span>DATE COMPLETED</span><b>${fmtDate(c.date_completed)}</b></div></div>
        <div class="cert-verify"><div class="cert-qr" id="certificateQr" data-verify-url="${esc(verifyUrl)}"></div><div class="cert-verify-copy"><b>VERIFY CREDENTIAL</b><span>Scan the QR code to check this certificate in the official registry.</span><small>${esc(c.certificate_number || '')}</small></div></div>
      </footer>
      <div class="cert-footnote"><span>A BRAND OF ${esc(CFG.issuerParent || 'ALLON-MAADIAH INTERNATIONAL LIMITED')} · RC ${esc(CFG.issuerRc || '1364788')}</span><b>LEARN. BUILD. GROW. LEAD.</b><span>${demo ? 'DEMO PREVIEW · NOT VALID' : 'OFFICIAL REGISTRY RECORD'}</span></div>
    </div>
  </div>`;
}
async function loadQrCodeLibrary() {
  try {
    await loadExternalScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js', 'QRCode');
  } catch (primaryError) {
    await loadExternalScript('https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js', 'QRCode');
  }
  if (typeof window.QRCode !== 'function') throw new Error('The QR generator did not initialise.');
}

async function renderCertificateQr(qr) {
  if (!qr) throw new Error('The certificate QR area is missing.');
  const verifyUrl = String(qr.dataset.verifyUrl || '');
  const expectedBase = String(CFG.verifyUrl || 'https://verify.ethandigitalacademy.org').replace(/\\/$/, '');
  if (!verifyUrl.startsWith(expectedBase + '/?verify=')) {
    throw new Error('The certificate verification link is invalid.');
  }
  await loadQrCodeLibrary();
  qr.replaceChildren();
  new window.QRCode(qr, {
    text: verifyUrl,
    width: 200,
    height: 200,
    colorDark: '#102b55',
    colorLight: '#ffffff',
    correctLevel: window.QRCode.CorrectLevel.M
  });
  const rendered = qr.querySelector('canvas, img');
  if (!rendered) throw new Error('The QR image could not be rendered.');
  qr.dataset.qrReady = 'true';
  qr.setAttribute('aria-label', 'Scan to verify this certificate online');
  return verifyUrl;
}

async function openCertificate(c) {
  const backdrop=document.createElement('div');backdrop.className='modal-backdrop';backdrop.id='certificate-modal';
  backdrop.innerHTML=`<div class="modal"><div class="modal-head"><h3>Certificate preview · ${esc(c.certificate_number||'')}</h3><div class="modal-actions"><button class="btn btn-primary btn-small" id="download-certificate-pdf" disabled>Preparing QR…</button><button class="btn btn-outline btn-small" id="print-certificate" disabled>Preparing QR…</button><button class="icon-btn" id="close-certificate" aria-label="Close">×</button></div></div><div class="modal-body">${buildCertificateMarkup(c)}</div></div>`;
  document.body.appendChild(backdrop);
  $('#close-certificate',backdrop).addEventListener('click',()=>backdrop.remove());
  backdrop.addEventListener('click',event=>{if(event.target===backdrop)backdrop.remove();});
  const printButton = $('#print-certificate',backdrop);
  const downloadButton = $('#download-certificate-pdf',backdrop);
  printButton.addEventListener('click',()=>window.print());
  downloadButton.addEventListener('click',()=>downloadCertificatePdf(c));
  try {
    await renderCertificateQr($('#certificateQr',backdrop));
    downloadButton.disabled = false;
    downloadButton.textContent = 'Download PDF';
    printButton.disabled = false;
    printButton.textContent = 'Print';
  } catch(error) {
    const qr = $('#certificateQr',backdrop);
    if(qr) {
      qr.innerHTML = '<span style="font-size:8px;text-align:center;color:#8a5c08;padding:4px">QR unavailable. Reopen while online.</span>';
      qr.dataset.qrReady = 'false';
    }
    downloadButton.textContent = 'QR could not load';
    printButton.textContent = 'QR could not load';
    toast('The certificate QR code could not be prepared. Reopen the certificate while online.', 'error');
  }
}
async function downloadCertificatePdf(c) {
  const button = $('#download-certificate-pdf');
  if (!button) return;
  button.disabled = true;
  button.textContent = 'Preparing PDF…';
  const paper = $('#certificate-paper');
  try {
    await loadExternalScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', 'html2canvas');
    await loadExternalScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'jspdf');
    if (!paper) throw new Error('The certificate preview is not available. Close and reopen the certificate.');
    const qr = $('#certificateQr');
    if (!qr || qr.dataset.qrReady !== 'true' || !qr.querySelector('canvas, img')) {
      throw new Error('The certificate QR code is not ready. Close and reopen the certificate while online.');
    }
    if (document.fonts?.ready) await document.fonts.ready;
    await Promise.all([...paper.querySelectorAll('img')].map(img => img.decode ? img.decode().catch(() => {}) : Promise.resolve()));
    paper.classList.add('cert-exporting');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const canvas = await window.html2canvas(paper, {
      scale: 2.5, backgroundColor: '#ffffff', useCORS: true, allowTaint: false, logging: false,
      width: 1122, height: 794, windowWidth: 1122, windowHeight: 794, scrollX: 0, scrollY: 0
    });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 297, 210, undefined, 'FAST');
    pdf.save(`${(c.certificate_number || 'ETHAN-CERTIFICATE').replace(/[^A-Za-z0-9-]/g, '_')}.pdf`);
    toast('Certificate PDF downloaded.', 'success');
  } catch (error) {
    toast(error.message || 'PDF export failed. Try Print and choose Save as PDF.', 'error');
  } finally {
    paper?.classList.remove('cert-exporting');
    button.disabled = false;
    button.textContent = 'Download PDF';
  }
}
window.addEventListener('online',()=>{if(state.mode==='live')toast('Connection restored.','success')});
init().catch(error=>{app.innerHTML=`<div class="boot-screen"><div class="boot-mark">ED</div><div class="boot-title">ETHAN CERTIFICATE</div><div class="boot-sub">${esc(error.message||'Application could not start.')}</div></div>`;});
