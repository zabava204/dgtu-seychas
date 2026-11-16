'use strict';
// Помощник «Что нужно?». Кнопки-действия всегда строятся правилами на сервере;
// текст отвечает GigaChat (если задан ключ) или запасные правила. Ключ хранится только в переменных окружения.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');
const tls = require('tls');
const T = require('./time');
const TAX = require('./tax');
const GR = require('./grades');
const EN = require('./assistant-en');
const PREP = require('./prep');

const OAUTH_URL = process.env.GIGACHAT_OAUTH_URL || 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const API_URL = process.env.GIGACHAT_API_URL || 'https://gigachat.devices.sberbank.ru/api/v1';
const MODEL = process.env.GIGACHAT_MODEL || 'GigaChat-2';

const low = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');
const has = (q, words) => words.some((w) => q.includes(w));

// ---------- правила ----------
function intents(question, data) {
  const q = low(question);
  const out = { id: 'other', text: null, actions: [] };
  const set = (id, text, actions = []) => { out.id = id; out.text = text; out.actions = actions; return out; };

  if (has(q, ['не хочу жить', 'покончить', 'суицид', 'умереть', 'самоуб', 'тяжело', 'плохо мне', 'паник', 'депресс', 'не справляюсь с жизнью'])) {
    return set('support', 'Спасибо, что написал(а). Ты не один(одна) с этим. Если есть угроза жизни — звони 112. Контакты анонимной поддержки — в разделе «Психологическая помощь».', [{ label: 'Психологическая помощь', href: '/hard#psy' }, { label: 'Позвонить 112', href: 'tel:112' }]);
  }
  // Четыре готовых вопроса: план, письмо, отсрочка, вечер. Раньше общего ответа про баллы, чтобы «до сессии» не ушло в пересказ оценок.
  const prep = PREP.match(question, data, 'ru');
  if (prep) { out.exact = true; return set(prep.id, prep.text, prep.actions); }
  if (has(q, ['состав семьи', 'составе семьи'])) return set('doc_family', 'Справку о составе семьи обычно выдают МФЦ или управляющая компания / ТСЖ по месту регистрации. Для подачи достаточно скана или фото. Точные требования (например, срок давности) уточни в деканате — это демо-правило.', [{ label: 'Где взять справку', href: '/help/doc?name=' + encodeURIComponent('Справка о составе семьи') }]);
  // Вузовские термины — из словаря, без пересказа моделью (модель путала «академическую разницу»)
  const TERMS = [
    [['академическая разниц', 'академической разниц', 'академразниц'], 'Академическая разница — дисциплины, которых не было в твоём прежнем учебном плане, но они есть в новом. Их досдают при переводе на другое направление, форму обучения или в другой вуз и при восстановлении. Перечень и сроки определяет деканат.'],
    [['академическая задолжен', 'академической задолжен', 'что такое долг', 'что значит долг'], 'Академическая задолженность — несданный зачёт или экзамен (или неявка на него без уважительной причины). Её ликвидируют на пересдаче в сроки, которые назначает институт.'],
    [['что такое академ', 'академический отпуск это', 'что значит академ'], 'Академический отпуск — перерыв в учёбе по медицинским, семейным или иным основаниям с сохранением места в вузе. Оформляется заявлением в деканат с подтверждающим документом.'],
    [['что такое пересдач'], 'Пересдача — повторная сдача зачёта или экзамена, по которому есть академическая задолженность. Сроки назначает институт.'],
    [['что такое восстановлен'], 'Восстановление — возвращение в вуз после отчисления. Условия и сроки определяет вуз, обратись в деканат.'],
  ];
  const term = TERMS.find(([ws]) => has(q, ws));
  if (term) { out.exact = true; return set('term', term[1], [{ label: 'Мой деканат', href: '/me' }]); }
  // ---- Факты считает программа. Порядок важен: сначала узкие вопросы, потом широкие ----
  const nowKey = T.dateKey();
  const plB = (n) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? 'балл' : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? 'балла' : 'баллов'; };
  // Статус уже поданных заявок
  if (has(q, ['статус', 'где моя', 'что с моей', 'что с заявк', 'когда будет', 'когда готов', 'готова ли', 'готова?', 'готово ли', 'уже готов']) && !has(q, ['готовл', 'подготов', 'стипенд']) && !/(^|[^а-я])нир([^а-я]|$)/.test(q)) {
    out.exact = true;
    const open = data.requests.filter((r) => ['submitted', 'in_work', 'need_student'].includes(r.status));
    const ready = data.requests.filter((r) => r.status === 'ready').slice(0, 2);
    const line = (r) => `№ ${r.number} «${r.title}» — ${r.statusText.toLowerCase()}${r.status === 'need_student' && r.needs_text ? `: ${r.needs_text.toLowerCase()}` : r.eta_at ? `, ожидаемая готовность — ${T.relDateTime(new Date(r.eta_at))}` : ''}`;
    const text = open.length ? `Открытые заявки:\n${open.map(line).join('\n')}${ready.length ? `\nГотовы: ${ready.map((r) => `№ ${r.number} «${r.title}»`).join(', ')}.` : ''}` : ready.length ? `Открытых заявок нет. Готовы: ${ready.map((r) => `№ ${r.number} «${r.title}»`).join(', ')}.` : 'Открытых заявок нет.';
    return set('status', text, open.length === 1 ? [{ label: `Открыть заявку № ${open[0].number}`, href: `/requests/${open[0].id}` }] : [{ label: 'Мои заявки', href: '/requests' }]);
  }
  // Пересдача и досрочная сдача — правил института в кабинете нет
  if (has(q, ['пересда', 'досрочн', 'комисси'])) {
    out.exact = true;
    return set('retake', 'Порядок пересдачи и досрочной сдачи назначает институт — в кабинете этих правил нет, поэтому не буду гадать. Уточни у преподавателя или в деканате: корпус 1, каб. 210, пн–пт 9:00–17:00. Даты твоей сессии и допуск — в «Оценках».', [{ label: 'Сессия и допуск', href: '/study/grades#session' }, { label: 'Мой деканат', href: '/me' }]);
  }
  // Студенческий билет и зачётка — данные профиля, без обещания оригинала
  if (has(q, ['студенческ', 'зачётн книж', 'зачетн книж', 'зачётка', 'зачетка', 'электронн зачёт', 'электронн зачет']) || (has(q, ['билет']) && has(q, ['студент', 'студенч']))) {
    out.exact = true;
    const u = data.user;
    const b = data.book;
    return set('idcard', `Студенческий билет и зачётка: ${u.full_name}, ${u.faculty}, ${u.course} курс, группа ${u.group_name}, № ${u.record_book}.${b && b.avg ? ` Средний балл по зачётке — ${b.avg.toFixed(2).replace('.', ',')}.` : ''} Открыть можно в «Мои документы».`, [{ label: 'Студенческий билет', href: '/me/docs' }, { label: 'Зачётная книжка', href: '/study/record' }]);
  }
  // Средний балл — по зачётной книжке
  if (has(q, ['средн'])) {
    out.exact = true;
    const b = data.book;
    return set('avg', b && b.avg ? `Средний балл по оценкам в зачётной книжке — ${b.avg.toFixed(2).replace('.', ',')} (${b.sems.length} ${b.sems.length === 1 ? 'семестр' : b.sems.length < 5 ? 'семестра' : 'семестров'}, долгов ${b.debts ? b.debts : 'нет'}). Оценки текущего семестра появятся после сессии.` : 'В зачётной книжке пока нет оценок — средний балл появится после первой сессии.', [{ label: 'Зачётная книжка', href: '/study/record' }]);
  }
  // НИР
  if (/(^|[^а-я])нир([^а-я]|$)/.test(q) || has(q, ['научно-исслед', 'научной работ', 'научная работ'])) {
    out.exact = true;
    const st = data.nir || [];
    if (!st.length) return set('nir', 'НИР в твоём учебном плане в этом семестре нет.', [{ label: 'Учёба', href: '/study' }]);
    const sum = st.reduce((a, x) => a + (x.score || 0), 0);
    const ret = st.find((x) => x.state === 'returned'); const nx = st.find((x) => x.state === 'todo');
    return set('nir', `НИР: ${sum} из 100 баллов${sum < 85 ? `, до «отлично» (от 85) ещё ${85 - sum}` : ''}.${ret ? ` Этап «${ret.title}» вернули на доработку${ret.note ? ` — ${ret.note.replace(/^Руководитель:\s*/, '')}` : ''}${ret.due_key ? `, срок ${T.dayMonthKey(ret.due_key)}` : ''}.` : ''}${nx ? ` Следующий этап — «${nx.title}»${nx.due_key ? ` до ${T.dayMonthKey(nx.due_key)}` : ''}.` : ''}`, [{ label: 'Открыть НИР', href: '/study/nir' }]);
  }
  // Стипендия
  if (has(q, ['стипенд'])) {
    out.exact = true;
    const st = data.stipends || [];
    if (data.user.funding !== 'бюджет') return set('stipend', 'Ты учишься по договору — академическая стипендия на договоре не назначается, поэтому и справки о стипендии нет. Если есть вопрос о социальной поддержке — посмотри «Жизненные ситуации».', [{ label: 'Жизненные ситуации', href: '/requests/new' }]);
    if (has(q, ['справк'])) return set('stipend_cert', `Справку о размере стипендии можно заказать онлайн: в ней выплаты за последние ${st.length} мес. (${TAX.rub(st.reduce((a, x) => a + x.amount, 0))}). Электронная справка — 1 рабочий день (демо-срок). Если она нужна для субсидии на ЖКУ, удобнее заказать пакет вместе со справкой об обучении.`, [{ label: 'Заказать справку о стипендии', href: '/requests/new?type=stipend' }, { label: 'Пакет для субсидии', href: '/situations/housing' }]);
    if (has(q, ['повышен', 'именн', 'социальн', 'как получить', 'условия'])) return set('stipend_rules', 'Условия повышенной, именной и социальной стипендии устанавливает вуз, в кабинете их нет — не буду гадать. Уточни в деканате: корпус 1, каб. 210. Что видно в кабинете: твоя академическая стипендия и есть ли риск не закрыть сессию вовремя.', [{ label: 'Сессия и допуск', href: '/study/grades#session' }, { label: 'Мой деканат', href: '/me' }]);
    const last = st[st.length - 1];
    return set('stipend', last ? `Государственная академическая стипендия — ${TAX.rub(last.amount)} в месяц, последние ${st.length} мес. — ${TAX.rub(st.reduce((a, x) => a + x.amount, 0))}. Справку о размере стипендии можно заказать онлайн.` : 'Выплат стипендии в кабинете нет.', [{ label: 'Заказать справку о стипендии', href: '/requests/new?type=stipend' }]);
  }
  // Расписание на любой день: сегодня, завтра, послезавтра, день недели, дата
  if (has(q, ['пар', 'расписан', 'аудитор', 'занят', 'куда идти', 'учусь', 'лекци', 'семинар']) && data.dayPairs) {
    const WD = [['понедельн', 1], ['вторник', 2], ['сред', 3], ['четверг', 4], ['пятниц', 5], ['суббот', 6], ['воскрес', 7]];
    const MON = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
    let key = null;
    if (has(q, ['послезавтра'])) key = T.addDays(nowKey, 2);
    else if (has(q, ['завтра'])) key = T.addDays(nowKey, 1);
    else if (has(q, ['сегодня'])) key = nowKey;
    if (!key) { const w = WD.find(([w]) => q.includes(w)); if (w) { const d = (w[1] - T.weekdayOfKey(nowKey) + 7) % 7; key = T.addDays(nowKey, d); } }
    if (!key) { const m = q.match(/(\d{1,2})[.\s]+(\d{1,2}|[а-я]+)/); if (m) { const day = Number(m[1]); const mo = /^\d+$/.test(m[2]) ? Number(m[2]) - 1 : MON.findIndex((x) => m[2].startsWith(x)); if (mo >= 0 && day >= 1 && day <= 31) { let y = Number(nowKey.slice(0, 4)); const k = `${y}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`; key = k < T.addDays(nowKey, -60) ? `${y + 1}${k.slice(4)}` : k; } } }
    if (key) {
      out.exact = true;
      const ps = data.dayPairs(key).filter((p) => !p.cancelled);
      const ex = (data.session || []).filter((x) => x.date_key === key);
      const room = (p) => (p.online ? 'онлайн' : `ауд. ${p.room}`);
      const rel = key === nowKey ? 'Сегодня' : key === T.addDays(nowKey, 1) ? 'Завтра' : key === T.addDays(nowKey, 2) ? 'Послезавтра' : '';
      const head = `${rel ? rel + ', ' : ''}${T.wdLongKey(key)[0].toUpperCase() + T.wdLongKey(key).slice(1)}, ${T.dayMonthKey(key)}`;
      const lines = [...ex.map((x) => `${x.start} ${x.kind}: ${x.subject}, ауд. ${x.room}`), ...ps.map((p) => `${p.start}–${p.end} ${p.subject}, ${room(p)}${p.old_room || p.old_start ? ' (изменение)' : ''}`)];
      return set('schedule', lines.length ? `${head}:\n${lines.join('\n')}` : `${head} — пар нет.`, [{ label: 'Расписание дня', href: `/study?d=${key}` }]);
    }
    if (has(q, ['недел'])) { out.exact = true; return set('schedule', 'Расписание на неделю — в «Учёбе», режим «Неделя».', [{ label: 'Расписание на неделю', href: '/study?view=week' }]); }
  }
  // Справка для вычета за конкретный год
  if (has(q, ['справк']) && /20\d\d/.test(q) && (data.payments || []).length) {
    out.exact = true;
    const yr = Number(q.match(/20\d\d/)[0]);
    const y = TAX.yearsFromPayments(data.payments).find((x) => x.year === yr);
    return set('tax', !y ? `За ${yr} год оплат по договору в кабинете нет.` : y.closed ? `Справку для налогового вычета за ${yr} год можно заказать: оплачено ${TAX.rub(y.sum)}, вернуть можно до ${TAX.rub(y.refund)}.` : `Справку за ${yr} год можно заказать с января ${yr + 1}, когда год закончится. Сейчас оплачено ${TAX.rub(y.sum)}.`, y && y.closed ? [{ label: `Заказать справку за ${yr} год`, href: '/requests/new?type=tax' }] : [{ label: 'Как получить вычет', href: '/help/tax' }]);
  }
  // Даты сессии — из расписания сессии, без модели
  // (даты сессии)
  if (has(q, ['когда', 'дата', 'во сколько', 'где будет', 'расписание сесс', 'какого числа', 'сколько дней до']) && has(q, ['сесси', 'экзамен', 'зачет', 'консультац']) && (data.session || []).length) {
    out.exact = true;
    const d = GR.findDiscipline(q, data.disciplines);
    const items = data.session.filter((s) => (d ? s.discipline_id === d.id : s.kind !== 'консультация'));
    const line = (s) => `${T.dayMonthKey(s.date_key)} (${T.wdShortKey(s.date_key).toLowerCase()}), ${s.start}, ауд. ${s.room} — ${s.kind}: ${s.subject}${s.kind === 'консультация' ? '' : s.admitted ? ' · допуск есть' : ` · до допуска не хватает ${s.gap} ${s.gap % 10 === 1 && s.gap % 100 !== 11 ? 'балла' : 'баллов'}`}`;
    const text = items.length ? `${d ? '' : 'Сессия по расписанию кабинета:\n'}${items.map(line).join('\n')}` : 'По этой дисциплине в сессию нет зачёта или экзамена.';
    return set('session', text, [{ label: 'Сессия и допуск', href: '/study/grades#session' }]);
  }
  // Баллы считает программа (grades.js); модель их не пересчитывает
  if (has(q, ['балл', 'зачет', 'оценк', 'экзамен', 'сесси', 'долг', 'автомат', 'порог', 'хватит', 'допуск']) || GR.findDiscipline(q, data.disciplines)) {
    const g = GR.answer(q, data.disciplines);
    out.exact = true;
    const gradeActions = !g.discipline
      ? [{ label: 'Открыть оценки', href: '/study/grades' }]
      : g.discipline.gap > 0 && !g.discipline.closed_text
        ? [{ label: 'Разобраться с допуском', href: `/study/session-support/${g.discipline.id}` }, { label: `Открыть: ${g.discipline.subject}`, href: `/study/grades#d-${g.discipline.id}` }]
        : [{ label: `Открыть: ${g.discipline.subject}`, href: `/study/grades#d-${g.discipline.id}` }];
    return set('grades', g.text, gradeActions);
  }
  if (has(q, ['вычет', 'налог', 'ндфл'])) {
    out.exact = true;
    const ys = TAX.yearsFromPayments(data.payments || []).filter((y) => y.eligibleForm);
    const y = ys.find((x) => x.closed);
    const cur = ys.find((x) => !x.closed);
    return set('tax', y
      ? `За ${y.year} год по договору оплачено ${TAX.rub(y.sum)} — можно вернуть до ${TAX.rub(y.refund)}, если доход облагается по ставке 13%. Закажи справку об оплате обучения за ${y.year} год и приложи её к декларации 3-НДФЛ в личном кабинете налогоплательщика.${cur ? ` Справку за ${cur.year} год можно будет заказать с января ${cur.year + 1}.` : ''}`
      : cur ? `Справку за ${cur.year} год можно заказать с января ${cur.year + 1}, когда год закончится. Оплачено пока ${TAX.rub(cur.sum)}.`
        : 'Вычет за обучение дают за платное обучение. В кабинете нет оплат по договору с 2024 года — если обучение платное, напиши в деканат, проверим договор.',
    y ? [{ label: 'Заказать справку для вычета', href: '/requests/new?type=tax' }, { label: 'Как получить вычет', href: '/help/tax' }] : [{ label: 'Мой деканат', href: '/me' }]);
  }
  if (has(q, ['жку', 'коммунал', 'субсид', 'соцзащит', 'социальн', 'льгот'])) return set('study_social', 'Для субсидии или льготы по оплате ЖКУ обычно нужна «Справка об обучении (Форма 2)» в органы социальной защиты населения: она подтверждает, что ты учишься очно. Закажи её в «Заявках» — черновик заполнится из профиля. Электронная справка обычно готова в тот же день (демо-правило). Какие ещё документы нужны, уточни в органе соцзащиты.', [{ label: 'Собрать пакет для субсидии', href: '/situations/housing' }, { label: 'Только справка об обучении', href: '/requests/new?type=study&purpose=social' }]);
  if (has(q, ['виз', 'посольств', 'консульств'])) return set('visa', 'Справку для визы в этой версии кабинета онлайн не заказать — обратись в деканат (корпус 1, каб. 210).', [{ label: 'Мой деканат', href: '/me' }]);
  if (has(q, ['матпомощ', 'материальн'])) {
    const aid = data.requests.find((r) => r.type === 'aid' && r.status === 'need_student');
    return set('aid', aid ? `По заявке № ${aid.number} деканат ждёт документ: ${aid.needs_text.toLowerCase()}. После загрузки рассмотрение продолжится.` : 'Заявление на материальную помощь подаётся в «Заявках». Понадобится справка о составе семьи — подскажу, где её взять.',
      aid ? [{ label: 'Загрузить документ', href: `/requests/${aid.id}#upload` }, { label: 'Где взять справку', href: '/help/doc?name=' + encodeURIComponent('Справка о составе семьи') }] : [{ label: 'Подать заявление', href: '/requests/new?type=aid' }]);
  }
  if (has(q, ['работ']) && has(q, ['справк'])) return set('study_job', 'Для работодателя подойдёт справка об обучении «по месту работы» — PDF обычно в тот же день (демо-правило). Если совмещаешь работу и учёбу, загляни в ситуацию «Устраиваюсь на работу» — там и про сессию.', [{ label: 'Справка по месту работы', href: '/requests/new?type=study&purpose=employer' }, { label: 'Устраиваюсь на работу', href: '/situations/job' }]);
  if (has(q, ['справк', 'работодател'])) return set('study', 'Справку об обучении можно заказать в «Заявках»: выбери, куда она нужна, и формат — электронный или бумажный.', [{ label: 'Заказать справку об обучении', href: '/requests/new?type=study' }, { label: 'Все справки и ситуации', href: '/requests/new' }]);
  if (has(q, ['заочк', 'перевод', 'перевест', 'другую форму'])) return set('transfer', 'Это перевод на другую форму обучения. Демо-правило концепта: подаётся заявление в деканат, его согласуют в институте и оформляют приказом. На заочной форме обычно не назначается академическая стипендия, условия оплаты зависят от направления — уточни в деканате (корпус 1, каб. 210) до подачи.', [{ label: 'Мой деканат', href: '/me' }]);
  if (has(q, ['академ', 'академическ'])) return set('academic_leave', 'Академический отпуск оформляется через заявление в деканат с подтверждающим документом. В первой версии кабинета эта заявка не подаётся онлайн — уточни порядок в деканате (корпус 1, каб. 210).', [{ label: 'Мой деканат', href: '/me' }]);
  if (has(q, ['пара', 'расписан', 'аудитор', 'где занят', 'куда идти'])) {
    out.exact = true;
    const n = data.next;
    return set('schedule', n ? `Ближайшая пара: ${n.subject}, ${T.relDateTime(n.startsAt)}, ${n.online ? 'онлайн' : `ауд. ${n.room}`}.${n.old_room ? ` Аудитория изменена, было ${n.old_room}.` : ''}` : 'В ближайшие две недели пар нет.', [{ label: 'Расписание', href: n ? `/study?d=${T.dateKey(n.startsAt)}#pair-${n.id}` : '/study' }]);
  }
  if (has(q, ['заявк'])) {
    out.exact = true;
    const open = data.requests.filter((r) => ['submitted', 'in_work', 'need_student'].includes(r.status));
    return set('status', open.length ? open.map((r) => `№ ${r.number} «${r.title}» — ${r.statusText.toLowerCase()}`).join('; ') + '.' : 'Открытых заявок нет.', [{ label: 'Мои заявки', href: '/requests' }]);
  }
  return out;
}

function fallbackText() {
  return 'Пока не знаю, как помочь с этим. Попробуй спросить иначе: «справка об обучении в соцзащиту», «сколько баллов до зачёта», «перевод на заочку» — или напиши в деканат по любой заявке.';
}

// ---------- GigaChat ----------
// Серверы GigaChat используют сертификаты НУЦ Минцифры. Берём их из GIGACHAT_CA_FILE,
// из кэша в папке данных или скачиваем один раз с gu-st.ru (ссылка из документации Сбера).
const CA_URLS = ['https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt', 'https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt'];
let caPromise = null;
function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('ca ' + res.statusCode)); }
      let d = ''; res.setEncoding('utf8'); res.on('data', (c) => { d += c; }); res.on('end', () => resolve(d));
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('ca timeout')); });
  });
}
function extraCa() {
  if (!caPromise) caPromise = (async () => {
    if (process.env.GIGACHAT_CA_FILE) return fs.readFileSync(process.env.GIGACHAT_CA_FILE, 'utf8');
    const cache = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'russian_trusted_ca.pem');
    if (fs.existsSync(cache)) return fs.readFileSync(cache, 'utf8');
    const parts = [];
    for (const u of CA_URLS) { try { parts.push(await download(u)); } catch (e) { console.error('[assistant] сертификат не скачан:', u, e.message); } }
    const pem = parts.filter((p) => p.includes('BEGIN CERTIFICATE')).join('\n');
    if (pem) fs.writeFileSync(cache, pem);
    return pem;
  })().catch((e) => { caPromise = null; throw e; });
  return caPromise;
}
async function post(url, headers, body, timeout) {
  const extra = await extraCa().catch(() => '');
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request({ method: 'POST', hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
      ca: extra ? [...tls.rootCertificates, extra] : undefined, timeout }, (res) => {
      let d = ''; res.setEncoding('utf8'); res.on('data', (c) => { d += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(d); } catch { /* not json */ } resolve({ status: res.statusCode, json }); });
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end(body);
  });
}

let token = null; let tokenExp = 0; let chain = Promise.resolve();
const enabled = () => !!process.env.GIGACHAT_AUTH_KEY;

async function getToken() {
  if (token && Date.now() < tokenExp - 60e3) return token;
  const r = await post(OAUTH_URL, { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', RqUID: crypto.randomUUID(), Authorization: `Basic ${process.env.GIGACHAT_AUTH_KEY}` },
    `scope=${encodeURIComponent(process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS')}`, 10000);
  if (r.status !== 200 || !r.json?.access_token) throw new Error('oauth ' + r.status);
  token = r.json.access_token; tokenExp = r.json.expires_at || Date.now() + 25 * 60e3;
  return token;
}

// RAG-lite: в LLM кладём только те блоки базы, которые модели разрешено цитировать.
// Баллы, суммы, статусы заявок и даты сессии в промпт не попадают — их считает cascade/calc.
function retrieveFacts(question, data) {
  const q = low(question);
  const u = data.user;
  const blocks = [
    { id: 'core', text: [
      'Опирайся только на блоки ниже. Не выдумывай нормативы, сроки, суммы, телефоны и ссылки. Если не знаешь — скажи и предложи деканат: корпус 1, каб. 210, пн–пт 9:00–17:00.',
      'Никогда не называй расписание на конкретные дни, баллы, даты сессии, суммы, стипендию и статусы заявок — это считает программа кабинета. Укажи раздел («Учёба», «Оценки», «Заявки») без цифр.',
      'Никогда не пиши, что ты что-то проверил, отправил или оформил. Кнопки интерфейс покажет сам.',
      'Если студенту плохо — раздел «Психологическая помощь» и 112 при угрозе жизни; без диагнозов. Вопросы по кабинету — «Служба поддержки».',
      `Сегодня: ${T.wdLongKey(T.dateKey())}, ${T.dayMonthKey(T.dateKey())}, ${T.timeOf(T.now())}, неделя — ${T.parityLabel()}.`,
      `Студент: ${u.first_name}, ${u.level}, ${u.course} курс, группа ${u.group_name}, форма ${u.form}, основа ${u.funding}.`,
    ].join('\n') },
    { id: 'services', text: 'Онлайн можно подать: справку для налогового вычета (3 рабочих дня, демо-срок), справку об обучении, Форма 2 (по месту требования, в органы социальной защиты, по месту работы; обычно в тот же день), справку о размере стипендии (только бюджет, 1 рабочий день), заявление на материальную помощь (нужна справка о составе семьи). Есть «Жизненные ситуации», где кабинет собирает пакет справок. Это демо-правила концепта.' },
    { id: 'terms', text: 'Словарь: академическая разница — дисциплины, которых не было в прежнем плане, их досдают при переводе или восстановлении; академическая задолженность — несданный зачёт или экзамен; пересдача — повторная сдача в сроки института; академический отпуск — перерыв в учёбе с сохранением места; восстановление — возвращение после отчисления; перевод — смена формы, направления, основы или вуза.' },
    { id: 'tax', text: 'Вычет за своё обучение (демо по материалам ФНС): любая форма; 13% от расходов в пределах 150 000 ₽ в год с другими социальными вычетами; с 2024 года достаточно справки об оплате из вуза; справка только за закончившийся календарный год; к декларации 3-НДФЛ; вернуть налог можно за три последних года. За ребёнка — только очная форма и возраст до 24 лет.' },
  ];
  const need = new Set(['core', 'services']);
  if (has(q, ['академ', 'перевод', 'перевест', 'восстанов', 'пересдач', 'задолжен', 'разниц', 'заочк'])) need.add('terms');
  if (has(q, ['вычет', 'налог', 'ндфл', 'ифнс', 'оплат', 'договор'])) need.add('tax');
  // Свободный вопрос без узких маркеров — короткая политика + словарь, без сумм студента
  if (need.size <= 2) { need.add('terms'); need.add('tax'); }
  return blocks.filter((b) => need.has(b.id));
}

function systemPrompt(data, lang, question = '') {
  const facts = retrieveFacts(question, data);
  const lines = [
    ...(lang === 'en' ? ['Студент пишет по-английски (иностранный студент). Отвечай по-английски, просто и коротко, 2–5 предложений; названия дисциплин и документов можно оставить по-русски с пояснением. Все правила ниже действуют так же.'] : []),
    'Ты — помощник «Что нужно?» в концепте личного кабинета студента «ДГТУ.Сейчас» (прототип для конкурса, данные вымышленные).',
    'Отвечай по-русски, на «ты», коротко: 2–5 предложений, без markdown-заголовков.',
    ...facts.map((f) => f.text),
  ];
  return lines.join('\n');
}

async function askGigaChat(question, history, data, lang) {
  const run = async () => {
    const tk = await getToken();
    const messages = [{ role: 'system', content: systemPrompt(data, lang, question) }];
    for (const h of (history || []).slice(-6)) if (h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string') messages.push({ role: h.role, content: h.content.slice(0, 800) });
    messages.push({ role: 'user', content: question });
    const r = await post(`${API_URL}/chat/completions`, { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${tk}` },
      JSON.stringify({ model: MODEL, messages, temperature: 0.3, max_tokens: 400 }), 25000);
    if (r.status === 401) { token = null; throw new Error('unauthorized'); }
    if (r.status !== 200) throw new Error('chat ' + r.status);
    return String(r.json?.choices?.[0]?.message?.content || '').trim();
  };
  // бесплатный пакет — один поток: запросы идут по очереди
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

async function answer(question, history, data) {
  const q = String(question || '').trim().slice(0, 500);
  if (!q) return { text: 'Напиши, что нужно.', actions: [], source: 'rules', intent: 'empty', cascade: 'empty' };
  // Вопрос на английском — английские правила (первая часть английской версии кабинета)
  const lang = EN.isEnglish(q) ? 'en' : 'ru';
  const it = lang === 'en' ? EN.intents(q, data) : intents(q, data);
  const res = (o) => ({ ...o, lang, intent: it.id });
  if (it.id === 'support') return res({ text: it.text, actions: it.actions, source: 'rules', cascade: 'decision' });
  // Цифры (баллы, суммы, статусы, расписание) — детерминированный расчёт, не модель
  if (it.exact) return res({ text: it.text, actions: it.actions, source: 'calc', cascade: 'calc' });
  // Каскад как у Decision Models: уверенный выбор из вариантов (правило + текст) не переспрашиваем у LLM.
  // Раньше при наличии GIGACHAT_AUTH_KEY ответ про ЖКУ/справки уходил в модель и мог «переписать» правило.
  if (it.id !== 'other' && it.text) return res({ text: it.text, actions: it.actions, source: 'rules', cascade: 'decision' });
  // Сомнительный класс (other) — в LLM с фактами кабинета; без ключа — запасные правила
  if (enabled()) {
    try {
      const text = await askGigaChat(q, history, data, lang);
      if (text) return res({ text, actions: it.actions, source: 'gigachat', cascade: 'llm' });
    } catch (e) {
      console.error('[assistant] GigaChat недоступен:', e.message);
    }
  }
  return res({ text: it.text || (lang === 'en' ? EN.fallbackText() : fallbackText()), actions: it.actions, source: 'rules', cascade: 'fallback' });
}

module.exports = { answer, intents, enabled, retrieveFacts };
