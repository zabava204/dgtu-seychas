'use strict';
const { html, raw } = require('./html');
const { head, demoSwitcher, I } = require('./layout');
const T = require('../time');
const { TYPES, purposeOf, formatOf } = require('../catalog');
const TAX = require('../tax');

const TAG = { submitted: ['blue', 'Новая'], in_work: ['', 'В работе'], need_student: ['amber', 'Ждёт студента'], ready: ['green', 'Готова'], rejected: ['red', 'Отклонена'] };
const tag = (s, cert = true) => html`<span class="tag ${TAG[s][0]}">${s === 'ready' && !cert ? 'Решение принято' : TAG[s][1]}</span>`;

function shell({ title, ctx, cur, body }) {
  const c = ctx.counts;
  const nav = [['new', 'Новые', c.new], ['work', 'В работе', c.work], ['student', 'Ждут студента', c.student], ['done', 'Завершённые', c.done]];
  return html`${head(title, 'Кабинет деканата')}<body><div class="staff-layout">
<aside aria-label="Разделы деканата">
<div class="brand" style="display:flex;gap:10px;align-items:center;margin-bottom:14px">${I.logo}<div class="brand-t"><div style="font-weight:700">ДГТУ.Сейчас</div><div class="small" style="color:rgba(255,255,255,.82)">Кабинет деканата</div></div></div>
${nav.map(([k, l, n]) => html`<a href="/staff?f=${k}" ${cur === k ? raw('aria-current="page"') : ''}><span>${l}</span><span class="cnt">${n}</span></a>`)}
<a href="/staff/announce" ${cur === 'announce' ? raw('aria-current="page"') : ''}><span>Объявление студентам</span></a>
<a href="/a11y"><span class="lv-off">Версия для слабовидящих</span><span class="lv-on">Обычная версия</span></a>
<div class="who" style="margin-top:auto;font-size:13px;color:rgba(255,255,255,.82);padding:12px"><span class="who-name">${ctx.user.full_name}<br>${ctx.user.position}</span>
<form method="post" action="/logout" style="margin-top:8px"><button class="link" style="color:#fff;padding:0;min-height:36px">Выйти</button></form></div>
</aside>
<main>${ctx.flash ? html`<div class="note green" role="status" style="margin-bottom:16px">${ctx.flash.text}</div>` : ''}
<div class="small muted" style="margin-bottom:12px">Концепт для конкурса · не официальный сервис ДГТУ · данные вымышленные</div>
${demoSwitcher(ctx)}
${body}</main></div><script src="/app.js?v=20" defer></script></body></html>`;
}

// Пакет из жизненной ситуации: справки, заказанные одной кнопкой, — одной строкой очереди
function groupBundles(list) {
  const out = []; const seen = new Map();
  for (const r of list) {
    if (!r.bundle) { out.push([r]); continue; }
    if (seen.has(r.bundle)) { seen.get(r.bundle).push(r); continue; }
    const g = [r]; seen.set(r.bundle, g); out.push(g);
  }
  return out;
}
const bundleName = (r) => String(r.note || '').replace(/^Ситуация:\s*/, '') || 'жизненная ситуация';
function bundleRow(g) {
  const r = g[0];
  const eta = g.map((x) => x.eta_at).filter(Boolean).sort().pop();
  return html`<tr class="clickable bundle" data-href="/staff/requests/${r.id}">
<td data-label="Номер">${g.map((x) => html`<a style="display:block" aria-label="Заявка № ${x.number}: ${x.title}" href="/staff/requests/${x.id}">${x.number}</a>`)}</td>
<td data-label="Заявка"><span class="tag blue" style="margin-bottom:4px">Пакет · ${g.length} ${g.length < 5 ? 'справки' : 'справок'}</span><div style="font-weight:600">${bundleName(r)}</div>${g.map((x) => html`<div class="small muted">${x.title}</div>`)}</td>
<td data-label="Студент">${r.student_name}<div class="small muted">${r.group_name}</div></td><td data-label="Подана">${T.relDateTime(new Date(r.submitted_at || r.created_at))}</td>
<td data-label="Срок">${eta && g.some((x) => !['ready', 'rejected'].includes(x.status)) ? T.relDateTime(new Date(eta)) : '—'}</td><td data-label="Статус">${g.map((x) => html`<div style="margin-bottom:4px">${tag(x.status, TYPES[x.type].producesPdf)}</div>`)}</td></tr>`;
}

function queue(ctx) {
  const { list, filter } = ctx;
  const titles = { new: 'Новые заявки', work: 'В работе', student: 'Ждут действия студента', done: 'Завершённые' };
  return shell({
    title: 'Деканат', ctx, cur: filter,
    body: html`<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><h1>${titles[filter]}</h1>
<span class="muted small">Сейчас ${T.timeOf(T.now())}, ${T.dayMonthKey(T.dateKey())}</span></div>
<table class="table" style="margin-top:16px"><thead><tr><th>№</th><th>Заявка</th><th>Студент</th><th>Подана</th><th>Срок</th><th>Статус</th></tr></thead><tbody>
${list.length ? groupBundles(list).map((g) => g.length > 1 ? bundleRow(g) : html`<tr class="clickable" data-href="/staff/requests/${g[0].id}">
<td data-label="Номер"><a aria-label="Заявка № ${g[0].number}: ${g[0].title}" href="/staff/requests/${g[0].id}">${g[0].number}</a></td><td data-label="Заявка"><b style="font-weight:600">${g[0].title}</b>${g[0].type === 'study' && g[0].format === 'paper' ? html`<div class="small muted">бумажная</div>` : ''}</td>
<td data-label="Студент">${g[0].student_name}<div class="small muted">${g[0].group_name}</div></td><td data-label="Подана">${T.relDateTime(new Date(g[0].submitted_at || g[0].created_at))}</td>
<td data-label="Срок">${g[0].eta_at && !['ready', 'rejected'].includes(g[0].status) ? T.relDateTime(new Date(g[0].eta_at)) : '—'}</td><td data-label="Статус">${tag(g[0].status, TYPES[g[0].type].producesPdf)}${g[0].assignee ? html`<div class="small muted" style="margin-top:4px">${g[0].assignee.short_name}</div>` : ''}</td></tr>`)
    : html`<tr><td colspan="6" class="muted">В этом разделе заявок пока нет. Новые появятся после отправки студентами.</td></tr>`}
</tbody></table>
<form method="post" action="/staff/reset" style="margin-top:28px" data-confirm="Вернуть все демо-данные к исходному состоянию? Новые заявки и сообщения удалятся.">
<button class="btn danger small" type="submit">Сбросить демо-данные</button> <span class="small muted">Возвращает заявки, уведомления и сообщения к исходному состоянию.</span></form>`,
  });
}

function detail(ctx) {
  const { r, student, events, files } = ctx;
  const t = TYPES[r.type];
  const purpose = r.type === 'study' ? purposeOf('study', r.purpose) : null;
  const evText = { submitted: 'Подана студентом', taken: 'Взята в работу', need_doc: 'Запрошен документ', uploaded: 'Студент загрузил документ', ready: t.producesPdf ? 'Готова' : 'Решение принято', rejected: 'Отклонена', message: 'Сообщение' };
  const open = !['ready', 'rejected'].includes(r.status);
  return shell({
    title: `Заявка ${r.number}`, ctx, cur: { submitted: 'new', in_work: 'work', need_student: 'student' }[r.status] || 'done',
    body: html`<a class="link" style="padding-left:0" href="/staff?f=${{ submitted: 'new', in_work: 'work', need_student: 'student' }[r.status] || 'done'}">← К списку</a>
<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><h1>${r.title}</h1>${tag(r.status, TYPES[r.type].producesPdf)}</div>
<div class="muted" style="margin-top:4px">№ ${r.number} · подана ${T.stamp(new Date(r.submitted_at || r.created_at))}${r.eta_at && open ? ` · срок ${T.relDateTime(new Date(r.eta_at))}` : ''}</div>
<div class="grid2" style="margin-top:18px">
<div>
<div class="card"><b>Студент</b><div style="margin-top:8px">
<div class="kv"><span>ФИО</span><span>${student.full_name}</span></div><div class="kv"><span>Группа, курс</span><span>${student.group_name}, ${student.course} курс</span></div>
<div class="kv"><span>Направление</span><span>${student.program}</span></div><div class="kv"><span>Форма, основа</span><span>${student.form}, ${student.funding}</span></div>
<div class="kv"><span>Зачётная книжка</span><span>№ ${student.record_book}</span></div></div></div>
<div class="card"><b>Заявка</b><div style="margin-top:8px">
<div class="kv"><span>Тип</span><span>${t.title}</span></div>
${purpose ? html`<div class="kv"><span>Куда</span><span>${purpose.label}</span></div>` : ''}
${r.type === 'aid' ? html`<div class="kv"><span>Основание</span><span>${r.purpose}</span></div>` : ''}
${r.note ? html`<div class="kv"><span>Примечание студента</span><span>${r.note}</span></div>` : ''}
${r.type === 'tax' ? html`<div class="kv"><span>Год оплаты</span><span>${r.purpose}</span></div><div class="kv"><span>ИНН</span><span>${r.details || 'не указан'}</span></div>` : ''}
${r.details && r.type !== 'tax' ? html`<div class="kv"><span>${t.detailsLabel || 'Уточнение'}</span><span>${r.details}</span></div>` : ''}
${r.format ? html`<div class="kv"><span>Формат</span><span>${formatOf(r.type, r.format)?.label}</span></div>` : ''}
${files.map((f) => html`<div class="kv"><span>Документ</span><span><a href="/files/${f.id}" target="_blank" rel="noopener">${f.name}</a> · ${T.stamp(new Date(f.uploaded_at))}</span></div>`)}
${r.type === 'aid' && !files.length ? html`<div class="kv"><span>Документы</span><span class="muted">не загружены</span></div>` : ''}
</div></div>
${r.type === 'stipend' ? html`<div class="card"><b>Выплаты стипендии</b>${(ctx.stipends || []).map((x) => html`<div class="kv"><span>${x.month.split('-').reverse().join('.')}</span><span>${x.amount.toLocaleString('ru-RU').replace(/\u00a0/g, ' ')} ₽</span></div>`)}<div class="kv"><b>Итого</b><b>${(ctx.stipends || []).reduce((a, x) => a + x.amount, 0).toLocaleString('ru-RU').replace(/\u00a0/g, ' ')} ₽</b></div></div>` : ''}
${r.type === 'tax' ? html`<div class="card"><b>Оплаты по договору</b><table class="table" style="margin-top:8px"><thead><tr><th>Дата</th><th>Договор</th><th>Заказчик</th><th>Сумма</th></tr></thead><tbody>
${ctx.payments.map((p) => html`<tr><td>${p.paid_on.split('-').reverse().join('.')}</td><td>${p.contract}</td><td>${p.payer}</td><td>${TAX.rub(p.amount)}</td></tr>`)}</tbody></table>
<div class="small muted" style="margin-top:6px">За ${r.purpose} год: ${TAX.rub(ctx.payments.filter((p) => p.paid_on.startsWith(r.purpose)).reduce((s, p) => s + p.amount, 0))} — эта сумма попадёт в справку.</div></div>` : ''}
${(ctx.siblings || []).length ? html`<div class="card"><b>Пакет «${bundleName(r)}»</b><p class="small muted" style="font-size:14px;margin:6px 0 4px">Студент заказал справки одной кнопкой. Остальные справки пакета:</p>
${ctx.siblings.map((x) => html`<div class="kv"><span><a href="/staff/requests/${x.id}">№ ${x.number}</a> · ${x.title}</span><span>${tag(x.status, TYPES[x.type].producesPdf)}</span></div>`)}</div>` : ''}
<div class="card"><b>История</b>${events.map((e) => html`<div style="padding:8px 0;border-bottom:1px solid var(--line)"><div class="small muted">${T.stamp(new Date(e.at))} · ${e.actor_role === 'staff' ? e.actor_name : 'студент'}</div>
<div>${evText[e.kind] || e.kind}${e.text ? html`: ${e.text}` : ''}</div></div>`)}</div>
</div>
<div>
${r.status === 'submitted' ? html`<div class="card"><b>Действие</b><p class="small muted" style="font-size:14px">После подтверждения заявка перейдёт в работу. Студент увидит изменение статуса.</p>
<form method="post" action="/staff/requests/${r.id}/take"><button class="btn block">Взять в работу</button></form></div>` : ''}
${r.status === 'in_work' && t.producesPdf ? html`<div class="card"><b>${r.format === 'paper' ? 'Справка готова к выдаче' : 'Сформировать PDF-справку'}</b>
<p class="small muted" style="font-size:14px">${r.format === 'paper' ? 'Студент получит уведомление «Готова, забрать в каб. 210».' : 'PDF появится в заявке студента, придёт уведомление.'}</p>
<form method="post" action="/staff/requests/${r.id}/ready"><button class="btn block">${r.format === 'paper' ? 'Отметить: готова к выдаче' : 'Сформировать PDF-справку'}</button></form>
<a class="link" style="padding-left:0" href="/staff/requests/${r.id}/preview" target="_blank" rel="noopener">Посмотреть образец PDF</a></div>` : ''}
${r.status === 'in_work' && !t.producesPdf ? html`<div class="card"><b>Решение по заявлению</b>
<form method="post" action="/staff/requests/${r.id}/ready"><label class="field" style="margin-top:6px">Текст для студента<textarea name="text" required>Демонстрационное решение: материальная помощь назначена.</textarea></label>
<button class="btn block" style="margin-top:10px">Сообщить решение</button></form></div>` : ''}
${r.status === 'submitted' ? html`<p class="small muted" style="margin:4px 4px 0">Запросить документ или отклонить заявку можно после того, как возьмёте её в работу.</p>` : ''}
${r.status === 'in_work' ? html`<div class="card"><b>Запросить документ у студента</b>
<form method="post" action="/staff/requests/${r.id}/need"><label class="field" style="margin-top:6px">Что нужно<input type="text" name="text" required maxlength="200" value="${r.type === 'aid' ? 'Загрузи справку о составе семьи (не старше 30 дней)' : ''}"></label>
<button class="btn secondary block" style="margin-top:10px">Запросить</button></form></div>
<div class="card"><b>Отклонить</b><form method="post" action="/staff/requests/${r.id}/reject"><label class="field" style="margin-top:6px">Причина — её увидит студент<input type="text" name="text" required maxlength="200"></label>
<button class="btn danger block" style="margin-top:10px">Отклонить заявку</button></form></div>` : ''}
${r.status === 'ready' && t.producesPdf && r.format !== 'paper' ? html`<div class="card"><b>Готово</b><div class="actions"><a class="btn secondary small" href="/requests/${r.id}/pdf" target="_blank" rel="noopener">${I.file}Открыть PDF</a></div></div>` : ''}
<div class="card"><b>Написать студенту</b><form method="post" action="/staff/requests/${r.id}/message"><label class="field" style="margin-top:6px"><span class="sr-only">Сообщение</span><textarea name="text" required maxlength="1000"></textarea></label>
<button class="btn secondary block" style="margin-top:10px">Отправить</button></form></div>
</div></div>`,
  });
}

function announce(ctx) {
  return shell({
    title: 'Объявление', ctx, cur: 'announce',
    body: html`<h1>Объявление студентам</h1><p class="muted">Объявление появится в уведомлениях всех студентов демо-кабинета.</p>
<form method="post" action="/staff/announce" class="card" style="max-width:560px">
<label class="field" style="margin-top:0">Заголовок<input type="text" name="title" required maxlength="120"></label>
<label class="field">Текст<textarea name="body" required maxlength="600"></textarea></label>
<button class="btn" style="margin-top:14px">Отправить объявление</button></form>`,
  });
}

module.exports = { queue, detail, announce };
