const config = require('./config');
const store = require('./store');

function useRemote() {
  return Boolean(config.maxApiUrl && config.adminApiSecret);
}

function apiBase() {
  return String(config.maxApiUrl || '').replace(/\/$/, '');
}

async function request(method, path, body) {
  const url = `${apiBase()}${path}`;
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

async function fetchRemoteVisitCount(refCode, period = 'all') {
  const ref = String(refCode || '').trim().toLowerCase();
  if (!ref || !apiBase()) return 0;
  try {
    const url = `${apiBase()}/api/auth/visits?ref=${encodeURIComponent(ref)}&period=${encodeURIComponent(period)}`;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return 0;
    return Number(data.visits) || 0;
  } catch {
    return 0;
  }
}

async function syncUser(user) {
  if (!user || !user.id) return user;
  const payload = {
    id: user.id,
    refCode: user.refCode,
    username: user.username,
    firstName: user.firstName,
    lastSeenAt: user.lastSeenAt || Date.now()
  };
  if (!useRemote()) return user;
  try {
    return await request('POST', '/api/internal/users', payload);
  } catch (error) {
    try {
      await request('POST', '/api/auth/ref-sync', payload);
      return user;
    } catch {
      console.warn('syncUser:', error.message);
      return user;
    }
  }
}

async function syncAllUsers() {
  if (!useRemote()) return;
  for (const user of store.listUsers()) {
    await syncUser({ id: user.id, ...user });
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
  const local = store.buildStats(period);
  if (!useRemote()) return local;
  try {
    const remote = await request('GET', `/api/internal/stats?period=${encodeURIComponent(period)}`);
    return {
      ...local,
      ...remote,
      visits: Math.max(Number(remote.visits) || 0, Number(local.visits) || 0)
    };
  } catch {
    return local;
  }
}

async function userStats(userId, period = 'all') {
  const localUser = store.getUser(userId) || store.touchUser(userId);
  const local = store.userStats(userId, period);
  const remoteVisits = await fetchRemoteVisitCount(localUser.refCode, period);
  const visits = Math.max(
    Number(local.visits) || 0,
    remoteVisits,
    Number(localUser.visits) || 0
  );

  if (!useRemote()) {
    return { ...local, visits, user: { ...localUser, id: String(userId) } };
  }

  try {
    await syncUser(localUser);
    const remote = await request(
      'GET',
      `/api/internal/stats/user/${encodeURIComponent(userId)}?period=${encodeURIComponent(period)}`
    );
    return {
      ...local,
      ...remote,
      user: {
        ...(remote.user || {}),
        ...localUser,
        id: String(userId),
        refCode: localUser.refCode,
        visits: Math.max(Number(remote.user?.visits) || 0, visits)
      },
      visits: Math.max(Number(remote.visits) || 0, visits),
      commissionEvery:
        remote.commissionEvery != null ? remote.commissionEvery : local.commissionEvery
    };
  } catch {
    return {
      ...local,
      visits,
      user: { ...localUser, id: String(userId), visits }
    };
  }
}

async function listUsers() {
  const local = store.listUsers();
  const enriched = [];
  for (const u of local) {
    const visits = Math.max(
      Number(u.visits) || 0,
      await fetchRemoteVisitCount(u.refCode, 'all')
    );
    enriched.push({ ...u, visits });
  }
  if (!useRemote()) return enriched;
  try {
    const remote = await request('GET', '/api/internal/users');
    const map = new Map(enriched.map((u) => [u.id, u]));
    for (const u of remote.users || []) {
      const prev = map.get(String(u.id)) || {};
      const visits = Math.max(
        Number(prev.visits) || 0,
        Number(u.visits) || 0,
        await fetchRemoteVisitCount(prev.refCode || u.refCode, 'all')
      );
      map.set(String(u.id), { ...prev, ...u, id: String(u.id), visits });
    }
    return [...map.values()].sort(
      (a, b) => (b.logCount || 0) - (a.logCount || 0) || (b.lastSeenAt || 0) - (a.lastSeenAt || 0)
    );
  } catch {
    return enriched;
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
  syncAllUsers,
  fetchRemoteVisitCount,
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
