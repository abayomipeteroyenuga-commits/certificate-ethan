const crypto = require('node:crypto');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

let pool;
function getPool() {
  if (pool) return pool;
  if (!process.env.DATABASE_URL) throw new Error('The Neon database connection is not configured.');
  let connectionString = process.env.DATABASE_URL;
  try {
    const parsed = new URL(connectionString);
    parsed.searchParams.delete('sslmode');
    parsed.searchParams.delete('channel_binding');
    connectionString = parsed.toString();
  } catch {}
  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: true },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    application_name: 'ethan-certificate-render'
  });
  return pool;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

function safeOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  let parsed;
  try { parsed = new URL(origin); } catch { throw new HttpError(403, 'Request origin is not allowed.'); }
  if (parsed.host.toLowerCase() !== String(req.headers.host || '').toLowerCase() || parsed.protocol !== 'https:') {
    throw new HttpError(403, 'Request origin is not allowed.');
  }
}

function getCookie(req, name) {
  const source = String(req.headers.cookie || '');
  for (const part of source.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return '';
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', 'ethan_certificate_session=' + encodeURIComponent(token) + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800');
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'ethan_certificate_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function tokenMatches(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function getIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(req.socket?.remoteAddress || 'unknown');
}

async function checkRateLimit(db, action, identity, maximum, windowSql) {
  const bucket = sha256(action + '|' + identity);
  const result = await db.query(
    'INSERT INTO public.request_limits (bucket_key, action, window_started_at, attempts) ' +
    'VALUES ($1, $2, now(), 1) ' +
    'ON CONFLICT (bucket_key, action) DO UPDATE SET ' +
    'attempts = CASE WHEN public.request_limits.window_started_at < now() - $3::interval THEN 1 ELSE public.request_limits.attempts + 1 END, ' +
    'window_started_at = CASE WHEN public.request_limits.window_started_at < now() - $3::interval THEN now() ELSE public.request_limits.window_started_at END ' +
    'RETURNING attempts',
    [bucket, action, windowSql]
  );
  if (Number(result.rows[0]?.attempts || 0) > maximum) {
    throw new HttpError(429, 'Too many attempts. Please try again later.');
  }
  return bucket;
}

async function findSession(req, db) {
  const rawToken = getCookie(req, 'ethan_certificate_session');
  if (!rawToken || !/^[a-f0-9]{64}$/i.test(rawToken)) return null;
  const hash = sha256(rawToken);
  const result = await db.query(
    'SELECT u.id, u.email, a.role ' +
    'FROM public.app_sessions s ' +
    'JOIN public.app_users u ON u.id = s.user_id ' +
    'JOIN public.admin_users a ON a.user_id = u.id ' +
    'WHERE s.token_hash = $1 AND s.expires_at > now() ' +
    'AND u.is_active = true AND u.must_reset_password = false AND a.is_active = true ' +
    'AND lower(u.email) = $2 ' +
    'LIMIT 1',
    [hash, ALLOWED_ADMIN_EMAIL]
  );
  if (!result.rows.length) return null;
  await db.query('UPDATE public.app_sessions SET last_seen_at = now() WHERE token_hash = $1', [hash]);
  const row = result.rows[0];
  return { id: row.id, email: row.email, role: row.role };
}

async function requireSession(req, db) {
  const user = await findSession(req, db);
  if (!user) throw new HttpError(401, 'Your session has ended. Please sign in again.');
  return user;
}

function requireStaff(user) {
  if (!user || !['owner', 'admin', 'issuer', 'viewer'].includes(user.role)) {
    throw new HttpError(403, 'You are not authorised to access the certificate registry.');
  }
}

function requireIssuer(user) {
  requireStaff(user);
  if (!['owner', 'admin', 'issuer'].includes(user.role)) {
    throw new HttpError(403, 'You are not authorised to issue certificates.');
  }
}

function requireManager(user) {
  requireStaff(user);
  if (!['owner', 'admin'].includes(user.role)) {
    throw new HttpError(403, 'Only owners and administrators can change certificate status.');
  }
}

async function createSession(db, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = sha256(token);
  await db.query(
    'INSERT INTO public.app_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval \'8 hours\')',
    [hash, userId]
  );
  setSessionCookie(res, token);
}

async function login(db, req, res, body) {
  safeOrigin(req);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) throw new HttpError(400, 'Enter your administrator email and password.');
  if (email !== ALLOWED_ADMIN_EMAIL) throw new HttpError(403, 'Access is restricted to the Ethan Digital Academy administrator.');
  const bucket = await checkRateLimit(db, 'login', getIp(req) + '|' + email, 8, '15 minutes');
  const result = await db.query(
    'SELECT u.id, u.email, u.password_hash, u.must_reset_password, u.is_active, a.role, a.is_active AS admin_active ' +
    'FROM public.app_users u JOIN public.admin_users a ON a.user_id = u.id ' +
    'WHERE lower(u.email) = lower($1) LIMIT 1',
    [email]
  );
  const account = result.rows[0];
  if (!account || !account.is_active || !account.admin_active) {
    throw new HttpError(401, 'Email or password is incorrect.');
  }
  if (account.must_reset_password || !account.password_hash) {
    throw new HttpError(409, 'Complete the one-time Neon account setup before signing in.');
  }
  const valid = await bcrypt.compare(password, account.password_hash);
  if (!valid) throw new HttpError(401, 'Email or password is incorrect.');
  await db.query('DELETE FROM public.request_limits WHERE bucket_key = $1 AND action = $2', [bucket, 'login']);
  await createSession(db, res, account.id);
  return { user: { id: account.id, email: account.email }, role: account.role };
}

async function bootstrapOwner(db, req, res, body) {
  safeOrigin(req);
  const expected = process.env.CERTIFICATE_BOOTSTRAP_TOKEN || '';
  if (!tokenMatches(String(body.token || ''), expected)) {
    throw new HttpError(403, 'The one-time migration key is invalid.');
  }
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || password.length < 12) throw new HttpError(400, 'Enter your owner email and a new password of at least 12 characters.');
  if (email !== ALLOWED_ADMIN_EMAIL) throw new HttpError(403, 'Only the authorised Ethan Digital Academy administrator can activate this account.');
  const bucket = await checkRateLimit(db, 'bootstrap', getIp(req) + '|' + email, 5, '15 minutes');
  const existing = await db.query(
    'SELECT u.id, u.email FROM public.app_users u ' +
    'JOIN public.admin_users a ON a.user_id = u.id ' +
    'WHERE lower(u.email) = lower($1) AND u.is_active = true AND u.must_reset_password = true ' +
    'AND a.is_active = true AND a.role = \'owner\' LIMIT 1',
    [email]
  );
  const owner = existing.rows[0];
  if (!owner) throw new HttpError(409, 'The migrated owner account is already set up or the email is not the owner account.');
  const passwordHash = await bcrypt.hash(password, 12);
  const update = await db.query(
    'UPDATE public.app_users SET password_hash = $1, must_reset_password = false, updated_at = now() ' +
    'WHERE id = $2 AND must_reset_password = true RETURNING id, email',
    [passwordHash, owner.id]
  );
  if (!update.rows.length) throw new HttpError(409, 'The migrated owner account has already been set up.');
  await db.query(
    'INSERT INTO public.audit_logs (actor_user_id, action, details) VALUES ($1, $2, $3::jsonb)',
    [owner.id, 'NEON OWNER ACCOUNT ACTIVATED', JSON.stringify({ source: 'supabase-to-neon-migration' })]
  );
  await db.query('DELETE FROM public.request_limits WHERE bucket_key = $1 AND action = $2', [bucket, 'bootstrap']);
  await createSession(db, res, owner.id);
  return { user: update.rows[0] };
}

async function getRegistry(db, user) {
  requireStaff(user);
  const privileged = ['owner', 'admin', 'issuer'].includes(user.role);
  const result = await db.query(
    'SELECT c.id, s.full_name AS recipient_name, ' +
    'CASE WHEN $1 THEN s.email ELSE NULL END AS student_email, ' +
    'CASE WHEN $1 THEN s.phone ELSE NULL END AS student_phone, ' +
    'c.certificate_number, c.verification_token, c.award_title, c.programme_name, c.course_title, ' +
    'c.duration, c.date_completed, c.issued_at, c.grade, ' +
    'CASE WHEN $1 THEN c.remarks ELSE NULL END AS remarks, ' +
    'c.signatory_name, c.signatory_title, c.status, ' +
    'CASE WHEN $1 THEN c.status_reason ELSE NULL END AS status_reason, ' +
    'c.expiration_date, c.achievement_description, c.criteria_narrative, c.skills_tags, ' +
    'CASE WHEN $1 THEN c.evidence_url ELSE NULL END AS evidence_url, c.framework_alignment ' +
    'FROM public.certificates c JOIN public.students s ON s.id = c.student_id ' +
    'ORDER BY c.issued_at DESC LIMIT 500',
    [privileged]
  );
  return result.rows;
}

async function selectTable(db, user, body) {
  requireStaff(user);
  const table = String(body.table || '');
  if (!['students', 'audit_logs'].includes(table)) throw new HttpError(400, 'Unsupported registry data request.');
  if (user.role === 'viewer') throw new HttpError(403, 'This role cannot access private registry details.');
  const limit = Math.max(1, Math.min(500, Number(body.limit) || (table === 'students' ? 500 : 100)));
  const order = body.orderBy === 'created_at' ? 'created_at' : 'created_at';
  const direction = body.ascending === true ? 'ASC' : 'DESC';
  const result = await db.query(
    'SELECT * FROM public.' + table + ' ORDER BY ' + order + ' ' + direction + ' LIMIT $1',
    [limit]
  );
  return result.rows;
}

async function issueCertificate(db, user, args) {
  requireIssuer(user);
  const fullName = String(args.p_full_name || '').trim();
  const programme = String(args.p_programme_name || '').trim();
  const course = String(args.p_course_title || '').trim();
  const completed = args.p_date_completed || null;
  const email = String(args.p_email || '').trim();
  const phone = String(args.p_phone || '').trim();
  const evidence = String(args.p_evidence_url || '').trim();
  if (!fullName) throw new HttpError(400, 'Student full name is required.');
  if (!programme) throw new HttpError(400, 'Programme name is required.');
  if (!course) throw new HttpError(400, 'Course title is required.');
  if (!completed) throw new HttpError(400, 'Completion date is required.');
  const dateInfo = await db.query('SELECT COALESCE($1::date, CURRENT_DATE)::text AS issue_date, CURRENT_DATE::text AS today', [args.p_date_issued || null]);
  const issueDate = dateInfo.rows[0].issue_date;
  if (completed > issueDate) throw new HttpError(400, 'Completion date cannot be after the issue date.');
  if (args.p_expiration_date && String(args.p_expiration_date) < issueDate) throw new HttpError(400, 'Expiry date cannot be earlier than the issue date.');
  if (evidence && !/^https?:\/\/[^\s]+$/i.test(evidence)) throw new HttpError(400, 'Evidence link must be a valid HTTP or HTTPS URL.');
  const skills = Array.isArray(args.p_skills_tags)
    ? args.p_skills_tags.map(x => String(x || '').trim().slice(0, 80)).filter(Boolean).slice(0, 20)
    : [];
  const reissueFrom = args.p_reissued_from || null;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    let previousNumber = null;
    if (reissueFrom) {
      const previous = await client.query(
        'SELECT certificate_number, status, expiration_date, (expiration_date IS NOT NULL AND expiration_date < CURRENT_DATE) AS expired ' +
        'FROM public.certificates WHERE id = $1 FOR UPDATE',
        [reissueFrom]
      );
      if (!previous.rows.length) throw new HttpError(400, 'The original certificate record was not found.');
      const old = previous.rows[0];
      previousNumber = old.certificate_number;
      if (old.status === 'active' && !old.expired) {
        throw new HttpError(400, 'Reissue requires the previous certificate to be suspended, revoked or expired.');
      }
    }
    let student;
    if (email) {
      const found = await client.query(
        'SELECT * FROM public.students WHERE lower(email) = lower($1) ORDER BY created_at ASC LIMIT 1 FOR UPDATE',
        [email]
      );
      if (found.rows.length) {
        const updated = await client.query(
          'UPDATE public.students SET full_name = $1, phone = $2, updated_at = now() WHERE id = $3 RETURNING *',
          [fullName, phone || null, found.rows[0].id]
        );
        student = updated.rows[0];
      }
    }
    if (!student) {
      const created = await client.query(
        'INSERT INTO public.students (full_name, email, phone, created_by) VALUES ($1, $2, $3, $4) RETURNING *',
        [fullName, email || null, phone || null, user.id]
      );
      student = created.rows[0];
    }
    const sequence = await client.query("SELECT nextval('public.certificate_number_seq')::bigint AS value");
    const number = 'EDA-CERT-' + issueDate.slice(0, 4) + '-' + String(sequence.rows[0].value).padStart(6, '0');
    const verificationToken = crypto.randomUUID();
    const inserted = await client.query(
      'INSERT INTO public.certificates (' +
      'student_id,reissued_from,certificate_number,verification_token,award_title,programme_name,course_title,' +
      'duration,date_completed,issued_at,grade,remarks,signatory_name,signatory_title,issued_by,' +
      'achievement_description,criteria_narrative,skills_tags,evidence_url,expiration_date,framework_alignment' +
      ') VALUES (' +
      '$1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10::date,$11,$12,$13,$14,$15,$16,$17,$18::text[],$19,$20::date,$21' +
      ') RETURNING *',
      [
        student.id, reissueFrom, number, verificationToken,
        String(args.p_award_title || '').trim() || 'CERTIFICATE OF COMPLETION',
        programme, course, String(args.p_duration || '').trim() || null,
        completed, issueDate, String(args.p_grade || '').trim() || null, String(args.p_remarks || '').trim() || null,
        String(args.p_signatory_name || '').trim() || 'Mr. Abayomi Peter Oyenuga',
        String(args.p_signatory_title || '').trim() || 'Founder', user.id,
        String(args.p_achievement_description || '').trim() || null,
        String(args.p_criteria_narrative || '').trim() || null,
        skills, evidence || null, args.p_expiration_date || null,
        String(args.p_framework_alignment || '').trim() || null
      ]
    );
    const cert = inserted.rows[0];
    await client.query(
      'INSERT INTO public.audit_logs (actor_user_id, action, details) VALUES ($1,$2,$3::jsonb)',
      [user.id, reissueFrom ? 'CERTIFICATE REISSUED' : 'CERTIFICATE ISSUED',
        JSON.stringify({ certificate_id: cert.id, certificate_number: number, student_id: student.id, reissued_from: reissueFrom, previous_certificate_number: previousNumber, skills_count: skills.length, has_criteria: Boolean(args.p_criteria_narrative) })]
    );
    await client.query('COMMIT');
    cert.students = { id: student.id, full_name: student.full_name, email: student.email, phone: student.phone };
    return cert;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function changeCertificateStatus(db, user, args) {
  requireManager(user);
  const id = String(args.p_certificate_id || '');
  const status = String(args.p_status || '');
  const reason = String(args.p_reason || '').trim();
  if (!id) throw new HttpError(400, 'Certificate record ID is required.');
  if (!['active', 'suspended', 'revoked'].includes(status)) throw new HttpError(400, 'Unsupported certificate status.');
  if (status !== 'active' && !reason) throw new HttpError(400, 'A reason is required for suspension or revocation.');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const changed = await client.query(
      'UPDATE public.certificates SET status=$1,status_reason=$2,revoked_at=CASE WHEN $1=\'revoked\' THEN now() ELSE NULL END,updated_at=now() WHERE id=$3 RETURNING certificate_number',
      [status, reason || null, id]
    );
    if (!changed.rows.length) throw new HttpError(404, 'Certificate record not found.');
    await client.query(
      'INSERT INTO public.audit_logs (actor_user_id, action, details) VALUES ($1,$2,$3::jsonb)',
      [user.id, 'CERTIFICATE STATUS CHANGED', JSON.stringify({ certificate_number: changed.rows[0].certificate_number, status, reason: reason || null })]
    );
    await client.query('COMMIT');
    return { certificate_number: changed.rows[0].certificate_number, status };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function verifyCertificate(db, req, identifier) {
  const value = String(identifier || '').trim();
  if (!value) return { status: 'not_found' };
  await checkRateLimit(db, 'verify', getIp(req), 40, '5 minutes');
  const found = await db.query(
    'SELECT c.*, s.full_name AS recipient_name FROM public.certificates c ' +
    'JOIN public.students s ON s.id = c.student_id ' +
    'WHERE upper(c.certificate_number) = upper($1) OR c.verification_token::text = $1 LIMIT 1',
    [value]
  );
  if (!found.rows.length) {
    await db.query('INSERT INTO public.verification_logs (certificate_id, result_status) VALUES (NULL, $1)', ['not_found']);
    return { status: 'not_found' };
  }
  const c = found.rows[0];
  const status = c.status === 'active' && c.expiration_date && String(c.expiration_date).slice(0, 10) < new Date().toISOString().slice(0, 10) ? 'expired' : c.status;
  await db.query(
    'INSERT INTO public.verification_logs (certificate_id, result_status) VALUES ($1,$2)',
    [c.id, status]
  );
  return {
    status,
    certificate_number: c.certificate_number,
    recipient_name: c.recipient_name,
    award_title: c.award_title,
    programme_name: c.programme_name,
    course_title: c.course_title,
    duration: c.duration,
    date_completed: c.date_completed,
    date_issued: c.issued_at,
    issuer_name: 'Ethan Digital Academy',
    achievement_description: c.achievement_description,
    criteria_narrative: c.criteria_narrative,
    skills_tags: c.skills_tags || [],
    expiration_date: c.expiration_date,
    framework_alignment: c.framework_alignment
  };
}

async function handleAction(req, res, db, body) {
  const action = String(body.action || '');
  if (action !== 'verify') safeOrigin(req);
  if (action === 'login') return { user: (await login(db, req, res, body)).user };
  if (action === 'bootstrap') return await bootstrapOwner(db, req, res, body);
  if (action === 'session') {
    const user = await findSession(req, db);
    return { session: user ? { user: { id: user.id, email: user.email } } : null };
  }
  if (action === 'logout') {
    const raw = getCookie(req, 'ethan_certificate_session');
    if (raw) await db.query('DELETE FROM public.app_sessions WHERE token_hash = $1', [sha256(raw)]);
    clearSessionCookie(res);
    return {};
  }
  if (action === 'rpc') {
    if (body.name === 'verify_certificate') return await verifyCertificate(db, req, body.args?.p_identifier);
    const user = await requireSession(req, db);
    if (body.name === 'get_admin_role') return user.role;
    if (body.name === 'get_certificate_registry') return await getRegistry(db, user);
    if (body.name === 'issue_certificate_v2') return await issueCertificate(db, user, body.args || {});
    if (body.name === 'set_certificate_status') return await changeCertificateStatus(db, user, body.args || {});
    throw new HttpError(400, 'Unsupported certificate action.');
  }
  if (action === 'select') {
    const user = await requireSession(req, db);
    return await selectTable(db, user, body);
  }
  throw new HttpError(400, 'Unsupported request.');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });
  const body = parseBody(req);
  let db;
  try {
    db = getPool();
    const data = await handleAction(req, res, db, body);
    return send(res, 200, { data });
  } catch (error) {
    const status = Number(error.status) || 500;
    if (status >= 500) console.error('Ethan Certificate API failure:', error.message);
    return send(res, status, { error: status >= 500 ? 'The certificate service is temporarily unavailable.' : error.message });
  }
};

module.exports.healthCheck = async function healthCheck() {
  await getPool().query('SELECT 1');
  return true;
};

module.exports.close = async function close() {
  if (pool) {
    const activePool = pool;
    pool = null;
    await activePool.end();
  }
};
