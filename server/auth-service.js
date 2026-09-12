const crypto = require('crypto');
const { MaxDesk } = require('./bridge');
const { jsonSafe } = require('./serialize');

class AuthService {
  constructor() {
    this.flows = new Map();
    this.listeners = new Map();
    this.startLog = [];
  }

  assertStartAllowed() {
    const now = Date.now();
    this.startLog = this.startLog.filter((time) => now - time < 60_000);
    if (this.startLog.length >= 5) {
      throw new Error('Слишком много попыток входа. Подождите 1–2 минуты.');
    }
    this.startLog.push(now);
  }

  async cleanupStaleFlows() {
    const maxAge = 15 * 60 * 1000;
    const now = Date.now();
    for (const [id, desk] of [...this.flows.entries()]) {
      if (desk.phase === 'saved') continue;
      if (now - (desk.createdAt || 0) > maxAge) {
        await this.removeFlow(id);
      }
    }
  }

  createFlow() {
    this.assertStartAllowed();
    this.cleanupStaleFlows().catch(() => {});
    const id = `max_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const desk = new MaxDesk(id, { authOnly: true });
    desk.createdAt = Date.now();
    const subs = new Set();
    this.listeners.set(id, subs);

    desk.on('event', (event) => {
      const line = `data: ${JSON.stringify(jsonSafe(event))}\n\n`;
      for (const res of subs) res.write(line);
      if (event.type === 'saved') {
        setTimeout(() => this.removeFlow(id), 5 * 60 * 1000);
      }
    });

    this.flows.set(id, desk);
    return id;
  }

  getFlow(id) {
    const desk = this.flows.get(String(id || '').trim());
    if (!desk) {
      throw new Error('Сессия авторизации не найдена. Обновите страницу.');
    }
    return desk;
  }

  addListener(id, res) {
    const subs = this.listeners.get(id);
    if (subs) subs.add(res);
  }

  removeListener(id, res) {
    const subs = this.listeners.get(id);
    if (!subs) return;
    subs.delete(res);
    if (subs.size > 0) return;

    const desk = this.flows.get(id);
    if (!desk || desk.phase === 'saved') return;

    setTimeout(() => {
      const current = this.listeners.get(id);
      if (!current || current.size > 0) return;
      const active = this.flows.get(id);
      if (!active || active.phase === 'saved') return;
      this.removeFlow(id).catch(() => {});
    }, 500);
  }

  async removeFlow(id) {
    const desk = this.flows.get(id);
    if (desk) {
      try {
        await desk.destroyClient();
      } catch {
        /* ignore */
      }
      desk.cleanupPartialSession();
    }
    this.flows.delete(id);
    this.listeners.delete(id);
  }
}

module.exports = { AuthService };
