const store = require('../bot/store');

function requireSecret(req, res) {
  const expected = String(process.env.ADMIN_API_SECRET || '').trim();
  if (!expected) {
    res.status(503).json({ error: 'ADMIN_API_SECRET не настроен' });
    return false;
  }
  const got = String(req.headers['x-admin-secret'] || '').trim();
  if (!got || got !== expected) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function mountInternalApi(app, { sendJson, wrap }) {
  app.use('/api/internal', (req, res, next) => {
    if (!requireSecret(req, res)) return;
    next();
  });

  app.get('/api/internal/health', (_req, res) => {
    sendJson(res, 200, { ok: true });
  });

  app.get('/api/internal/settings', (_req, res) => {
    sendJson(res, 200, store.getSettings());
  });

  app.post('/api/internal/settings/commission', (req, res) =>
    wrap(res, () => store.setCommissionEvery(req.body && req.body.every))
  );

  app.get('/api/internal/stats', (req, res) => {
    const period = String(req.query.period || 'all');
    sendJson(res, 200, store.buildStats(period));
  });

  app.get('/api/internal/stats/user/:id', (req, res) => {
    const period = String(req.query.period || 'all');
    sendJson(res, 200, store.userStats(req.params.id, period));
  });

  app.get('/api/internal/users', (_req, res) => {
    sendJson(res, 200, { users: store.listUsers() });
  });

  app.post('/api/internal/users', (req, res) =>
    wrap(res, () => store.upsertUserRemote(req.body || {}))
  );

  app.get('/api/internal/admins', (_req, res) => {
    sendJson(res, 200, { admins: store.getDynamicAdmins() });
  });

  app.post('/api/internal/admins', (req, res) =>
    wrap(res, () => ({ admins: store.addAdmin(req.body && req.body.userId) }))
  );

  app.delete('/api/internal/admins/:id', (req, res) =>
    wrap(res, () => ({ admins: store.removeAdmin(req.params.id) }))
  );

  app.get('/api/internal/logs', (req, res) => {
    const mode = String(req.query.mode || 'all');
    const period = String(req.query.period || 'all');
    const ownerId = req.query.ownerId || null;
    const files = store.listExportableFiles({ mode, period, ownerId });
    sendJson(res, 200, {
      files: files.map(({ path: _p, ...rest }) => rest)
    });
  });

  app.get('/api/internal/logs/file/:name', (req, res) =>
    wrap(res, () => store.readSessionBase64(req.params.name))
  );

  app.post('/api/internal/exports/record', (req, res) =>
    wrap(res, () =>
      store.recordExport({
        mode: req.body && req.body.mode,
        period: req.body && req.body.period,
        fileCount: Number((req.body && req.body.fileCount) || 0)
      })
    )
  );

  app.get('/api/internal/exports/stats', (_req, res) => {
    sendJson(res, 200, store.getExportStats());
  });
}

function mountPublicAuthExtras(app, { sendJson, wrap }) {
  app.post('/api/auth/visit', (req, res) =>
    wrap(res, () => {
      const ref = (req.body && req.body.ref) || req.query.ref || '';
      const ip =
        req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
        req.socket.remoteAddress ||
        '';
      return store.recordVisit(ref, { ipHash: store.hashIp(ip) });
    })
  );
}

module.exports = {
  mountInternalApi,
  mountPublicAuthExtras
};
