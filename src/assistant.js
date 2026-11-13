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
    return set('support', 'Спасибо, что написал(а). Ты не один(одна) с этим. Если есть угроза жизни — звони 112. Контакты психолога вуза — в разделе «Если тяжело»; открытие этого раздела не создаёт обращения в деканат.', [{ label: 'Если тяжело', href: '/hard' }, { label: 'Позвонить 112', href: 'tel:112' }]);
  }
  if (has(q, ['состав семьи', 'составе семьи'])) return set('doc_family', 'Справку о составе семьи обычно выдают МФЦ или управляющая компания / ТСЖ по месту регистрации. Для подачи достаточно скана или фото. Точные требования (например, срок давности) уточни в деканате — это демо-правило.', [{ label: 'Где взять справку', href: '/help/doc?name=' + encodeURIComponent('Справка о составе семьи') }]);
  // Баллы считает программа (grades.js); модель их не пересчитывает
  if (has(q, ['балл', 'зачет', 'оценк', 'экзамен', 'сесси', 'долг', 'автомат', 'порог', 'хватит', 'допуск']) || GR.findDiscipline(q, data.disciplines)) {
    const g = GR.answer(q, data.disciplines);
    out.exact = true;
    return set('grades', g.text, [{ label: g.discipline ? `Открыть: ${g.discipline.subject}` : 'Открыть оценки', href: g.discipline ? `/study/grades#d-${g.discipline.id}` : '/study/grades' }]);
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
  if (has(q, ['проездн', 'транспорт'])) return set('study_transport', 'Справку для проездного можно заказать здесь: я заполню черновик из профиля, тебе останется проверить и отправить. Электронная справка обычно готова в тот же день, если подать до 15:00 в рабочий день (демо-правило).', [{ label: 'Оформить справку для проездного', href: '/requests/new?type=study&purpose=transport' }]);
  if (has(q, ['соцзащит', 'социальн'])) return set('study_social', 'Справка для соцзащиты — это справка об обучении с нужной формулировкой. Оформляется в «Заявках».', [{ label: 'Оформить справку в соцзащиту', href: '/requests/new?type=study&purpose=social' }]);
  if (has(q, ['виз', 'посольств', 'консульств'])) return set('visa', 'Справка для визы готовится на английском, обычно 3 рабочих дня (демо-правило). Укажи страну и даты поездки.', [{ label: 'Оформить справку для визы', href: '/requests/new?type=visa' }]);
  if (has(q, ['матпомощ', 'материальн'])) {
    const aid = data.requests.find((r) => r.type === 'aid' && r.status === 'need_student');
    return set('aid', aid ? `По заявке № ${aid.number} деканат ждёт документ: ${aid.needs_text.toLowerCase()}. После загрузки рассмотрение продолжится.` : 'Заявление на материальную помощь подаётся в «Заявках». Понадобится справка о составе семьи — подскажу, где её взять.',
      aid ? [{ label: 'Загрузить документ', href: `/requests/${aid.id}#upload` }, { label: 'Где взять справку', href: '/help/doc?name=' + encodeURIComponent('Справка о составе семьи') }] : [{ label: 'Подать заявление', href: '/requests/new?type=aid' }]);
  }
  if (has(q, ['справк', 'работодател'])) return set('study', 'Справку об обучении можно заказать в «Заявках»: выбери, куда она нужна, и формат — электронный или бумажный.', [{ label: 'Заказать справку', href: '/requests/new?type=study' }]);
  if (has(q, ['заочк', 'перевод', 'перевест', 'другую форму'])) return set('transfer', 'Это перевод на другую форму обучения. Демо-правило концепта: подаётся заявление в деканат, его согласуют в институте и оформляют приказом. На заочной форме обычно не назначается академическая стипендия, условия оплаты зависят от направления — уточни в деканате (корпус 1, каб. 210) до подачи.', [{ label: 'Мой деканат', href: '/me' }]);
  if (has(q, ['академ', 'академическ'])) return set('academic_leave', 'Академический отпуск оформляется через заявление в деканат с подтверждающим документом. В первой версии кабинета эта заявка не подаётся онлайн — уточни порядок в деканате (корпус 1, каб. 210).', [{ label: 'Мой деканат', href: '/me' }]);
  if (has(q, ['отсрочк', 'больше времени', 'не успеваю', 'продлить срок', 'перенести срок'])) return set('extension', 'Можно написать преподавателю так: «Здравствуйте! Я не успеваю сдать работу к сроку. Могу ли я сдать её до [дата]? Спасибо». Объяснять причины не обязательно. Если работ несколько — посмотри «Оценки»: там видно, что важнее.', [{ label: 'Открыть оценки', href: '/study/grades' }]);
  if (has(q, ['пара', 'расписан', 'аудитор', 'где занят', 'куда идти'])) {
    out.exact = true;
    const n = data.next;
    return set('schedule', n ? `Ближайшая пара: ${n.subject}, ${T.relDateTime(n.startsAt)}, ${n.online ? 'онлайн' : `ауд. ${n.room}`}.${n.old_room ? ` Аудитория изменена, было ${n.old_room}.` : ''}` : 'В ближайшие две недели пар нет.', [{ label: 'Расписание', href: n ? `/study?d=${T.dateKey(n.startsAt)}#pair-${n.id}` : '/study' }]);
  }
  if (has(q, ['статус', 'заявк', 'готов'])) {
    out.exact = true;
    const open = data.requests.filter((r) => !['ready', 'rejected', 'draft'].includes(r.status));
    return set('status', open.length ? open.map((r) => `№ ${r.number} «${r.title}» — ${r.statusText.toLowerCase()}`).join('; ') + '.' : 'Открытых заявок нет.', [{ label: 'Мои заявки', href: '/requests' }]);
  }
  if (has(q, ['стипенд'])) return set('stipend', 'Размер и условия стипендии в демо не рассчитываются. По данным «Оценок» видно, есть ли риск не закрыть сессию вовремя — это главное условие академической стипендии. Точные правила — в деканате.', [{ label: 'Открыть оценки', href: '/study/grades' }]);
  return out;
}

function fallbackText() {
  return 'Пока не знаю, как помочь с этим. Попробуй спросить иначе: «справка для проездного», «сколько баллов до зачёта», «перевод на заочку» — или напиши в деканат по любой заявке.';
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

function systemPrompt(data) {
  const u = data.user;
  const lines = [
    'Ты — помощник «Что нужно?» в концепте личного кабинета студента «ДГТУ.Сейчас» (прототип для конкурса, данные вымышленные).',
    'Отвечай по-русски, на «ты», коротко: 2–5 предложений, без markdown-заголовков.',
    'Опирайся только на данные студента и демо-правила ниже. Не выдумывай нормативы, сроки, суммы, телефоны и ссылки. Если не знаешь — так и скажи и предложи обратиться в деканат: корпус 1, каб. 210, пн–пт 9:00–17:00.',
    'Никогда не считай баллы, суммы и сроки сам и не придумывай максимумы работ: такие ответы кабинет считает программой. Если спрашивают о баллах — предложи открыть «Оценки».',
    'Никогда не пиши, что ты что-то проверил, отправил или оформил — ты только подсказываешь. Кнопки для действий интерфейс покажет сам.',
    'Если студенту плохо — мягко предложи раздел «Если тяжело» и номер 112 при угрозе жизни; не ставь диагнозов.',
    '', `Сегодня: ${T.wdLongKey(T.dateKey())}, ${T.dayMonthKey(T.dateKey())}, ${T.timeOf(T.now())}, неделя — ${T.parityLabel()}.`,
    `Студент: ${u.first_name}, ${u.level}, ${u.course} курс, группа ${u.group_name}, форма ${u.form}, основа ${u.funding}.`,
    data.next ? `Ближайшая пара: ${data.next.subject}, ${T.relDateTime(data.next.startsAt)}, ${data.next.online ? 'онлайн' : 'ауд. ' + data.next.room}.` : 'Ближайших пар нет.',
    'Успеваемость: ' + data.disciplines.map((d) => d.closed_text ? `${d.subject} — ${d.closed_text}` : `${d.subject} — ${d.points}/100, порог ${d.pass_threshold}${d.overdue.length ? `, не сданы: ${d.overdue.map((w) => w.title).join(', ')}` : ''}`).join('; ') + '.',
    'Заявки: ' + (data.requests.filter((r) => r.status !== 'draft').map((r) => `№ ${r.number} ${r.title} — ${r.statusText}${r.needs_text && r.status === 'need_student' ? ` (${r.needs_text})` : ''}`).join('; ') || 'нет') + '.',
    'Оплаты по договору: ' + (TAX.yearsFromPayments(data.payments || []).map((y) => `${y.year} — ${TAX.rub(y.sum)}`).join('; ') || 'нет (бюджет)') + '.',
    'Вычет за своё обучение (демо-подсказка по материалам ФНС): любая форма обучения; 13% от расходов, но в пределах 150 000 ₽ в год вместе с другими социальными вычетами; с расходов 2024 года достаточно справки об оплате образовательных услуг из вуза; вуз выдаёт справку только за закончившийся календарный год (за текущий — с января следующего); справку прикладывают к декларации 3-НДФЛ в личном кабинете налогоплательщика; вернуть налог можно за три последних года. За обучение ребёнка родители получают вычет только при очной форме и возрасте до 24 лет.',
    'Словарь вузовских терминов (используй эти значения, не придумывай свои): академическая разница — дисциплины, которых не было в прежнем учебном плане или программе, их досдают при переводе или восстановлении; академическая задолженность — несданный зачёт или экзамен; пересдача — повторная сдача задолженности в сроки, которые назначает институт; академический отпуск — перерыв в учёбе по медицинским, семейным и иным основаниям с сохранением места; восстановление — возвращение в вуз после отчисления; перевод — смена формы обучения, направления, основы или вуза. Если термина нет в словаре и данных кабинета — скажи, что лучше уточнить в деканате.',
    'Онлайн можно подать: справку для налогового вычета (3 рабочих дня, демо-срок), справку об обучении (для проездного, в соцзащиту, работодателю; электронная — обычно в тот же день, бумажная — 2 рабочих дня), справку для визы на английском (3 рабочих дня), заявление на материальную помощь (нужна справка о составе семьи). Это демо-правила концепта.',
  ];
  return lines.join('\n');
}

async function askGigaChat(question, history, data) {
  const run = async () => {
    const tk = await getToken();
    const messages = [{ role: 'system', content: systemPrompt(data) }];
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
  if (!q) return { text: 'Напиши, что нужно.', actions: [], source: 'rules', intent: 'empty' };
  const it = intents(q, data);
  if (it.id === 'support') return { text: it.text, actions: it.actions, source: 'rules', intent: it.id };
  // Цифры (баллы, суммы, статусы, расписание) отдаём из расчёта кабинета, без пересказа моделью
  if (it.exact) return { text: it.text, actions: it.actions, source: 'calc', intent: it.id };
  if (enabled()) {
    try {
      const text = await askGigaChat(q, history, data);
      if (text) return { text, actions: it.actions, source: 'gigachat', intent: it.id };
    } catch (e) {
      console.error('[assistant] GigaChat недоступен:', e.message);
    }
  }
  return { text: it.text || fallbackText(), actions: it.actions, source: 'rules', intent: it.id };
}

module.exports = { answer, intents, enabled };
