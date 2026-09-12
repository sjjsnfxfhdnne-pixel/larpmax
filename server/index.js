const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const express = require('express');
const multer = require('multer');
const { MaxDesk, cleanupOrphanAuthSessions } = require('./bridge');
const { AuthService } = require('./auth-service');
const botConfig = require('../bot/config');
const { jsonSafe } = require('./serialize');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 3780;
const SECRET_FILE = path.join(process.cwd(), '.panel-secret');
const DOWNLOADS = path.join(process.cwd(), 'downloads');
fs.mkdirSync(DOWNLOADS, { recursive: true });

function loadPanelPassword() {
  if (process.env.PANEL_PASSWORD && process.env.PANEL_PASSWORD.trim()) {
    return { password: process.env.PANEL_PASSWORD.trim(), generated: false };
  }
  if (fs.existsSync(SECRET_FILE)) {
    return { password: fs.readFileSync(SECRET_FILE, 'utf8').trim(), generated: false };
  }
  const password = crypto.randomBytes(5).toString('hex');
  fs.writeFileSync(SECRET_FILE, password, 'utf8');
  return { password, generated: true };
}

const panel = loadPanelPassword();
const desk = new MaxDesk();
const authService = new AuthService();
const app = express();
const AUTH_DIR = path.join(__dirname, '..', 'public', 'auth');
const DESK_DIR = path.join(__dirname, '..', 'public');
const upload = multer({
  dest: DOWNLOADS,
  limits: { fileSize: 20 * 1024 * 1024 }
});

const listeners = new Set();

desk.on('event', (event) => {
  const line = `data: ${JSON.stringify(jsonSafe(event))}\n\n`;
  for (const res of listeners) res.write(line);
});

function cookieMap(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function tokenFor(password) {
  return crypto.createHmac('sha256', 'pult-desk').update(password).digest('hex');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function unlocked(req) {
  return safeEqual(cookieMap(req).pult || '', tokenFor(panel.password));
}

function sendJson(res, status, body) {
  res.status(status).json(jsonSafe(body));
}

async function wrap(res, fn) {
  try {
    sendJson(res, 200, await fn());
  } catch (error) {
    sendJson(res, 400, { error: error.message || String(error) });
  }
}

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.get('/api/auth/config', (_req, res) => {
  sendJson(res, 200, { botUsername: botConfig.botUsername || 'maxlarpingbot' });
});

app.post('/api/auth/start', (_req, res) => wrap(res, () => ({ authId: authService.createFlow() })));

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

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  if (req.path === '/unlock' && req.method === 'POST') return next();
  if (req.path === '/health' && req.method === 'GET') return next();
  if (!unlocked(req)) {
    return sendJson(res, 401, { error: 'Нужен пароль пульта.', locked: true });
  }
  next();
});

app.get('/api/health', (_req, res) => {
  sendJson(res, 200, { ok: true, locked: true });
});

app.post('/api/unlock', (req, res) => {
  const password = String((req.body && req.body.password) || '');
  if (!safeEqual(password, panel.password)) {
    return sendJson(res, 401, { error: 'Неверный пароль пульта.' });
  }
  res.setHeader(
    'Set-Cookie',
    `pult=${tokenFor(panel.password)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`
  );
  sendJson(res, 200, { ok: true });
});

app.post('/api/lock', (_req, res) => {
  res.setHeader('Set-Cookie', 'pult=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  sendJson(res, 200, { ok: true });
});

app.get('/api/state', (_req, res) => {
  sendJson(res, 200, desk.snapshot());
});

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.write('data: {"type":"hello"}\n\n');
  listeners.add(res);
  req.on('close', () => listeners.delete(res));
});

app.post('/api/login/qr', (_req, res) => wrap(res, () => desk.startQr()));
app.post('/api/login/resume', (_req, res) => wrap(res, () => desk.resume()));
app.post('/api/login/sms', (req, res) =>
  wrap(res, () => desk.startSms(String((req.body && req.body.phone) || '')))
);
app.post('/api/login/sms/code', (req, res) =>
  wrap(res, () => desk.submitSmsCode(String((req.body && req.body.code) || '')))
);
app.post('/api/login/sms/password', (req, res) =>
  wrap(res, () => desk.submitSmsPassword(String((req.body && req.body.password) || '')))
);

app.get('/api/chats', (_req, res) => wrap(res, () => desk.listChats()));
app.get('/api/chats/:id/history', (req, res) =>
  wrap(res, () => desk.history(req.params.id, req.query.backward))
);
app.post('/api/chats/:id/messages', (req, res) =>
  wrap(res, () => desk.sendText(req.params.id, String((req.body && req.body.text) || '')))
);
app.post('/api/chats/:id/messages/:mid/edit', (req, res) =>
  wrap(res, () =>
    desk.editText(req.params.id, req.params.mid, String((req.body && req.body.text) || ''))
  )
);
app.delete('/api/chats/:id/messages/:mid', (req, res) =>
  wrap(res, () => desk.removeMessage(req.params.id, req.params.mid))
);
app.post('/api/chats/:id/photo', upload.single('photo'), (req, res) =>
  wrap(res, async () => {
    if (!req.file) throw new Error('Файл не получен.');
    try {
      return await desk.sendPhoto(req.params.id, req.file.path);
    } finally {
      fs.unlink(req.file.path, () => {});
    }
  })
);

app.get('/api/media/:chatId/:messageId/:index', (req, res) => {
  wrap(res, async () => {
    const file = await desk.downloadAttach(req.params.chatId, req.params.messageId, req.params.index);
    return { url: `/downloads/${path.basename(file.path)}`, contentType: file.contentType };
  });
});

app.use(
  '/downloads',
  (req, res, next) => {
    if (!unlocked(req)) return sendJson(res, 401, { error: 'Нужен пароль пульта.' });
    next();
  },
  express.static(DOWNLOADS)
);

app.get('/api/devices', (_req, res) => wrap(res, () => desk.devices()));
app.post('/api/devices/close-others', (_req, res) => wrap(res, () => desk.closeOtherDevices()));
app.post('/api/profile', (req, res) =>
  wrap(res, () =>
    desk.updateProfile({
      firstName: req.body && req.body.firstName,
      lastName: req.body && req.body.lastName,
      description: req.body && req.body.description
    })
  )
);
app.post('/api/calls/reject', (req, res) =>
  wrap(res, () => desk.rejectCall(String((req.body && req.body.conversationId) || '')))
);
app.post('/api/disconnect', (_req, res) => wrap(res, () => desk.disconnectKeepSession()));
app.post('/api/logout', (_req, res) => wrap(res, () => desk.logoutWipe()));

const MAX_UPSTREAM = 'web.max.ru';

function proxyMaxAsset(req, res, next) {
  if (!req.path.startsWith('/_app/')) return next();
  const localPath = path.join(AUTH_DIR, req.path);
  if (fs.existsSync(localPath) && fs.statSync(localPath).isFile()) return next();

  const upstream = https.request(
    {
      hostname: MAX_UPSTREAM,
      path: req.originalUrl,
      method: 'GET',
      headers: { 'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0' }
    },
    (upstreamRes) => {
      res.status(upstreamRes.statusCode || 502);
      for (const header of ['content-type', 'cache-control', 'etag', 'last-modified']) {
        const value = upstreamRes.headers[header];
        if (value) res.setHeader(header, value);
      }
      upstreamRes.pipe(res);
    }
  );
  upstream.on('error', () => sendJson(res, 502, { error: 'Не удалось загрузить ассет MAX.' }));
  upstream.end();
}

app.use('/desk', express.static(DESK_DIR));
app.get('/desk', (_req, res) => {
  res.sendFile(path.join(DESK_DIR, 'index.html'));
});
app.use(proxyMaxAsset);
app.use(express.static(AUTH_DIR));
app.get('/', (_req, res) => {
  res.sendFile(path.join(AUTH_DIR, 'index.html'));
});

const removedOrphans = cleanupOrphanAuthSessions();
if (removedOrphans > 0) {
  console.log(`Удалено незавершённых auth-сессий: ${removedOrphans}`);
}

const server = app.listen(PORT, HOST, () => {
  console.log(`Auth: http://${HOST}:${PORT}`);
  console.log(`Desk: http://${HOST}:${PORT}/desk`);
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
    console.log('Слушает не только localhost — кто угодно в сети с паролем получит аккаунт Max.');
  }
  if (panel.generated) {
    console.log(`Пароль пульта (сохранён в .panel-secret): ${panel.password}`);
  } else {
    console.log('Пароль пульта: из PANEL_PASSWORD или .panel-secret');
  }
  if (desk.sessionExists()) {
    desk.resume().catch((error) => {
      console.log('Сохранённую сессию не поднял:', error.message);
      desk.cleanupPartialSession?.();
    });
  }
});

function shutdown() {
  server.close(() => {
    desk.destroyClient().finally(() => process.exit(0));
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
