'use strict';
const { html, raw } = require('./html');
const { page, backBar, I } = require('./layout');
const T = require('../time');
const { TYPES, DOC_HELP, purposeOf, formatOf } = require('../catalog');
const { NOTIF_CATEGORIES } = require('../model');
const TAX = require('../tax');

// ---------- помощники форматирования ----------
function countdown(startsAt, endsAt) {
  const now = T.now();
  const diff = Math.round((startsAt - now) / 60000);
  if (diff <= 0 && endsAt > now) return { big: 'идёт сейчас', small: `до ${T.timeOf(endsAt)}` };
  const sameDay = T.dateKey(startsAt) === T.dateKey(now);
  if (sameDay && diff < 60) return { big: `через ${diff} мин`, small: `в ${T.timeOf(startsAt)}` };
  if (sameDay && diff < 180) return { big: `через ${Math.floor(diff / 60)} ч ${diff % 60 ? (diff % 60) + ' мин' : ''}`.trim(), small: `в ${T.timeOf(startsAt)}` };
  if (sameDay) return { big: `в ${T.timeOf(startsAt)}`, small: 'сегодня' };
  const key = T.dateKey(startsAt);
  if (key === T.addDays(T.dateKey(now), 1)) return { big: `завтра в ${T.timeOf(startsAt)}`, small: T.dayMonthKey(key) };
  return { big: `${T.wdShortKey(key).toLowerCase()}, ${T.timeOf(startsAt)}`, small: `${T.wdLongKey(key)}, ${T.dayMonthKey(key)}` };
}
const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c; };
const roomText = (p) => p.online ? 'онлайн' : p.room === 'спорткомплекс' ? 'спорткомплекс' : `ауд. ${p.room}`;
const whereText = (p) => {
  if (p.online) return 'Онлайн · ссылка появится за 15 минут';
  if (!p.room || !p.room.includes('-')) return p.room || '';
  const [b, r] = p.room.split('-');
  return `Ауд. ${p.room} · корпус ${b}, ${r[0]} этаж`;
};
const placeText = (p) => {
  if (p.online) return 'онлайн';
  if (!p.room || !p.room.includes('-')) return p.room || '';
  const [b, r] = p.room.split('-');
  return `ауд. ${p.room} · корпус ${b}, ${r[0]} этаж`;
};
const changeText = (p) => {
  if (p.old_start && p.old_room) return `Перенос: ${p.start} вместо ${p.old_start}, ауд. ${p.room} вместо ${p.old_room}`;
  if (p.old_start) return `Перенос · было ${p.old_start}`;
  if (p.old_room) return `Аудитория изменена · было ${p.old_room}`;
  return '';
};
const MON_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const daysUntil = (key) => Math.round((Date.parse(key + 'T00:00:00Z') - Date.parse(T.dateKey() + 'T00:00:00Z')) / T.DAY_MS);
const inDays = (n) => (n === 0 ? 'сегодня' : n === 1 ? 'завтра' : `через ${n} ${plural(n, 'день', 'дня', 'дней')}`);
const KIND_CAP = { зачёт: 'Зачёт', экзамен: 'Экзамен', консультация: 'Консультация' };
function admitTag(s) {
  if (s.kind === 'консультация' || s.admitted == null) return '';
  return s.admitted ? html`<span class="tag green">допуск есть</span>` : html`<span class="tag red">до допуска ${s.gap} ${plural(s.gap, 'балл', 'балла', 'баллов')}</span>`;
}
function sessionRow(s) {
  const [, mo, da] = s.date_key.split('-').map(Number);
  const cons = s.kind === 'консультация';
  return html`<div class="sess${cons ? ' cons' : ''}"><div class="sd"><b>${da}</b><span>${MON_SHORT[mo - 1]}, ${T.wdShortKey(s.date_key).toLowerCase()}</span></div>
<div class="body"><div class="title">${s.subject}</div><div class="meta">${KIND_CAP[s.kind]} · ${s.start} · ауд. ${s.room}${cons ? '' : ` · ${s.teacher}`}</div>${s.consult ? html`<div class="meta">Консультация — ${T.dayMonthKey(s.consult.date_key)}, ${s.consult.start}</div>` : ''}${admitTag(s) ? html`<div style="margin-top:6px">${admitTag(s)}</div>` : ''}</div></div>`;
}
const lbl = (pos) => (pos < 12 ? 'transform:none' : pos > 88 ? 'transform:translateX(-100%)' : '');

function dayLine(pairs, isToday, next) {
  if (!pairs.length) return '';
  const mins = pairs.map((p) => T.parseHHMM(p.start));
  const nowMin = T.minutesOfDay();
  const lo = Math.min(mins[0], isToday ? nowMin : mins[0]) - 30;
  const hi = Math.max(mins[mins.length - 1] + 30, T.parseHHMM(pairs[pairs.length - 1].end));
  const pos = (m) => Math.max(4, Math.min(96, ((m - lo) / (hi - lo)) * 100));
  const nowPos = isToday && nowMin >= lo && nowMin <= hi ? pos(nowMin) : null;
  return html`<div class="dayline" aria-hidden="true"><div class="track"></div>${nowPos != null ? html`<div class="done" style="width:${nowPos.toFixed(1)}%"></div>` : ''}
${pairs.map((p, i) => {
    const m = mins[i];
    const cls = p.id === next.id ? 'next' : isToday && T.parseHHMM(p.end) <= nowMin ? 'past' : '';
    return html`<span class="pt ${cls}" style="left:${pos(m).toFixed(1)}%"></span>${nowPos != null && Math.abs(pos(m) - nowPos) < 16 ? '' : html`<span class="t ${cls}" style="left:${pos(m).toFixed(1)}%;${raw(lbl(pos(m)))}">${p.start}</span>`}`;
  })}
${nowPos != null ? html`<span class="now" style="left:${nowPos.toFixed(1)}%"></span><span class="t is-now" style="left:${nowPos.toFixed(1)}%;${raw(lbl(nowPos))}">сейчас</span>` : ''}</div>`;
}

function lightsBar(ds) {
  return html`<span class="lights">${ds.map((d) => html`<i class="l-${d.light}"></i>`)}</span>`;
}
function gradesSummary(ds) {
  const red = ds.find((d) => d.light === 'red');
  const amber = ds.find((d) => d.light === 'amber');
  if (red) return html`<b>${red.subject}:</b> до порога не хватает ${red.gap} ${plural(red.gap, 'балла', 'баллов', 'баллов')}${red.overdue.length ? `, ${red.overdue.length} ${plural(red.overdue.length, 'работа просрочена', 'работы просрочены', 'работ просрочено')}` : ''}`;
  if (amber) return html`<b>${amber.subject}:</b> до порога не хватает ${amber.gap} ${plural(amber.gap, 'балла', 'баллов', 'баллов')}`;
  return html`<b>По всем дисциплинам порог набран</b>`;
}

// ---------- Сегодня ----------
function greeting() {
  const h = Math.floor(T.minutesOfDay() / 60);
  return h >= 5 && h < 12 ? 'Доброе утро' : h >= 12 && h < 17 ? 'Добрый день' : h >= 17 && h < 23 ? 'Добрый вечер' : 'Доброй ночи';
}
const TILE_ICON = {
  cal: '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 14h6M13 11v6"/>',
  book: '<path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h10M9 8h6"/>',
};
const tile = (href, icon, label, color) => html`<a class="tile" href="${href}"><span class="ti ${color}">${raw(`<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TILE_ICON[icon]}</svg>`)}</span><span>${label}</span></a>`;
function today(ctx) {
  const { user, next, ds, todo, session = [], todayPairs = [] } = ctx;
  const key = T.dateKey();
  const nowMin = T.minutesOfDay();
  const firstS = session.find((x) => x.kind !== 'консультация' && x.date_key >= key);
  const live = todayPairs.filter((p) => !p.cancelled);
  const left = live.filter((p) => T.parseHHMM(p.end) > nowMin);
  const nextToday = left[0];
  // Пары на сегодня — компактным списком; текущая или ближайшая выделена
  const pairRow = (p) => {
    const st = T.parseHHMM(p.start); const en = T.parseHHMM(p.end);
    const cls = p.cancelled ? 'off' : en <= nowMin ? 'past' : nextToday && p.id === nextToday.id ? 'now' : '';
    const badge = p.cancelled ? 'отменена' : en <= nowMin ? '' : st <= nowMin ? `идёт · до ${p.end}` : nextToday && p.id === nextToday.id ? (st - nowMin < 60 ? `через ${st - nowMin} мин` : `в ${p.start}`) : '';
    const ch = changeText(p);
    return html`<a class="row tp ${cls}" href="/study?d=${key}#pair-${p.id}"><span class="tm">${p.start}<br>${p.end}</span>
<span class="body"><span class="title">${p.subject}</span><span class="meta">${placeText(p)} · ${p.kind}</span>${ch ? html`<span class="meta chg">${ch}</span>` : ''}</span>${badge ? html`<span class="tag ${cls === 'now' ? 'blue' : ''}">${badge}</span>` : ''}</a>`;
  };
  const nextLine = next && T.dateKey(next.startsAt) !== key
    ? html`<div class="row"><span class="body"><span class="title">${live.length ? 'На сегодня пары закончились' : 'Сегодня пар нет'}</span>
<span class="meta">Следующая — ${T.wdLongKey(T.dateKey(next.startsAt))}, ${T.dayMonthKey(T.dateKey(next.startsAt))}, ${next.start}: ${next.subject}, ${placeText(next)}</span></span></div>`
    : !left.length ? html`<div class="row"><span class="body"><span class="title">Сегодня пар нет</span><span class="meta">В ближайшие две недели пар нет</span></span></div>` : '';
  // Требует внимания: заявки и черновики, сроки, риск недопуска
  const risks = session.filter((x) => x.kind !== 'консультация' && x.admitted === false);
  const attention = [
    ...todo,
    ...risks.map((x) => ({ amber: true, title: `Допуск к сессии: ${x.subject}`, meta: `Не хватает ${x.gap} ${plural(x.gap, 'балла', 'баллов', 'баллов')} до порога · ${x.kind} ${T.dayMonthKey(x.date_key)}`, href: `/helper?q=${encodeURIComponent(`Что мне сделать по дисциплине «${x.subject}»?`)}`, action: 'Что делать' })),
  ];
  // Контекстные действия: зависят от ситуации студента
  const overdue = ds.some((d) => d.overdue.length);
  const actions = [
    firstS && daysUntil(firstS.date_key) <= 60 ? ['/study/grades#session', `Сессия через ${daysUntil(firstS.date_key)} ${plural(daysUntil(firstS.date_key), 'день', 'дня', 'дней')}`] : null,
    overdue ? ['/helper?q=' + encodeURIComponent('Мне нужно больше времени на работы. Как попросить отсрочку?'), 'Попросить отсрочку'] : null,
    ['/requests/new', 'Жизненные ситуации'],
    ['/study?view=week', 'Расписание на неделю'],
    ['/study/record', 'Зачётка'],
  ].filter(Boolean);
  return page({
    title: 'Сегодня', active: 'today', ctx,
    body: html`
<div class="greet"><h1>${greeting()}, ${user.first_name}!</h1><div class="muted">${T.wdLongKey(key)[0].toUpperCase() + T.wdLongKey(key).slice(1)}, ${T.dayMonthKey(key)} · ${T.parityLabel(key)}</div></div>
<a class="ask-bar ai" href="/helper"><span class="spark" aria-hidden="true">✦</span><span><b>Помощник</b><span class="muted"> · спроси о своей учёбе или справках</span></span></a>
<section class="section" aria-labelledby="today-h"><h2 class="label" id="today-h">Сегодня${left.length ? html` <span class="cnt">${left.length}</span>` : ''}</h2>
<div class="group">${(left.length ? todayPairs : []).map(pairRow)}${nextLine}
<a class="row more" href="/study?d=${key}"><span class="body"><span class="title">Полное расписание</span></span>${I.chev}</a></div></section>
<section class="section" aria-labelledby="att-h"><h2 class="label" id="att-h">Требует внимания${attention.length ? html` <span class="cnt amber">${attention.length}</span>` : ''}</h2>
${attention.length ? html`<div class="group">${attention.map((t) => html`<div class="row">${t.amber ? html`<span class="bar amber"></span>` : html`<span class="bar"></span>`}
<div class="body"><div class="title">${t.title}</div><div class="meta">${t.meta}</div></div>${t.href ? html`<a class="act" href="${t.href}">${t.action}</a>` : ''}</div>`)}</div>`
    : html`<div class="group"><div class="row"><span class="body"><span class="title">Всё в порядке</span><span class="meta">Срочных дел нет. Хорошего дня!</span></span></div></div>`}
</section>
<section class="section" aria-labelledby="qa-h"><h2 class="label" id="qa-h">Быстрые действия</h2>
<nav class="qa">${actions.map(([h, l]) => html`<a href="${h}">${l}</a>`)}</nav></section>
`,
  });
}

// ---------- Учёба ----------
function studyTabs(user, cur) {
  const tabs = [['schedule', '/study', 'Расписание'], ['grades', '/study/grades', 'Оценки']];
  if (user.level === 'магистратура') tabs.push(['nir', '/study/nir', 'НИР']);
  return html`<nav class="seg" aria-label="Учёба">${tabs.map(([k, h, l]) => html`<a href="${h}" ${k === cur ? raw('aria-current="page"') : ''}>${l}</a>`)}</nav>`;
}

function schedule(ctx) {
  const { user, sel, week, pairs, exams = [], view = 'day' } = ctx;
  const q = (d, v = view) => `/study?d=${d}${v === 'week' ? '&view=week' : ''}`;
  const todayKey = T.dateKey();
  const weekBody = () => html`<section class="section" style="padding-top:4px" aria-label="Пары на неделю">
<h2 class="label">Неделя ${T.dayMonthKey(week[0].key)} – ${T.dayMonthKey(week[week.length - 1].key)} · ${T.parityLabel(week[0].key)}</h2>
${week.map((d) => html`<div class="wk-day${d.key === todayKey ? ' is-today' : ''}"><a class="wk-h" href="${q(d.key, 'day')}">${T.wdLongKey(d.key)[0].toUpperCase() + T.wdLongKey(d.key).slice(1)}, ${T.dayMonthKey(d.key)}${d.key === todayKey ? ' · сегодня' : ''}</a>
${d.session.map((e) => html`<a class="wk-row exam" href="${q(d.key, 'day')}#exam-${e.id}"><span class="t">${e.start}</span><span class="b"><b>${e.subject}</b><span class="m">${e.kind} · ауд. ${e.room}</span></span></a>`)}
${d.pairs.length ? d.pairs.map((p) => html`<a class="wk-row${p.change ? ' ch' : ''}${p.cancelled ? ' off' : ''}" href="${q(d.key, 'day')}#pair-${p.id}"><span class="t">${p.start}<br>${p.end}</span><span class="b"><b>${p.subject}</b><span class="m">${p.cancelled ? 'отменена' : `${p.kind} · ${roomText(p)}`}</span>${changeText(p) ? html`<span class="m chg">${changeText(p)}</span>` : ''}</span></a>`)
    : d.session.length ? '' : html`<div class="wk-none">Пар нет</div>`}</div>`)}
</section>`;
  return page({
    title: 'Расписание', active: 'study', ctx,
    body: html`<div class="page-head" style="padding-top:16px"><h1>Учёба</h1></div>
${studyTabs(user, 'schedule')}
<div class="days" role="list" aria-label="Дни недели">${week.map((d) => html`<a role="listitem" href="${q(d.key, 'day')}" ${d.key === sel && view === 'day' ? raw('aria-current="date"') : ''}>
<span>${T.wdShortKey(d.key)}</span><b>${Number(d.key.slice(8))}</b>${d.changed ? html`<span class="ch" title="есть изменения"></span>` : d.session && d.session.length ? html`<span class="ch ex" title="сессия"></span>` : ''}</a>`)}</div>
<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 20px 0">
<a class="icon-btn wk-nav" href="${q(T.addDays(week[0].key, -7))}" aria-label="Предыдущая неделя">←</a>
<nav class="mini-seg" aria-label="Вид расписания"><a href="${q(sel, 'day')}" ${view === 'day' ? raw('aria-current="page"') : ''}>День</a><a href="${q(sel, 'week')}" ${view === 'week' ? raw('aria-current="page"') : ''}>Неделя</a></nav>
<a class="icon-btn wk-nav" href="${q(T.addDays(week[0].key, 7))}" aria-label="Следующая неделя">→</a></div>
${view === 'week' ? weekBody() : html`<section class="section" style="padding-top:4px" aria-label="Пары">
<h2 class="label">${T.wdLongKey(sel)[0].toUpperCase() + T.wdLongKey(sel).slice(1)}, ${T.dayMonthKey(sel)} · ${T.parityLabel(sel)}</h2>
${exams.map((e) => html`<article class="pair exam" id="exam-${e.id}">
<div class="tm"><span>${e.start}</span><span class="tag ${e.kind === 'консультация' ? 'blue' : 'amber'}">${e.kind}</span></div>
<div class="nm">${e.subject}</div>
<div class="small muted" style="margin-top:2px">${e.teacher} · ауд. ${e.room}</div>
<div class="actions"><a class="btn secondary small" href="/study/grades#session">Сессия и допуск</a></div></article>`)}
${pairs.length ? pairs.map((p) => html`<article class="pair" id="pair-${p.id}">
<div class="tm"><span>${p.start}–${p.end}</span><span>${p.cancelled ? 'отменена' : p.kind}</span></div>
<div class="nm">${p.subject}</div>
<div class="small muted" style="margin-top:2px">${p.teacher} · ${placeText(p)}</div>
${changeText(p) ? html`<div class="changed">${changeText(p)}. Обновлено ${T.relDateTime(new Date(p.change.created_at))}</div>` : ''}
</article>`) : exams.length ? '' : html`<div class="card" style="margin-top:10px"><b>Пар нет.</b><div class="small muted">Выбери другой день или неделю.</div></div>`}
</section>`}`,
  });
}

function grades(ctx) {
  const { user, ds, session = [], book } = ctx;
  const firstS = session.find((x) => x.kind !== 'консультация');
  const sessList = session.filter((x) => x.kind !== 'консультация').map((x) => ({ ...x, consult: session.find((c) => c.kind === 'консультация' && c.discipline_id === x.discipline_id) }));
  const exCount = sessList.length;
  const early = ds.filter((d) => d.closed_text);
  const risky = ds.filter((d) => d.gap > 0 && !d.closed_text);
  const bad = ds.filter((d) => d.light === 'red' || d.light === 'amber').length;
  const ok = ds.length - bad;
  const cap = (x) => x[0].toUpperCase() + x.slice(1);
  const word = (d) => {
    if (d.light === 'done') return `${cap(d.control)} · ${d.closed_text.toLowerCase()}.`;
    if (d.gap > 0) {
      const over = d.overdue.length ? ` Просрочены: ${d.overdue.map((w) => `${w.title} (до ${w.max})`).join(', ')}.` : '';
      const nx = d.upcoming[0];
      return `${cap(d.control)} · до порога ${d.pass_threshold} не хватает ${d.gap} ${plural(d.gap, 'балла', 'баллов', 'баллов')}.${over}${nx ? ` Ближайшее: ${nx.title} (до ${nx.max}), ${T.dayMonthKey(nx.due_key)}.` : ''}`;
    }
    return `${cap(d.control)} · порог ${d.pass_threshold} набран.${d.autoGap ? ` До автомата ${d.autoGap} ${plural(d.autoGap, 'балл', 'балла', 'баллов')}.` : ''}`;
  };
  const color = { green: 'var(--green)', amber: '#D97706', red: 'var(--red-dot)', done: '#98A2B3' };
  return page({
    title: 'Оценки', active: 'study', ctx,
    body: html`<div class="page-head" style="padding-top:16px"><h1>Учёба</h1></div>
${studyTabs(user, 'grades')}
<section class="section" aria-label="Готовность к сессии"><div class="card readiness">
<div class="small muted" style="font-weight:600">${firstS ? `Сессия с ${T.dayMonthKey(firstS.date_key)} · ${inDays(daysUntil(firstS.date_key))}` : 'Текущие баллы'}</div>
<div style="font-size:20px;font-weight:700;margin-top:4px">${risky.length ? `Допуск есть по ${ds.length - risky.length} из ${ds.length} дисциплин` : 'Допуск есть по всем дисциплинам'}</div>
${risky.map((d) => html`<div class="risk"><span class="tag red">не хватает ${d.gap} ${plural(d.gap, 'балла', 'баллов', 'баллов')}</span><span class="rs">${d.subject}</span>
<a class="link" style="padding:0" href="/helper?q=${encodeURIComponent(`Что мне сделать по дисциплине «${d.subject}»?`)}">Что можно сделать →</a></div>`)}
<div class="small muted" style="margin-top:10px">Итоговые оценки ещё не выставлены. Допуск — порог текущих баллов (демо-правило). Баллы обновлены ${T.relDateTime(new Date(ds[0] ? ds[0].updated_at : T.now()))}.</div>
</div></section>
${session.length ? html`<section class="section" id="session" aria-labelledby="sess-h"><h2 class="label" id="sess-h">Сессия · ${exCount} ${plural(exCount, 'зачёт или экзамен', 'зачёта или экзамена', 'зачётов и экзаменов')}</h2>
<div class="card" style="padding:4px 16px">${sessList.map(sessionRow)}${early.map((d) => html`<div class="sess"><div class="sd done"><b>✓</b><span>сдан</span></div><div class="body"><div class="title">${d.subject}</div><div class="meta">${cap(d.control)} · ${d.closed_text.toLowerCase()}</div></div></div>`)}</div></section>` : ''}
<section class="section" aria-labelledby="pts-h"><h2 class="label" id="pts-h">Текущие баллы</h2>
${ds.map((d) => html`<details class="card" id="d-${d.id}" style="margin-top:10px">
<summary style="list-style:none;cursor:pointer;display:flex;gap:10px">
<span class="dotc" style="background:${raw(color[d.light])}"></span>
<span style="flex:1;min-width:0"><span style="display:flex;justify-content:space-between;gap:8px"><b style="font-weight:600">${d.subject}</b><span class="muted" style="white-space:nowrap">${d.closed_text ? 'зачтено' : `${d.points} / 100`}</span></span>
<span class="small muted" style="display:block;margin-top:2px">${word(d)}</span></span></summary>
<div style="margin-top:10px">${d.works.map((w) => html`<div class="kv"><span>${w.title}${w.due_key && w.score == null ? html` · до ${T.dayMonthKey(w.due_key)}` : ''}</span><span>${w.score == null ? '—' : w.score} / ${w.max}</span></div>`)}
<div class="small muted" style="margin-top:6px">${d.control} · порог ${d.pass_threshold}${d.auto_threshold ? ` · автомат от ${d.auto_threshold}` : ''} · ${d.teacher}</div>
<div class="actions"><a class="btn secondary small" href="/helper?q=${encodeURIComponent(`Что мне сделать по дисциплине «${d.subject}»?`)}">Спросить помощника</a></div></div>
</details>`)}
${book && book.total ? html`<a class="card linkcard" href="/study/record" style="margin-top:16px"><span style="flex:1"><b>Зачётная книжка</b><span class="small muted" style="display:block;margin-top:2px">${book.sems.length} ${plural(book.sems.length, 'семестр', 'семестра', 'семестров')} · ${book.debts ? `долгов: ${book.debts}` : 'долгов нет'}${book.avg ? ` · средний балл ${book.avg.toFixed(1).replace('.', ',')}` : ''}</span></span>${I.chev}</a>` : ''}
</section>`,
  });
}

const MARK_CLS = { отлично: 'green', хорошо: 'blue', удовлетворительно: 'amber', зачтено: '' };
function recordBook(ctx) {
  const { book } = ctx;
  return page({
    title: 'Зачётная книжка', active: 'study', ctx,
    body: html`${backBar('/study/grades', 'Оценки')}<div class="page-head"><h1>Зачётная книжка</h1>
<p class="muted" style="margin:6px 0 0">Итоги прошлых сессий. Текущий семестр — в «Оценках».</p></div>
<section class="section"><div class="card"><div class="kv"><span>Сдано</span><span>${book.total} из ${book.total}</span></div>
<div class="kv"><span>Академические задолженности</span><span>${book.debts ? book.debts : 'нет'}</span></div>
${book.avg ? html`<div class="kv"><span>Средний балл по оценкам</span><span>${book.avg.toFixed(2).replace('.', ',')}</span></div>` : ''}</div></section>
${book.sems.map((s, i) => html`<section class="section"><details class="card" ${i === 0 ? raw('open') : ''}>
<summary style="cursor:pointer;font-weight:600">${s.semester} семестр · ${s.rows.length} ${plural(s.rows.length, 'дисциплина', 'дисциплины', 'дисциплин')}</summary>
${s.rows.map((r) => html`<div class="row"><div class="body"><div class="title">${r.subject}</div><div class="meta">${r.control} · ${T.dayMonthKey(r.date_key)} ${r.date_key.slice(0, 4)} · ${r.teacher}</div></div><span class="tag ${MARK_CLS[r.mark] || ''}">${r.mark}</span></div>`)}
</details></section>`)}`,
  });
}

function nir(ctx) {
  const { user, stages } = ctx;
  const sum = stages.reduce((s, x) => s + (x.score || 0), 0);
  const stateTag = { signed: html`<span class="tag green">Подписано руководителем</span>`, returned: html`<span class="tag amber">Вернули на доработку</span>`, todo: html`<span class="tag">В работе</span>` };
  return page({
    title: 'НИР', active: 'study', ctx,
    body: html`<div class="page-head" style="padding-top:16px"><h1>Учёба</h1></div>
${studyTabs(user, 'nir')}
<section class="hero" style="margin-top:14px"><div class="small" style="color:rgba(255,255,255,.82);font-weight:600">НИР · ${user.course * 2 - 1} СЕМЕСТР · РУКОВОДИТЕЛЬ: ${user.curator}</div>
<div class="big">${sum} <span style="font-size:18px;font-weight:500">из 100 баллов</span></div>
<div class="progress" style="background:rgba(255,255,255,.3)"><i style="width:${sum}%"></i></div>
<div class="small" style="color:rgba(255,255,255,.92)">До «отлично» ещё ${Math.max(0, 85 - sum)} ${plural(Math.max(0, 85 - sum), 'балл', 'балла', 'баллов')}</div></section>
<section class="section">${stages.map((s) => html`<div class="card" style="margin-top:10px">
<div class="req-head"><b>${s.title}</b><span class="muted">${s.score == null ? '—' : s.score} / ${s.max}</span></div>
<div style="margin-top:6px">${stateTag[s.state]}</div>
${s.note || s.due_key ? html`<div class="small muted" style="margin-top:6px">${[s.note, s.due_key ? `до ${T.dayMonthKey(s.due_key)}` : ''].filter(Boolean).join(' · ')}</div>` : ''}</div>`)}
<p class="small muted">Это обзор этапов: загрузка файлов НИР в первой версии не делается, задачи по ней не попадают в «Нужно сделать».</p>
</section>`,
  });
}

// ---------- Заявки ----------
function reqRowWaiting(r) {
  const cert = TYPES[r.type].producesPdf;
  const who = r.status === 'in_work' && r.assignee ? `В обработке · ${r.assignee.short_name}` : cert ? 'Заказана · ждёт обработки' : 'Подана · ждёт сотрудника деканата';
  return html`<a class="row" href="/requests/${r.id}"><div class="body">
<div class="req-head"><span class="title strong">${r.title}</span><span class="num">№ ${r.number}</span></div>
<div style="font-size:14px">${who}</div>
<div class="meta">${r.eta_at ? `Ожидаемая готовность — ${T.relDateTime(new Date(r.eta_at))}` : ''}</div></div>${I.chev}</a>`;
}

function requestsList(ctx) {
  const { list } = ctx;
  const act = list.filter((r) => r.status === 'need_student');
  const wait = list.filter((r) => r.status === 'submitted' || r.status === 'in_work');
  const done = list.filter((r) => r.status === 'ready' || r.status === 'rejected');
  const drafts = list.filter((r) => r.status === 'draft');
  const docName = (r) => (r.type === 'aid' ? 'Справка о составе семьи' : null);
  return page({
    title: 'Заявки', active: 'requests', ctx,
    body: html`<div class="top" style="padding-top:18px"><h1>Заявки</h1><a class="pill" href="/requests/new">Новая</a></div>
${act.length ? html`<section class="section" style="padding-top:18px"><h2 class="label amber">Нужно твоё действие</h2>
${act.map((r) => html`<div class="row" style="align-items:stretch"><span class="bar amber"></span><div class="body">
<div class="req-head"><a href="/requests/${r.id}" class="title strong" style="color:inherit;text-decoration:none">${r.title}</a><span class="num">№ ${r.number}</span></div>
<div style="font-size:14px;color:var(--amber);font-weight:600">${r.needs_text}</div>
<div class="meta">Ожидаем документ. После загрузки деканат продолжит рассмотрение.</div>
<div class="actions"><a class="btn small" href="/requests/${r.id}#upload">Загрузить справку</a>${docName(r) ? html`<a class="link" href="/help/doc?name=${encodeURIComponent(docName(r))}&back=/requests">Где взять справку</a>` : ''}</div>
</div></div>`)}</section>` : ''}
${drafts.length ? html`<section class="section"><h2 class="label">Черновики</h2>${drafts.map((r) => html`<a class="row" href="/requests/new?type=${r.type}&draft=1"><div class="body"><span class="title strong">${r.title}</span><span class="meta">${r.type === 'tax' ? 'Заполнен по договору' : 'Заполнен из профиля'} · проверь и отправь</span></div>${I.chev}</a>`)}</section>` : ''}
<section class="section"><h2 class="label">Ждут деканат</h2>
${wait.length ? wait.map(reqRowWaiting) : html`<p class="muted small">Заявок в работе нет.</p>`}</section>
<section class="section"><h2 class="label">Завершённые</h2>
${done.length ? done.map((r) => html`<div class="row"><div class="body">
<div class="req-head"><a href="/requests/${r.id}" class="title strong" style="color:inherit;text-decoration:none">${r.title}</a><span class="num">№ ${r.number}</span></div>
<div style="font-size:14px">${r.status === 'ready' ? `Готова · ${T.dayMonth(new Date(r.closed_at))}` : `Отклонена · ${r.reject_reason || ''}`}</div>
${r.status === 'ready' && TYPES[r.type].producesPdf && r.format !== 'paper' ? html`<div class="actions"><a class="btn secondary small" href="/requests/${r.id}/pdf" target="_blank" rel="noopener" style="color:var(--blue)">${I.file}Открыть PDF</a></div>`
    : r.status === 'ready' && r.format === 'paper' ? html`<div class="meta">Забрать в деканате: корпус 1, каб. 210</div>` : ''}
</div></div>`) : html`<p class="muted small">Завершённых заявок пока нет.</p>`}</section>`,
  });
}

const SIT_ICON = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
  work: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
  tax: '<circle cx="12" cy="12" r="9"/><path d="M9 15l6-6M9.5 9.5h.01M14.5 14.5h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  aid: '<path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z"/>',
};
const sitIcon = (k) => raw(`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SIT_ICON[k]}</svg>`);
function situationList(list) {
  return html`<div class="group">${list.map((x) => html`<a class="row sit" href="/situations/${x.id}"><span class="si">${sitIcon(x.icon)}</span><span class="body"><span class="title strong">${x.title}</span><span class="meta">${x.lead}</span></span>${I.chev}</a>`)}</div>`;
}

function newRequestChoose(ctx) {
  const { user, situations = [] } = ctx;
  const types = Object.entries(TYPES).filter(([, t]) => !t.budgetOnly || user.funding === 'бюджет');
  return page({
    title: 'Новая заявка', active: 'requests', ctx,
    body: html`${backBar('/requests', 'Заявки')}<div class="page-head"><h1>Новая заявка</h1><p class="muted" style="margin:6px 0 0">Выбери жизненную ситуацию — кабинет подберёт справки и подскажет шаги. Или закажи нужную справку сам.</p></div>
<section class="section" aria-labelledby="sit-h"><h2 class="label" id="sit-h">Жизненные ситуации</h2>${situationList(situations)}</section>
<section class="section" aria-labelledby="types-h"><h2 class="label" id="types-h">Справки и заявления</h2>
${types.map(([k, t]) => html`<a class="row" href="/requests/new?type=${k}"><div class="body"><span class="title strong">${t.title}</span>
<span class="meta">${t.subtitle || 'Заявление и документы'}</span></div>${I.chev}</a>`)}</section>
<section class="section"><div class="actions"><a class="btn secondary small" href="/helper">Не нашёл — спросить помощника</a></div></section>`,
  });
}

function situation(ctx) {
  const { s } = ctx;
  const n = s.available.length;
  return page({
    title: s.title, active: 'requests', ctx,
    body: html`${backBar('/requests/new', 'Жизненные ситуации')}<div class="page-head"><div class="sit-ic">${sitIcon(s.icon)}</div><h1 style="font-size:26px">${s.title}</h1><p class="muted" style="margin:6px 0 0">${s.lead}</p></div>
${s.orders.length ? html`<form method="post" action="/situations/${s.id}" class="section" aria-labelledby="ord-h"><h2 class="label" id="ord-h">Закажем за тебя</h2>
<div class="group">${s.orders.map((o) => html`<label class="row pick ${o.available ? '' : 'off'}"><input type="checkbox" name="items" value="${o.key}" ${o.available ? raw('checked') : raw('disabled')}>
<span class="body"><span class="title strong">${o.title}</span><span class="meta">${o.available ? o.hint : o.reason}</span></span></label>`)}</div>
<p class="small muted" style="margin:10px 2px 0">Данные возьмём из профиля${s.orders.some((o) => o.type === 'tax') ? ' и договора' : ''}. Статус каждой справки — в «Заявках».</p>
${n ? html`<button class="btn block" type="submit" style="margin-top:14px">${n === 1 ? 'Заказать справку' : `Заказать ${n} ${plural(n, 'справку', 'справки', 'справок')} одной кнопкой`}</button>` : ''}
</form>` : ''}
${s.todo.length ? html`<section class="section" aria-labelledby="todo-h"><h2 class="label" id="todo-h">${s.orders.length ? 'Подготовь сам' : 'Что сейчас по учёбе'}</h2>
<div class="group">${s.todo.map((t) => html`<div class="row"><span class="body"><span class="title" style="font-size:15px">${t}</span></span></div>`)}</div></section>` : ''}
${s.notes.length ? html`<section class="section">${s.notes.map((t) => html`<div class="note" style="margin-top:8px">${t}</div>`)}</section>` : ''}
${s.links.length ? html`<section class="section"><div class="actions">${s.links.map((l, i) => html`<a class="btn ${i ? 'secondary' : ''} small" href="${l.href}">${l.label}</a>`)}</div></section>` : ''}`,
  });
}

function newRequestForm(ctx) {
  const { user, type, draft, values = {}, error, years = [], payments = [] } = ctx;
  const t = TYPES[type];
  const isTax = type === 'tax';
  const taxYears = years.filter((y) => y.eligibleForm);
  const v = { purpose: draft?.purpose || values.purpose || (t.purposes ? t.purposes[0].id : ''), format: draft?.format || values.format || t.formats?.[0].id, details: draft?.details || values.details || '', note: values.note || '' };
  return page({
    title: 'Новая заявка', active: 'requests', ctx,
    body: html`${backBar('/requests/new', 'Новая заявка')}<div class="page-head"><h1>${t.title}</h1>${t.official ? html`<p class="small muted" style="margin:6px 0 0">${t.official}</p>` : ''}${draft ? html`<p class="muted" style="margin:6px 0 0">Черновик заполнен ${isTax ? 'по договору' : 'из профиля'}. Проверь и отправь.</p>` : ''}</div>
<form method="post" action="/requests" enctype="multipart/form-data" class="section" style="padding-top:8px">
<input type="hidden" name="type" value="${type}">
${error ? html`<div class="note red" role="alert">${error}</div>` : ''}
${t.purposes ? html`<fieldset class="field" style="border:0;padding:0;margin:16px 0 0"><legend style="padding:0;margin-bottom:6px">Куда нужна? <span class="hint">От этого зависит формулировка</span></legend>
<div class="chips">${t.purposes.map((p) => html`<label><input type="radio" name="purpose" value="${p.id}" ${v.purpose === p.id ? raw('checked') : ''}><span>${p.label}</span></label>`)}</div>${t.purposeHint ? html`<p class="small muted" style="margin:8px 0 0;font-weight:400">${t.purposeHint}</p>` : ''}</fieldset>` : ''}
${t.reasons ? html`<label class="field">Основание<select name="purpose">${t.reasons.map((r) => html`<option ${v.purpose === r ? raw('selected') : ''}>${r}</option>`)}</select></label>` : ''}
${t.detailsLabel || t.purposes ? html`<label class="field">${t.detailsLabel || 'Уточнение'} <span class="hint">${t.detailsLabel ? '' : 'необязательно, например название организации'}</span>
<textarea name="details" maxlength="500" placeholder="${t.detailsPlaceholder || ''}">${v.details}</textarea></label>` : ''}
${t.formats && t.formats.length > 1 ? html`<fieldset class="field" style="border:0;padding:0;margin:16px 0 0"><legend style="padding:0;margin-bottom:6px">Формат</legend>
<div class="options">${t.formats.map((f) => html`<label><input type="radio" name="format" value="${f.id}" ${v.format === f.id ? raw('checked') : ''}><span class="opt">${f.label}<small>${f.hint}</small></span></label>`)}</div></fieldset>`
    : html`<input type="hidden" name="format" value="${t.formats?.[0].id || ''}">${t.formats ? html`<p class="small muted">${t.formats[0].label}: ${t.formats[0].hint}</p>` : ''}`}
${isTax ? taxFields(payments, taxYears, v, user) : ''}
${t.requiredDocs ? html`<label class="field">${t.requiredDocs[0]} <span class="hint">PDF или фото, до 5 МБ. Можно загрузить позже.</span>
<span class="filepick"><input type="file" name="doc" accept=".pdf,.jpg,.jpeg,.png"><span class="btn secondary small" aria-hidden="true">Выбрать файл</span><span class="fname" data-fname>Файл не выбран</span></span></label>
<a class="link" style="padding-left:0" href="/help/doc?name=${encodeURIComponent(t.requiredDocs[0])}&back=${encodeURIComponent('/requests/new?type=' + type)}">Где взять справку</a>` : ''}
<div class="card" style="margin-top:16px"><div class="req-head"><span class="small muted">Данные из профиля</span><a class="small" href="/help/data">Ошибка в данных?</a></div>
<div style="font-size:15px;margin-top:6px">${user.full_name}<br>${user.course} курс, ${user.group_name} · ${user.form}, ${user.funding}</div></div>
<button class="btn block" type="submit" style="margin-top:18px" ${isTax && !taxYears.some((y) => y.closed) ? raw('disabled') : ''}>${t.producesPdf ? 'Заказать справку' : 'Подать заявление'}</button>
</form>`,
  });
}

// Справка для вычета: сначала проверяем условия по данным кабинета, потом спрашиваем только год.
// Справку выдают за закончившийся календарный год — текущий год показываем, но выбрать его нельзя.
function taxFields(payments, years, v, user) {
  const contract = payments[0]?.contract;
  const self = payments.length && payments.every((p) => p.payer === user.full_name);
  const customer = payments[0]?.payer;
  const ok = (text) => html`<div style="display:flex;gap:8px;align-items:flex-start;margin-top:6px"><span aria-hidden="true" style="color:var(--green);font-weight:700">✓</span><span>${text}</span></div>`;
  if (!years.length) return html`<div class="note amber" style="margin-top:16px">В кабинете нет оплат по договору за 2024 год и позже. Если обучение платное — напиши в деканат по любой заявке, проверим договор.</div>`;
  const closed = years.filter((y) => y.closed);
  const sel = closed.some((y) => String(y.year) === String(v.purpose)) ? String(v.purpose) : closed[0] ? String(closed[0].year) : '';
  return html`<div class="card" style="margin-top:16px;background:var(--green-soft);border-color:#BFE3CB"><b>Условия проверены по данным кабинета</b>
<div style="font-size:14px;line-height:1.4">${ok(`Платное обучение по договору № ${contract}`)}
${self ? ok('Договор оформлен на тебя — за своё обучение вычет положен при любой форме обучения') : ''}
${ok('Оплата с 2024 года — для налоговой хватит одной этой справки, договор и чеки не нужны')}</div></div>
<fieldset class="field" style="border:0;padding:0;margin:16px 0 0"><legend style="padding:0;margin-bottom:6px">За какой год оплаты <span class="hint">справку выдают за закончившийся год</span></legend>
<div class="options" style="grid-template-columns:1fr">${[...closed, ...years.filter((y) => !y.closed)].map((y) => y.closed ? html`<label><input type="radio" name="purpose" value="${y.year}" ${sel === String(y.year) ? raw('checked') : ''}>
<span class="opt">${y.year} · оплачено ${TAX.rub(y.sum)}<small>Вернуть можно до ${TAX.rub(y.refund)}*</small></span></label>`
    : html`<div class="opt" style="background:#EEF1F5;border-style:dashed;cursor:default" aria-disabled="true">${y.year} · оплачено ${TAX.rub(y.sum)}<small>Справку за ${y.year} год можно заказать с января ${y.year + 1} года.${y.sum > TAX.OWN_LIMIT ? ` Вычет будет считаться с ${TAX.rub(TAX.OWN_LIMIT)} — это лимит года.` : ''}</small></div>`)}</div></fieldset>
${closed.length ? html`<div class="card" style="margin-top:16px"><div class="small muted">Данные для справки — из договора</div>
<div class="kv"><span>ФИО обучающегося</span><span>${user.full_name}</span></div>
<div class="kv"><span>ФИО заказчика</span><span>${customer}</span></div>
<div class="kv"><span>Номер договора</span><span>${contract}</span></div></div>
<label class="field">ИНН обучающегося и заказчика <span class="hint">обязательно · 12 цифр${self ? ' · ты одновременно обучающийся и заказчик' : ''}${v.details === TAX.DEMO_INN ? ' · в демо подставлен тестовый ИНН' : ''}</span>
<input type="text" name="details" inputmode="numeric" maxlength="12" pattern="\\d{12}" required value="${/^\d{12}$/.test(v.details) ? v.details : ''}" autocomplete="off"></label>
<label class="field">Примечание <span class="hint">необязательно</span><textarea name="note" maxlength="500" style="min-height:72px">${v.note || ''}</textarea></label>
<p class="small muted" style="margin-top:10px">* 13% от оплаты, но не больше 13% от ${TAX.rub(TAX.OWN_LIMIT)} в год вместе с другими социальными вычетами (лечение, спорт) — если доход облагается по ставке 13%.</p>` : ''}
<a class="link" style="padding-left:0" href="/help/tax">Как получить вычет по справке</a>
<p class="small muted" style="margin:6px 0 0">Если заказчик по договору — родители или супруг(а), справку оформляют на их имя — в первой версии такую заявку подают в деканате.</p>`;
}

function dataHelp(ctx) {
  return page({
    title: 'Если данные неверны', active: 'me', ctx,
    body: html`${backBar('/me', 'Я')}<div class="page-head"><h1>Если данные в профиле неверны</h1></div>
<section class="section"><p style="margin:0;line-height:1.5">ФИО, курс, группу, форму и основу обучения студент сам не меняет: это сведения из личного дела. Их исправляет деканат по документу.</p>
<div class="stages" style="padding:14px 0 0">
<div class="stage"><div class="st">ФИО или гражданство</div><div class="when">В кабинете ДГТУ для этого есть онлайн-заявка «Изменение персональных данных». В нашей первой версии — обращение в деканат с паспортом.</div></div>
<div class="stage"><div class="st">Курс, группа, форма или основа обучения</div><div class="when">Меняются приказом; если в кабинете ошибка — напиши в деканат, укажи, какое поле неверно.</div></div>
<div class="stage todo"><div class="st">Деканат</div><div class="when">Корпус 1, каб. 210 · пн–пт 9:00–17:00</div></div></div>
<div class="actions"><a class="btn secondary small" href="/me">Мой профиль</a></div></section>`,
  });
}

function taxHelp(ctx) {
  const step = (cls, t, w) => html`<div class="stage ${cls}"><div class="st">${t}</div><div class="when" style="font-size:14px;line-height:1.4">${w}</div></div>`;
  const y = Number(T.dateKey().slice(0, 4));
  return page({
    title: 'Как получить вычет', active: 'requests', ctx,
    body: html`${backBar(ctx.back || '/requests', 'Назад')}<div class="page-head"><h1>Как получить вычет за обучение</h1>
<p class="muted" style="margin:6px 0 0">Справку из вуза прикладывают к декларации в личном кабинете налогоплательщика.</p></div>
<section class="section"><div class="stages" style="padding:8px 0 0">
${step('', 'Справка из вуза за закончившийся год', `Закажи в «Заявках» — PDF придёт сюда. Сейчас доступны годы до ${y - 1} включительно, справку за ${y} год можно заказать с января ${y + 1}.`)}
${step('', 'Декларация 3-НДФЛ', 'В личном кабинете налогоплательщика выбери вычет на обучение за нужный год и приложи справку.')}
${step('todo', 'Проверка и возврат', 'Налоговая проверит декларацию и вернёт налог на указанный счёт. Вернуть налог можно за три последних года.')}</div></section>
<section class="section"><div class="note">Подсказка концепта, не налоговая консультация. Сверено с материалами ФНС: с расходов 2024 года вместо договора и платёжек достаточно справки об оплате образовательных услуг (приказ ФНС от 18.10.2023 № ЕД-7-11/755@); вуз может и сам передать сведения в налоговую — тогда они появятся в личном кабинете.</div>
<div class="actions" style="margin-top:12px"><a class="btn small" href="/requests/new?type=tax">Заказать справку</a><a class="btn secondary small" href="/helper?q=${encodeURIComponent('Как получить налоговый вычет за обучение?')}">Спросить помощника</a></div></section>`,
  });
}

function requestSent(ctx) {
  const { r } = ctx;
  const head = TYPES[r.type].producesPdf ? 'Справка заказана' : 'Заявление подано';
  return page({
    title: head, active: 'requests', ctx,
    body: html`<div class="page-head" style="padding-top:40px">${I.check}
<h1 style="margin-top:14px">${head}</h1>
<div class="sub">${r.title} · № ${r.number}</div>
<div class="small muted" style="margin-top:4px;font-size:14px">Ожидаемая готовность — ${T.relDateTime(new Date(r.eta_at))}</div></div>
<div style="margin:18px 20px 0;padding:14px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)">Заявка передана в <b>деканат</b>. Тебе ничего делать не нужно.</div>
${r.notify_ready ? html`<div class="note green" style="margin:16px 20px 0">Сообщим, когда справка будет готова.</div>` : html`<div class="card" style="margin:18px 12px 0" id="notify-card">
<div style="display:flex;gap:12px;align-items:flex-start"><span style="width:40px;height:40px;border-radius:20px;background:var(--blue-soft);color:var(--blue);display:flex;align-items:center;justify-content:center;flex:none">${I.bell}</span>
<div><div style="font-weight:600">Сообщить, когда справка будет готова?</div><div class="small muted" style="font-size:14px;margin-top:4px">Покажем уведомление «Справка готова» в кабинете, а пока кабинет открыт — и в браузере. Без оценок и содержания заявки.</div></div></div>
<form method="post" action="/requests/${r.id}/notify" data-ask-permission style="margin-top:12px"><button class="btn block" type="submit">Да, сообщить</button></form>
<div style="text-align:center"><a class="link" style="color:var(--muted);font-weight:500" href="/requests/${r.id}">Не сейчас</a></div></div>`}
<div style="margin:14px 20px 0;display:flex;gap:8px"><a class="btn secondary small" style="flex:1" href="/requests/${r.id}">Открыть заявку</a><a class="btn secondary small" style="flex:1" href="/">На главную</a></div>`,
  });
}

function requestDetail(ctx) {
  const { r, events, files } = ctx;
  const t = TYPES[r.type];
  const isAid = r.type === 'aid';
  const msgs = events.filter((e) => e.kind === 'message');
  const docFiles = files;
  const stage = (cls, title, when, extra) => html`<div class="stage ${cls}"><div class="st">${title}</div>${when ? html`<div class="when">${when}</div>` : ''}${extra || ''}</div>`;
  const by = (e) => (e ? `${T.stamp(new Date(e.at))} · ${e.actor_role === 'staff' ? `${e.actor_name}, деканат` : 'ты'}` : '');
  const ev = (k) => [...events].reverse().find((e) => e.kind === k);
  const actor = r.status === 'need_student' ? html`<b>Нужно твоё действие</b>` : r.status === 'ready' ? html`<b>Готова</b>` : r.status === 'rejected' ? html`<b>Отклонена</b>` : r.status === 'in_work' ? html`<b>В работе</b> у сотрудника деканата` : html`<b>Ждёт обработки</b> в деканате`;
  const workTitle = isAid ? 'Рассмотрение заявления' : 'Оформление справки';
  const purpose = r.type === 'study' ? purposeOf('study', r.purpose) : null;
  const pdfOk = r.status === 'ready' && t.producesPdf && r.format !== 'paper';
  return page({
    title: `Заявка № ${r.number}`, active: 'requests', ctx,
    body: html`${backBar('/requests', `Заявка № ${r.number}`)}
<div class="page-head" style="display:flex;flex-direction:column;gap:6px"><h1>${r.title}</h1><div style="font-size:16px">${actor}</div>
${r.eta_at && !['ready', 'rejected'].includes(r.status) ? html`<div class="muted" style="font-size:14px">Ожидаемая готовность — ${T.relDateTime(new Date(r.eta_at))}</div>` : ''}</div>
${pdfOk ? html`<div style="padding:16px 20px 0"><a class="btn block" href="/requests/${r.id}/pdf" target="_blank" rel="noopener">${I.file}Открыть PDF</a></div>` : ''}
<div class="stages">
${stage('', isAid ? 'Подана' : 'Заказана', by(ev('submitted')))}
${isAid ? (r.taken_at ? stage('', 'Взята в работу', by(ev('taken'))) : stage(r.status === 'submitted' ? 'current' : 'todo', 'Ждёт сотрудника', r.status === 'submitted' ? 'сейчас · обычно берут в течение часа в рабочее время' : ''))
    : r.taken_at ? stage(r.status === 'in_work' ? 'current' : '', 'В обработке', by(ev('taken')), r.status === 'in_work' && purpose ? html`<div class="bubble">Справка об обучении ${purpose.full} · ${formatOf('study', r.format)?.label.toLowerCase()}</div>` : '')
      : stage(r.status === 'submitted' ? 'current' : 'todo', 'В обработке', r.status === 'submitted' ? 'ждёт сотрудника · обычно берут в течение часа в рабочее время' : '')}
${ev('uploaded') && r.status !== 'need_student' ? stage('', 'Документ загружен', by(ev('uploaded'))) : ''}
${r.status === 'need_student' ? stage('amber', 'Нужен документ', by(ev('need_doc')), html`<div class="bubble staff">${r.needs_text}</div>
<form id="upload" method="post" action="/requests/${r.id}/upload" enctype="multipart/form-data" style="margin-top:10px">
<label class="field" style="margin-top:0">Файл <span class="hint">PDF или фото, до 5 МБ</span><span class="filepick"><input type="file" name="doc" accept=".pdf,.jpg,.jpeg,.png"><span class="btn secondary small" aria-hidden="true">Выбрать файл</span><span class="fname" data-fname>Файл не выбран</span></span></label>
<div class="actions"><button class="btn small" type="submit">Загрузить справку</button>${isAid ? html`<a class="link" href="/help/doc?name=${encodeURIComponent('Справка о составе семьи')}&back=/requests/${r.id}">Где взять справку</a>` : ''}</div>
<p class="small muted">Ожидаем документ. После загрузки деканат продолжит рассмотрение.</p></form>`) : ''}
${r.status === 'rejected' ? stage('amber', 'Отклонена', by(ev('rejected')), html`<div class="bubble staff">${r.reject_reason}</div>`)
    : r.status === 'ready' ? html`${isAid ? stage('', workTitle, '') : ''}${stage('', isAid ? 'Решение принято' : 'Готова', by(ev('ready')), isAid ? html`<div class="bubble staff">${ev('ready')?.text || 'Решение отправлено в бухгалтерию.'}</div>` : r.format === 'paper' ? html`<div class="bubble">Забрать: корпус 1, каб. 210, пн–пт 9:00–17:00</div>` : '')}`
      : html`${isAid ? stage(r.status === 'in_work' ? 'current' : 'todo', workTitle, r.status === 'in_work' ? 'сейчас' : '') : ''}
${stage('todo', isAid ? 'Решение' : 'Готова', isAid ? 'решение появится здесь и в уведомлениях кабинета' : r.format === 'paper' ? 'появится уведомление в кабинете, забрать в деканате' : 'здесь появится кнопка «Открыть PDF» и уведомление в кабинете')}`}
</div>
<div style="margin:4px 20px 0;padding-top:12px;border-top:1px solid var(--line)">
${!isAid ? html`<div class="kv"><span>Дата заказа</span><span>${T.stamp(new Date(r.submitted_at || r.created_at))}</span></div>` : ''}
${purpose ? html`<div class="kv"><span>Куда</span><span>${purpose.label}</span></div>` : ''}
${r.type === 'tax' ? html`<div class="kv"><span>Год оплаты</span><span>${r.purpose}</span></div><div class="kv"><span>Как получить вычет</span><span><a href="/help/tax?back=/requests/${r.id}">декларация 3-НДФЛ</a></span></div>` : ''}
${isAid ? html`<div class="kv"><span>Основание</span><span>${r.purpose}</span></div>` : ''}
${r.details ? html`<div class="kv"><span>${t.detailsLabel || (r.type === 'tax' ? 'ИНН' : 'Уточнение')}</span><span>${r.details}</span></div>` : ''}
${r.note ? html`<div class="kv"><span>Примечание</span><span>${r.note}</span></div>` : ''}
${r.format ? html`<div class="kv"><span>Формат</span><span>${formatOf(r.type, r.format)?.label || r.format}</span></div>` : ''}
${docFiles.map((f) => html`<div class="kv"><span>Документ</span><span><a href="/files/${f.id}" target="_blank" rel="noopener">${f.name}</a></span></div>`)}
</div>
<section class="section" aria-labelledby="msg-h"><h2 class="label" id="msg-h">Переписка по заявке</h2>
${msgs.map((e) => html`<div class="bubble ${e.actor_role === 'staff' ? 'staff' : ''}"><div class="small muted">${e.actor_role === 'staff' ? `${e.actor_name}, деканат` : 'Ты'} · ${T.stamp(new Date(e.at))}</div>${e.text}</div>`)}
${['ready', 'rejected'].includes(r.status) && !msgs.length ? html`<p class="small muted">Сообщений нет.</p>` : ''}
<form method="post" action="/requests/${r.id}/message" style="margin-top:10px">
<label class="field" style="margin-top:0"><span class="sr-only">Сообщение</span><textarea name="text" required maxlength="1000" placeholder="Написать по заявке — ответит сотрудник деканата"></textarea></label>
<div class="actions"><button class="btn secondary small" type="submit">Отправить сообщение</button></div></form>
</section>`,
  });
}

function docHelp(ctx) {
  const { name, back } = ctx;
  const h = DOC_HELP[name];
  return page({
    title: 'Где взять справку', active: 'requests', ctx,
    body: html`${backBar(back || '/requests', 'Назад')}<div class="page-head"><h1>${name}: где взять</h1></div>
<section class="section">${h ? html`<ul style="padding-left:20px;margin:0;line-height:1.5">${h.where.map((w) => html`<li style="margin-bottom:8px">${w}</li>`)}</ul>
<div class="note amber" style="margin-top:12px">${h.note}</div>` : html`<p>Подсказки для этого документа пока нет. Уточните в деканате.</p>`}
<div class="actions" style="margin-top:16px"><a class="btn secondary small" href="/helper?q=${encodeURIComponent(`Где взять: ${name}?`)}">Спросить помощника</a></div></section>`,
  });
}

// ---------- Я ----------
function me(ctx) {
  const { user } = ctx;
  const wd = T.weekday(); const min = T.minutesOfDay();
  const open = wd <= 5 && min >= 540 && min < 1020;
  const linkRow = (href, title, meta) => html`<a class="row" href="${href}" style="min-height:56px"><span class="body"><span class="title strong" style="font-size:15px">${title}</span>${meta ? html`<span class="meta">${meta}</span>` : ''}</span>${I.chev}</a>`;
  return page({
    title: 'Я', active: 'me', ctx,
    body: html`<div class="page-head" style="padding-top:16px"><h1>Я</h1></div>
<section class="section" style="padding-top:12px"><div class="card">
<div style="display:flex;gap:12px;align-items:center"><span style="width:52px;height:52px;border-radius:26px;background:var(--blue-soft);color:var(--blue);display:flex;align-items:center;justify-content:center;font-weight:700">${user.full_name.split(' ').slice(0, 2).map((s) => s[0]).reverse().join('')}</span>
<div><div style="font-weight:600;font-size:17px">${user.full_name}</div><div class="small muted">${user.gender === 'f' ? 'Студентка' : 'Студент'} · ${user.form} форма, ${user.funding}</div></div></div>
<div style="margin-top:12px"><div class="kv"><span>Факультет</span><span>${user.faculty}</span></div><div class="kv"><span>Направление</span><span>${user.program}</span></div>
<div class="kv"><span>Курс и группа</span><span>${user.course} курс · ${user.group_name}</span></div><div class="kv"><span>Зачётная книжка</span><span>№ ${user.record_book}</span></div></div></div>
<div class="card"><div class="req-head"><b>Мой деканат</b><span class="small" style="color:${raw(open ? 'var(--green)' : 'var(--muted)')};font-weight:600">${open ? 'сейчас открыт' : 'сейчас закрыт'}</span></div>
<div class="small muted" style="margin-top:6px;font-size:14px">Корпус 1, каб. 210 · пн–пт 9:00–17:00<br>${user.level === 'магистратура' ? 'Руководитель НИР' : 'Куратор группы'}: ${user.curator}</div>
<div class="actions"><a class="btn small" href="/requests/new">Новая заявка</a><a class="btn secondary small" href="/helper">Спросить помощника</a></div></div>
<div class="card" style="padding-top:4px;padding-bottom:4px">
${linkRow('/hard', 'Если тяжело', 'Контакты психолога и телефоны помощи')}
${linkRow('/me/notifications', 'Уведомления', 'Какие уведомления получать')}
${linkRow('/notifications', 'Все уведомления', '')}
<form method="post" action="/logout"><button class="row" style="width:100%;background:none;border:0;cursor:pointer;text-align:left;min-height:56px"><span class="body"><span class="title strong" style="font-size:15px">Выйти</span></span>${I.chev}</button></form>
</div>
<p id="about" class="small muted" style="text-align:center;margin:16px 0">Концепт для конкурса MGIMO AI Challenge. Не официальный сервис ДГТУ. Все данные вымышленные.</p></section>`,
  });
}

function notifSettings(ctx) {
  const { settings } = ctx;
  return page({
    title: 'Уведомления', active: 'me', ctx,
    body: html`${backBar('/me', 'Я')}<div class="page-head"><h1>Уведомления</h1><p class="muted" style="margin:4px 0 0;font-size:14px">Выбери, о чём показывать уведомления. В ленте кабинета видно всё.</p></div>
<form method="post" action="/me/notifications" class="section" style="padding-top:12px" data-autosave>
${NOTIF_CATEGORIES.map((c) => html`<label class="toggle-row"><span class="body"><span>${c.title}</span><span class="small muted">${c.hint}</span></span>
<input class="switch" type="checkbox" role="switch" name="notif_${c.key}" value="1" ${settings['notif_' + c.key] !== '0' ? raw('checked') : ''}></label>`)}
<noscript><button class="btn block" type="submit">Сохранить</button></noscript>
<p class="small muted" data-saved hidden>Сохранено</p>
</form>
<div class="section" style="padding-top:8px"><div class="note">${I.lock}<span>На экране блокировки не показываем баллы, оценки и содержание заявок — только тему: «Есть изменение в заявке».</span></div>
<p class="small muted" style="margin-top:12px;font-size:14px">Тихие часы: с 22:00 до 8:00</p>
<div class="card" style="margin-top:8px"><b>Уведомления в браузере</b><p class="small muted" style="font-size:14px;margin:4px 0 0">Пока кабинет открыт, браузер покажет уведомление о смене статуса заявки.</p>
<div class="actions"><button class="btn secondary small" type="button" data-ask-permission-btn>Разрешить на этом устройстве</button></div><p class="small muted" data-perm-state></p></div></div>`,
  });
}

const CAT = { schedule: 'Изменение расписания', requests: 'Заявка', deadlines: 'Дедлайн', announcements: 'Деканат', grades: 'Учёба' };
function notifications(ctx) {
  const { items, filter } = ctx;
  const f = [['', 'Все'], ['deadlines', 'Сроки'], ['schedule', 'Изменения'], ['requests', 'Заявки'], ['announcements', 'Деканат'], ['grades', 'Учёба']];
  const shown = filter ? items.filter((n) => n.category === filter) : items;
  return page({
    title: 'Уведомления', active: 'today', ctx,
    body: html`${backBar('/', 'Сегодня')}<div class="page-head"><h1>Уведомления</h1></div>
<nav class="chips" style="padding:12px 20px 0" aria-label="Фильтр">${f.map(([k, l]) => html`<a href="/notifications${k ? '?c=' + k : ''}" style="text-decoration:none"><span style="${raw(filter === k ? 'background:var(--blue);color:#fff;border-color:var(--blue);' : '')}display:inline-flex;align-items:center;min-height:40px;padding:0 14px;border-radius:20px;border:1px solid var(--line);background:${raw(filter === k ? 'var(--blue)' : '#fff')};font-size:14px;color:${raw(filter === k ? '#fff' : 'var(--ink)')}">${l}</span></a>`)}</nav>
<section class="section" style="padding-top:6px">${shown.length ? shown.map((n) => html`<a class="feed-item ${n.read ? '' : 'unread'}" href="${n.link || '#'}"><div style="flex:1">
<div class="req-head"><span class="cat">${CAT[n.category] || ''}</span><span class="small muted">${T.relDateTime(new Date(n.at))}</span></div>
<div style="font-weight:600;margin-top:2px">${n.title}</div>${n.body ? html`<div class="small muted" style="font-size:14px;margin-top:2px">${n.body}</div>` : ''}</div></a>`)
    : html`<p class="muted">Уведомлений нет.</p>`}</section>`,
  });
}

function hard(ctx) {
  const opt = (href, title, text) => html`<a class="card" href="${href}" style="display:flex;gap:12px;text-decoration:none;color:var(--ink);margin-top:10px"><span style="flex:1"><b>${title}</b><span class="small muted" style="display:block;margin-top:2px;font-size:14px">${text}</span></span>${I.chev}</a>`;
  return page({
    title: 'Если тяжело', active: 'me', ctx,
    body: html`${backBar('/me', 'Я')}<div class="page-head"><h1>Хорошо, что ты здесь</h1><p class="muted" style="margin:6px 0 0">Можно ничего не объяснять. Выбери, что сейчас ближе — или просто закрой.</p></div>
<section class="section" style="padding-top:8px">
${opt('#psy', 'Поговорить с психологом', 'Контакт психологической службы вуза')}
${opt('/helper?q=' + encodeURIComponent('Мне нужно больше времени на работы. Как попросить отсрочку?'), 'Мне нужно больше времени', 'Помощник подготовит просьбу об отсрочке — без объяснения причин')}
${opt('/study/grades', 'Не справляюсь с учёбой', 'Разберём по шагам, что можно сделать позже')}
<div class="card" id="psy" style="margin-top:16px"><b>Если тяжело прямо сейчас</b>
<div class="actions"><a class="btn small" href="tel:112">112 — экстренные службы</a><a class="btn secondary small" href="tel:+74959895050">+7 495 989-50-50</a></div>
<p class="small muted" style="margin:8px 0 0">+7 495 989-50-50 — телефон экстренной психологической помощи МЧС России, круглосуточно, для взрослых из любого региона.</p>
<p class="small muted" style="margin:8px 0 0">Психологическая служба вуза (демо-контакт): корпус 1, каб. 115, пн–пт 10:00–18:00.</p></div>
<div class="note" style="margin-top:12px">${I.lock}<span>Открытие этой страницы не создаёт обращения в деканат и не отправляет уведомлений куратору.</span></div>
</section>`,
  });
}

function route(ctx) {
  const { room } = ctx;
  const [b, r] = String(room || '').split('-');
  return page({
    title: 'Как пройти', active: 'study', ctx,
    body: html`${backBar('/', 'Назад')}<div class="page-head"><h1>Как пройти в ${room ? `ауд. ${room}` : 'аудиторию'}</h1></div>
<section class="section">${r ? html`<div class="stages" style="padding:0">
<div class="stage"><div class="st">Корпус ${b}</div><div class="when">Вход с главной площади кампуса</div></div>
<div class="stage"><div class="st">${r[0]} этаж</div><div class="when">Лестница или лифт справа от входа</div></div>
<div class="stage current"><div class="st">Аудитория ${room}</div><div class="when">Номера по возрастанию — от лестницы налево</div></div></div>` : html`<p>Аудитория не указана.</p>`}
<div class="note" style="margin-top:8px">Демо-маршрут. В рабочей версии кнопка откроет навигатор по корпусам ДГТУ с готовым маршрутом.</div></section>`,
  });
}

function helper(ctx) {
  const { q, user } = ctx;
  const sugg = [
    ['Когда у меня зачёты и экзамены?', 'Когда сессия'],
    ['Сколько баллов мне не хватает до допуска?', 'Баллы до допуска'],
    user.funding === 'контракт' ? ['Нужна справка для налогового вычета за обучение', 'Налоговый вычет'] : ['Нужна справка об обучении для субсидии на ЖКУ', 'Справка в соцзащиту'],
    ['Где завтра пары?', 'Пары на завтра'],
    ['Мне нужно больше времени на работы. Как попросить отсрочку?', 'Попросить отсрочку'],
  ];
  return page({
    title: 'Помощник', active: 'today', ctx,
    body: html`${backBar('/', 'Помощник')}
<div class="page-head" style="padding-top:0"><p class="small muted" style="margin:0">Отвечает по данным твоего кабинета и демо-правилам. Может ошибаться — важное уточняй в деканате.</p></div>
<div class="chat" id="chat" aria-live="polite">
<div class="msg bot">Что нужно? Спроси про справку, баллы до допуска, даты зачётов и экзаменов или пары на завтра.</div></div>
<div class="suggest" id="suggest" style="margin-top:10px">
${sugg.map(([qq, l]) => html`<button type="button" data-q="${qq}">${l}</button>`)}
<a href="/hard">Мне тяжело</a></div>
<div style="height:170px"></div>
<div class="composer"><form id="ask" autocomplete="off"><label class="sr-only" for="q">Вопрос</label><input id="q" name="q" maxlength="500" placeholder="Спроси про учёбу" value="${q || ''}">
<button type="submit" aria-label="Отправить">${I.send}</button></form></div>`,
  });
}

module.exports = { situation, situationList, recordBook, dataHelp, taxHelp, today, schedule, grades, nir, requestsList, newRequestChoose, newRequestForm, requestSent, requestDetail, docHelp, me, notifSettings, notifications, hard, route, helper, plural };
