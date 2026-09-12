const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(process.cwd(), '.bot-user-settings.json');

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeAll(state) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function defaults() {
  return {
    lang: 'ru',
    notify: true
  };
}

function getUserSettings(userId) {
  const all = readAll();
  return { ...defaults(), ...(all[String(userId)] || {}) };
}

function setUserSettings(userId, patch) {
  const all = readAll();
  const key = String(userId);
  all[key] = { ...getUserSettings(userId), ...patch };
  writeAll(all);
  return all[key];
}

function clearExportHistory(userId) {
  const exportState = require('./export-state');
  const state = exportState.readState();
  delete state[String(userId)];
  exportState.writeState(state);
}

module.exports = {
  getUserSettings,
  setUserSettings,
  clearExportHistory
};
