'use strict';
const { html, raw } = require('./html');

const ICON = {
  today: ['<circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/><path d="M3 12h5.5M15.5 12H21"/>',
    '<circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none"/><path d="M2.5 12h5M16.5 12h5" stroke-width="2.4"/>'],
  study: ['<path d="M4 5h16v14H4z"/><path d="M4 9h16M9 5v14"/>',
    '<path d="M4 5h16v14H4z" fill="currentColor"/><path d="M4 9h16M9 9v10" stroke="#fff"/>'],
  requests: ['<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
    '<path d="M7 3h7l5 5v13H7z" fill="currentColor"/><path d="M10 13h6M10 17h6" stroke="#fff"/>'],
  me: ['<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    '<circle cx="12" cy="8" r="4" fill="currentColor"/><path d="M4 21a8 8 0 0 1 16 0z" fill="currentColor"/>'],
};
const svg = (inner, size = 24, extra = '') => raw(`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${inner}</svg>`);
const I = {
  helper: svg('<path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-9l-5 3v-3H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M8 9h8M8 13h5"/>', 22),
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', 22),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 22),
  bell: svg('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>', 22),
  back: svg('<path d="M15 18l-6-6 6-6"/>', 22, 'stroke-width="2"'),
  chev: svg('<path d="M9 6l6 6-6 6"/>', 18, 'class="chev" stroke-width="2"'),
  file: svg('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>', 18),
  send: svg('<path d="M5 12h14M13 6l6 6-6 6"/>', 22, 'stroke-width="2.2"'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', 18),
  check: raw('<svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="28" fill="#E7F6EC"/><path d="M17 29l7 7 15-16" fill="none" stroke="#15803D" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>'),
  logoSm: raw('<svg width="30" height="30" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="12" fill="#4A6FA5"/><path d="M7 20h8M25 20h8" stroke="#C9D7EA" stroke-width="2.6" stroke-linecap="round"/><circle cx="20" cy="20" r="5" fill="#fff"/></svg>'),
  logo: raw('<svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="12" fill="#4A6FA5"/><path d="M7 20h8M25 20h8" stroke="#C9D7EA" stroke-width="2.4" stroke-linecap="round"/><circle cx="20" cy="20" r="5" fill="#fff"/></svg>'),
};

function head(title, cabinet = 'Личный кабинет студента') {
  return html`<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#F5F7FA">
<title>${title} · ДГТУ.Сейчас · ${cabinet}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/app.css?v=20">
</head>`;
}

function tabbar(active, badge) {
  const tabs = [['today', '/', 'Сегодня'], ['study', '/study', 'Учёба'], ['requests', '/requests', 'Заявки'], ['me', '/me', 'Профиль']];
  return html`<nav class="tabbar" aria-label="Основное меню"><div class="in">${tabs.map(([k, href, label]) => html`
<a href="${href}" ${active === k ? raw('aria-current="page"') : ''}><span class="ico">${svg(ICON[k][active === k ? 1 : 0])}${k === 'requests' && badge ? html`<span class="badge"></span><span class="sr-only">Требуется действие. </span>` : ''}</span>${label}</a>`)}
</div></nav>`;
}

// Страница мобильного кабинета студента
function page({ title, active, ctx, body, noNav = false, scripts = '' }) {
  const flash = ctx && ctx.flash;
  return html`${head(title)}<body class="${noNav ? 'standalone-view' : 'student-view'}">
<a class="skip-link" href="#main-content">К содержимому</a>
${!noNav && ctx && ctx.user ? '' : html`<div class="demo-strip">Концепт для конкурса · не официальный сервис ДГТУ · данные синтетические</div>`}
${!noNav && ctx && ctx.user ? html`<header class="appbar"><a class="brand" href="/" aria-label="ДГТУ.Сейчас, на главную">${I.logoSm}<span>ДГТУ.Сейчас</span></a><span class="demo-badge" title="Концепт для конкурса, не официальный сервис ДГТУ, данные синтетические">Демо</span>
<div class="ab-act"><a class="icon-btn" href="/a11y" aria-label="Версия для слабовидящих: включить или выключить">${I.eye}<span class="desktop-label">Доступность</span></a><a class="icon-btn" href="/find" aria-label="Найти раздел в кабинете">${I.search}<span class="desktop-label">Поиск</span></a>
<a class="icon-btn" href="/notifications" aria-label="Уведомления${ctx.unread ? `, новых: ${ctx.unread}` : ''}">${I.bell}<span class="desktop-label">Уведомления</span>${ctx.unread ? html`<span class="dot"></span>` : ''}</a></div></header>` : ''}
<div class="student-workspace">
${noNav ? '' : tabbar(active, ctx && ctx.needsAction)}
<main id="main-content" class="app ${noNav ? 'no-nav' : ''} route-${active || 'other'}" tabindex="-1">
${flash ? html`<div class="toast" role="status">${flash.text}${flash.link ? html`<a href="${flash.link}">${flash.linkText || 'Открыть'}</a>` : ''}</div>` : ''}
${body}
</main></div>
<script src="/app.js?v=20" defer></script>${scripts}
</body></html>`;
}

function demoSwitcher(ctx) {
  const users = ctx.demoUsers || [];
  if (!users.some((u) => u.id === ctx.user?.id)) return '';
  return html`<nav class="demo-switcher" aria-label="Переключение демо-аккаунта">
<div class="demo-switch-title">Демо-аккаунты</div><p class="small muted">Выбери демо-аккаунт для просмотра. При переключении заявки не сбрасываются: справку, заказанную за Илью, можно сразу открыть у сотрудника деканата.</p>
<form method="post" action="/demo/switch" class="demo-accounts">${users.map((u) => html`<button class="demo-account" type="submit" name="login" value="${u.login}" ${u.id === ctx.user.id ? raw('disabled aria-current="true"') : ''}>
<span class="demo-account-name">${u.role === 'staff' ? 'Сотрудник деканата' : u.short_name}</span><span class="small muted">${u.role === 'staff' ? u.short_name : u.demo_note}</span><span class="demo-account-state">${u.id === ctx.user.id ? 'Сейчас открыт' : 'Переключиться'}</span></button>`)}</form></nav>`;
}

function backBar(href, label) {
  return html`<div class="back"><a href="${href}" aria-label="${label === 'Назад' ? 'Назад' : `Назад: ${label}`}">${I.back}<span>${label}</span></a></div>`;
}

// Понятная страница ошибки в стиле кабинета: что случилось и куда идти дальше
const ERR_ICON = raw('<svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="28" fill="#EDF2F8"/><path d="M28 17v14" stroke="#36557F" stroke-width="4" stroke-linecap="round"/><circle cx="28" cy="39" r="2.6" fill="#36557F"/></svg>');
function errorPage({ ctx, title, text, links = [] }) {
  const user = ctx && ctx.user;
  const isStudent = user && user.role === 'student';
  const home = !user ? ['/login', 'Войти'] : user.role === 'staff' ? ['/staff', 'К заявкам'] : ['/', 'На главную'];
  const all = [...links, home];
  return page({
    title, active: null, ctx, noNav: !isStudent,
    body: html`<div class="errpage"><div>${ERR_ICON}</div><h1>${title}</h1><p class="muted">${text}</p>
<div class="actions" style="justify-content:center">${all.map(([href, label], i) => html`<a class="btn ${i === 0 ? '' : 'secondary'} small" href="${href}">${label}</a>`)}</div></div>`,
  });
}

module.exports = { head, page, tabbar, backBar, errorPage, demoSwitcher, I, svg };
