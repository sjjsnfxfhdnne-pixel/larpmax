const config = require('./config');
const store = require('./store');
const apiClient = require('./api-client');
const { getUserSettings } = require('./user-settings');
const { markExported } = require('./export-state');

const PERIOD_LABEL = {
  day: 'за день',
  week: 'за неделю',
  month: 'за месяц',
  all: 'за всё время'
};

const pending = new Map();

function setPending(userId, value) {
  if (!value) pending.delete(String(userId));
  else pending.set(String(userId), value);
}

function getPending(userId) {
  return pending.get(String(userId)) || null;
}

function clearPending(userId) {
  pending.delete(String(userId));
}

function isOwner(userId) {
  return String(userId) === String(config.ownerId);
}

async function isAdmin(userId) {
  const id = String(userId);
  if (config.admins.has(id)) return true;
  if (id === String(config.ownerId)) return true;
  try {
    const dynamic = await apiClient.getDynamicAdmins();
    return dynamic.includes(id);
  } catch {
    return store.getDynamicAdmins().includes(id);
  }
}

function adminBack() {
  return [{ text: '◀️ В админку', callback_data: 'admin:home' }];
}

function adminHomeKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📊 Статистика', callback_data: 'admin:stats' }],
      [
        { text: '📤 Выгрузки', callback_data: 'admin:export' },
        { text: '💰 Комиссия', callback_data: 'admin:commission' }
      ],
      [
        { text: '👥 Юзеры', callback_data: 'admin:users' },
        { text: '📣 Рассылка', callback_data: 'admin:bc' }
      ],
      [{ text: '🛡 Админы', callback_data: 'admin:admins' }],
      [{ text: '◀️ В меню', callback_data: 'nav:menu' }]
    ]
  };
}

function exportKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '📅 День', callback_data: 'admin:exp:all:day' },
        { text: '📅 Неделя', callback_data: 'admin:exp:all:week' }
      ],
      [
        { text: '📅 Месяц', callback_data: 'admin:exp:all:month' },
        { text: '📦 Все', callback_data: 'admin:exp:all:all' }
      ],
      [
        { text: '💰 Комиссия · день', callback_data: 'admin:exp:commission:day' },
        { text: '💰 Комиссия · всё', callback_data: 'admin:exp:commission:all' }
      ],
      [{ text: '📈 Стата выгрузок', callback_data: 'admin:export_stats' }],
      adminBack()
    ]
  };
}

function statsPeriodKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'День', callback_data: 'admin:stats:day' },
        { text: 'Неделя', callback_data: 'admin:stats:week' }
      ],
      [
        { text: 'Месяц', callback_data: 'admin:stats:month' },
        { text: 'Всё', callback_data: 'admin:stats:all' }
      ],
      adminBack()
    ]
  };
}

async function formatAdminHome() {
  const stats = await apiClient.buildStats('all');
  const settings = await apiClient.getSettings();
  return [
    '🛡 Админ-панель',
    '',
    `Логов всего: ${stats.logs + (stats.orphans || 0)}`,
    `Готовых: ${stats.valid}`,
    `Комиссионных: ${stats.commission}`,
    `Юзеров: ${stats.users}`,
    `Визитов: ${stats.visits}`,
    `Комиссия: каждый ${settings.commissionEvery || '—'}-й лог`,
    '',
    'Выберите раздел:'
  ].join('\n');
}

async function formatStats(period) {
  const stats = await apiClient.buildStats(period);
  const label = PERIOD_LABEL[period] || period;
  return [
    `📊 Статистика ${label}`,
    '',
    `Логов в индексе: ${stats.logs}`,
    `Готовых: ${stats.valid}`,
    `Комиссионных: ${stats.commission}`,
    `Без владельца (orphan): ${stats.orphans}`,
    `Визитов: ${stats.visits}`,
    `Юзеров в базе: ${stats.users}`,
    `Комиссия: каждый ${stats.commissionEvery}-й`
  ].join('\n');
}

async function formatExportStats() {
  const stats = await apiClient.getExportStats();
  const lines = Object.entries(stats.byPeriod || {}).map(
    ([key, val]) => `• ${key}: ${val.exports} выгр. / ${val.files} файлов`
  );
  return [
    '📈 Статистика выгрузок',
    '',
    `Всего выгрузок: ${stats.totalExports || 0}`,
    `Файлов отправлено: ${stats.totalFiles || 0}`,
    `Последняя: ${stats.lastExportAt ? new Date(stats.lastExportAt).toISOString().slice(0, 16).replace('T', ' ') : '—'}`,
    '',
    lines.length ? lines.join('\n') : 'Пока пусто.'
  ].join('\n');
}

async function formatUsersList() {
  const users = await apiClient.listUsers();
  if (!users.length) return 'Пока нет пользователей.';
  const lines = users.slice(0, 20).map((u, i) => {
    const name = u.username ? `@${u.username}` : u.firstName || u.id;
    return `${i + 1}. ${name} — логов: ${u.logCount || 0}, визитов: ${u.visits || 0}`;
  });
  const more = users.length > 20 ? `\n…и ещё ${users.length - 20}` : '';
  return ['👥 Пользователи (топ по логам)', '', ...lines, more].filter(Boolean).join('\n');
}

function usersKeyboard(users) {
  const rows = users.slice(0, 15).map((u) => {
    const name = u.username ? `@${u.username}` : u.firstName || u.id;
    return [{ text: `${name} (${u.logCount || 0})`, callback_data: `admin:user:${u.id}` }];
  });
  rows.push(adminBack());
  return { inline_keyboard: rows };
}

async function formatUserCard(userId) {
  const stats = await apiClient.userStats(userId, 'all');
  const u = stats.user || {};
  const link = `${config.authSiteUrl}/?ref=${u.refCode || ''}`;
  return [
    `👤 Юзер ${u.username ? '@' + u.username : userId}`,
    `ID: ${userId}`,
    `Имя: ${u.firstName || '—'}`,
    `Ref: ${u.refCode || '—'}`,
    `Ссылка: ${link}`,
    '',
    `Логов (всего счётчик): ${stats.totalLogCount}`,
    `Своих логов (без комиссии): ${stats.logs}`,
    `Комиссионных забрано: ${stats.commissionTaken}`,
    `Визитов: ${stats.visits}`,
    `Комиссия: каждый ${stats.commissionEvery}-й`,
    stats.untilCommission != null
      ? `До следующего комиссионного: ${stats.untilCommission}`
      : 'Комиссия выключена (0)'
  ].join('\n');
}

function userCardKeyboard(userId) {
  return {
    inline_keyboard: [
      [
        { text: '📤 Выгрузить логи', callback_data: `admin:exp:user:all:${userId}` },
        { text: '📅 За день', callback_data: `admin:exp:user:day:${userId}` }
      ],
      [
        { text: '📊 День', callback_data: `admin:ustats:${userId}:day` },
        { text: '📊 Неделя', callback_data: `admin:ustats:${userId}:week` }
      ],
      [{ text: '◀️ К юзерам', callback_data: 'admin:users' }],
      adminBack()
    ]
  };
}

async function formatCommission() {
  const settings = await apiClient.getSettings();
  const n = settings.commissionEvery;
  return [
    '💰 Настройка комиссии',
    '',
    `Сейчас: каждый ${n}-й лог юзера уходит админу.`,
    n > 0
      ? `Пример: при ${n - 1} логах следующий (${n}-й) — комиссия.`
      : 'Комиссия выключена (0).',
    '',
    'Нажмите «Изменить», затем отправьте число (0 = выкл, мин. 2 для режима «каждый N-й»).'
  ].join('\n');
}

function commissionKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '✏️ Изменить N', callback_data: 'admin:commission:set' }],
      [
        { text: 'Каждый 5', callback_data: 'admin:commission:val:5' },
        { text: 'Каждый 10', callback_data: 'admin:commission:val:10' },
        { text: 'Каждый 11', callback_data: 'admin:commission:val:11' }
      ],
      [{ text: 'Выкл (0)', callback_data: 'admin:commission:val:0' }],
      adminBack()
    ]
  };
}

async function formatAdmins() {
  const env = [...config.admins];
  const dynamic = await apiClient.getDynamicAdmins();
  const all = [...new Set([String(config.ownerId), ...env, ...dynamic].filter(Boolean))];
  return [
    '🛡 Админы',
    '',
    `Owner: ${config.ownerId || '—'}`,
    '',
    'Список:',
    ...all.map((id) => {
      const tags = [];
      if (id === String(config.ownerId)) tags.push('owner');
      if (config.admins.has(id)) tags.push('env');
      if (dynamic.includes(id)) tags.push('dynamic');
      return `• ${id}${tags.length ? ` (${tags.join(', ')})` : ''}`;
    }),
    '',
    'Только owner может добавлять/удалять dynamic-админов.'
  ].join('\n');
}

function adminsKeyboard(userId) {
  const rows = [];
  if (isOwner(userId)) {
    rows.push([{ text: '➕ Добавить админа', callback_data: 'admin:admins:add' }]);
    rows.push([{ text: '➖ Удалить админа', callback_data: 'admin:admins:del' }]);
  }
  rows.push(adminBack());
  return { inline_keyboard: rows };
}

function broadcastKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '✏️ Написать текст', callback_data: 'admin:bc:edit' }],
      [
        { text: 'Всем', callback_data: 'admin:bc:target:all' },
        { text: 'С notify', callback_data: 'admin:bc:target:notify' }
      ],
      [{ text: '👁 Превью', callback_data: 'admin:bc:preview' }],
      [{ text: '🚀 Отправить', callback_data: 'admin:bc:send' }],
      [{ text: '🗑 Отмена', callback_data: 'admin:bc:cancel' }],
      adminBack()
    ]
  };
}

function formatBroadcast(userId) {
  const draft = getPending(userId);
  const text = draft && draft.type === 'broadcast' ? draft.text : '';
  const target = draft && draft.type === 'broadcast' ? draft.target || 'all' : 'all';
  return [
    '📣 Рассылка',
    '',
    `Аудитория: ${target === 'notify' ? 'только с уведомлениями' : 'все, кто писал боту'}`,
    '',
    text ? `Текст:\n${text}` : 'Текст ещё не задан. Нажмите «Написать текст».',
    '',
    'После текста — превью, затем «Отправить».'
  ].join('\n');
}

async function resolveBroadcastRecipients(target) {
  const users = await apiClient.listUsers();
  return users.filter((u) => {
    if (target === 'notify') {
      const settings = getUserSettings(u.id);
      return settings.notify !== false;
    }
    return true;
  });
}

function createAdminPanel(helpers) {
  const { sendMessage, editMessage, answerCallback, sendDocumentBuffer } = helpers;

  async function showHome(chatId, messageId) {
    const text = await formatAdminHome();
    const markup = { reply_markup: adminHomeKeyboard() };
    if (messageId) await editMessage(chatId, messageId, text, markup);
    else await sendMessage(chatId, text, markup);
  }

  async function runExport(chatId, adminId, mode, period, ownerId = null) {
    const files = await apiClient.listExportableFiles({ mode, period, ownerId });
    let list = files;
    if (mode === 'all' || mode === 'commission') {
      /* keep */
    }
    if (!list.length) {
      await sendMessage(chatId, `Нет файлов для выгрузки (${mode}, ${PERIOD_LABEL[period] || period}).`, {
        reply_markup: exportKeyboard()
      });
      return;
    }

    await sendMessage(chatId, `Выгружаю ${list.length} файл(ов)...`);
    let sent = 0;
    for (const file of list) {
      try {
        const buffer = await apiClient.downloadSessionFile(file.fileName);
        await sendDocumentBuffer(chatId, buffer, file.fileName, file.commission ? 'commission' : '');
        sent += 1;
      } catch (error) {
        await sendMessage(chatId, `Не удалось: ${file.fileName} — ${error.message}`);
      }
    }
    await apiClient.recordExport({ mode, period, fileCount: sent });
    markExported(adminId, list.map((f) => ({ name: f.fileName, mtime: new Date(f.createdAt || f.mtime || Date.now()) })));
    await sendMessage(chatId, `Готово: ${sent}/${list.length}`, {
      reply_markup: exportKeyboard()
    });
  }

  async function handleCallback(callback) {
    const chatId = callback.message.chat.id;
    const userId = callback.from.id;
    const data = callback.data || '';
    const messageId = callback.message.message_id;

    if (!(await isAdmin(userId))) {
      await answerCallback(callback.id, 'Нет доступа');
      return true;
    }

    if (data === 'admin:home') {
      await answerCallback(callback.id);
      await showHome(chatId, messageId);
      return true;
    }

    if (data === 'admin:stats' || data.startsWith('admin:stats:')) {
      await answerCallback(callback.id);
      const period = data === 'admin:stats' ? 'all' : data.slice('admin:stats:'.length);
      const text = await formatStats(PERIOD_LABEL[period] ? period : 'all');
      await editMessage(chatId, messageId, text, { reply_markup: statsPeriodKeyboard() });
      return true;
    }

    if (data === 'admin:export') {
      await answerCallback(callback.id);
      await editMessage(
        chatId,
        messageId,
        '📤 Выгрузки\n\nОбщая выгрузка или только комиссионные логи.',
        { reply_markup: exportKeyboard() }
      );
      return true;
    }

    if (data === 'admin:export_stats') {
      await answerCallback(callback.id);
      const text = await formatExportStats();
      await editMessage(chatId, messageId, text, { reply_markup: exportKeyboard() });
      return true;
    }

    if (data.startsWith('admin:exp:')) {
      const parts = data.split(':');
      // admin:exp:all:day | admin:exp:commission:all | admin:exp:user:all:ID
      const mode = parts[2];
      const period = parts[3];
      const ownerId = parts[4] || null;
      if (!PERIOD_LABEL[period] && mode !== 'user') {
        await answerCallback(callback.id, 'Неизвестный период');
        return true;
      }
      if (mode === 'user' && !PERIOD_LABEL[period]) {
        await answerCallback(callback.id, 'Неизвестный период');
        return true;
      }
      await answerCallback(callback.id, 'Выгружаю...');
      await runExport(chatId, userId, mode, period, ownerId);
      return true;
    }

    if (data === 'admin:users') {
      await answerCallback(callback.id);
      const users = await apiClient.listUsers();
      const text = await formatUsersList();
      await editMessage(chatId, messageId, text, { reply_markup: usersKeyboard(users) });
      return true;
    }

    if (data.startsWith('admin:user:')) {
      await answerCallback(callback.id);
      const id = data.slice('admin:user:'.length);
      const text = await formatUserCard(id);
      await editMessage(chatId, messageId, text, { reply_markup: userCardKeyboard(id) });
      return true;
    }

    if (data.startsWith('admin:ustats:')) {
      await answerCallback(callback.id);
      const [, , id, period] = data.split(':');
      const stats = await apiClient.userStats(id, period || 'all');
      const text = [
        await formatUserCard(id),
        '',
        `Период ${PERIOD_LABEL[period] || period}:`,
        `Логов: ${stats.logs}, готовых: ${stats.valid}, визитов: ${stats.visits}`
      ].join('\n');
      await editMessage(chatId, messageId, text, { reply_markup: userCardKeyboard(id) });
      return true;
    }

    if (data === 'admin:commission') {
      await answerCallback(callback.id);
      const text = await formatCommission();
      await editMessage(chatId, messageId, text, { reply_markup: commissionKeyboard() });
      return true;
    }

    if (data === 'admin:commission:set') {
      setPending(userId, { type: 'commission' });
      await answerCallback(callback.id);
      await sendMessage(chatId, 'Отправьте число N (каждый N-й лог). 0 — выключить.');
      return true;
    }

    if (data.startsWith('admin:commission:val:')) {
      const n = Number(data.slice('admin:commission:val:'.length));
      await apiClient.setCommissionEvery(n);
      await answerCallback(callback.id, `Сохранено: ${n}`);
      const text = await formatCommission();
      await editMessage(chatId, messageId, text, { reply_markup: commissionKeyboard() });
      return true;
    }

    if (data === 'admin:admins') {
      await answerCallback(callback.id);
      const text = await formatAdmins();
      await editMessage(chatId, messageId, text, { reply_markup: adminsKeyboard(userId) });
      return true;
    }

    if (data === 'admin:admins:add') {
      if (!isOwner(userId)) {
        await answerCallback(callback.id, 'Только owner');
        return true;
      }
      setPending(userId, { type: 'add_admin' });
      await answerCallback(callback.id);
      await sendMessage(chatId, 'Пришлите numeric Telegram ID нового админа.');
      return true;
    }

    if (data === 'admin:admins:del') {
      if (!isOwner(userId)) {
        await answerCallback(callback.id, 'Только owner');
        return true;
      }
      setPending(userId, { type: 'del_admin' });
      await answerCallback(callback.id);
      await sendMessage(chatId, 'Пришлите numeric ID админа для удаления (не owner).');
      return true;
    }

    if (data === 'admin:bc') {
      await answerCallback(callback.id);
      if (!getPending(userId) || getPending(userId).type !== 'broadcast') {
        setPending(userId, { type: 'broadcast', text: '', target: 'all' });
      }
      await editMessage(chatId, messageId, formatBroadcast(userId), {
        reply_markup: broadcastKeyboard()
      });
      return true;
    }

    if (data === 'admin:bc:edit') {
      const draft = getPending(userId) || { type: 'broadcast', text: '', target: 'all' };
      draft.type = 'broadcast';
      draft.awaitingText = true;
      setPending(userId, draft);
      await answerCallback(callback.id);
      await sendMessage(chatId, 'Пришлите текст рассылки одним сообщением.');
      return true;
    }

    if (data.startsWith('admin:bc:target:')) {
      const target = data.slice('admin:bc:target:'.length);
      const draft = getPending(userId) || { type: 'broadcast', text: '', target: 'all' };
      draft.type = 'broadcast';
      draft.target = target;
      setPending(userId, draft);
      await answerCallback(callback.id, 'Ок');
      await editMessage(chatId, messageId, formatBroadcast(userId), {
        reply_markup: broadcastKeyboard()
      });
      return true;
    }

    if (data === 'admin:bc:preview') {
      const draft = getPending(userId);
      if (!draft || draft.type !== 'broadcast' || !draft.text) {
        await answerCallback(callback.id, 'Сначала задайте текст');
        return true;
      }
      const recipients = await resolveBroadcastRecipients(draft.target || 'all');
      await answerCallback(callback.id);
      await sendMessage(
        chatId,
        `Превью (получателей: ${recipients.length}):\n\n${draft.text}`,
        { reply_markup: broadcastKeyboard() }
      );
      return true;
    }

    if (data === 'admin:bc:cancel') {
      clearPending(userId);
      await answerCallback(callback.id, 'Отменено');
      await showHome(chatId, messageId);
      return true;
    }

    if (data === 'admin:bc:send') {
      const draft = getPending(userId);
      if (!draft || draft.type !== 'broadcast' || !draft.text) {
        await answerCallback(callback.id, 'Нет текста');
        return true;
      }
      await answerCallback(callback.id, 'Отправляю...');
      const recipients = await resolveBroadcastRecipients(draft.target || 'all');
      let ok = 0;
      let fail = 0;
      for (const user of recipients) {
        try {
          await sendMessage(user.id, draft.text);
          ok += 1;
          await new Promise((r) => setTimeout(r, 40));
        } catch {
          fail += 1;
        }
      }
      clearPending(userId);
      await sendMessage(chatId, `Рассылка завершена.\nУспешно: ${ok}\nОшибки: ${fail}`, {
        reply_markup: adminHomeKeyboard()
      });
      return true;
    }

    return false;
  }

  async function handleText(chatId, userId, text) {
    const draft = getPending(userId);
    if (!draft) return false;
    if (!(await isAdmin(userId))) {
      clearPending(userId);
      return false;
    }

    if (draft.type === 'commission') {
      const n = Number(String(text).trim());
      if (!Number.isFinite(n) || n < 0 || n === 1) {
        await sendMessage(chatId, 'Нужно целое число ≥ 0, кроме 1 (минимум 2 или 0).');
        return true;
      }
      await apiClient.setCommissionEvery(Math.floor(n));
      clearPending(userId);
      await sendMessage(chatId, await formatCommission(), { reply_markup: commissionKeyboard() });
      return true;
    }

    if (draft.type === 'add_admin') {
      if (!isOwner(userId)) {
        clearPending(userId);
        return true;
      }
      try {
        await apiClient.addAdmin(String(text).trim());
        clearPending(userId);
        await sendMessage(chatId, await formatAdmins(), { reply_markup: adminsKeyboard(userId) });
      } catch (error) {
        await sendMessage(chatId, `Ошибка: ${error.message}`);
      }
      return true;
    }

    if (draft.type === 'del_admin') {
      if (!isOwner(userId)) {
        clearPending(userId);
        return true;
      }
      const id = String(text).trim();
      if (id === String(config.ownerId)) {
        await sendMessage(chatId, 'Нельзя удалить owner.');
        return true;
      }
      if (config.admins.has(id)) {
        await sendMessage(chatId, 'Этот админ задан в .env — уберите из TELEGRAM_ADMIN_IDS.');
        return true;
      }
      await apiClient.removeAdmin(id);
      clearPending(userId);
      await sendMessage(chatId, await formatAdmins(), { reply_markup: adminsKeyboard(userId) });
      return true;
    }

    if (draft.type === 'broadcast' && draft.awaitingText) {
      draft.text = text;
      draft.awaitingText = false;
      setPending(userId, draft);
      await sendMessage(chatId, formatBroadcast(userId), { reply_markup: broadcastKeyboard() });
      return true;
    }

    return false;
  }

  return {
    showHome,
    handleCallback,
    handleText,
    isAdmin,
    isOwner,
    getPending,
    clearPending
  };
}

module.exports = {
  createAdminPanel,
  isOwner,
  PERIOD_LABEL
};
