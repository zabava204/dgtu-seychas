'use strict';
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } } };

  // Выбор вида задач хранится только в этом браузере и отдельно для каждого аккаунта.
  $$('details[data-disclosure]').forEach((panel) => {
    const key = 'dgtu_' + panel.dataset.disclosure;
    const saved = store.get(key);
    if (saved === 'closed') panel.open = false;
    panel.addEventListener('toggle', () => store.set(key, panel.open ? 'open' : 'closed'));
  });

  // Показать пароль
  $$('[data-toggle-password]').forEach((b) => b.addEventListener('click', () => {
    const i = b.parentElement.querySelector('input');
    const show = i.type === 'password'; i.type = show ? 'text' : 'password';
    b.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
  }));

  // Результат действия остаётся доступен, пока студент его не закроет.
  const toast = $('.toast');
  if (toast) {
    const close = document.createElement('button'); close.type = 'button'; close.className = 'toast-close'; close.textContent = 'Закрыть';
    close.addEventListener('click', () => toast.remove()); toast.appendChild(close);
  }

  // Строки таблицы деканата — целиком кликабельны
  $$('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a')) location.href = tr.dataset.href; }));
  // Защита от двойной отправки — только для настоящей отправки формы (чат помощника отправляет сам и не блокируется)
  $$('form').forEach((f) => f.addEventListener('submit', (e) => { if (f.dataset.askPermission !== undefined || f.dataset.confirm || f.id === 'ask') return; setTimeout(() => { if (e.defaultPrevented) return; f.querySelectorAll('button[type=submit], button:not([type])').forEach((b) => { b.disabled = true; }); }, 0); }));
  $$('form[data-confirm]').forEach((f) => f.addEventListener('submit', (e) => { if (!window.confirm(f.dataset.confirm)) e.preventDefault(); }));

  // Выбор файла: показываем имя выбранного файла
  $$('.filepick input[type=file]').forEach((i) => i.addEventListener('change', () => {
    const n = i.parentElement.querySelector('[data-fname]'); if (!n) return;
    const f = i.files && i.files[0]; n.textContent = f ? f.name : 'Файл не выбран'; n.classList.toggle('has', !!f);
  }));

  // Настройки уведомлений сохраняются сразу
  const auto = $('form[data-autosave]');
  if (auto) {
    const status = $('[data-saved]', auto), retry = $('[data-save-retry]', auto), feedback = $('.save-feedback', auto);
    let revision = 0, saving = false;
    const state = (name, text) => { feedback.dataset.state = name; status.textContent = text; retry.hidden = name !== 'error'; };
    const save = async () => {
      if (saving) return;
      saving = true;
      try {
        let sent;
        do {
          sent = revision;
          state('saving', 'Сохраняем…');
          const body = {}; $$('input[type=checkbox]', auto).forEach((c) => { body[c.name] = c.checked ? '1' : '0'; });
          const r = await fetch(auto.action, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
          if (!r.ok || r.redirected) throw new Error('save');
        } while (sent !== revision);
        state('saved', 'Настройки сохранены');
      } catch { state('error', 'Не удалось сохранить. Проверь подключение и повтори.'); }
      finally { saving = false; }
    };
    auto.addEventListener('change', () => { revision++; save(); });
    retry.addEventListener('click', save);
  }

  // Отправляются только выбранные документы; пустую заявку создать нельзя.
  $$('form[data-document-order]').forEach((f) => {
    const button = $('button[type=submit]', f);
    if (!button) return;
    const update = () => { button.disabled = !$$('input[name=items]:checked:not(:disabled)', f).length; };
    f.addEventListener('change', update); update();
  });

  // Разрешение на уведомления браузера — только в контексте (после отправки заявки или в настройках)
  const askPermission = async () => { if (!('Notification' in window)) return 'unsupported'; if (Notification.permission !== 'default') return Notification.permission; try { return await Notification.requestPermission(); } catch { return 'denied'; } };
  $$('form[data-ask-permission]').forEach((f) => f.addEventListener('submit', async (e) => {
    if (f.dataset.done) return; e.preventDefault(); await askPermission(); f.dataset.done = '1'; f.submit();
  }));
  const permState = $('[data-perm-state]');
  const showPerm = () => { if (!permState) return; const p = 'Notification' in window ? Notification.permission : 'unsupported'; permState.textContent = { granted: 'Разрешено на этом устройстве.', denied: 'Запрещено в настройках браузера.', default: '', unsupported: 'Этот браузер не поддерживает уведомления.' }[p]; };
  showPerm();
  $$('[data-ask-permission-btn]').forEach((b) => b.addEventListener('click', async () => { await askPermission(); showPerm(); }));

  // Пока кабинет открыт — проверяем новые уведомления раз в 30 секунд
  if ($('.tabbar') && 'Notification' in window && Notification.permission === 'granted') {
    const poll = async () => {
      try {
        const since = Number(store.get('dgtu_last') || 0);
        const r = await fetch('/api/poll?since=' + since); if (!r.ok) return;
        const j = await r.json();
        if (since) j.items.forEach((n) => { const x = new Notification(n.title, { body: n.body, tag: 'dgtu-' + n.id }); x.onclick = () => { window.focus(); if (n.link) location.href = n.link; }; });
        store.set('dgtu_last', String(j.last));
      } catch { /* сеть */ }
    };
    poll(); setInterval(poll, 30000);
  }

  // Черновик письма преподавателю: копирование, без отправки
  $$('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const el = $(b.dataset.copy);
    const text = el ? (el.value || el.textContent || '') : '';
    const done = b.textContent;
    try { await navigator.clipboard.writeText(text); b.textContent = 'Скопировано'; }
    catch { if (el && el.select) el.select(); b.textContent = 'Выдели текст и скопируй'; }
    setTimeout(() => { b.textContent = done; }, 2000);
  }));

  // Лупа: фильтр разделов кабинета (не чат)
  const findQ = $('#find-q');
  if (findQ) {
    const rows = $$('#find-list .find-row');
    const empty = $('#find-empty');
    const apply = () => {
      const q = findQ.value.trim().toLowerCase().replace(/ё/g, 'е');
      let n = 0;
      rows.forEach((r) => {
        const ok = !q || (r.dataset.keys || '').toLowerCase().replace(/ё/g, 'е').includes(q) || q.split(/\s+/).every((w) => (r.dataset.keys || '').toLowerCase().replace(/ё/g, 'е').includes(w));
        r.hidden = !ok; if (ok) n++;
      });
      if (empty) empty.hidden = n > 0;
    };
    findQ.addEventListener('input', apply);
    apply();
  }

  // Помощник
  const form = $('#ask');
  if (form) {
    const chat = $('#chat'); const input = $('#q'); const history = []; let pending = false;
    const add = (cls, text) => { const d = document.createElement('div'); d.className = 'msg ' + cls; d.textContent = text; chat.appendChild(d); d.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return d; };
    const ask = async (q) => {
      q = q.trim(); if (!q || pending) return;
      pending = true; const send = $('button[type=submit]', form); send.disabled = true; form.setAttribute('aria-busy', 'true');
      const sg = $('#suggest'); if (sg) sg.hidden = true;
      const me = add('me', q); input.value = '';
      const wait = add('bot', 'Готовлю ответ…');
      try {
        const r = await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: q, history }) });
        if (!r.ok) throw new Error('assistant');
        const j = await r.json();
        wait.textContent = j.text || 'Не получилось ответить.';
        if (j.actions && j.actions.length) {
          const box = document.createElement('div'); box.className = 'actions';
          j.actions.forEach((a) => { const l = document.createElement('a'); l.className = 'btn small'; l.href = a.href; l.textContent = a.label; box.appendChild(l); });
          wait.appendChild(box);
        }
        const src = document.createElement('span'); src.className = 'src'; const en = j.lang === 'en'; src.textContent = j.source === 'gigachat' ? (en ? 'GigaChat answer based on cabinet data' : 'Ответ GigaChat с учётом справки кабинета') : j.source === 'calc' ? (en ? 'Calculated from your cabinet data' : 'Расчёт по данным кабинета') : (en ? 'Answer by cabinet rules' : 'Ответ по правилам кабинета'); wait.appendChild(src);
        history.push({ role: 'user', content: q }, { role: 'assistant', content: j.text || '' });
        wait.scrollIntoView({ block: 'start', behavior: 'smooth' }); // начало ответа — в видимой зоне, не под панелью ввода
      } catch {
        wait.textContent = 'Не удалось получить ответ. Проверь подключение и нажми «Повторить».';
        const box = document.createElement('div'); box.className = 'actions';
        const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn small'; btn.textContent = 'Повторить';
        btn.addEventListener('click', () => { if (pending) return; me.remove(); wait.remove(); ask(q); });
        box.appendChild(btn); wait.appendChild(box);
      } finally { pending = false; send.disabled = false; form.removeAttribute('aria-busy'); }
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); ask(input.value); });
    $$('#suggest [data-q]').forEach((b) => b.addEventListener('click', () => ask(b.dataset.q)));
    if (input.value) ask(input.value);
  }
})();
