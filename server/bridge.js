const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const QRCode = require('qrcode');
const { WebMaxClient } = require('webmaxsocket');
const { APP_VERSION, BUILD_NUMBER } = require('webmaxsocket/lib/constants');
const {
  profileOf,
  serializeChat,
  serializeMessage,
  serializeDevice,
  collectChats,
  chatsFromPayload,
  asId
} = require('./serialize');

const SESSION_NAME = process.env.SESSION_NAME || 'pult';
const SESSION_FILE = path.join(process.cwd(), 'sessions', `${SESSION_NAME}.json`);

class SerialQueue {
  constructor() {
    this.tail = Promise.resolve();
  }

  run(fn) {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => {});
    return next;
  }
}

class MaxDesk extends EventEmitter {
  constructor(sessionName = SESSION_NAME, options = {}) {
    super();
    this.sessionName = sessionName;
    this.sessionFile = path.join(process.cwd(), 'sessions', `${sessionName}.json`);
    this.authOnly = Boolean(options.authOnly);
    this.savedSession = null;
    this.savedProfile = null;
    this.client = null;
    this.queue = new SerialQueue();
    this.phase = 'idle';
    this.qr = null;
    this.sms = null;
    this.abortQr = false;
  }

  sessionExists() {
    try {
      if (!fs.existsSync(this.sessionFile)) return false;
      const data = JSON.parse(fs.readFileSync(this.sessionFile, 'utf8'));
      return Boolean(data && data.token);
    } catch {
      return false;
    }
  }

  cleanupPartialSession() {
    if (!this.authOnly) return;
    try {
      if (!fs.existsSync(this.sessionFile)) return;
      const data = JSON.parse(fs.readFileSync(this.sessionFile, 'utf8'));
      if (data && data.token) return;
      fs.unlinkSync(this.sessionFile);
      const lastOk = this.sessionFile.replace(/\.json$/, '.last_ok.json');
      if (fs.existsSync(lastOk)) fs.unlinkSync(lastOk);
    } catch {
      try {
        if (fs.existsSync(this.sessionFile)) fs.unlinkSync(this.sessionFile);
      } catch {
        /* ignore */
      }
    }
  }

  snapshot() {
    return {
      phase: this.phase,
      sessionExists: this.sessionExists(),
      sessionFile: this.savedSession || (this.sessionExists() ? `${this.sessionName}.json` : null),
      me:
        this.phase === 'saved'
          ? this.savedProfile
          : this.client && this.client.isAuthorized
            ? profileOf(this.client)
            : null,
      saved:
        this.phase === 'saved'
          ? { sessionFile: this.savedSession, me: this.savedProfile }
          : null,
      qr: this.qr
        ? {
            image: this.qr.image,
            expiresAt: this.qr.expiresAt,
            link: this.qr.link
          }
        : null,
      sms: this.sms
        ? {
            phone: this.sms.phone,
            needsPassword: Boolean(this.sms.needsPassword),
            hint: this.sms.hint || ''
          }
        : null
    };
  }

  buildClientOptions(deviceType) {
    const type = String(deviceType || 'WEB').toUpperCase();
    const common = {
      locale: process.env.MAX_LOCALE || 'ru',
      deviceLocale: process.env.MAX_LOCALE || 'ru',
      timezone: process.env.MAX_TIMEZONE || 'Europe/Moscow',
      appVersion: process.env.MAX_APP_VERSION || APP_VERSION,
      buildNumber: Number(process.env.MAX_BUILD_NUMBER) || BUILD_NUMBER,
      clientSessionId: Number(process.env.MAX_CLIENT_SESSION_ID) || 1
    };
    if (type === 'ANDROID') {
      return {
        ...common,
        headerUserAgent:
          process.env.MAX_ANDROID_UA ||
          'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
        osVersion: '14',
        deviceName: 'Android',
        screen: '360x780 3.0x'
      };
    }
    return {
      ...common,
      headerUserAgent:
        process.env.MAX_WEB_UA ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      osVersion: 'Windows 11',
      deviceName: 'Chrome',
      screen: '1080x1920 1.0x'
    };
  }

  disableSessionDiskWrites(client) {
    const session = client.session;
    session.save = () => true;
    session.set = (key, value) => {
      session.data[key] = value;
      return true;
    };
    session.delete = (key) => {
      delete session.data[key];
      return true;
    };
    this.cleanupPartialSession();
  }

  createClient(deviceType) {
    const client = new WebMaxClient({
      name: this.sessionName,
      deviceType,
      saveToken: !this.authOnly,
      saveTwofaPassword: false,
      logIncoming: false,
      sessionRefreshIntervalMs: 45 * 60 * 1000,
      ...this.buildClientOptions(deviceType)
    });
    if (this.authOnly) {
      this.disableSessionDiskWrites(client);
    }
    return client;
  }

  async destroyClient() {
    this.abortQr = true;
    const client = this.client;
    this.client = null;
    this.qr = null;
    this.sms = null;
    if (client) {
      try {
        await client.stop();
      } catch {
        /* ignore */
      }
    }
    this.cleanupPartialSession();
  }

  attachLiveHandlers(client) {
    client.onMessage(async (message) => {
      const payload = serializeMessage(message, client.me && client.me.id);
      this.emit('event', { type: 'message', message: payload });
    });

    client.onMessageRemoved(async (message) => {
      this.emit('event', {
        type: 'message_removed',
        chatId: asId(message.chatId),
        messageId: asId(message.id)
      });
    });

    client.onIncomingCall(async (payload) => {
      this.emit('event', {
        type: 'incoming_call',
        callerId: asId(payload && payload.callerId),
        conversationId: asId(payload && payload.conversationId),
        callType: payload && payload.type
      });
    });

    client.onError(async (error) => {
      this.emit('event', { type: 'error', error: error.message || String(error) });
    });
  }

  async finalizeAuthLogin(sourceClient) {
    const token = sourceClient._token || sourceClient.session.get('token');
    if (!token) {
      throw new Error('Токен после входа не получен.');
    }

    if (!sourceClient._useSocketTransport) {
      const profile = this.buildClientOptions('ANDROID');
      const deviceId = sourceClient.deviceId;
      const clientSessionId = sourceClient.userAgent?.clientSessionId || profile.clientSessionId;
      await sourceClient.stop().catch(() => {});
      this.client = null;

      const android = this.createClient('ANDROID');
      Object.assign(android.session.data, {
        ...profile,
        token,
        deviceId,
        clientSessionId,
        deviceType: 'ANDROID'
      });
      android.deviceId = deviceId;
      android._token = token;
      this.client = android;
      await android.connect();
      await this.queue.run(() => android.sync());
      android.isAuthorized = true;
      if (typeof android.fetchMyProfile === 'function') {
        try {
          await this.queue.run(() => android.fetchMyProfile());
        } catch {
          /* ignore */
        }
      }
      return this.finishReady(android);
    }

    if (!sourceClient.isAuthorized) {
      sourceClient._token = token;
      await this.queue.run(() => sourceClient.sync());
      sourceClient.isAuthorized = true;
    }
    if (typeof sourceClient.fetchMyProfile === 'function') {
      try {
        await this.queue.run(() => sourceClient.fetchMyProfile());
      } catch {
        /* ignore */
      }
    }
    return this.finishReady(sourceClient);
  }

  persistAuthSession(client) {
    const data = {
      token: client._token || client.session.get('token'),
      deviceId: client.deviceId,
      clientSessionId: client.userAgent.clientSessionId,
      deviceType: 'ANDROID',
      headerUserAgent: client.userAgent.headerUserAgent,
      appVersion: client.userAgent.appVersion,
      osVersion: client.userAgent.osVersion,
      deviceName: client.userAgent.deviceName,
      screen: client.userAgent.screen,
      timezone: client.userAgent.timezone,
      locale: client.userAgent.locale,
      buildNumber: client.userAgent.buildNumber
    };
    if (client.me && client.me.id != null) {
      data.userId = client.me.id;
    }
    fs.writeFileSync(this.sessionFile, JSON.stringify(data, null, 2), 'utf8');
    client.session.data = { ...client.session.data, ...data };
  }

  async finishReady(client) {
    const me = profileOf(client);
    if (this.authOnly) {
      this.persistAuthSession(client);
      this.savedSession = `${this.sessionName}.json`;
      this.savedProfile = me;
      this.phase = 'saved';
      this.qr = null;
      this.sms = null;
      const savedClient = client;
      this.client = null;
      this.abortQr = true;
      try {
        await savedClient.stop();
      } catch {
        /* ignore */
      }
      this.emit('event', { type: 'saved', sessionFile: this.savedSession, me });
      return this.snapshot();
    }

    this.client = client;
    this.phase = 'ready';
    this.qr = null;
    this.sms = null;
    this.attachLiveHandlers(client);
    if (typeof client._scheduleSessionRefreshIfNeeded === 'function') {
      client._scheduleSessionRefreshIfNeeded();
    }
    this.emit('event', { type: 'ready', me });
    return this.snapshot();
  }

  readStoredDeviceType() {
    try {
      const data = JSON.parse(fs.readFileSync(this.sessionFile, 'utf8'));
      if (data.deviceType === 'WEB' || data.device_type === 1) return 'WEB';
      return 'ANDROID';
    } catch {
      return 'ANDROID';
    }
  }

  async resume() {
    if (this.phase === 'ready' && this.client && this.client.isAuthorized) {
      return this.snapshot();
    }
    if (!this.sessionExists()) {
      throw new Error('Нет сохранённой сессии. Войдите по QR или SMS.');
    }

    await this.destroyClient();
    const client = this.createClient(this.readStoredDeviceType());
    await client.connect();
    const token = client.session.get('token');
    if (!token) {
      throw new Error('В файле сессии нет токена.');
    }
    client._token = token;
    await this.queue.run(() => client.sync());
    client.isAuthorized = true;
    if (typeof client.fetchMyProfile === 'function') {
      try {
        await this.queue.run(() => client.fetchMyProfile());
      } catch {
        /* sync already filled me in most cases */
      }
    }
    if (typeof client.triggerHandlers === 'function' && client.handlers) {
      try {
        await client.triggerHandlers('start');
      } catch {
        /* optional */
      }
    }
    return this.finishReady(client);
  }

  async startQr() {
    await this.destroyClient();
    this.abortQr = false;
    this.phase = 'qr';
    const client = this.createClient('WEB');
    this.client = client;
    await client.connect();
    const qrData = await this.queue.run(() => client.requestQR());
    if (!qrData || !qrData.qrLink || !qrData.trackId) {
      throw new Error('Сервер Max не вернул QR.');
    }
    const image = await QRCode.toDataURL(qrData.qrLink, {
      margin: 1,
      width: 220,
      errorCorrectionLevel: 'H',
      color: { dark: '#000000', light: '#ffffff' }
    });
    this.qr = {
      image,
      link: qrData.qrLink,
      trackId: qrData.trackId,
      interval: Number(qrData.pollingInterval) || 2000,
      expiresAt: Number(qrData.expiresAt) || Date.now() + 120000
    };
    this.emit('event', { type: 'qr', image, expiresAt: this.qr.expiresAt, link: this.qr.link });
    this.pollQr(client, this.qr).catch((error) => {
      if (!this.abortQr) {
        this.phase = 'idle';
        this.emit('event', { type: 'error', error: error.message || String(error) });
      }
    });
    return this.snapshot();
  }

  async pollQr(client, qr) {
    while (!this.abortQr && this.phase === 'qr' && this.client === client) {
      if (Date.now() >= qr.expiresAt) {
        this.phase = 'idle';
        this.qr = null;
        await this.destroyClient();
        throw new Error('QR истёк. Запросите новый.');
      }
      await new Promise((resolve) => setTimeout(resolve, qr.interval));
      if (this.abortQr || this.client !== client) return;
      const status = await this.queue.run(() => client.checkQRStatus(qr.trackId));
      const ready = status && status.status && status.status.loginAvailable;
      if (!ready) continue;

      this.emit('event', { type: 'qr_scanned' });
      const loginData = await this.queue.run(() => client.loginByQR(qr.trackId));
      const token = loginData && loginData.tokenAttrs && loginData.tokenAttrs.LOGIN && loginData.tokenAttrs.LOGIN.token;
      if (!token) throw new Error('Токен после QR не получен.');
      client._token = token;
      client.isAuthorized = true;
      await this.finalizeAuthLogin(client);
      return;
    }
  }

  async startSms(phone) {
    await this.destroyClient();
    this.phase = 'sms_code';
    const normalized = String(phone || '').replace(/\s/g, '');
    if (!/^\+?\d{10,15}$/.test(normalized)) {
      throw new Error('Неверный формат номера телефона');
    }

    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const client = this.createClient('ANDROID');
        this.client = client;
        await client.connect();
        const auth = await this.queue.run(() => client.authorizeBySMS(normalized));
        this.sms = {
          phone: auth.phone,
          sendCode: auth.sendCode,
          needsPassword: false,
          hint: ''
        };
        return this.snapshot();
      } catch (error) {
        lastError = error;
        try {
          await this.destroyClient();
        } catch {
          /* ignore */
        }
        this.phase = 'sms_code';
        const msg = String((error && error.message) || error || '');
        const transient = /connect|closed|socket|ECONN|network|timeout|ETIMEDOUT|EAI_AGAIN|temporarily/i.test(
          msg
        );
        if (!transient || attempt === 3) {
          if (/слишком много попыток/i.test(msg)) {
            throw new Error('Max временно ограничил SMS. Подождите 2–5 минут и попробуйте снова.');
          }
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
      }
    }
    throw lastError || new Error('Не удалось подключиться к Max');
  }

  async submitSmsCode(code) {
    if (!this.sms || !this.sms.sendCode) {
      throw new Error('Сначала запросите код.');
    }
    const result = await this.queue.run(() => this.sms.sendCode(String(code).trim()));
    if (result && typeof result === 'object' && result.needsPassword) {
      this.phase = 'sms_2fa';
      this.sms.needsPassword = true;
      this.sms.hint = (result.passwordChallenge && result.passwordChallenge.hint) || '';
      this.sms.sendPassword = result.sendPassword;
      return this.snapshot();
    }
    await this.finalizeAuthLogin(this.client);
    return this.snapshot();
  }

  async submitSmsPassword(password) {
    if (!this.sms || !this.sms.sendPassword) {
      throw new Error('Пароль 2FA сейчас не нужен.');
    }
    await this.queue.run(() => this.sms.sendPassword(String(password)));
    await this.finalizeAuthLogin(this.client);
    return this.snapshot();
  }

  requireReady() {
    if (!this.client || !this.client.isAuthorized || this.phase !== 'ready') {
      throw new Error('Сначала войдите в аккаунт Max.');
    }
    return this.client;
  }

  async listChats() {
    const client = this.requireReady();
    let chats = [];
    try {
      chats = await this.queue.run(() => client.getChats());
    } catch {
      chats = [];
    }
    if (!Array.isArray(chats) || chats.length === 0) {
      chats = collectChats(client);
    }
    let serialized = chats.map(serializeChat).filter((chat) => chat.id);
    const missing = serialized.filter((chat) => chat.title.startsWith('Чат ')).map((chat) => chat.id);
    if (missing.length && typeof client.getChatInfo === 'function') {
      try {
        const info = await this.queue.run(() => client.getChatInfo(missing.slice(0, 40)));
        const extras = new Map(chatsFromPayload(info).map((chat) => [asId(chat.id ?? chat.chatId), serializeChat(chat)]));
        serialized = serialized.map((chat) => {
          const extra = extras.get(chat.id);
          return extra && !extra.title.startsWith('Чат ') ? { ...chat, title: extra.title } : chat;
        });
      } catch {
        /* titles stay as fallback */
      }
    }
    return serialized;
  }

  async history(chatId, backward = 40) {
    const client = this.requireReady();
    const messages = await this.queue.run(() =>
      client.getHistory(chatId, Date.now(), Number(backward) || 40, 0)
    );
    const myId = client.me && client.me.id;
    return messages.map((message) => serializeMessage(message, myId));
  }

  async sendText(chatId, text) {
    const client = this.requireReady();
    const cid = 1 + Math.floor(Math.random() * 0x7ffffffe);
    const message = await this.queue.run(() =>
      client.sendMessage({ chatId, text: String(text), cid })
    );
    return serializeMessage(message, client.me && client.me.id);
  }

  async sendPhoto(chatId, filePath) {
    const client = this.requireReady();
    const attach = await this.queue.run(() => client.uploadPhoto(chatId, filePath));
    const cid = 1 + Math.floor(Math.random() * 0x7ffffffe);
    const message = await this.queue.run(() =>
      client.sendMessage({ chatId, text: '', cid, attachments: [attach] })
    );
    return serializeMessage(message, client.me && client.me.id);
  }

  async editText(chatId, messageId, text) {
    const client = this.requireReady();
    await this.queue.run(() => client.editMessage({ chatId, messageId, text: String(text) }));
    return { ok: true };
  }

  async removeMessage(chatId, messageId) {
    const client = this.requireReady();
    await this.queue.run(() => client.deleteMessage({ chatId, messageId }));
    return { ok: true };
  }

  async devices() {
    const client = this.requireReady();
    const info = await this.queue.run(() => client.getSessionsInfo());
    return WebMaxClient.normalizeSessionsList(info).map(serializeDevice);
  }

  async closeOtherDevices() {
    const client = this.requireReady();
    await this.queue.run(() => client.closeAllSessionsExceptCurrent());
    return this.devices();
  }

  async updateProfile(fields) {
    const client = this.requireReady();
    await this.queue.run(() => client.updateProfile(fields));
    if (typeof client.fetchMyProfile === 'function') {
      try {
        await this.queue.run(() => client.fetchMyProfile());
      } catch {
        /* ignore */
      }
    }
    return profileOf(client);
  }

  async rejectCall(conversationId) {
    const client = this.requireReady();
    await this.queue.run(() => client.rejectIncomingCall({ conversationId }));
    return { ok: true };
  }

  async downloadAttach(chatId, messageId, index) {
    const client = this.requireReady();
    const messages = await this.queue.run(() => client.getHistory(chatId, Date.now(), 80, 0));
    const found = messages.find((message) => asId(message.id) === asId(messageId));
    if (!found) throw new Error('Сообщение не найдено в недавней истории.');
    return found.downloadAttachment(Number(index) || 0, {
      dir: path.join(process.cwd(), 'downloads')
    });
  }

  async disconnectKeepSession() {
    this.phase = 'idle';
    await this.destroyClient();
    this.emit('event', { type: 'signed_out' });
    return this.snapshot();
  }

  async logoutWipe() {
    const client = this.client;
    this.phase = 'idle';
    if (client && typeof client.logout === 'function') {
      try {
        await client.logout();
      } catch {
        /* ignore */
      }
    } else {
      await this.destroyClient();
      try {
        if (fs.existsSync(this.sessionFile)) fs.unlinkSync(this.sessionFile);
      } catch {
        /* ignore */
      }
    }
    this.client = null;
    this.qr = null;
    this.sms = null;
    this.emit('event', { type: 'signed_out' });
    return this.snapshot();
  }
}

function cleanupOrphanAuthSessions() {
  const dir = path.join(process.cwd(), 'sessions');
  if (!fs.existsSync(dir)) return 0;
  let removed = 0;
  for (const file of fs.readdirSync(dir)) {
    if (!file.startsWith('max_') || !file.endsWith('.json')) continue;
    const full = path.join(dir, file);
    try {
      const data = JSON.parse(fs.readFileSync(full, 'utf8'));
      if (data && data.token) continue;
      fs.unlinkSync(full);
      removed += 1;
    } catch {
      try {
        fs.unlinkSync(full);
        removed += 1;
      } catch {
        /* ignore */
      }
    }
  }
  return removed;
}

module.exports = { MaxDesk, SESSION_NAME, cleanupOrphanAuthSessions };
