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

test('неверный пароль — понятная ошибка, без входа', async () => {
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
  await dk.post(`/staff/requests/${id}/need`, { text: 'Загрузи справку о составе семьи' });
  assert.match(await (await anna.get('/requests')).text(), /Нужно твоё действие/);
  const fd = new FormData();
  fd.append('doc', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'spravka.pdf');
  const up = await anna.post(`/requests/${id}/upload`, fd);
  assert.equal(up.status, 302);
  const page = await (await anna.get(`/requests/${id}`)).text();
  assert.match(page, /Документ загружен/);
  assert.match(page, /spravka\.pdf/);
  assert.match(await (await dk.get(`/staff/requests/${id}`)).text(), /Студент загрузил документ/);
});

test('помощник без ключа отвечает по правилам и даёт кнопку', async () => {
  const anna = await login('anna');
  const r = await anna.post('/api/assistant', { message: 'нужна справка для субсидии на ЖКУ' }, true);
  const j = await r.json();
  assert.equal(j.source, 'rules');
  assert.ok(j.actions.some((a) => a.href.startsWith('/requests/new?type=study')));
  const s = await (await anna.post('/api/assistant', { message: 'мне очень тяжело' }, true)).json();
  assert.ok(s.actions.some((a) => a.href === '/hard'));
});

test('основной сценарий: справка для налогового вычета', async () => {
  const ilya = await login('ilya'); const anna = await login('anna'); const dk = await login('dekanat');
  const form = await (await ilya.get('/requests/new?type=tax&draft=1')).text();
  assert.match(form, /Условия проверены/);
  assert.match(form, /96 000 ₽/);
  assert.match(form, /pattern="\\d\{12\}"/);
  assert.match(form, /12 480 ₽/);
  const year = form.match(/name="purpose" value="(\d{4})"/)[1];
  assert.match(form, /Справка об оплате образовательных услуг для ИФНС \(КНД 1151158\)/);
  assert.match(form, /ФИО заказчика/);
  assert.match(form, new RegExp(`value="${DEMO_INN}"`)); // демо-ИНН подставлен в черновик
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
  assert.match(g, /Сессия с \d+ декабря/);
  assert.match(g, /Что можно сделать/);
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
  assert.doesNotMatch(f, /Экономика организации — ауд/); // другие категории скрыты фильтром
});

test('повторный проход сценария: ИНН подставлен без черновика, сброс демо возвращает черновик', async () => {
  const ilya = await login('ilya');
  assert.match(await (await ilya.get('/requests/new?type=tax')).text(), new RegExp(`value="${DEMO_INN}"`));
  const r = await client().post('/demo/reset', {});
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/login?reset=1');
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
  assert.match(p, /Заказать 2 справки одной кнопкой/);
  const ip = await (await ilya.get('/situations/housing')).text();
  assert.match(ip, /на договоре академическая стипендия не назначается/); // контракт — без справки о стипендии
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
