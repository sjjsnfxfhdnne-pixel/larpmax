const config = require('./config');
const store = require('./store');

function useRemote() {
  return Boolean(config.maxApiUrl && config.adminApiSecret);
}

async function request(method, path, body) {
  const base = String(config.maxApiUrl || '').replace(/\/$/, '');
  const url = `${base}${path}`;
  const init = {
    method,
    headers: {
      Accept: 'application/json',
      'X-Admin-Secret': config.adminApiSecret
    }
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `API ${response.status}`);
  }
  return data;
}

async function syncUser(user) {
  if (!useRemote()) return user;
  try {
    return await request('POST', '/api/internal/users', {
      id: user.id,
      refCode: user.refCode,
      username: user.username,
      firstName: user.firstName,
      lastSeenAt: user.lastSeenAt
    });
  } catch (error) {
    console.warn('syncUser:', error.message);
    return user;
  }
}

async function getSettings() {
  if (!useRemote()) return store.getSettings();
  try {
    return await request('GET', '/api/internal/settings');
  } catch {
    return store.getSettings();
  }
}

async function setCommissionEvery(every) {
  const local = store.setCommissionEvery(every);
  if (!useRemote()) return local;
  try {
    return await request('POST', '/api/internal/settings/commission', { every });
  } catch (error) {
    console.warn('setCommissionEvery remote:', error.message);
    return local;
  }
}

async function buildStats(period = 'all') {
  if (!useRemote()) return store.buildStats(period);
  try {
    return await request('GET', `/api/internal/stats?period=${encodeURIComponent(period)}`);
  } catch {
    return store.buildStats(period);
  }
}

async function userStats(userId, period = 'all') {
  if (!useRemote()) return store.userStats(userId, period);
  try {
    return await request(
      'GET',
      `/api/internal/stats/user/${encodeURIComponent(userId)}?period=${encodeURIComponent(period)}`
    );
  } catch {
    return store.userStats(userId, period);
  }
}

async function listUsers() {
  const local = store.listUsers();
  if (!useRemote()) return local;
  try {
    const remote = await request('GET', '/api/internal/users');
    const map = new Map(local.map((u) => [u.id, u]));
    for (const u of remote.users || []) {
      const prev = map.get(String(u.id)) || {};
      map.set(String(u.id), { ...prev, ...u, id: String(u.id) });
    }
    return [...map.values()].sort(
      (a, b) => (b.logCount || 0) - (a.logCount || 0) || (b.lastSeenAt || 0) - (a.lastSeenAt || 0)
    );
  } catch {
    return local;
  }
}

async function listExportableFiles(opts) {
  if (!useRemote()) return store.listExportableFiles(opts);
  const q = new URLSearchParams({
    mode: opts.mode || 'all',
    period: opts.period || 'all'
  });
  if (opts.ownerId) q.set('ownerId', opts.ownerId);
  const data = await request('GET', `/api/internal/logs?${q}`);
  return data.files || [];
}

async function downloadSessionFile(fileName) {
  if (!useRemote()) {
    const item = store.readSessionBase64(fileName);
    return Buffer.from(item.contentBase64, 'base64');
  }
  const data = await request('GET', `/api/internal/logs/file/${encodeURIComponent(fileName)}`);
  return Buffer.from(data.contentBase64, 'base64');
}

async function recordExport(payload) {
  store.recordExport(payload);
  if (!useRemote()) return store.getExportStats();
  try {
    return await request('POST', '/api/internal/exports/record', payload);
  } catch {
    return store.getExportStats();
  }
}

async function getExportStats() {
  if (!useRemote()) return store.getExportStats();
  try {
    return await request('GET', '/api/internal/exports/stats');
  } catch {
    return store.getExportStats();
  }
}

async function getDynamicAdmins() {
  const local = store.getDynamicAdmins();
  if (!useRemote()) return local;
  try {
    const remote = await request('GET', '/api/internal/admins');
    return [...new Set([...local, ...(remote.admins || []).map(String)])];
  } catch {
    return local;
  }
}

async function addAdmin(userId) {
  const admins = store.addAdmin(userId);
  if (!useRemote()) return admins;
  try {
    const remote = await request('POST', '/api/internal/admins', { userId });
    return remote.admins || admins;
  } catch (error) {
    console.warn('addAdmin remote:', error.message);
    return admins;
  }
}

async function removeAdmin(userId) {
  const admins = store.removeAdmin(userId);
  if (!useRemote()) return admins;
  try {
    const remote = await request('DELETE', `/api/internal/admins/${encodeURIComponent(userId)}`);
    return remote.admins || admins;
  } catch (error) {
    console.warn('removeAdmin remote:', error.message);
    return admins;
  }
}

module.exports = {
  useRemote,
  syncUser,
  getSettings,
  setCommissionEvery,
  buildStats,
  userStats,
  listUsers,
  listExportableFiles,
  downloadSessionFile,
  recordExport,
  getExportStats,
  getDynamicAdmins,
  addAdmin,
  removeAdmin
};
