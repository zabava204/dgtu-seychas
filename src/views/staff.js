'use strict';
const { html, raw } = require('./html');
const { head, I } = require('./layout');
const T = require('../time');
const { TYPES, purposeOf, formatOf } = require('../catalog');

const TAG = { submitted: ['blue', 'Новая'], in_work: ['', 'В работе'], need_student: ['amber', 'Ждёт студента'], ready: ['green', 'Готова'], rejected: ['red', 'Отклонена'] };
const tag = (s) => html`<span class="tag ${TAG[s][0]}">${TAG[s][1]}</span>`;

function shell({ title, ctx, cur, body }) {
  const c = ctx.counts;
  const nav = [['new', 'Новые', c.new], ['work', 'В работе', c.work], ['student', 'Ждут студента', c.student], ['done', 'Готовые и закрытые', c.done]];
  return html`${head(title)}<body><div class="staff-layout">
<aside aria-label="Разделы деканата">
<div style="display:flex;gap:10px;align-items:center;margin-bottom:14px">${I.logo}<div><div style="font-weight:700">ДГТУ.Сейчас</div><div class="small" style="color:#8E9BBB">Кабинет деканата</div></div></div>
${nav.map(([k, l, n]) => html`<a href="/staff?f=${k}" ${cur === k ? raw('aria-current="page"') : ''}><span>${l}</span><span class="cnt">${n}</span></a>`)}
<a href="/staff/announce" ${cur === 'announce' ? raw('aria-current="page"') : ''}><span>Объявление студентам</span></a>
<div style="margin-top:auto;font-size:13px;color:#8E9BBB;padding:12px">${ctx.user.full_name}<br>${ctx.user.position}
<form method="post" action="/logout" style="margin-top:8px"><button class="link" style="color:#AFC3FF;padding:0;min-height:36px">Выйти</button></form></div>
</aside>
<main>${ctx.flash ? html`<div class="note green" role="status" style="margin-bottom:16px">${ctx.flash.text}</div>` : ''}
<div class="small muted" style="margin-bottom:12px">Концепт для конкурса · не официальный сервис ДГТУ · данные вымышленные</div>
${body}</main></div><script src="/app.js?v=1" defer></script></body></html>`;
}

function queue(ctx) {
  const { list, filter } = ctx;
  const titles = { new: 'Новые заявки', work: 'В работе', student: 'Ждут действия студента', done: 'Готовые и закрытые' };
  return shell({
    title: 'Деканат', ctx, cur: filter,
    body: html`<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><h1>${titles[filter]}</h1>
<span class="muted small">Сейчас ${T.timeOf(T.now())}, ${T.dayMonthKey(T.dateKey())}</span></div>
<table class="table" style="margin-top:16px"><thead><tr><th>№</th><th>Заявка</th><th>Студент</th><th>Подана</th><th>Срок</th><th>Статус</th></tr></thead><tbody>
${list.length ? list.map((r) => html`<tr class="clickable" data-href="/staff/requests/${r.id}">
<td><a href="/staff/requests/${r.id}">${r.number}</a></td><td><b style="font-weight:600">${r.title}</b>${r.type === 'study' && r.format === 'paper' ? html`<div class="small muted">бумажная</div>` : ''}</td>
<td>${r.student_name}<div class="small muted">${r.group_name}</div></td><td>${T.relDateTime(new Date(r.submitted_at || r.created_at))}</td>
<td>${r.eta_at && !['ready', 'rejected'].includes(r.status) ? T.relDateTime(new Date(r.eta_at)) : '—'}</td><td>${tag(r.status)}${r.assignee ? html`<div class="small muted" style="margin-top:4px">${r.assignee.short_name}</div>` : ''}</td></tr>`)
    : html`<tr><td colspan="6" class="muted">Пусто.</td></tr>`}
</tbody></table>
<form method="post" action="/staff/reset" style="margin-top:28px" data-confirm="Вернуть все демо-данные к исходному состоянию? Новые заявки и сообщения удалятся.">
<button class="btn danger small" type="submit">Сбросить демо-данные</button> <span class="small muted">Возвращает заявки, уведомления и сообщения к исходному состоянию.</span></form>`,
  });
}

function detail(ctx) {
  const { r, student, events, files } = ctx;
  const t = TYPES[r.type];
  const purpose = r.type === 'study' ? purposeOf('study', r.purpose) : null;
  const evText = { submitted: 'Подана студентом', taken: 'Взята в работу', need_doc: 'Запрошен документ', uploaded: 'Студент загрузил документ', ready: 'Готова', rejected: 'Отклонена', message: 'Сообщение' };
  const open = !['ready', 'rejected'].includes(r.status);
  return shell({
    title: `Заявка ${r.number}`, ctx, cur: { submitted: 'new', in_work: 'work', need_student: 'student' }[r.status] || 'done',
    body: html`<a class="link" style="padding-left:0" href="/staff?f=${{ submitted: 'new', in_work: 'work', need_student: 'student' }[r.status] || 'done'}">← К списку</a>
<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><h1>${r.title}</h1>${tag(r.status)}</div>
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
${r.details ? html`<div class="kv"><span>${t.detailsLabel || 'Уточнение'}</span><span>${r.details}</span></div>` : ''}
${r.format ? html`<div class="kv"><span>Формат</span><span>${formatOf(r.type, r.format)?.label}</span></div>` : ''}
${files.map((f) => html`<div class="kv"><span>Документ</span><span><a href="/files/${f.id}" target="_blank" rel="noopener">${f.name}</a> · ${T.stamp(new Date(f.uploaded_at))}</span></div>`)}
${r.type === 'aid' && !files.length ? html`<div class="kv"><span>Документы</span><span class="muted">не загружены</span></div>` : ''}
</div></div>
<div class="card"><b>История</b>${events.map((e) => html`<div style="padding:8px 0;border-bottom:1px solid var(--line)"><div class="small muted">${T.stamp(new Date(e.at))} · ${e.actor_role === 'staff' ? e.actor_name : 'студент'}</div>
<div>${evText[e.kind] || e.kind}${e.text ? html`: ${e.text}` : ''}</div></div>`)}</div>
</div>
<div>
${r.status === 'submitted' ? html`<div class="card"><b>Действие</b><p class="small muted" style="font-size:14px">Студент видит: «ждёт сотрудника». После взятия в работу — ваше имя и срок.</p>
<form method="post" action="/staff/requests/${r.id}/take"><button class="btn block">Взять в работу</button></form></div>` : ''}
${r.status === 'in_work' && t.producesPdf ? html`<div class="card"><b>${r.format === 'paper' ? 'Справка готова к выдаче' : 'Сформировать PDF-справку'}</b>
<p class="small muted" style="font-size:14px">${r.format === 'paper' ? 'Студент получит уведомление «Готова, забрать в каб. 210».' : 'PDF появится в заявке студента, придёт уведомление.'}</p>
<form method="post" action="/staff/requests/${r.id}/ready"><button class="btn block">${r.format === 'paper' ? 'Отметить: готова к выдаче' : 'Сформировать PDF-справку'}</button></form>
<a class="link" style="padding-left:0" href="/staff/requests/${r.id}/preview" target="_blank" rel="noopener">Предпросмотр PDF</a></div>` : ''}
${r.status === 'in_work' && !t.producesPdf ? html`<div class="card"><b>Решение по заявлению</b>
<form method="post" action="/staff/requests/${r.id}/ready"><label class="field" style="margin-top:6px">Текст для студента<textarea name="text" required>Материальная помощь назначена, выплата — со стипендией в следующем месяце.</textarea></label>
<button class="btn block" style="margin-top:10px">Сообщить решение</button></form></div>` : ''}
${['submitted', 'in_work'].includes(r.status) ? html`<div class="card"><b>Запросить документ у студента</b>
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
    body: html`<h1>Объявление студентам</h1><p class="muted">Придёт всем студентам факультета в «Уведомления», категория «Объявления деканата».</p>
<form method="post" action="/staff/announce" class="card" style="max-width:560px">
<label class="field" style="margin-top:0">Заголовок<input type="text" name="title" required maxlength="120"></label>
<label class="field">Текст<textarea name="body" required maxlength="600"></textarea></label>
<button class="btn" style="margin-top:14px">Отправить объявление</button></form>`,
  });
}

module.exports = { queue, detail, announce };
