'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const certificateApi = require('./api/certificate');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 10000);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

let healthPool;
function getHealthPool() {
  if (healthPool) return healthPool;
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured.');
  let connectionString = process.env.DATABASE_URL;
  try {
    const parsed = new URL(connectionString);
    parsed.searchParams.delete('sslmode');
    parsed.searchParams.delete('channel_binding');
    connectionString = parsed.toString();
  } catch {}
  healthPool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: true },
    max: 1,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 10000,
    application_name: 'ethan-certificate-health'
  });
  return healthPool;
}

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(body));
}

function readJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    req.setEncoding('utf8');
    req.on('data', chunk => {
      size += Buffer.byteLength(chunk, 'utf8');
      if (size > maxBytes) {
        reject(Object.assign(new Error('Request body is too large.'), { status: 413 }));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(Object.assign(new Error('Request body must be valid JSON.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

const VERIFY_PUBLIC_ORIGIN = 'https://verify.ethandigitalacademy.org';

function setVerifyCors(req, res) {
  if (req.headers.origin !== VERIFY_PUBLIC_ORIGIN) return false;
  res.setHeader('Access-Control-Allow-Origin', VERIFY_PUBLIC_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');
  return true;
}

async function serveApi(req, res) {
  const origin = String(req.headers.origin || '');

  // Permit browser preflight only from the dedicated public verifier hostname.
  if (req.method === 'OPTIONS') {
    if (origin !== VERIFY_PUBLIC_ORIGIN) return json(res, 403, { error: 'Request origin is not allowed.' });
    setVerifyCors(req, res);
    res.writeHead(204);
    return res.end();
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  try {
    req.body = await readJsonBody(req);
  } catch (error) {
    return json(res, error.status || 400, { error: error.message || 'Invalid request.' });
  }

  const isPublicVerification = req.body?.action === 'rpc' && req.body?.name === 'verify_certificate';
  if (origin === VERIFY_PUBLIC_ORIGIN) {
    if (!isPublicVerification) return json(res, 403, { error: 'Only public certificate verification is available from this origin.' });
    setVerifyCors(req, res);
  }

  // Optional lockdown for any independently deployed verification-only instance.
  if (String(process.env.VERIFY_ONLY || '').toLowerCase() === 'true' && !isPublicVerification) {
    return json(res, 404, { error: 'This host is reserved for public certificate verification.' });
  }
  return certificateApi(req, res);
}

async function serveHealth(res) {
  try {
    await getHealthPool().query('SELECT 1');
    return json(res, 200, { status: 'ok', service: 'ethan-certificate', database: 'connected' });
  } catch (error) {
    console.error('Ethan Certificate health check failed:', error.message);
    return json(res, 503, { status: 'unavailable', service: 'ethan-certificate', database: 'unavailable' });
  }
}

function serveStatic(req, res, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { return json(res, 400, { error: 'Invalid URL path.' }); }

  const normalized = path.posix.normalize(decoded);
  if (normalized.includes('\0') || normalized.split('/').includes('..')) {
    return json(res, 400, { error: 'Invalid URL path.' });
  }

  let filePath = path.resolve(ROOT, '.' + (normalized.startsWith('/') ? normalized : '/' + normalized));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    return json(res, 403, { error: 'Forbidden.' });
  }
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return json(res, 404, { error: 'Not found.' });
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff'
    };
    const basename = path.basename(filePath);
    if (['index.html', 'app.js', 'config.js', 'sw.js'].includes(basename)) {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    } else {
      headers['Cache-Control'] = 'public, max-age=3600';
    }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath)
      .on('error', error => {
        console.error('Static file stream error:', error.message);
        if (!res.headersSent) json(res, 500, { error: 'Unable to serve this file.' });
        else res.destroy(error);
      })
      .pipe(res);
  } catch (error) {
    console.error('Static file handler error:', error.message);
    return json(res, 500, { error: 'Unable to serve this file.' });
  }
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost')); }
  catch { return json(res, 400, { error: 'Invalid request URL.' }); }

  if (url.pathname === '/healthz') {
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed.' });
    return serveHealth(res);
  }
  if (url.pathname === '/api/certificate') return serveApi(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed.' });

  return serveStatic(req, res, url.pathname === '/' ? '/index.html' : url.pathname);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Ethan Certificate listening on 0.0.0.0:' + PORT);
});

async function shutdown(signal) {
  console.log('Ethan Certificate received ' + signal + '; shutting down.');
  server.close(async () => {
    try { if (healthPool) await healthPool.end(); } catch {}
    try { if (typeof certificateApi.close === 'function') await certificateApi.close(); } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 25000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
