'use strict';
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } } };

  // Показать пароль
  $$('[data-toggle-password]').forEach((b) => b.addEventListener('click', () => {
    const i = b.parentElement.querySelector('input');
    const show = i.type === 'password'; i.type = show ? 'text' : 'password';
    b.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
  }));

  // Тост исчезает сам
  const toast = $('.toast'); if (toast) setTimeout(() => { toast.style.transition = 'opacity .3s'; toast.style.opacity = '0'; setTimeout(() => toast.remove(), 400); }, 5000);

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
  if (auto) auto.addEventListener('change', async () => {
    const body = {}; $$('input[type=checkbox]', auto).forEach((c) => { body[c.name] = c.checked ? '1' : '0'; });
    const r = await fetch(auto.action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const s = $('[data-saved]', auto); if (r.ok && s) { s.hidden = false; setTimeout(() => { s.hidden = true; }, 1500); }
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

  // Помощник
  const form = $('#ask');
  if (form) {
    const chat = $('#chat'); const input = $('#q'); const history = [];
    const add = (cls, text) => { const d = document.createElement('div'); d.className = 'msg ' + cls; d.textContent = text; chat.appendChild(d); d.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return d; };
    const ask = async (q) => {
      q = q.trim(); if (!q) return;
      const sg = $('#suggest'); if (sg) sg.hidden = true;
      const me = add('me', q); input.value = '';
      const wait = add('bot', 'Думаю…');
      try {
        const r = await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: q, history }) });
        const j = await r.json();
        wait.textContent = j.text || 'Не получилось ответить.';
        if (j.actions && j.actions.length) {
          const box = document.createElement('div'); box.className = 'actions';
          j.actions.forEach((a) => { const l = document.createElement('a'); l.className = 'btn small'; l.href = a.href; l.textContent = a.label; box.appendChild(l); });
          wait.appendChild(box);
        }
        const src = document.createElement('span'); src.className = 'src'; src.textContent = j.source === 'gigachat' ? 'Ответ GigaChat по данным кабинета' : j.source === 'calc' ? 'Расчёт по данным кабинета' : 'Ответ по правилам кабинета'; wait.appendChild(src);
        history.push({ role: 'user', content: q }, { role: 'assistant', content: j.text || '' });
        wait.scrollIntoView({ block: 'start', behavior: 'smooth' }); // начало ответа — в видимой зоне, не под панелью ввода
      } catch {
        wait.textContent = 'Нет связи. Вопрос сохранён — проверь интернет и нажми «Повторить».';
        const box = document.createElement('div'); box.className = 'actions';
        const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn small'; btn.textContent = 'Повторить';
        btn.addEventListener('click', () => { me.remove(); wait.remove(); ask(q); });
        box.appendChild(btn); wait.appendChild(box);
      }
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); ask(input.value); });
    $$('#suggest [data-q]').forEach((b) => b.addEventListener('click', () => ask(b.dataset.q)));
    if (input.value) ask(input.value);
  }
})();
