const path = require('path');
const express = require('express');
const botConfig = require('../bot/config');
const { cleanupOrphanAuthSessions } = require('./bridge');
const { AuthService } = require('./auth-service');
const { jsonSafe } = require('./serialize');
const { mountInternalApi, mountPublicAuthExtras } = require('./internal-api');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT) || 3780;
const AUTH_DIR = path.join(__dirname, '..', 'public', 'auth');
const ALLOWED_ORIGINS = String(process.env.CORS_ORIGINS || 'https://larpmax-auth.vercel.app,http://127.0.0.1:3780')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const authService = new AuthService();
const app = express();

function sendJson(res, status, body) {
  res.status(status).json(jsonSafe(body));
}

function wrap(res, fn) {
  Promise.resolve()
    .then(fn)
    .then((data) => sendJson(res, 200, data))
    .catch((error) => sendJson(res, 400, { error: error.message || String(error) }));
}

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Admin-Secret');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.get('/api/health', (_req, res) => {
  sendJson(res, 200, { ok: true });
});

const PRODUCTION_API_URL = 'https://larpmax-api.onrender.com';

function isLoopbackUrl(url) {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(String(url || ''));
}

function resolvePublicApiBase() {
  const candidates = [
    process.env.PUBLIC_API_URL,
    process.env.RENDER_EXTERNAL_URL,
    process.env.MAX_API_URL
  ]
    .map((value) => String(value || '').trim().replace(/\/$/, ''))
    .filter(Boolean);

  for (const url of candidates) {
    if (!isLoopbackUrl(url)) return url;
  }

  if (process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.NODE_ENV === 'production') {
    return PRODUCTION_API_URL;
  }

  if (HOST === '0.0.0.0' || HOST === '127.0.0.1') {
    return `http://127.0.0.1:${PORT}`;
  }
  return `http://${HOST}:${PORT}`;
}

app.get('/api/auth/config', (_req, res) => {
  sendJson(res, 200, {
    botUsername: botConfig.botUsername || 'larpmaxbot',
    apiBase: resolvePublicApiBase()
  });
});

mountPublicAuthExtras(app, { sendJson, wrap });
mountInternalApi(app, { sendJson, wrap });

app.post('/api/auth/start', (req, res) =>
  wrap(res, () => ({
    authId: authService.createFlow({ ref: (req.body && req.body.ref) || req.query.ref || '' })
  }))
);

app.get('/api/auth/:id/state', (req, res) =>
  wrap(res, () => authService.getFlow(req.params.id).snapshot())
);

app.get('/api/auth/:id/events', (req, res) => {
  try {
    authService.getFlow(req.params.id);
  } catch (error) {
    return sendJson(res, 400, { error: error.message || String(error) });
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.write('data: {"type":"hello"}\n\n');
  authService.addListener(req.params.id, res);
  req.on('close', () => authService.removeListener(req.params.id, res));
});

app.post('/api/auth/:id/qr', (req, res) =>
  wrap(res, () => authService.getFlow(req.params.id).startQr())
);
app.post('/api/auth/:id/sms', (req, res) =>
  wrap(res, () => authService.getFlow(req.params.id).startSms(String((req.body && req.body.phone) || '')))
);
app.post('/api/auth/:id/sms/code', (req, res) =>
  wrap(res, () => authService.getFlow(req.params.id).submitSmsCode(String((req.body && req.body.code) || '')))
);
app.post('/api/auth/:id/sms/password', (req, res) =>
  wrap(res, () =>
    authService.getFlow(req.params.id).submitSmsPassword(String((req.body && req.body.password) || ''))
  )
);

app.use('/_app', express.static(path.join(AUTH_DIR, '_app')));
app.use(express.static(AUTH_DIR));

const removedOrphans = cleanupOrphanAuthSessions();
if (removedOrphans > 0) {
  console.log(`Удалено незавершённых auth-сессий: ${removedOrphans}`);
}

app.listen(PORT, HOST, () => {
  console.log(`Auth API: http://${HOST}:${PORT}`);
  console.log(`CORS: ${ALLOWED_ORIGINS.join(', ')}`);
});
