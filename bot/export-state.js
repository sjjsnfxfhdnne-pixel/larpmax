const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(process.cwd(), '.bot-export-state.json');

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function wasExported(userId, file) {
  const record = (readState()[String(userId)] || {})[file.name];
  if (!record) return false;
  return record.mtimeMs >= file.mtime.getTime();
}

function filterOnlyNew(userId, files) {
  return files.filter((file) => !wasExported(userId, file));
}

function markExported(userId, files) {
  const state = readState();
  const key = String(userId);
  if (!state[key]) state[key] = {};
  const exportedAt = Date.now();
  for (const file of files) {
    state[key][file.name] = {
      mtimeMs: file.mtime.getTime(),
      exportedAt
    };
  }
  writeState(state);
}

module.exports = {
  wasExported,
  filterOnlyNew,
  markExported,
  readState,
  writeState
};
