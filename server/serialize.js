function jsonSafe(value) {
  return JSON.parse(
    JSON.stringify(value, (_, v) => {
      if (typeof v === 'bigint') return v.toString();
      return v;
    })
  );
}

function asId(value) {
  if (value == null) return null;
  if (typeof value === 'bigint') return value.toString();
  return String(value);
}

function profileOf(client) {
  const me = client && client.me;
  if (!me) return null;
  return jsonSafe({
    id: asId(me.id),
    firstname: me.firstname || '',
    lastname: me.lastname || '',
    fullname: me.fullname || me.firstname || 'Max',
    phone: me.phone ? String(me.phone) : '',
    username: me.username || '',
    bio: me.bio || '',
    avatar: typeof me.avatar === 'string' ? me.avatar : me.avatar?.url || me.avatar?.baseUrl || null
  });
}

function lastMessagePreview(chat) {
  const last =
    chat.lastMessage ||
    chat.last_message ||
    chat.message ||
    null;
  if (!last) return '';
  if (typeof last === 'string') return last;
  const text = last.text || last.message || last.body || '';
  if (typeof text === 'string') return text;
  if (text && typeof text === 'object') return text.text || '';
  return '';
}

function personName(user) {
  if (!user || typeof user !== 'object') return '';
  const full = [user.firstName || user.firstname, user.lastName || user.lastname]
    .filter(Boolean)
    .join(' ')
    .trim();
  return full || user.name || user.names || user.nick || user.username || '';
}

function namesFromGroup(node, depth = 0, acc = []) {
  if (!node || depth > 4) return acc;
  if (Array.isArray(node)) {
    node.forEach((item) => namesFromGroup(item, depth + 1, acc));
    return acc;
  }
  if (typeof node !== 'object') return acc;
  const own = personName(node);
  if (own) acc.push(own);
  if (node.chatName) acc.push(String(node.chatName));
  for (const key of ['contacts', 'users', 'members', 'participants']) {
    if (node[key]) namesFromGroup(node[key], depth + 1, acc);
  }
  return acc;
}

function chatTitle(chat) {
  const id = asId(chat.id ?? chat.chatId);
  if (id === '0') return 'Избранное';
  const direct =
    chat.title ||
    chat.name ||
    chat.chatTitle ||
    (chat.participants && chat.participants.chatName);
  if (direct) return String(direct);
  const names = [...new Set(namesFromGroup(chat.participants || chat.members))];
  if (names.length) return names.slice(0, 3).join(', ');
  return id ? `Чат ${id}` : 'Чат';
}

function chatsFromPayload(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.chats)) return payload.chats;
  if (payload.chat) return [payload.chat];
  return [];
}

function serializeChat(chat) {
  const id = asId(chat.id ?? chat.chatId);
  const preview = String(lastMessagePreview(chat)).replace(/\s+/g, ' ').trim();
  return jsonSafe({
    id,
    title: chatTitle(chat),
    type: chat.type || chat.chatType || chat.status || '',
    unread: Number(chat.unread || chat.unreadCount || chat.newMessages || 0) || 0,
    muted: Boolean(chat.muted || chat.isMuted),
    preview: preview.slice(0, 140),
    timestamp: chat.lastUpdate || chat.modified || chat.timestamp || lastTimestamp(chat) || 0
  });
}

function lastTimestamp(chat) {
  const last = chat.lastMessage || chat.last_message;
  return last && (last.timestamp || last.time) ? last.timestamp || last.time : 0;
}

function serializeMessage(message, myId) {
  if (!message || typeof message !== 'object') {
    return {
      id: null,
      chatId: null,
      text: '',
      senderId: null,
      senderName: 'User',
      mine: false,
      timestamp: Date.now(),
      isEdited: false,
      attachments: []
    };
  }
  const attachments = Array.isArray(message.attachments)
    ? message.attachments
    : Array.isArray(message.attaches)
      ? message.attaches
      : [];
  return jsonSafe({
    id: asId(message.id),
    chatId: asId(message.chatId),
    text: message.text || '',
    senderId: asId(message.senderId),
    senderName: typeof message.getSenderName === 'function' ? message.getSenderName() : 'User',
    mine: myId != null && asId(message.senderId) === asId(myId),
    timestamp: Number(message.timestamp) || Date.now(),
    isEdited: Boolean(message.isEdited),
    attachments: attachments.map((att, index) => ({
      index,
      type: String(att._type || att.type || '').toUpperCase(),
      name: att.name || att.fileName || att.filename || '',
      url: att.baseUrl || att.url || null
    }))
  });
}

function serializeDevice(device) {
  return jsonSafe({
    time: device.time ?? null,
    client: device.client || '',
    info: device.info || '',
    location: device.location || '',
    current: Boolean(device.current)
  });
}

function collectChats(client) {
  const fromSync =
    (client.lastSyncPayload && (client.lastSyncPayload.chats || client.lastSyncPayload.chatList)) ||
    [];
  return Array.isArray(fromSync) ? fromSync : [];
}

module.exports = {
  jsonSafe,
  asId,
  profileOf,
  serializeChat,
  serializeMessage,
  serializeDevice,
  collectChats,
  chatsFromPayload
};
