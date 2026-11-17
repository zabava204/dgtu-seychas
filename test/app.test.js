'use strict';
// Проверки: разделение данных студентов, права деканата, сквозной сценарий заявки, помощник без ключа.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dgtu-'));
process.env.DATA_DIR = tmp;
process.env.DB_FILE = path.join(tmp, 'test.sqlite');
delete process.env.GIGACHAT_AUTH_KEY;
const { createApp } = require('../src/server');
const { DEMO_INN } = require('../src/tax');

let server; let base;
before(async () => { server = createApp().listen(0); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

// Простой клиент с cookie
function client() {
  let cookie = '';
  const req = async (method, url, body, json) => {
    const headers = { cookie };
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body && json) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    else if (body) { headers['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(body).toString(); }
    const res = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
    const set = res.headers.getSetCookie();
    if (set.length) {
      const jar = Object.fromEntries(cookie.split('; ').filter(Boolean).map((c) => c.split(/=(.*)/s).slice(0, 2)));
      for (const c of set) { const [kv] = c.split(';'); const [k, v] = kv.split(/=(.*)/s); jar[k] = v; }
      cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    }
    return res;
  };
  return { get: (u) => req('GET', u), post: (u, b, j) => req('POST', u, b, j) };
}
async function login(name) { const c = client(); const r = await c.post('/login', { login: name, password: 'demo2026' }); assert.equal(r.status, 302); return c; }

test('неверный пароль – понятная ошибка, без входа', async () => {
  const c = client();
  const r = await c.post('/login', { login: 'anna', password: 'wrong' });
  assert.equal(r.status, 401);
  assert.match(await r.text(), /Неверный логин или пароль/);
  assert.equal((await c.get('/')).status, 302);
});

test('без входа кабинет недоступен', async () => {
  const c = client();
  for (const u of ['/', '/requests', '/study', '/staff', '/requests/1', '/files/1']) assert.equal((await c.get(u)).status, 302, u);
});

test('студент видит только свои заявки, файлы и PDF', async () => {
  const anna = await login('anna'); const ilya = await login('ilya');
  const page = await (await anna.get('/requests')).text();
  assert.match(page, /Материальная помощь/);
  assert.doesNotMatch(page, /\d{4}-051/); // заявка Ильи
  const annaReady = 1; // № …-007, готовая справка Анны
  assert.equal((await anna.get(`/requests/${annaReady}/pdf`)).status, 200);
  const foreign = await ilya.get(`/requests/${annaReady}`);
  assert.equal(foreign.status, 404);
  const ft = await foreign.text();
  assert.match(ft, /Такой заявки нет среди твоих/); // понятная страница с меню
  assert.match(ft, /class="tabbar"/);
  assert.doesNotMatch(ft, /Справка об обучении/);
  assert.equal((await ilya.get(`/requests/${annaReady}/pdf`)).status, 404);
  assert.equal((await ilya.get('/files/1')).status, 404); // файл чужой студентки
  assert.equal((await ilya.post(`/requests/2/message`, { text: 'чужое' })).status, 404);
});

test('студент не может выполнять действия деканата', async () => {
  const anna = await login('anna');
  assert.equal((await anna.get('/staff')).status, 403);
  assert.equal((await anna.post('/staff/requests/3/ready', {})).status, 403);
  assert.equal((await anna.post('/staff/reset', {})).status, 403);
});

test('POST с чужого сайта отклоняется', async () => {
  const res = await fetch(base + '/login', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' }, body: 'login=anna&password=demo2026', redirect: 'manual' });
  assert.equal(res.status, 403);
});

test('сквозной сценарий: подача → в работе → PDF → уведомление', async () => {
  const anna = await login('anna'); const dk = await login('dekanat');
  const r = await anna.post('/requests', { type: 'study', purpose: 'social', format: 'pdf', details: '' });
  assert.equal(r.status, 302);
  const id = r.headers.get('location').match(/requests\/(\d+)\/sent/)[1];
  assert.match(await (await anna.get(`/requests/${id}/sent`)).text(), /Справка заказана/);
  assert.equal((await anna.get(`/requests/${id}/pdf`)).status, 404); // ещё не готова
  assert.match(await (await dk.get('/staff?f=new')).text(), new RegExp(`/staff/requests/${id}`));
  assert.equal((await dk.post(`/staff/requests/${id}/take`, {})).status, 302);
  assert.match(await (await anna.get(`/requests/${id}`)).text(), /Соколова Е\. В\./);
  assert.equal((await dk.post(`/staff/requests/${id}/ready`, {})).status, 302);
  const pdf = await anna.get(`/requests/${id}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.ok((await pdf.arrayBuffer()).byteLength > 5000);
  const feed = await (await anna.get('/notifications')).text();
  assert.match(feed, /Справка об обучении в органы соцзащиты готова/);
});

test('запрос документа и загрузка студентом', async () => {
  const anna = await login('anna'); const dk = await login('dekanat');
  const r = await anna.post('/requests', { type: 'aid', purpose: 'Лечение', details: 'тест' });
  const id = r.headers.get('location').match(/requests\/(\d+)/)[1];
  const early = await dk.post(`/staff/requests/${id}/need`, { text: 'до взятия' });
  assert.match(await (await dk.get(`/staff/requests/${id}`)).text(), /Новая/); // запросить документ до «Взять в работу» нельзя
  await dk.post(`/staff/requests/${id}/take`, {});
  await dk.post(`/staff/requests/${id}/need`, { text: 'Загрузи справку о составе семьи' });
  assert.match(await (await anna.get('/requests')).text(), /Нужно дополнить/);
  const fd = new FormData();
  fd.append('doc', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'spravka.pdf');
  const up = await anna.post(`/requests/${id}/upload`, fd);
  assert.equal(up.status, 302);
  const page = await (await anna.get(`/requests/${id}`)).text();
  assert.match(page, /Документ загружен/);
  assert.match(page, /spravka\.pdf/);
  assert.match(await (await dk.get(`/staff/requests/${id}`)).text(), /Студент загрузил документ/);
  await anna.post(`/requests/${id}/notify`, {});
  const notified = await (await anna.get(`/requests/${id}`)).text();
  assert.match(notified, /Уведомления по заявке включены/);
  assert.doesNotMatch(notified, /Сообщим, когда справка будет готова/);
  await dk.post(`/staff/requests/${id}/ready`, { text: 'Демонстрационное решение по заявлению' });
  assert.match(await (await dk.get(`/staff/requests/${id}`)).text(), /Решение принято/);
  assert.doesNotMatch(await (await anna.get(`/requests/${id}`)).text(), /href="\/requests\/\d+\/pdf"/);
});

test('помощник без ключа отвечает по правилам и даёт кнопку', async () => {
  const anna = await login('anna');
  const r = await anna.post('/api/assistant', { message: 'нужна справка для субсидии на ЖКУ' }, true);
  const j = await r.json();
  assert.equal(j.source, 'rules');
  assert.equal(j.cascade, 'decision'); // каскад Decision Models: уверенное правило, не LLM
  assert.ok(j.actions.some((a) => a.href.startsWith('/requests/new?type=study')));
  const s = await (await anna.post('/api/assistant', { message: 'мне очень тяжело' }, true)).json();
  assert.ok(s.actions.some((a) => a.href === '/hard' || a.href.startsWith('/hard#')));
  assert.equal(s.cascade, 'decision');
  const grades = await (await anna.post('/api/assistant', { message: 'Сколько баллов не хватает по бизнес-планированию?' }, true)).json();
  assert.equal(grades.source, 'calc');
  assert.equal(grades.cascade, 'calc');
});

test('RAG-lite: в факты для LLM не попадают баллы и суммы студента', async () => {
  const assistant = require('../src/assistant');
  const data = {
    user: { first_name: 'Анна', level: 'бакалавриат', course: 3, group_name: 'ЭБ-31', form: 'очная', funding: 'бюджет' },
    disciplines: [{ subject: 'Бизнес-планирование', points: 47, pass_threshold: 50, overdue: [], closed_text: null }],
    payments: [{ year: 2024, amount: 96000 }],
    requests: [{ number: '2024-048', title: 'Справка', status: 'in_work', statusText: 'В обработке' }],
    session: [],
  };
  const taxFacts = assistant.retrieveFacts('как оформить вычет', data);
  assert.ok(taxFacts.some((b) => b.id === 'tax'));
  assert.ok(taxFacts.every((b) => !/47|96\s*000|2024-048|Бизнес-планирование – 47/.test(b.text)));
  const termFacts = assistant.retrieveFacts('что такое академическая разница', data);
  assert.ok(termFacts.some((b) => b.id === 'terms'));
  assert.ok(termFacts.every((b) => !/\b47\b|96000/.test(b.text)));
});

test('основной сценарий: справка для налогового вычета', async () => {
  const ilya = await login('ilya'); const anna = await login('anna'); const dk = await login('dekanat');
  const form = await (await ilya.get('/requests/new?type=tax&draft=1')).text();
  assert.match(form, /Договор и оплаты найдены/);
  assert.match(form, /96 000 ₽/);
  assert.match(form, /pattern="\\d\{12\}"/);
  assert.match(form, /12 480 ₽/);
  const year = form.match(/name="purpose" value="(\d{4})"/)[1];
  assert.match(form, /Справка об оплате образовательных услуг для ИФНС \(КНД 1151158\)/);
  assert.match(form, /ФИО заказчика/);
  assert.match(form, new RegExp(`value="${DEMO_INN}"`)); // демо-ИНН подставлен в черновик
  // Первый экран: итог и кнопка заказа выше данных договора; данные свёрнуты, когда ИНН уже есть
  assert.ok(form.indexOf('Заказать справку') < form.indexOf('Данные для справки и ИНН'));
  assert.match(form, /<details class="card tax-more"[^>]*>\s*<summary>/); assert.doesNotMatch(form, /<details class="card tax-more"[^>]*open/);
  assert.equal((await ilya.post('/requests', { type: 'tax', purpose: year, format: 'pdf', details: '123456789012' })).status, 400); // неверный ИНН
  assert.equal((await ilya.post('/requests', { type: 'tax', purpose: year, format: 'pdf', details: '' })).status, 400); // ИНН обязателен
  assert.equal((await ilya.post('/requests', { type: 'tax', purpose: '2019', format: 'pdf', details: DEMO_INN })).status, 400); // нет оплат за год
  const cur = String(new Date(Date.now() + 3 * 3600e3).getUTCFullYear());
  assert.match(form, new RegExp(`Справку за ${cur} год можно заказать с января ${Number(cur) + 1} года`));
  assert.doesNotMatch(form, /Год ещё идёт/);
  assert.equal((await ilya.post('/requests', { type: 'tax', purpose: cur, format: 'pdf', details: DEMO_INN })).status, 400); // год не закончился
  assert.equal((await anna.post('/requests', { type: 'tax', purpose: year, format: 'pdf', details: '' })).status, 400); // бюджет: оплат нет
  const r = await ilya.post('/requests', { type: 'tax', purpose: year, format: 'pdf', details: DEMO_INN, note: 'Для декларации 3-НДФЛ' });
  assert.equal(r.status, 302);
  const id = r.headers.get('location').match(/requests\/(\d+)/)[1];
  assert.match(await (await dk.get(`/staff/requests/${id}`)).text(), /Оплаты по договору/);
  await dk.post(`/staff/requests/${id}/take`, {});
  await dk.post(`/staff/requests/${id}/ready`, {});
  const pdf = await ilya.get(`/requests/${id}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal((await anna.get(`/requests/${id}/pdf`)).status, 404);
  const a = await (await ilya.post('/api/assistant', { message: 'как вернуть налог за учёбу?' }, true)).json();
  assert.ok(a.actions.some((x) => x.href === '/requests/new?type=tax'));
  assert.match(a.text, /12 480 ₽/);
});

test('помощник: баллы считает программа (регрессия «212 баллов»)', async () => {
  const anna = await login('anna');
  const a = await (await anna.post('/api/assistant', { message: 'Хватит ли финансового и маркетингового плана по бизнес-планированию, чтобы набрать порог 50?' }, true)).json();
  assert.equal(a.source, 'calc');
  assert.match(a.text, /12 \+ 20 \+ 15 = 47/);
  assert.match(a.text, /останется 3 балла/);
  assert.doesNotMatch(a.text, /212|70/);
});

test('уведомление об изменении аудитории ведёт на нужный день и пару', async () => {
  const anna = await login('anna');
  const feed = await (await anna.get('/notifications')).text();
  const m = feed.match(/href="(\/study\?d=(\d{4}-\d{2}-\d{2})#pair-(\d+))"/);
  assert.ok(m, 'ссылка с датой и парой');
  const page = await (await anna.get(m[1].split('#')[0])).text();
  assert.match(page, new RegExp(`id="pair-${m[3]}"`));
  assert.match(page, /Аудитория изменена · было 8-202/);
});

test('сессия: даты, допуск, зачётная книжка, вопрос помощнику', async () => {
  const anna = await login('anna'); const ilya = await login('ilya');
  const g = await (await anna.get('/study/grades')).text();
  assert.match(g, /первый зачёт \d+ декабря/);
  assert.match(g, /Как получить допуск/);
  assert.match(g, /Бизнес-планирование[\s\S]*до допуска 38 баллов/);
  assert.match(g, /Маркетинг[\s\S]*допуск есть/);
  assert.match(g, /Зачётная книжка/);
  const book = await (await anna.get('/study/record')).text();
  assert.match(book, /4 семестр/);
  assert.match(book, /Курсовая работа по менеджменту/);
  assert.doesNotMatch(await (await ilya.get('/study/record')).text(), /Курсовая работа по менеджменту/); // чужая зачётка не видна
  const a = await (await anna.post('/api/assistant', { message: 'Когда экзамен по бизнес-планированию?' }, true)).json();
  assert.equal(a.source, 'calc');
  assert.match(a.text, /консультация[\s\S]*экзамен: Бизнес-планирование/);
});

test('расписание на неделю: все дни, изменения, пары другой группы не видны', async () => {
  const anna = await login('anna');
  const w = await (await anna.get('/study?view=week')).text();
  assert.equal((w.match(/class="wk-day/g) || []).length, 6);
  assert.match(w, /aria-current="page">Неделя/);
  assert.doesNotMatch(w, /Методы анализа в менеджменте/); // пары магистрантов ММН-21
});

test('напоминания о сроках в ленте и фильтр «Сроки»', async () => {
  const anna = await login('anna');
  const f = await (await anna.get('/notifications?c=deadlines')).text();
  assert.match(f, /Через 2 дня: реферат по маркетингу/);
  assert.doesNotMatch(f, /Экономика организации: ауд/); // другие категории скрыты фильтром
});

test('повторный проход сценария: ИНН подставлен без черновика, сброс демо возвращает черновик', async () => {
  const ilya = await login('ilya');
  assert.match(await (await ilya.get('/requests/new?type=tax')).text(), new RegExp(`value="${DEMO_INN}"`));
  const anon = await client().post('/demo/reset', {});
  assert.equal(anon.headers.get('location'), '/login'); // без входа сброса нет
  const r = await ilya.post('/demo/reset', {});
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/');
  const again = await login('ilya');
  assert.match(await (await again.get('/requests')).text(), /Черновики[\s\S]*Справка для налогового вычета/);
});

test('помощник: пары на завтра считает программа, подсказки под студента', async () => {
  const ilya = await login('ilya');
  const a = await (await ilya.post('/api/assistant', { message: 'Где завтра пары?' }, true)).json();
  assert.equal(a.source, 'calc');
  assert.match(a.text, /^Завтра|пар нет/);
  const h = await (await ilya.get('/helper')).text();
  assert.match(h, /Налоговый вычет/);
  assert.doesNotMatch(h, /Перевод на заочку/);
});

test('жизненная ситуация: пакет справок по данным и заказ одной кнопкой', async () => {
  const anna = await login('anna'); const ilya = await login('ilya'); const dk = await login('dekanat');
  const p = await (await anna.get('/situations/housing')).text();
  assert.match(p, /Справка об обучении в органы социальной защиты/);
  assert.match(p, /Справка о размере стипендии/);
  assert.match(p, /Заказать выбранные справки/);
  const ip = await (await ilya.get('/situations/housing')).text();
  assert.match(ip, /на договоре академическая стипендия не назначается/); // контракт – без справки о стипендии
  const r = await anna.post('/situations/housing', new URLSearchParams([['items', 'study'], ['items', 'stipend']]));
  assert.equal(r.status, 302);
  const list = await (await anna.get('/requests')).text();
  assert.match(list, /Справка о размере стипендии/);
  const again = await (await anna.get('/situations/housing')).text();
  assert.match(again, /Уже заказана/); // повторно не закажет
  assert.equal((await ilya.post('/requests', { type: 'stipend', format: 'pdf' })).status, 400); // стипендия только бюджету
  const q = await (await dk.get('/staff?f=new')).text();
  const id = q.match(/\/staff\/requests\/(\d+)[^]*?Справка о размере стипендии/);
  assert.ok(id);
  // У деканата две справки пакета – одной строкой очереди, на странице заявки – ссылка на вторую справку
  assert.equal((q.match(/Пакет · 2 справки/g) || []).length, 1);
  assert.match(q, /Семья оформляет субсидию на ЖКУ/);
  const ids = [...q.matchAll(/class="clickable bundle" data-href="\/staff\/requests\/(\d+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, 1);
  const d = await (await dk.get(`/staff/requests/${ids[0]}`)).text();
  assert.match(d, /Пакет «Семья оформляет субсидию на ЖКУ»/);
});

test('помощник: факты из аудита 14.11 считает программа', async () => {
  const anna = await login('anna'); const ilya = await login('ilya');
  const ask = async (c, m) => (await c.post('/api/assistant', { message: m }, true)).json();
  const mon = await ask(anna, 'Какие пары в понедельник?');
  assert.equal(mon.source, 'calc'); assert.match(mon.text, /Понедельник/); assert.match(mon.text, /Маркетинг|Статистика|Бизнес-планирование/);
  const avg = await ask(anna, 'Какой у меня средний балл?'); assert.equal(avg.source, 'calc'); assert.match(avg.text, /4,45/);
  const rt = await ask(anna, 'Можно ли пересдать экзамен?'); assert.match(rt.text, /назначает институт/); assert.doesNotMatch(rt.text, /не хватает/);
  const st = await ask(anna, 'Когда будет готова справка?'); assert.equal(st.source, 'calc'); assert.match(st.text, /№ \d{4}-048/);
  const sc = await ask(anna, 'Нужна справка о стипендии'); assert.match(sc.text, /1 рабочий день/); assert.ok(sc.actions.some((a) => a.href === '/requests/new?type=stipend'));
  const sa = await ask(anna, 'Какая у меня стипендия?'); assert.match(sa.text, /3 800 ₽ в месяц/);
  const si = await ask(ilya, 'Нужна справка о стипендии'); assert.match(si.text, /по договору/);
  const nir = await ask(ilya, 'Что с моей НИР, какой у меня балл?'); assert.equal(nir.source, 'calc'); assert.match(nir.text, /42 из 100/);
  const y26 = await ask(ilya, 'Можно справку за 2026 год?'); assert.match(y26.text, /с января 2027/);
  const job = await ask(ilya, 'Нужна справка для работы'); assert.ok(job.actions.some((a) => a.href.includes('purpose=employer')));
});

test('защита от повторов: вычет за тот же год и стипендия на договоре', async () => {
  const ilya = await login('ilya');
  const y = String(new Date(Date.now() + 3 * 3600e3).getUTCFullYear() - 1);
  await ilya.post('/requests', { type: 'tax', purpose: y, format: 'pdf', details: DEMO_INN });
  const second = await ilya.post('/requests', { type: 'tax', purpose: y, format: 'pdf', details: DEMO_INN });
  assert.equal(second.status, 400);
  assert.match(await second.text(), /уже (заказана|выдана)/);
  const st = await ilya.get('/requests/new?type=stipend');
  assert.equal(st.status, 302);
});

test('помощник: вузовские термины из словаря', async () => {
  const anna = await login('anna');
  const a = await (await anna.post('/api/assistant', { message: 'Что такое академическая разница?' }, true)).json();
  assert.equal(a.source, 'calc');
  assert.match(a.text, /которых не было в твоём прежнем учебном плане, но они есть в новом/);
});

test('помощник отвечает по-английски: факты считает программа', async () => {
  const anna = await login('anna'); const ilya = await login('ilya');
  const ask = async (c, m) => (await c.post('/api/assistant', { message: m }, true)).json();
  const mon = await ask(anna, 'What classes do I have on Monday?');
  assert.equal(mon.lang, 'en'); assert.equal(mon.source, 'calc'); assert.match(mon.text, /^Monday, \d+ [A-Z][a-z]+:/); assert.match(mon.text, /room /);
  const ex = await ask(anna, 'When are my exams?'); assert.equal(ex.source, 'calc'); assert.match(ex.text, /credit test|exam/); assert.doesNotMatch(ex.text, /зачёт:|экзамен:/);
  const st = await ask(anna, 'What is the status of my request?'); assert.equal(st.source, 'calc'); assert.match(st.text, /No\. \d{4}-048/);
  const tx = await ask(ilya, 'Can I get a tax deduction?'); assert.equal(tx.source, 'calc'); assert.match(tx.text, /RUB/);
  const ce = await ask(anna, 'How do I get a certificate of enrollment?'); assert.ok(ce.actions.some((a) => a.href === '/requests/new?type=study'));
  const ru = await ask(anna, 'Какие пары в понедельник?'); assert.equal(ru.lang, 'ru');
});

test('план на 7 дней не пересекает пары, не ставит прошлое и не меняет баллы', async () => {
  const P = require('../src/plan');
  const Tm = require('../src/time');
  const monday = [
    { start: '9:00', end: '10:35' },
    { start: '10:45', end: '12:20' },
    { start: '13:20', end: '14:55' },
  ];
  const fit = P.place({
    days: [{ key: '2026-11-16', pairs: monday }], minutes: 60, part: 'day',
    tasks: [{ discipline_id: 1, kind: 'self_study', title: 'Подготовиться', detail: 'из журнала' }],
    nowKey: '2026-11-16', nowMin: Tm.parseHHMM('8:00'),
  });
  assert.equal(fit.placed.length, 1);
  assert.equal(fit.placed[0].start_min, Tm.parseHHMM('8:00'));
  assert.equal(fit.placed[0].end_min, Tm.parseHHMM('9:00'));
  const late = P.place({
    days: [{ key: '2026-11-16', pairs: monday }, { key: '2026-11-17', pairs: [] }], minutes: 60, part: 'day',
    tasks: [{ discipline_id: 1, kind: 'clarify', title: 'Уточнить', detail: 'из журнала' }],
    nowKey: '2026-11-16', nowMin: Tm.parseHHMM('16:40'),
  });
  assert.equal(late.placed[0].date_key, '2026-11-17');
  assert.ok(late.placed[0].start_min >= Tm.parseHHMM('8:00'));
  const evening = P.place({
    days: [{ key: '2026-11-16', pairs: [{ start: '18:30', end: '20:05' }] }], minutes: 60, part: 'evening',
    tasks: [{ discipline_id: 2, kind: 'clarify', title: 'Уточнить', detail: 'из журнала' }],
    nowKey: '2026-11-16', nowMin: Tm.parseHHMM('12:00'),
  });
  assert.equal(evening.placed[0].start_min, Tm.parseHHMM('20:05'));
  assert.equal(evening.placed[0].end_min, Tm.parseHHMM('21:05'));
  assert.ok(!P.overlaps(evening.placed[0].start_min, evening.placed[0].end_min, Tm.parseHHMM('18:30'), Tm.parseHHMM('20:05')));

  const anna = await login('anna');
  const { open } = require('../src/db');
  const { model } = require('../src/model');
  const db = open();
  const M = model(db);
  const annaId = M.userByLogin('anna').id;
  const points = () => M.disciplines(annaId).find((d) => d.subject === 'Бизнес-планирование').points;
  const before = points();
  assert.equal((await anna.post('/study/plan', { minutes: '45', part: 'night' })).status, 302);
  assert.doesNotMatch(await (await anna.get('/study/plan')).text(), /data-date=/);
  assert.equal((await anna.post('/study/plan', { minutes: '60', part: 'day' })).status, 302);
  const page = await (await anna.get('/study/plan')).text();
  assert.match(page, /Подготовиться самой/);
  assert.match(page, /Уточнить у преподавателя: Бизнес-планирование/);
  assert.match(page, /баллы не меняет/);
  assert.match(page, /В плане учтены работы из журнала и расписание учебных занятий/);
  const slots = [...page.matchAll(/data-date="(\d{4}-\d{2}-\d{2})" data-start="(\d+)" data-end="(\d+)"/g)];
  assert.ok(slots.length >= 1 && slots.length <= 7);
  const today = Tm.dateKey();
  const nowMin = Tm.minutesOfDay();
  const byDay = {};
  for (const [, date, a, b] of slots) {
    const start = Number(a); const end = Number(b);
    assert.ok(date >= today, date);
    assert.ok(end - start <= 60 && end - start >= 30);
    if (date === today) assert.ok(start >= nowMin - 1);
    byDay[date] = (byDay[date] || 0) + (end - start);
    const busy = M.dayPairs('МН-31', date).filter((p) => !p.cancelled);
    for (const p of busy) assert.ok(!P.overlaps(start, end, Tm.parseHHMM(p.start), Tm.parseHHMM(p.end)), `${date} ${p.subject}`);
  }
  for (const used of Object.values(byDay)) assert.ok(used <= 60);
  const slotId = page.match(/data-slot="(\d+)"/)[1];
  assert.equal((await anna.post(`/study/plan/slots/${slotId}/done`)).status, 302);
  assert.equal(points(), before);
  assert.match(await (await anna.get('/')).text(), /Ближайшая задача плана/);
  const ilya = await login('ilya');
  assert.equal((await ilya.post(`/study/plan/slots/${slotId}/done`)).status, 404);
  assert.doesNotMatch(await (await ilya.get('/study/plan')).text(), /Бизнес-планирование/);
  assert.equal((await ilya.post('/study/plan', { minutes: '60', part: 'evening' })).status, 302);
  const ip = await (await ilya.get('/study/plan')).text();
  assert.match(ip, /Подготовиться самому/);
  for (const [, date, a, b] of ip.matchAll(/data-date="(\d{4}-\d{2}-\d{2})" data-start="(\d+)" data-end="(\d+)"/g)) {
    const start = Number(a); const end = Number(b);
    assert.ok(date >= today);
    if (date === today) assert.ok(start >= nowMin - 1);
    assert.ok(end - start <= 60);
    for (const p of M.dayPairs('ММН-21', date).filter((x) => !x.cancelled)) assert.ok(!P.overlaps(start, end, Tm.parseHHMM(p.start), Tm.parseHHMM(p.end)), `${date} ${p.start}`);
  }
  const dean = await login('dekanat');
  assert.equal((await dean.post('/staff/reset')).status, 302);
  const again = await login('anna');
  assert.doesNotMatch(await (await again.get('/study/plan')).text(), /data-date=/);
  const homeAgain = await (await again.get('/')).text();
  assert.doesNotMatch(homeAgain, /Ближайшая задача плана/);
  assert.match(homeAgain, /Составить план на 7 дней/);
  assert.match(homeAgain, /href="\/study\/plan\?new=1"/);
  assert.doesNotMatch(homeAgain.match(/<nav class="qa"[\s\S]*?<\/nav>/)[0], /План на 7 дней/);
  const att = homeAgain.match(/id="att-h"[\s\S]*?<\/section>/)[0];
  assert.match(att, /Допуск к сессии: Бизнес-планирование/);
  assert.ok(att.indexOf('Допуск к сессии: Бизнес-планирование') < att.indexOf('Материальная помощь'), 'допуск выше заявок');
  assert.ok(att.indexOf('Бизнес-планирование') < att.indexOf('Статистика'), 'больший недобор выше');
  db.close();
});

test('разбор допуска: свои баллы, чужая дисциплина скрыта, письмо не отправляется', async () => {
  const anna = await login('anna');
  const ilya = await login('ilya');
  const list = await (await anna.get('/study/session-support')).text();
  const m = list.match(/href="(\/study\/session-support\/(\d+))"[^>]*>[\s\S]{0,240}Бизнес-планирование/);
  assert.ok(m, 'у Анны есть разбор бизнес-планирования');
  const page = await (await anna.get(m[1])).text();
  assert.match(page, /Расчёт кабинета: 50 − 12 = 38/);
  assert.match(page, /12 \+ 35 = 47/);
  assert.match(page, /останется 3/);
  assert.match(page, /Уточни у преподавателя/);
  assert.match(page, /Не хватает 38|не хватает 38/);
  assert.match(page, /12 из 50/);
  assert.match(page, /admit-prog|progress gap/);
  assert.match(page, /допуска к экзамену/);
  assert.match(page, /Из кабинета сообщение не отправляется/);
  assert.doesNotMatch(page, /type="submit"|письмо отправлено/);
  assert.equal((await ilya.get(m[1])).status, 404);
  assert.doesNotMatch(await (await ilya.get(m[1])).text(), /Бизнес-планирование|Не хватает 38/);
  const il = await (await ilya.get('/study/session-support')).text();
  assert.match(il, /Методы анализа в менеджменте/);
  assert.doesNotMatch(il, /Бизнес-планирование/);
  const im = il.match(/href="(\/study\/session-support\/\d+)"/);
  const ip = await (await ilya.get(im[1])).text();
  assert.match(ip, /Не хватает 19/);
  assert.match(ip, /Этого хватит, чтобы набрать минимум для допуска/);
  assert.equal((await client().get(m[1])).status, 302);
  const ask = await (await anna.post('/api/assistant', { message: 'Сколько баллов не хватает по бизнес-планированию?' }, true)).json();
  assert.equal(ask.source, 'calc');
  assert.ok(ask.actions.some((a) => a.href === m[1]));
});

test('четыре вопроса помощника: план, письмо, отсрочка без даты, вечер', async () => {
  const anna = await login('anna');
  const ask = async (c, m) => (await c.post('/api/assistant', { message: m }, true)).json();
  const chips = await (await anna.get('/helper')).text();
  assert.match(chips, /До сессии/);
  assert.match(chips, /Письмо преподавателю/);
  assert.match(chips, /Перенос срока сдачи/);
  assert.match(chips, /Если занятия вечером/);
  const before = await ask(anna, 'Что сделать до сессии?');
  assert.equal(before.source, 'calc');
  assert.match(before.text, /Плана ещё нет/);
  assert.match(before.text, /Бизнес-планирование/);
  assert.match(before.text, /не хватает 38/);
  assert.ok(before.actions.some((a) => a.href === '/study/plan'));
  const letter = await ask(anna, 'Как написать преподавателю о допуске?');
  assert.equal(letter.source, 'calc');
  assert.match(letter.text, /12 из 50/);
  assert.match(letter.text, /Не хватает 38/);
  assert.match(letter.text, /не отправляет/);
  assert.doesNotMatch(letter.text, /\[дата\]/);
  assert.ok(letter.actions.some((a) => /\/study\/session-support\/\d+#letter/.test(a.href)));
  const ext = await ask(anna, 'Как попросить отсрочку по работе?');
  assert.equal(ext.source, 'calc');
  assert.match(ext.text, /дату не подставляю/);
  assert.doesNotMatch(ext.text, /\[дата\]/);
  const day = await ask(anna, 'Занятия вечером, когда готовиться?');
  assert.equal(day.source, 'calc');
  assert.match(day.text, /Твои учебные занятия днём/);
  assert.match(day.text, /18:00–22:00/);
  assert.equal((await anna.post('/study/plan', { minutes: '60', part: 'day' })).status, 302);
  const next = await ask(anna, 'Что сделать до сессии?');
  assert.match(next.text, /Ближайшее по плану/);
  assert.doesNotMatch(next.text, /\[дата\]|212/);
  const ilya = await login('ilya');
  const eve = await ask(ilya, 'Занятия вечером, когда готовиться?');
  assert.equal(eve.source, 'calc');
  assert.match(eve.text, /Учебные занятия у тебя вечером/);
  assert.ok(eve.actions.some((a) => a.href.includes('part=evening')));
  const en = await ask(anna, 'What should I do before the session?');
  assert.equal(en.lang, 'en');
  assert.equal(en.source, 'calc');
  assert.match(en.text, /Next in your plan|don’t have a plan/);
  const enLetter = await ask(anna, 'How do I write to my teacher?');
  assert.equal(enLetter.source, 'calc');
  assert.match(enLetter.text, /38 more needed/);
  assert.doesNotMatch(enLetter.text, /\[date\]|\[дата\]/);
  const dean = await login('dekanat');
  assert.equal((await dean.post('/staff/reset')).status, 302);
});

test('лупа ищет разделы, помощник – чат по своим данным', async () => {
  const anna = await login('anna');
  const home = await (await anna.get('/')).text();
  assert.match(home, /href="\/find"/); // лупа в шапке
  assert.match(home, /href="\/helper"/); // строка помощника
  assert.match(home, /aria-label="Найти раздел в кабинете"/);
  const find = await (await anna.get('/find')).text();
  assert.match(find, /Найти раздел/);
  assert.match(find, /id="find-q"/);
  assert.match(find, /href="\/study"/);
  assert.match(find, /href="\/me\/docs"/);
  assert.match(find, /Спросить помощника/);
  assert.match(find, /Психологическая помощь/);
  assert.match(find, /Служба поддержки/);
  assert.doesNotMatch(find, /Как получить вычет/);
  assert.doesNotMatch(find, /id="ask"|id="chat"/);
  const help = await (await anna.get('/helper')).text();
  assert.match(help, /id="ask"/);
  assert.match(help, /Ответы основаны на данных кабинета/);
  const hard = await (await anna.get('/hard')).text();
  assert.match(hard, /Психологическая помощь/);
  assert.match(hard, /href="\/support"/);
  const sup = await (await anna.get('/support')).text();
  assert.match(sup, /<h1>Служба поддержки<\/h1>/);
  assert.match(sup, /support@example\.com/);
  assert.doesNotMatch(hard, /<h1>Если тяжело<\/h1>|Если тяжело прямо сейчас/);
});

test('студенческий билет и зачётка: экран документов, ситуация и помощник', async () => {
  const anna = await login('anna');
  const ilya = await login('ilya');
  const me = await (await anna.get('/me')).text();
  assert.match(me, /href="\/me\/docs"/);
  assert.match(me, /Студенческий и зачётка|Мои документы/);
  const docs = await (await anna.get('/me/docs')).text();
  assert.match(docs, /Студенческий билет/);
  assert.match(docs, /Орлова Анна Сергеевна/);
  assert.match(docs, /Номер билета/);
  assert.match(docs, /230471/);
  assert.match(docs, /Приказ о зачислении/);
  assert.match(docs, /Дата выдачи/);
  assert.match(docs, /Уровень образования/);
  assert.match(docs, /Высшее, бакалавриат/);
  assert.match(docs, /href="\/study\/record"/);
  assert.doesNotMatch(docs, /не заменяет оригинал|военкомат|ОБРАЗЕЦ/);
  assert.equal((await ilya.get('/me/docs')).status, 200);
  assert.match(await (await ilya.get('/me/docs')).text(), /Смирнов Илья Андреевич/);
  assert.doesNotMatch(await (await ilya.get('/me/docs')).text(), /Орлова Анна/);
  const sit = await (await anna.get('/situations/idcard')).text();
  assert.match(sit, /Нужен студенческий билет или зачётная книжка/);
  assert.match(sit, /href="\/me\/docs"/);
  const ask = await (await anna.post('/api/assistant', { message: 'Где мой студенческий билет?' }, true)).json();
  assert.equal(ask.source, 'calc');
  assert.match(ask.text, /230471/);
  assert.doesNotMatch(ask.text, /не официальный|военкомат|оригинал/);
  assert.ok(ask.actions.some((a) => a.href === '/me/docs'));
  assert.match(docs, /Скачать билет \(PDF\)/);
  assert.match(docs, /href="\/me\/docs\/id\.pdf"/);
  assert.match(docs, /Скачать зачётную книжку \(PDF\)/);
  const idPdf = await anna.get('/me/docs/id.pdf');
  assert.equal(idPdf.status, 200);
  assert.match(idPdf.headers.get('content-type') || '', /pdf/);
  const rbPdf = await anna.get('/study/record/pdf');
  assert.equal(rbPdf.status, 200);
  assert.match(rbPdf.headers.get('content-type') || '', /pdf/);
  assert.equal((await ilya.get('/me/docs/id.pdf')).status, 200);
});

test('версия для слабовидящих: включается и выключается, работает и до входа', async () => {
  const c = client();
  const on = await c.get('/a11y');
  assert.equal(on.status, 302);
  assert.match(await (await c.get('/login')).text(), /<html lang="ru" class="lv">/);
  const anna = await login('anna');
  await anna.get('/a11y?on=1');
  const me = await (await anna.get('/me')).text();
  assert.match(me, /class="lv"/); assert.match(me, /Версия для слабовидящих/);
  await anna.get('/a11y');
  assert.doesNotMatch(await (await anna.get('/me')).text(), /class="lv"/);
});

test('главная: первая задача видна, вычет и допуск сверху, один вход в помощь', async () => {
  const anna = await login('anna'), ilya = await login('ilya');
  const a = await (await anna.get('/')).text(), i = await (await ilya.get('/')).text();
  for (const page of [a, i]) {
    assert.match(page, /Задачи и заявки/);
    assert.match(page, /class="group attention-primary"/);
    const visible = page.split('attention-primary')[1].split('<details')[0];
    assert.equal((visible.match(/class="row attention-row"/g) || []).length, 1);
    assert.match(page, /Ещё \d+ задач/);
    const attAt = page.indexOf('overview-attention');
    const actAt = page.indexOf('overview-actions');
    assert.ok(attAt > -1 && actAt > attAt, 'задачи выше быстрых действий в разметке');
  }
  assert.match(i.split('attention-primary')[1].split('<details')[0], /Справка для налогового вычета/);
  assert.match(a.split('attention-primary')[1].split('<details')[0], /Допуск к сессии: Бизнес-планирование/);
  assert.doesNotMatch(a.split('attention-primary')[1].split('<details')[0], /соцзащит/);
  const me = await (await anna.get('/me')).text();
  assert.ok(me.indexOf('Служба поддержки') > -1 && me.indexOf('Служба поддержки') < me.indexOf('Психологическая помощь')); // сначала поддержка, потом психологическая помощь
  assert.equal((me.match(/href="\/hard"/g) || []).length, 1);
  assert.equal((me.match(/href="\/support"/g) || []).length, 1);
  assert.doesNotMatch(me, /Куда обратиться/);
  for (const c of [anna, ilya]) {
    const p = await (await c.get('/situations/military')).text();
    assert.match(p, /Воинский учёт и отсрочка/);
    assert.match(p, /официальной странице|Официальная страница/);
    assert.doesNotMatch(p, /action="\/situations\/military"/);
  }
});

test('переключение демо: Анна → Илья → сотрудник → Анна, без сброса заявок', async () => {
  const c = await login('anna');
  await c.post('/requests/1/message', { text: 'Сообщение проверки переключения' });
  const annaList = [...new Set((await (await c.get('/requests')).text()).match(/href="\/requests\/\d+/g))];
  const profile = await (await c.get('/me')).text();
  assert.match(profile, /Переключение демо-аккаунта/);
  for (const name of ['anna', 'ilya', 'dekanat']) assert.match(profile, new RegExp(`value="${name}"`));
  let r = await c.post('/demo/switch', { login: 'ilya' });
  assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/me');
  let page = await (await c.get('/me')).text();
  assert.match(page, /Смирнов Илья Андреевич/); assert.doesNotMatch(page, /Орлова Анна Сергеевна/);
  assert.match(await (await c.get('/requests')).text(), /налогового вычета/);
  r = await c.post('/demo/switch', { login: 'dekanat' });
  assert.equal(r.headers.get('location'), '/staff');
  assert.match(await (await c.get('/staff')).text(), /Переключение демо-аккаунта/);
  await c.post('/demo/switch', { login: 'anna' });
  assert.deepEqual([...new Set((await (await c.get('/requests')).text()).match(/href="\/requests\/\d+/g))], annaList);
  assert.match(await (await c.get('/requests/1')).text(), /Сообщение проверки переключения/);
  assert.equal((await c.post('/demo/switch', { login: 'unknown' })).status, 404);
  assert.match(await (await c.get('/me')).text(), /Орлова Анна Сергеевна/);
  assert.equal((await client().post('/demo/switch', { login: 'dekanat' })).status, 401);
});

test('демо-переключение не доступно произвольному аккаунту и не принимает его как цель', async () => {
  const db = require('../src/db').open(process.env.DB_FILE);
  db.prepare("INSERT INTO users (login, pass_hash, role, full_name, short_name) SELECT 'ordinary-test', pass_hash, 'student', 'Тестовый пользователь', 'Тестовый' FROM users WHERE login='anna'").run();
  const ordinary = await login('ordinary-test');
  assert.doesNotMatch(await (await ordinary.get('/me')).text(), /Переключение демо-аккаунта/);
  assert.equal((await ordinary.post('/demo/switch', { login: 'dekanat' })).status, 404);
  const anna = await login('anna');
  assert.equal((await anna.post('/demo/switch', { login: 'ordinary-test' })).status, 404);
  const outsider = client();
  await outsider.post('/login/demo', { login: 'ordinary-test' });
  assert.equal((await outsider.get('/me')).status, 302);
  db.prepare("DELETE FROM users WHERE login='ordinary-test'").run(); db.close();
});

test('готовая справка: срок, когда её обычно принимают, и без повторного заказа', async () => {
  const anna = await login('anna');
  const list = await (await anna.get('/requests')).text();
  assert.match(list, /подойдёт до \d+ [а-я]+/);
  const ready = list.match(/href="\/requests\/(\d+)"[^>]*>Справка об обучении по месту работы/);
  assert.ok(ready);
  const d = await (await anna.get(`/requests/${ready[1]}`)).text();
  assert.match(d, /Подойдёт до \d+ [а-я]+/);
  assert.match(d, /демо-правило/);
  const job = await (await anna.get('/situations/job')).text();
  assert.match(job, /Уже выдана: № \d{4}-007, подойдёт до/);
  const tax = await login('ilya');
  assert.doesNotMatch(await (await tax.get('/requests')).text(), /возможно, устарела/);
});

test('в текстах кабинета нет тире между словами', async () => {
  const anna = await login('anna'); const ilya = await login('ilya'); const dk = await login('dekanat');
  const text = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');
  const pages = [[anna, ['/', '/study', '/study?view=week', '/study/grades', '/study/record', '/study/session-support', '/study/plan', '/requests', '/requests/new', '/situations/housing', '/situations/job', '/situations/behind', '/me', '/me/docs', '/notifications', '/support', '/hard', '/helper', '/find?q=справка']],
    [ilya, ['/', '/requests/new?type=tax&draft=1', '/study/nir', '/situations/tax', '/situations/military']], [dk, ['/staff', '/staff?f=work', '/staff?f=done']]];
  for (const [c, urls] of pages) for (const u of urls) {
    const t = text(await (await c.get(u)).text());
    const m = t.match(/.{0,30}\s[–—]\s.{0,30}/);
    assert.equal(m, null, `${u}: ${m && m[0]}`);
  }
  for (const q of ['Какие пары завтра?', 'Когда сессия?', 'Какой средний балл?', 'Что такое академическая разница?', 'Статус заявки', 'Нужна справка о стипендии']) {
    const a = await (await anna.post('/api/assistant', { message: q }, true)).json();
    assert.doesNotMatch(a.text, /\s[–—]\s/, q);
  }
});
