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
const changeText = (p) => {
  if (p.old_start && p.old_room) return `Перенос: ${p.start} вместо ${p.old_start}, ауд. ${p.room} вместо ${p.old_room}`;
  if (p.old_start) return `Перенос · было ${p.old_start}`;
  if (p.old_room) return `Аудитория изменена · было ${p.old_room}`;
  return '';
};
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
    return html`<span class="pt ${cls}" style="left:${pos(m).toFixed(1)}%"></span>${nowPos != null && Math.abs(pos(m) - nowPos) < 9 ? '' : html`<span class="t ${cls}" style="left:${pos(m).toFixed(1)}%;${raw(lbl(pos(m)))}">${p.start}</span>`}`;
  })}
${nowPos != null ? html`<span class="now" style="left:${nowPos.toFixed(1)}%"></span><span class="t is-now" style="left:${nowPos.toFixed(1)}%;${raw(lbl(nowPos))}">сейчас</span>` : ''}</div>`;
}

function lightsBar(ds) {
  return html`<span class="lights">${ds.map((d) => html`<i class="l-${d.light}"></i>`)}</span>`;
}
function gradesSummary(ds) {
  const red = ds.find((d) => d.light === 'red');
  const amber = ds.find((d) => d.light === 'amber');
  if (red) return html`<b>${red.subject}:</b> ${red.overdue.length ? `не ${plural(red.overdue.length, 'сдана', 'сданы', 'сданы')} ${red.overdue.length} ${plural(red.overdue.length, 'работа', 'работы', 'работ')}` : `до зачёта ${red.gap} ${plural(red.gap, 'балл', 'балла', 'баллов')}`}`;
  if (amber) return html`<b>${amber.subject}:</b> до зачёта ${amber.gap} ${plural(amber.gap, 'балл', 'балла', 'баллов')}`;
  return html`<b>Все дисциплины в порядке</b>`;
}

// ---------- Сегодня ----------
function today(ctx) {
  const { user, next, ds, todo, unread } = ctx;
  const key = T.dateKey();
  let hero = html`<div class="hero"><div class="subj">Пар в ближайшие две недели нет</div></div>`;
  if (next) {
    const cd = countdown(next.startsAt, next.endsAt);
    const isToday = T.dateKey(next.startsAt) === key;
    const ch = changeText(next);
    hero = html`<section class="hero" aria-label="Ближайшая пара">
${isToday ? '' : html`<div class="small" style="color:#AFC3FF">Сегодня пар больше нет · ${cd.small}</div>`}
${dayLine(next.dayPairs, isToday, next)}
<div class="big">${cd.big}</div>
<div style="display:flex;flex-direction:column;gap:4px">
<div class="subj">${next.subject}</div>
<div class="where">${whereText(next)} · ${next.kind}</div>
${ch ? html`<div class="warn">${ch}</div>` : ''}
</div>
${next.online ? '' : html`<a class="btn-white" href="/route?room=${encodeURIComponent(next.room || '')}">Как пройти</a>`}
<a class="ghost" href="/study?d=${T.dateKey(next.startsAt)}">Всё расписание дня</a>
</section>`;
  }
  return page({
    title: 'Сегодня', active: 'today', ctx,
    body: html`
<div class="top"><div class="date">${T.wdShortKey(key)}, ${T.dayMonthKey(key)} · ${T.parityLabel(key)}</div>
<div style="display:flex;gap:2px">
<a class="icon-btn" href="/helper" aria-label="Что нужно? Поиск и помощник">${I.search}</a>
<a class="icon-btn" href="/notifications" aria-label="Уведомления${unread ? `, новых: ${unread}` : ''}">${I.bell}${unread ? html`<span class="dot"></span>` : ''}</a>
</div></div>
<h1 class="sr-only">Сегодня, ${user.first_name}</h1>
${hero}
<section class="section" aria-labelledby="todo-h">
<h2 class="label" id="todo-h">Нужно сделать · ${todo.length}</h2>
${todo.length ? html`<div>${todo.map((t) => html`<div class="row">${t.amber ? html`<span class="bar amber"></span>` : html`<span class="bar"></span>`}
<div class="body"><div class="title">${t.title}</div><div class="meta">${t.meta}</div></div>${t.href ? html`<a class="act" href="${t.href}">${t.action}</a>` : ''}</div>`)}</div>`
    : html`<p class="muted">Всё сделано. Хорошего дня!</p>`}
</section>
<a class="row" href="/study/grades" style="margin:10px 20px 0;border-top:1px solid var(--line);border-bottom:0">
${lightsBar(ds)}<span class="body small" style="font-size:14px">${gradesSummary(ds)}</span>${I.chev}</a>`,
  });
}

// ---------- Учёба ----------
function studyTabs(user, cur) {
  const tabs = [['schedule', '/study', 'Расписание'], ['grades', '/study/grades', 'Оценки']];
  if (user.level === 'магистратура') tabs.push(['nir', '/study/nir', 'НИР']);
  return html`<nav class="seg" aria-label="Учёба">${tabs.map(([k, h, l]) => html`<a href="${h}" ${k === cur ? raw('aria-current="page"') : ''}>${l}</a>`)}</nav>`;
}

function schedule(ctx) {
  const { user, sel, week, pairs } = ctx;
  return page({
    title: 'Расписание', active: 'study', ctx,
    body: html`<div class="page-head" style="padding-top:16px"><h1>Учёба</h1></div>
${studyTabs(user, 'schedule')}
<div class="days" role="list" aria-label="Дни недели">${week.map((d) => html`<a role="listitem" href="/study?d=${d.key}" ${d.key === sel ? raw('aria-current="date"') : ''}>
<span>${T.wdShortKey(d.key)}</span><b>${Number(d.key.slice(8))}</b>${d.changed ? html`<span class="ch" title="есть изменения"></span>` : ''}</a>`)}</div>
<div style="display:flex;justify-content:space-between;padding:6px 20px 0">
<a class="link" style="padding-left:0" href="/study?d=${T.addDays(week[0].key, -7)}">← пред. неделя</a>
<a class="link" style="padding-right:0" href="/study?d=${T.addDays(week[0].key, 7)}">след. неделя →</a></div>
<section class="section" style="padding-top:4px" aria-label="Пары">
<h2 class="label">${T.wdLongKey(sel)}, ${T.dayMonthKey(sel)} · ${T.parityLabel(sel)}</h2>
${pairs.length ? pairs.map((p) => html`<article class="pair">
<div class="tm"><span>${p.start}–${p.end}</span><span>${p.cancelled ? 'отменена' : p.kind}</span></div>
<div class="nm">${p.subject}</div>
<div class="small muted" style="margin-top:2px">${p.teacher} · ${roomText(p)}</div>
${changeText(p) ? html`<div class="changed">${changeText(p)}. Обновлено ${T.relDateTime(new Date(p.change.created_at))}</div>` : ''}
${p.online || p.cancelled ? '' : html`<div class="actions"><a class="btn secondary small" href="/route?room=${encodeURIComponent(p.room)}">Как пройти</a></div>`}
</article>`) : html`<div class="card" style="margin-top:10px"><b>Пар нет.</b><div class="small muted">Выбери другой день или неделю.</div></div>`}
</section>`,
  });
}

function grades(ctx) {
  const { user, ds } = ctx;
  const bad = ds.filter((d) => d.light === 'red' || d.light === 'amber').length;
  const ok = ds.length - bad;
  const word = (d) => {
    if (d.light === 'done') return d.closed_text;
    if (d.light === 'red' && d.overdue.length) return `Не сданы: ${d.overdue.map((w) => `${w.title} (${w.max})`).join(', ')}. До зачёта ${d.gap} ${plural(d.gap, 'балл', 'балла', 'баллов')}.`;
    if (d.gap > 0) {
      const nx = d.upcoming[0];
      return `До ${d.control === 'зачёт' ? 'зачёта' : 'допуска'} ${d.gap} ${plural(d.gap, 'балл', 'балла', 'баллов')}${nx ? `. Ближайшее: ${nx.title} (${nx.max}) до ${T.dayMonthKey(nx.due_key)}` : ''}.`;
    }
    if (d.autoGap) return `Порог пройден. До автомата ${d.autoGap} ${plural(d.autoGap, 'балл', 'балла', 'баллов')}.`;
    return 'Порог пройден.';
  };
  const color = { green: 'var(--green)', amber: '#D97706', red: 'var(--red-dot)', done: '#98A2B3' };
  return page({
    title: 'Оценки', active: 'study', ctx,
    body: html`<div class="page-head" style="padding-top:16px"><h1>Учёба</h1></div>
${studyTabs(user, 'grades')}
<section class="hero" style="margin-top:14px" aria-label="Готовность к сессии">
<div class="small" style="color:#AFC3FF;font-weight:600;letter-spacing:.05em">ГОТОВНОСТЬ К СЕССИИ</div>
<div class="subj" style="font-size:22px">${bad ? `${ok} ${plural(ok, 'дисциплина', 'дисциплины', 'дисциплин')} в порядке, по ${bad} нужно действовать` : 'Все дисциплины в порядке'}</div>
<div style="display:flex;gap:4px">${ds.map((d) => html`<span style="flex:1;height:6px;border-radius:3px;background:${raw(color[d.light])}"></span>`)}</div>
<div class="small" style="color:#D5DDF0">Баллы обновлены ${T.relDateTime(new Date(ds[0] ? ds[0].updated_at : T.now()))}</div>
</section>
<section class="section" aria-label="Дисциплины">
${ds.map((d) => html`<details class="card" style="margin-top:10px">
<summary style="list-style:none;cursor:pointer;display:flex;gap:10px">
<span class="dotc" style="background:${raw(color[d.light])}"></span>
<span style="flex:1;min-width:0"><span style="display:flex;justify-content:space-between;gap:8px"><b style="font-weight:600">${d.subject}</b><span class="muted" style="white-space:nowrap">${d.closed_text ? 'зачтено' : `${d.points} / 100`}</span></span>
<span class="small muted" style="display:block;margin-top:2px">${word(d)}</span></span></summary>
<div style="margin-top:10px">${d.works.map((w) => html`<div class="kv"><span>${w.title}${w.due_key && w.score == null ? html` · до ${T.dayMonthKey(w.due_key)}` : ''}</span><span>${w.score == null ? '—' : w.score} / ${w.max}</span></div>`)}
<div class="small muted" style="margin-top:6px">${d.control} · порог ${d.pass_threshold}${d.auto_threshold ? ` · автомат от ${d.auto_threshold}` : ''} · ${d.teacher}</div>
<div class="actions"><a class="btn secondary small" href="/helper?q=${encodeURIComponent(`Что мне сделать по дисциплине «${d.subject}»?`)}">Спросить помощника</a></div></div>
</details>`)}
</section>`,
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
<section class="hero" style="margin-top:14px"><div class="small" style="color:#AFC3FF;font-weight:600">НИР · 1 СЕМЕСТР · РУКОВОДИТЕЛЬ: ${user.curator}</div>
<div class="big">${sum} <span style="font-size:18px;font-weight:500">из 100 баллов</span></div>
<div class="progress" style="background:#3A4766"><i style="width:${sum}%"></i></div>
<div class="small" style="color:#D5DDF0">До «отлично» ещё ${Math.max(0, 85 - sum)} ${plural(Math.max(0, 85 - sum), 'балл', 'балла', 'баллов')}</div></section>
<section class="section">${stages.map((s) => html`<div class="card" style="margin-top:10px">
<div class="req-head"><b>${s.title}</b><span class="muted">${s.score == null ? '—' : s.score} / ${s.max}</span></div>
<div style="margin-top:6px">${stateTag[s.state]}</div>
${s.note || s.due_key ? html`<div class="small muted" style="margin-top:6px">${[s.note, s.due_key ? `до ${T.dayMonthKey(s.due_key)}` : ''].filter(Boolean).join(' · ')}</div>` : ''}</div>`)}
<p class="small muted">Файлы этапов в демо не загружаются: в рабочей версии файл, загруженный здесь, сразу попадёт и в отчёт по НИР.</p>
</section>`,
  });
}

// ---------- Заявки ----------
function reqRowWaiting(r) {
  const who = r.status === 'in_work' && r.assignee ? `В деканате · оформляет ${r.assignee.short_name}` : 'В деканате · ждёт сотрудника';
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
${drafts.length ? html`<section class="section"><h2 class="label">Черновики</h2>${drafts.map((r) => html`<a class="row" href="/requests/new?type=${r.type}&draft=1"><div class="body"><span class="title strong">${r.title}</span><span class="meta">Заполнен из профиля · проверь и отправь</span></div>${I.chev}</a>`)}</section>` : ''}
<section class="section"><h2 class="label">Ждут деканат</h2>
${wait.length ? wait.map(reqRowWaiting) : html`<p class="muted small">Сейчас ничего не ждёт.</p>`}</section>
<section class="section"><h2 class="label">Готовые и закрытые</h2>
${done.length ? done.map((r) => html`<div class="row"><div class="body">
<div class="req-head"><a href="/requests/${r.id}" class="title strong" style="color:inherit;text-decoration:none">${r.title}</a><span class="num">№ ${r.number}</span></div>
<div style="font-size:14px">${r.status === 'ready' ? `Готова · ${T.dayMonth(new Date(r.closed_at))}` : `Отклонена · ${r.reject_reason || ''}`}</div>
${r.status === 'ready' && TYPES[r.type].producesPdf && r.format !== 'paper' ? html`<div class="actions"><a class="btn secondary small" href="/requests/${r.id}/pdf" target="_blank" rel="noopener" style="color:var(--blue)">${I.file}Открыть PDF</a></div>`
    : r.status === 'ready' && r.format === 'paper' ? html`<div class="meta">Забрать в деканате: корпус 1, каб. 210</div>` : ''}
</div></div>`) : html`<p class="muted small">Пока пусто.</p>`}</section>`,
  });
}

function newRequestChoose(ctx) {
  return page({
    title: 'Новая заявка', active: 'requests', ctx,
    body: html`${backBar('/requests', 'Заявки')}<div class="page-head"><h1>Новая заявка</h1><p class="muted" style="margin:6px 0 0">Что нужно? Не нашли — спросите помощника.</p></div>
<section class="section">${Object.entries(TYPES).map(([k, t]) => html`<a class="row" href="/requests/new?type=${k}"><div class="body"><span class="title strong">${t.title}</span>
<span class="meta">${t.subtitle || (k === 'study' ? 'Для проездного, соцзащиты, работодателя' : k === 'visa' ? 'На английском, 3 рабочих дня' : 'Заявление и документы')}</span></div>${I.chev}</a>`)}
<div class="actions"><a class="btn secondary small" href="/helper">Спросить помощника</a></div></section>`,
  });
}

function newRequestForm(ctx) {
  const { user, type, draft, values = {}, error, years = [], payments = [] } = ctx;
  const t = TYPES[type];
  const isTax = type === 'tax';
  const taxYears = years.filter((y) => y.eligibleForm);
  const v = { purpose: draft?.purpose || values.purpose || (t.purposes ? t.purposes[0].id : ''), format: draft?.format || values.format || t.formats?.[0].id, details: draft?.details || values.details || '' };
  return page({
    title: 'Новая заявка', active: 'requests', ctx,
    body: html`${backBar('/requests/new', 'Новая заявка')}<div class="page-head"><h1>${t.title}</h1>${draft ? html`<p class="muted" style="margin:6px 0 0">Черновик заполнен ${isTax ? 'по договору' : 'из профиля'}. Проверь и отправь.</p>` : ''}</div>
<form method="post" action="/requests" enctype="multipart/form-data" class="section" style="padding-top:8px">
<input type="hidden" name="type" value="${type}">
${error ? html`<div class="note red" role="alert">${error}</div>` : ''}
${t.purposes ? html`<fieldset class="field" style="border:0;padding:0;margin:16px 0 0"><legend style="padding:0;margin-bottom:6px">Куда нужна? <span class="hint">От этого зависит формулировка</span></legend>
<div class="chips">${t.purposes.map((p) => html`<label><input type="radio" name="purpose" value="${p.id}" ${v.purpose === p.id ? raw('checked') : ''}><span>${p.label}</span></label>`)}</div></fieldset>` : ''}
${t.reasons ? html`<label class="field">Основание<select name="purpose">${t.reasons.map((r) => html`<option ${v.purpose === r ? raw('selected') : ''}>${r}</option>`)}</select></label>` : ''}
${t.detailsLabel || t.purposes ? html`<label class="field">${t.detailsLabel || 'Уточнение'} <span class="hint">${t.detailsLabel ? '' : 'необязательно, например название организации'}</span>
<textarea name="details" maxlength="500" placeholder="${t.detailsPlaceholder || ''}">${v.details}</textarea></label>` : ''}
${t.formats && t.formats.length > 1 ? html`<fieldset class="field" style="border:0;padding:0;margin:16px 0 0"><legend style="padding:0;margin-bottom:6px">Формат</legend>
<div class="options">${t.formats.map((f) => html`<label><input type="radio" name="format" value="${f.id}" ${v.format === f.id ? raw('checked') : ''}><span class="opt">${f.label}<small>${f.hint}</small></span></label>`)}</div></fieldset>`
    : html`<input type="hidden" name="format" value="${t.formats?.[0].id || ''}">${t.formats ? html`<p class="small muted">${t.formats[0].label}: ${t.formats[0].hint}</p>` : ''}`}
${isTax ? taxFields(payments, taxYears, v, user) : ''}
${t.requiredDocs ? html`<label class="field">${t.requiredDocs[0]} <span class="hint">PDF или фото, до 5 МБ. Можно загрузить позже.</span>
<input type="file" name="doc" accept=".pdf,.jpg,.jpeg,.png" class="input"></label>
<a class="link" style="padding-left:0" href="/help/doc?name=${encodeURIComponent(t.requiredDocs[0])}&back=${encodeURIComponent('/requests/new?type=' + type)}">Где взять справку</a>` : ''}
<div class="card" style="margin-top:16px"><div class="req-head"><span class="small muted">Данные из профиля</span><a class="small" href="/me">Неверно?</a></div>
<div style="font-size:15px;margin-top:6px">${user.full_name}<br>${user.course} курс, ${user.group_name} · ${user.form}, ${user.funding}</div></div>
<button class="btn block" type="submit" style="margin-top:18px" ${isTax && !taxYears.length ? raw('disabled') : ''}>Отправить заявку</button>
</form>`,
  });
}

// Справка для вычета: сначала проверяем условия по данным кабинета, потом спрашиваем только год
function taxFields(payments, years, v, user) {
  const contract = payments[0]?.contract;
  const self = payments.length && payments.every((p) => p.payer === user.full_name);
  const ok = (text) => html`<div style="display:flex;gap:8px;align-items:flex-start;margin-top:6px"><span aria-hidden="true" style="color:var(--green);font-weight:700">✓</span><span>${text}</span></div>`;
  if (!years.length) return html`<div class="note amber" style="margin-top:16px">В кабинете нет оплат по договору за 2024 год и позже. Если обучение платное — напиши в деканат по любой заявке, проверим договор.</div>`;
  const sel = years.some((y) => String(y.year) === String(v.purpose)) ? String(v.purpose) : String(years[0].year);
  return html`<div class="card" style="margin-top:16px;background:var(--green-soft);border-color:#BFE3CB"><b>Условия проверены по данным кабинета</b>
<div style="font-size:14px;line-height:1.4">${ok(`Платное обучение по договору № ${contract}`)}
${self ? ok('Платил(а) ты сам(а) — за своё обучение вычет положен при любой форме обучения') : ''}
${ok('Оплата с 2024 года — для налоговой хватит одной этой справки, договор и чеки не нужны')}</div></div>
<fieldset class="field" style="border:0;padding:0;margin:16px 0 0"><legend style="padding:0;margin-bottom:6px">За какой год оплаты</legend>
<div class="options" style="grid-template-columns:1fr">${years.map((y) => html`<label><input type="radio" name="purpose" value="${y.year}" ${sel === String(y.year) ? raw('checked') : ''}>
<span class="opt">${y.year} · оплачено ${TAX.rub(y.sum)}<small>Вернуть можно до ${TAX.rub(y.refund)}*</small></span></label>`)}</div></fieldset>
<label class="field">ИНН <span class="hint">необязательно · 12 цифр. Если не указать, в справке будут паспортные данные из личного дела</span>
<input type="text" name="details" inputmode="numeric" maxlength="12" pattern="\d{12}" value="${/^\d{12}$/.test(v.details) ? v.details : ''}" autocomplete="off"></label>
<p class="small muted" style="margin-top:10px">* 13% от оплаты, но не больше 13% от ${TAX.rub(TAX.OWN_LIMIT)} в год вместе с другими социальными вычетами (лечение, спорт) — если зарплата облагается по ставке 13%.</p>
<a class="link" style="padding-left:0" href="/help/tax">Как получить вычет: через работу или налоговую</a>
<p class="small muted" style="margin:6px 0 0">Если платили родители или супруг(а), справку оформляют на их имя — в первой версии такую заявку подают в деканате.</p>`;
}

function taxHelp(ctx) {
  const step = (cls, t, w) => html`<div class="stage ${cls}"><div class="st">${t}</div><div class="when" style="font-size:14px;line-height:1.4">${w}</div></div>`;
  return page({
    title: 'Как получить вычет', active: 'requests', ctx,
    body: html`${backBar(ctx.back || '/requests', 'Назад')}<div class="page-head"><h1>Как получить вычет за обучение</h1>
<p class="muted" style="margin:6px 0 0">Справку из вуза несут не в бухгалтерию, а в налоговую. Дальше — два пути.</p></div>
<section class="section"><h2 class="label">В этом году — через работу</h2><div class="stages" style="padding:8px 0 0">
${step('', 'Справка из вуза', 'Закажи в «Заявках» — PDF придёт сюда.')}
${step('', 'Заявление в личном кабинете налогоплательщика', 'Приложи справку и запроси уведомление о праве на вычет у работодателя.')}
${step('', 'Уведомление — в бухгалтерию', 'Налоговая пришлёт уведомление тебе и работодателю, с этого месяца налог не удерживают до суммы вычета.')}
${step('todo', 'Остаток — в следующем году', 'Если до конца года вычет не использован полностью, остаток заявляют декларацией 3-НДФЛ.')}</div></section>
<section class="section"><h2 class="label">В следующем году — через налоговую</h2>
<p style="margin:6px 0 0;line-height:1.5">Подай декларацию 3-НДФЛ в личном кабинете налогоплательщика и приложи справку. Вернуть налог можно за три последних года.</p></section>
<section class="section"><div class="note">Подсказка концепта, не налоговая консультация. Сверено с материалами ФНС: с расходов 2024 года вместо договора и платёжек достаточно справки об оплате образовательных услуг (приказ ФНС от 18.10.2023 № ЕД-7-11/755@); вуз может и сам передать сведения в налоговую — тогда они появятся в личном кабинете.</div>
<div class="actions" style="margin-top:12px"><a class="btn small" href="/requests/new?type=tax">Заказать справку</a><a class="btn secondary small" href="/helper?q=${encodeURIComponent('Как получить налоговый вычет за обучение?')}">Спросить помощника</a></div></section>`,
  });
}

function requestSent(ctx) {
  const { r, perm } = ctx;
  return page({
    title: 'Заявка отправлена', active: 'requests', ctx,
    body: html`<div class="page-head" style="padding-top:40px">${I.check}
<h1 style="margin-top:14px">Заявка отправлена</h1>
<div class="sub">${r.title} · № ${r.number}</div>
<div class="small muted" style="margin-top:4px;font-size:14px">Ожидаемая готовность — ${T.relDateTime(new Date(r.eta_at))}</div></div>
<div style="margin:18px 20px 0;padding:14px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)">Сейчас действие за <b>деканатом</b>. Тебе ничего делать не нужно.</div>
${r.notify_ready ? html`<div class="note green" style="margin:16px 20px 0">Сообщим, когда справка будет готова.</div>` : html`<div class="card" style="margin:18px 12px 0" id="notify-card">
<div style="display:flex;gap:12px;align-items:flex-start"><span style="width:40px;height:40px;border-radius:20px;background:var(--blue-soft);color:var(--blue);display:flex;align-items:center;justify-content:center;flex:none">${I.bell}</span>
<div><div style="font-weight:600">Сообщить, когда справка будет готова?</div><div class="small muted" style="font-size:14px;margin-top:4px">Пришлём одно уведомление: «Справка готова». Без оценок и личных данных на экране блокировки.</div></div></div>
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
  const actor = r.status === 'need_student' ? html`Сейчас действие за <b>тобой</b>` : r.status === 'ready' ? html`<b>Готова</b>` : r.status === 'rejected' ? html`<b>Отклонена</b>` : html`Сейчас действие за <b>деканатом</b>`;
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
${stage('', 'Подана', by(ev('submitted')))}
${r.taken_at ? stage('', 'Взята в работу', by(ev('taken'))) : stage(r.status === 'submitted' ? 'current' : 'todo', 'Ждёт сотрудника', r.status === 'submitted' ? 'сейчас · обычно берут в течение часа в рабочее время' : '')}
${ev('uploaded') && r.status !== 'need_student' ? stage('', 'Документ загружен', by(ev('uploaded'))) : ''}
${r.status === 'need_student' ? stage('amber', 'Нужен документ', by(ev('need_doc')), html`<div class="bubble staff">${r.needs_text}</div>
<form id="upload" method="post" action="/requests/${r.id}/upload" enctype="multipart/form-data" style="margin-top:10px">
<label class="field" style="margin-top:0">Файл <span class="hint">PDF или фото, до 5 МБ</span><input class="input" type="file" name="doc" accept=".pdf,.jpg,.jpeg,.png" required></label>
<div class="actions"><button class="btn small" type="submit">Загрузить справку</button>${isAid ? html`<a class="link" href="/help/doc?name=${encodeURIComponent('Справка о составе семьи')}&back=/requests/${r.id}">Где взять справку</a>` : ''}</div>
<p class="small muted">Ожидаем документ. После загрузки деканат продолжит рассмотрение.</p></form>`) : ''}
${r.status === 'rejected' ? stage('amber', 'Отклонена', by(ev('rejected')), html`<div class="bubble staff">${r.reject_reason}</div>`)
    : r.status === 'ready' ? html`${stage('', workTitle, '')}${stage('', isAid ? 'Решение принято' : 'Готова', by(ev('ready')), isAid ? html`<div class="bubble staff">${ev('ready')?.text || 'Решение отправлено в бухгалтерию.'}</div>` : r.format === 'paper' ? html`<div class="bubble">Забрать: корпус 1, каб. 210, пн–пт 9:00–17:00</div>` : '')}`
      : html`${stage(r.status === 'in_work' ? 'current' : 'todo', workTitle, r.status === 'in_work' ? 'сейчас' : '', r.status === 'in_work' && purpose ? html`<div class="bubble">Справка с места учёбы ${purpose.full} · ${formatOf('study', r.format)?.label.toLowerCase()}</div>` : '')}
${stage('todo', isAid ? 'Решение' : 'Готова', isAid ? 'придёт уведомление с решением' : r.format === 'paper' ? 'придёт уведомление, забрать в деканате' : 'здесь появится кнопка «Открыть PDF», придёт уведомление')}`}
</div>
<div style="margin:4px 20px 0;padding-top:12px;border-top:1px solid var(--line)">
${purpose ? html`<div class="kv"><span>Куда</span><span>${purpose.label}</span></div>` : ''}
${r.type === 'tax' ? html`<div class="kv"><span>Год оплаты</span><span>${r.purpose}</span></div><div class="kv"><span>Как получить вычет</span><span><a href="/help/tax?back=/requests/${r.id}">через работу или налоговую</a></span></div>` : ''}
${isAid ? html`<div class="kv"><span>Основание</span><span>${r.purpose}</span></div>` : ''}
${r.details ? html`<div class="kv"><span>${t.detailsLabel || (r.type === 'tax' ? 'ИНН' : 'Уточнение')}</span><span>${r.details}</span></div>` : ''}
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
${linkRow('/hard', 'Если тяжело', 'Психолог и телефон доверия · анонимно, без деканата')}
${linkRow('/me/notifications', 'Уведомления', 'Что присылать и куда')}
${linkRow('/notifications', 'Все уведомления', '')}
<form method="post" action="/logout"><button class="row" style="width:100%;background:none;border:0;cursor:pointer;text-align:left;min-height:56px"><span class="body"><span class="title strong" style="font-size:15px">Выйти</span></span>${I.chev}</button></form>
</div>
<p class="small muted" style="text-align:center;margin:16px 0">Концепт для конкурса MGIMO AI Challenge. Не официальный сервис ДГТУ. Все данные вымышленные.</p></section>`,
  });
}

function notifSettings(ctx) {
  const { settings } = ctx;
  return page({
    title: 'Уведомления', active: 'me', ctx,
    body: html`${backBar('/me', 'Я')}<div class="page-head"><h1>Уведомления</h1><p class="muted" style="margin:4px 0 0;font-size:14px">Выбери, о чём сообщать. В самом кабинете видно всё.</p></div>
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
  const f = [['', 'Все'], ['schedule', 'Изменения'], ['requests', 'Заявки'], ['announcements', 'Деканат'], ['grades', 'Учёба']];
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
${opt('#psy', 'Поговорить с психологом', 'Психологическая служба вуза, запись без деканата')}
${opt('/helper?q=' + encodeURIComponent('Мне нужно больше времени на работы. Как попросить отсрочку?'), 'Мне нужно больше времени', 'Помощник подготовит просьбу об отсрочке — без объяснения причин')}
${opt('/study/grades', 'Не справляюсь с учёбой', 'Разберём по шагам, что можно сделать позже')}
<div class="card" id="psy" style="margin-top:16px"><b>Если тяжело прямо сейчас</b>
<div class="actions"><a class="btn small" href="tel:112">112 — экстренные службы</a><a class="btn secondary small" href="tel:88002000122">8-800-2000-122</a></div>
<p class="small muted" style="margin:8px 0 0">8-800-2000-122 — детский телефон доверия (для тех, кому нет 18, и их родителей), звонок бесплатный.</p>
<p class="small muted" style="margin:8px 0 0">Психологическая служба вуза (демо-контакт): корпус 1, каб. 115, пн–пт 10:00–18:00. Запись анонимна для деканата.</p></div>
<div class="note" style="margin-top:12px">${I.lock}<span>Это видишь только ты. Деканат и куратор не получают уведомлений о том, что ты открывал(а) этот экран.</span></div>
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
  const { q } = ctx;
  return page({
    title: 'Помощник', active: 'today', ctx,
    body: html`${backBar('/', 'Помощник')}
<div class="page-head" style="padding-top:0"><p class="small muted" style="margin:0">Отвечает по данным твоего кабинета и демо-правилам. Может ошибаться — важное уточняй в деканате.</p></div>
<div class="chat" id="chat" aria-live="polite">
<div class="msg bot">Что нужно? Например: справка для проездного, перевод на заочку, сколько баллов до зачёта.</div></div>
<div class="suggest" id="suggest" style="margin-top:10px">
<button type="button" data-q="Нужна справка для проездного">Справка для проездного</button>
<button type="button" data-q="Хочу перевестись на заочку">Перевод на заочку</button>
<button type="button" data-q="Нужна справка для налогового вычета за обучение">Налоговый вычет</button>
<button type="button" data-q="Сколько баллов мне не хватает до зачётов?">Баллы до зачёта</button>
<a href="/hard">Мне тяжело</a></div>
<div style="height:90px"></div>
<div class="composer"><form id="ask" autocomplete="off"><label class="sr-only" for="q">Вопрос</label><input id="q" name="q" maxlength="500" placeholder="Спроси про учёбу и жизнь в ДГТУ" value="${q || ''}">
<button type="submit" aria-label="Отправить">${I.send}</button></form></div>`,
  });
}

module.exports = { taxHelp, today, schedule, grades, nir, requestsList, newRequestChoose, newRequestForm, requestSent, requestDetail, docHelp, me, notifSettings, notifications, hard, route, helper, plural };
