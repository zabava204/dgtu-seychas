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
  assert.doesNotMatch(page, /Справка для визы/);
  const annaReady = 1; // № …-007, готовая справка Анны
  assert.equal((await anna.get(`/requests/${annaReady}/pdf`)).status, 200);
  assert.equal((await ilya.get(`/requests/${annaReady}`)).status, 404);
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
  const r = await anna.post('/requests', { type: 'study', purpose: 'transport', format: 'pdf', details: '' });
  assert.equal(r.status, 302);
  const id = r.headers.get('location').match(/requests\/(\d+)\/sent/)[1];
  assert.match(await (await anna.get(`/requests/${id}/sent`)).text(), /Заявка отправлена/);
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
  assert.match(feed, /Справка для проездного готова/);
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
  const r = await anna.post('/api/assistant', { message: 'нужна справка для проездного' }, true);
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
  assert.match(form, /12 480 ₽/);
  const year = form.match(/name="purpose" value="(\d{4})"/)[1];
  assert.equal((await ilya.post('/requests', { type: 'tax', purpose: year, format: 'pdf', details: '123456789012' })).status, 400); // неверный ИНН
  assert.equal((await ilya.post('/requests', { type: 'tax', purpose: '2019', format: 'pdf', details: '' })).status, 400); // нет оплат за год
  assert.equal((await anna.post('/requests', { type: 'tax', purpose: year, format: 'pdf', details: '' })).status, 400); // бюджет: оплат нет
  const r = await ilya.post('/requests', { type: 'tax', purpose: year, format: 'pdf', details: '' });
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
