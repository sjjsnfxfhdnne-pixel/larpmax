const $ = (id) => document.getElementById(id);

const state = {
  phase: "idle",
  me: null,
  chats: [],
  activeChat: null,
  messages: [],
  source: null
};

async function api(path, options = {}) {
  const headers = Object.assign({ Accept: "application/json" }, options.headers || {});
  if (options.body && !(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers,
    body:
      options.body && !(options.body instanceof FormData) && typeof options.body !== "string"
        ? JSON.stringify(options.body)
        : options.body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `Ошибка ${res.status}`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

function show(view) {
  $("view-gate").hidden = view !== "gate";
  $("view-login").hidden = view !== "login";
  $("view-desk").hidden = view !== "desk";
}

function setError(id, message) {
  const el = $(id);
  if (!message) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = message;
}

function toast(text) {
  const el = $("toast");
  el.hidden = false;
  el.textContent = text;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    el.hidden = true;
  }, 5000);
}

function formatTime(ts) {
  if (!ts) return "";
  const date = new Date(Number(ts));
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ru-RU", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
}

function closeDrawer() {
  $("drawer").hidden = true;
  $("drawer-body").replaceChildren();
}

function openDrawer(title, build) {
  $("drawer-title").textContent = title;
  $("drawer-body").replaceChildren();
  build($("drawer-body"));
  $("drawer").hidden = false;
}

function applySnapshot(snap) {
  state.phase = snap.phase;
  state.me = snap.me;
  $("resume-btn").hidden = !snap.sessionExists;
  if (snap.qr && snap.qr.image) {
    $("qr-placeholder").hidden = true;
    $("qr-image").hidden = false;
    $("qr-image").src = snap.qr.image;
    const left = Math.max(0, Math.round((snap.qr.expiresAt - Date.now()) / 1000));
    $("qr-meta").textContent = left ? `Код живёт ещё ${left} с` : "QR готов";
  }
  if (snap.sms) {
    $("sms-phone").value = snap.sms.phone || $("sms-phone").value;
    $("sms-hint").textContent = snap.sms.needsPassword
      ? `Max просит пароль 2FA${snap.sms.hint ? `: ${snap.sms.hint}` : ""}`
      : snap.sms.phone
        ? `Код отправлен на ${snap.sms.phone}`
        : "";
  }
  if (snap.me) {
    $("me-name").textContent = snap.me.fullname;
    $("me-phone").textContent = snap.me.phone ? `+${snap.me.phone}` : snap.me.id;
  }
  if (snap.phase === "ready") {
    show("desk");
    loadChats();
  } else {
    show("login");
  }
}

function renderChats() {
  const q = $("chat-search").value.trim().toLowerCase();
  const list = $("chat-list");
  list.replaceChildren();
  state.chats
    .filter((chat) => !q || `${chat.title} ${chat.preview}`.toLowerCase().includes(q))
    .forEach((chat) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chat-item" + (state.activeChat === chat.id ? " active" : "");
      const title = document.createElement("div");
      title.className = "chat-title";
      const name = document.createElement("span");
      name.textContent = chat.title;
      title.appendChild(name);
      if (chat.unread) {
        const unread = document.createElement("span");
        unread.className = "unread";
        unread.textContent = String(chat.unread);
        title.appendChild(unread);
      }
      const preview = document.createElement("div");
      preview.className = "preview";
      preview.textContent = chat.preview || "Нет текста";
      btn.append(title, preview);
      btn.addEventListener("click", () => openChat(chat.id, chat.title));
      list.appendChild(btn);
    });
}

function renderMessages() {
  const box = $("messages");
  box.replaceChildren();
  state.messages.forEach((message) => {
    const art = document.createElement("article");
    art.className = "bubble" + (message.mine ? " mine" : "");
    const head = document.createElement("header");
    const who = document.createElement("span");
    who.textContent = message.mine ? "Вы" : message.senderName;
    const when = document.createElement("span");
    when.textContent = formatTime(message.timestamp);
    head.append(who, when);
    const text = document.createElement("p");
    text.textContent = message.text || (message.attachments.length ? "" : "—");
    art.append(head, text);
    message.attachments.forEach((att) => {
      const a = document.createElement("a");
      a.className = "attach";
      a.textContent = att.name || att.type || "файл";
      a.href = `/api/media/${encodeURIComponent(message.chatId)}/${encodeURIComponent(message.id)}/${att.index}`;
      a.addEventListener("click", async (event) => {
        event.preventDefault();
        try {
          const file = await api(a.href);
          window.open(file.url, "_blank", "noopener");
        } catch (error) {
          toast(error.message);
        }
      });
      art.appendChild(a);
    });
    if (message.mine) {
      const actions = document.createElement("div");
      actions.className = "bubble-actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "ghost";
      edit.textContent = "Править";
      edit.addEventListener("click", () => editMessage(message));
      const del = document.createElement("button");
      del.type = "button";
      del.className = "ghost";
      del.textContent = "Удалить";
      del.addEventListener("click", () => deleteMessage(message));
      actions.append(edit, del);
      art.appendChild(actions);
    }
    box.appendChild(art);
  });
  box.scrollTop = box.scrollHeight;
}

async function loadChats() {
  state.chats = await api("/api/chats");
  state.chats.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  renderChats();
}

async function openChat(id, title) {
  state.activeChat = id;
  $("thread-title").textContent = title || "Чат";
  renderChats();
  const history = await api(`/api/chats/${encodeURIComponent(id)}/history`);
  state.messages = history.sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
  renderMessages();
}

async function editMessage(message) {
  const next = window.prompt("Новый текст", message.text || "");
  if (next == null) return;
  await api(`/api/chats/${encodeURIComponent(message.chatId)}/messages/${encodeURIComponent(message.id)}/edit`, {
    method: "POST",
    body: { text: next }
  });
  message.text = next;
  message.isEdited = true;
  renderMessages();
}

async function deleteMessage(message) {
  if (!window.confirm("Удалить это сообщение?")) return;
  await api(`/api/chats/${encodeURIComponent(message.chatId)}/messages/${encodeURIComponent(message.id)}`, {
    method: "DELETE"
  });
  state.messages = state.messages.filter((item) => item.id !== message.id);
  renderMessages();
}

function listenEvents() {
  if (state.source) state.source.close();
  state.source = new EventSource("/api/events");
  state.source.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    if (data.type === "ready") {
      applySnapshot({ phase: "ready", me: data.me, sessionExists: true });
    }
    if (data.type === "qr") {
      applySnapshot({
        phase: "qr",
        sessionExists: $("resume-btn").hidden === false,
        qr: data
      });
    }
    if (data.type === "qr_scanned") toast("QR прочитан, завершаем вход");
    if (data.type === "signed_out") {
      state.me = null;
      state.activeChat = null;
      show("login");
    }
    if (data.type === "message") {
      const msg = data.message;
      const chat = state.chats.find((item) => item.id === msg.chatId);
      if (chat) {
        chat.preview = msg.text || chat.preview;
        chat.timestamp = msg.timestamp;
        if (state.activeChat !== msg.chatId && !msg.mine) chat.unread = (chat.unread || 0) + 1;
        renderChats();
      } else {
        loadChats().catch(() => {});
      }
      if (state.activeChat === msg.chatId) {
        state.messages.push(msg);
        renderMessages();
      }
    }
    if (data.type === "message_removed" && state.activeChat === data.chatId) {
      state.messages = state.messages.filter((item) => item.id !== data.messageId);
      renderMessages();
    }
    if (data.type === "incoming_call") {
      toast("Входящий звонок");
      if (data.conversationId && window.confirm("Сбросить входящий звонок?")) {
        api("/api/calls/reject", { method: "POST", body: { conversationId: data.conversationId } }).catch((error) =>
          toast(error.message)
        );
      }
    }
    if (data.type === "error") toast(data.error);
  };
}

async function boot() {
  try {
    const snap = await api("/api/state");
    listenEvents();
    applySnapshot(snap);
  } catch (error) {
    if (error.status === 401) show("gate");
    else setError("gate-error", error.message);
  }
}

$("gate-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  setError("gate-error");
  try {
    await api("/api/unlock", { method: "POST", body: { password: $("gate-password").value } });
    listenEvents();
    applySnapshot(await api("/api/state"));
  } catch (error) {
    setError("gate-error", error.message);
  }
});

$("qr-btn").addEventListener("click", async () => {
  setError("login-error");
  $("qr-btn").disabled = true;
  try {
    applySnapshot(await api("/api/login/qr", { method: "POST" }));
  } catch (error) {
    setError("login-error", error.message);
  } finally {
    $("qr-btn").disabled = false;
  }
});

$("resume-btn").addEventListener("click", async () => {
  setError("login-error");
  try {
    applySnapshot(await api("/api/login/resume", { method: "POST" }));
  } catch (error) {
    setError("login-error", error.message);
  }
});

$("sms-request").addEventListener("click", async () => {
  setError("login-error");
  try {
    applySnapshot(await api("/api/login/sms", { method: "POST", body: { phone: $("sms-phone").value } }));
  } catch (error) {
    setError("login-error", error.message);
  }
});

$("sms-submit").addEventListener("click", async () => {
  setError("login-error");
  try {
    const snap = await api("/api/state");
    if (snap.phase === "sms_2fa" || $("sms-2fa").value) {
      applySnapshot(
        await api("/api/login/sms/password", { method: "POST", body: { password: $("sms-2fa").value } })
      );
    } else {
      applySnapshot(await api("/api/login/sms/code", { method: "POST", body: { code: $("sms-code").value } }));
    }
  } catch (error) {
    setError("login-error", error.message);
  }
});

$("chat-search").addEventListener("input", renderChats);

$("composer").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.activeChat) return toast("Сначала откройте чат");
  const text = $("composer-text").value.trim();
  if (!text) return;
  $("composer-text").value = "";
  try {
    const message = await api(`/api/chats/${encodeURIComponent(state.activeChat)}/messages`, {
      method: "POST",
      body: { text }
    });
    state.messages.push(message);
    renderMessages();
  } catch (error) {
    toast(error.message);
  }
});

$("photo-btn").addEventListener("click", () => {
  if (!state.activeChat) return toast("Сначала откройте чат");
  $("photo-input").click();
});

$("photo-input").addEventListener("change", async () => {
  const file = $("photo-input").files[0];
  $("photo-input").value = "";
  if (!file || !state.activeChat) return;
  const body = new FormData();
  body.append("photo", file);
  try {
    const message = await api(`/api/chats/${encodeURIComponent(state.activeChat)}/photo`, {
      method: "POST",
      body
    });
    state.messages.push(message);
    renderMessages();
  } catch (error) {
    toast(error.message);
  }
});

$("composer-text").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("composer").requestSubmit();
  }
});

$("drawer-close").addEventListener("click", closeDrawer);
$("drawer").addEventListener("click", (event) => {
  if (event.target.id === "drawer") closeDrawer();
});

$("devices-btn").addEventListener("click", async () => {
  try {
    const devices = await api("/api/devices");
    openDrawer("Устройства", (root) => {
      devices.forEach((device) => {
        const row = document.createElement("div");
        row.className = "device" + (device.current ? " current" : "");
        const title = document.createElement("strong");
        title.textContent = device.client || "устройство";
        const meta = document.createElement("p");
        meta.className = "hint";
        meta.textContent = [device.info, device.location, device.current ? "этот пульт" : ""]
          .filter(Boolean)
          .join(" · ");
        row.append(title, meta);
        root.appendChild(row);
      });
      const closeOthers = document.createElement("button");
      closeOthers.type = "button";
      closeOthers.textContent = "Завершить другие сеансы";
      closeOthers.addEventListener("click", async () => {
        if (!window.confirm("Закрыть все чужие устройства Max?")) return;
        try {
          await api("/api/devices/close-others", { method: "POST" });
          closeDrawer();
          toast("Другие сеансы закрыты");
        } catch (error) {
          toast(error.message);
        }
      });
      const disconnect = document.createElement("button");
      disconnect.type = "button";
      disconnect.className = "ghost";
      disconnect.textContent = "Отключить пульт, сессию оставить";
      disconnect.addEventListener("click", async () => {
        await api("/api/disconnect", { method: "POST" });
        closeDrawer();
      });
      const wipe = document.createElement("button");
      wipe.type = "button";
      wipe.className = "ghost";
      wipe.textContent = "Удалить сессию с диска";
      wipe.addEventListener("click", async () => {
        if (!window.confirm("Удалить sessions файл? Потом снова QR или SMS.")) return;
        await api("/api/logout", { method: "POST" });
        closeDrawer();
      });
      root.append(closeOthers, disconnect, wipe);
    });
  } catch (error) {
    toast(error.message);
  }
});

$("profile-btn").addEventListener("click", () => {
  const me = state.me || {};
  openDrawer("Профиль", (root) => {
    const form = document.createElement("form");
    const fields = [
      ["firstName", "Имя", me.firstname || ""],
      ["lastName", "Фамилия", me.lastname || ""],
      ["description", "О себе", me.bio || ""]
    ];
    const inputs = {};
    fields.forEach(([key, label, value]) => {
      const lab = document.createElement("label");
      lab.textContent = label;
      const input = document.createElement("input");
      input.value = value;
      inputs[key] = input;
      form.append(lab, input);
    });
    const save = document.createElement("button");
    save.type = "submit";
    save.textContent = "Сохранить";
    form.appendChild(save);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        state.me = await api("/api/profile", {
          method: "POST",
          body: {
            firstName: inputs.firstName.value,
            lastName: inputs.lastName.value,
            description: inputs.description.value
          }
        });
        $("me-name").textContent = state.me.fullname;
        closeDrawer();
        toast("Профиль обновлён");
      } catch (error) {
        toast(error.message);
      }
    });
    root.appendChild(form);
  });
});

boot();
