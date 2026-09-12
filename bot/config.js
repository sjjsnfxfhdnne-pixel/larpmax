const fs = require('fs');
const path = require('path');

function loadEnvFile() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile();

function parseRequiredChats() {
  const defaults = [
    {
      chatId: process.env.TELEGRAM_SUPPORT_CHAT_ID || '',
      label: 'Поддержка',
      url: 'https://t.me/+2-6zGMqnW1VmZTM1'
    },
    {
      chatId: process.env.TELEGRAM_COMMUNITY_CHAT_ID || '',
      label: 'Чат',
      url: 'https://t.me/+5-HGP3yLl2piZDQ1'
    }
  ];

  const raw = String(process.env.TELEGRAM_REQUIRED_CHATS || '').trim();
  if (!raw) return defaults;

  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [chatId, label, url] = part.split('|');
      return {
        chatId: String(chatId || '').trim(),
        label: String(label || 'Канал').trim(),
        url: String(url || '').trim()
      };
    })
    .filter((item) => item.url);
}

const LINKS = {
  chat: {
    label: '💬 Чат',
    url: process.env.TELEGRAM_CHAT_URL || 'https://t.me/+5-HGP3yLl2piZDQ1'
  },
  channel: {
    label: '📢 Канал',
    url: process.env.TELEGRAM_CHANNEL_URL || 'https://t.me/larpmax'
  },
  support: {
    label: '🆘 Поддержка',
    url:
      process.env.TELEGRAM_SUPPORT_URL ||
      `https://t.me/${process.env.TELEGRAM_SUPPORT_USERNAME || 'zprep'}`
  }
};

module.exports = {
  token: process.env.TELEGRAM_BOT_TOKEN || '',
  botUsername: process.env.TELEGRAM_BOT_USERNAME || 'larpmaxbot',
  supportUsername: process.env.TELEGRAM_SUPPORT_USERNAME || 'zprep',
  authSiteUrl: process.env.AUTH_SITE_URL || 'http://127.0.0.1:3780',
  links: LINKS,
  subscriptionEnabled: process.env.TELEGRAM_SUBSCRIPTION_ENABLED === '1',
  adminOnly: process.env.TELEGRAM_ADMIN_ONLY === '1',
  admins: new Set(
    String(process.env.TELEGRAM_ADMIN_IDS || '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  ),
  requiredChats: parseRequiredChats()
};
