'use strict';
const { html, raw } = require('./html');
const { head, I } = require('./layout');
const { DEMO_PASSWORD } = require('../seed');

function shell(title, body) {
  return html`${head(title)}<body><div class="app no-nav">
<div class="demo-strip">Концепт для конкурса · не официальный сервис ДГТУ · данные вымышленные</div>
<div style="padding:32px 20px 0;display:flex;flex-direction:column;gap:18px">
<div style="display:flex;align-items:center;gap:12px">${I.logo}<div><div style="font-size:22px;font-weight:700">ДГТУ.Сейчас</div><div class="small muted">Концепт для конкурса · не официальный сервис ДГТУ</div></div></div>
${body}</div></div><script src="/app.js?v=1" defer></script></body></html>`;
}

function login({ error, loginValue, demo }) {
  return shell('Вход', html`<h1>Вход в кабинет</h1>
<form method="post" action="/login" novalidate>
<label class="field ${error ? 'error' : ''}" style="margin-top:0">Логин<input type="text" name="login" autocomplete="username" autocapitalize="none" spellcheck="false" value="${loginValue || ''}" required></label>
<label class="field ${error ? 'error' : ''}">Пароль
<span style="position:relative;display:block"><input type="password" name="password" autocomplete="current-password" required style="padding-right:56px" ${error ? raw('aria-describedby="login-err"') : ''}>
<button type="button" class="icon-btn" data-toggle-password aria-label="Показать пароль" style="position:absolute;right:4px;top:4px"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#5B6577" stroke-width="1.8" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></button></span></label>
${error ? html`<div class="err" role="alert" id="login-err">${error}</div>` : ''}
<button class="btn block" type="submit" style="margin-top:18px">Войти</button>
<div style="text-align:center"><a class="link" href="/forgot">Забыли пароль?</a></div>
</form>
<section aria-labelledby="demo-h" style="margin-top:8px">
<h2 class="label" id="demo-h">Демо-доступ для жюри</h2>
${demo.map((u) => html`<form method="post" action="/login/demo"><input type="hidden" name="login" value="${u.login}">
<button class="row" style="width:100%;background:none;border:0;border-bottom:1px solid var(--line);cursor:pointer;text-align:left">
<span class="body"><span class="title strong">${u.role === 'staff' ? 'Сотрудник деканата' : u.short_name}</span><span class="meta">${u.demo_note} · логин <b>${u.login}</b></span></span>${I.chev}</button></form>`)}
<p class="small muted">Пароль всех демо-аккаунтов: <b>${DEMO_PASSWORD}</b>. Кабинет сотрудника удобнее смотреть с компьютера.</p>
</section>`);
}

function forgot() {
  return shell('Восстановление доступа', html`<h1>Восстановление доступа</h1>
<p>В рабочей версии пароль восстанавливается через единую учётную запись вуза: ссылка придёт на почту, указанную в личном деле, или пароль сбросят в деканате по студенческому билету.</p>
<div class="note">В демо-версии письма не отправляются. Войдите через демо-доступ на странице входа.</div>
<a class="btn block" href="/login">Вернуться ко входу</a>`);
}

module.exports = { login, forgot };
