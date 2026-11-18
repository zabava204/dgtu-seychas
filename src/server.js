'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieSession = require('cookie-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');

const T = require('./time');
const { open, resetDemo } = require('./db');
const { model, NOTIF_CATEGORIES } = require('./model');
const { TYPES, purposeOf, formatOf, requestTitle } = require('./catalog');
const V = require('./views/student');
const A = require('./views/auth');
const S = require('./views/staff');
const { errorPage } = require('./views/layout');
const pdf = require('./pdf');
const assistant = require('./assistant');
const TAX = require('./tax');
const SIT = require('./situations');
const AD = require('./admission');
const PLAN = require('./plan');

function createApp(opts = {}) {
  const db = opts.db || open();
  const M = model(db);
  const UPLOADS = path.join(db.dataDir, 'uploads');
  fs.mkdirSync(UPLOADS, { recursive: true });
  const demoFile = path.join(UPLOADS, 'demo-sample.pdf');
  if (!fs.existsSync(demoFile)) pdf.samplePdf(fs.createWriteStream(demoFile));

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // ---------- безопасность ----------
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    next();
  });
  // Версия для слабовидящих: настройка браузера в cookie «lv», класс lv на <html> у каждой страницы
  app.use((req, res, next) => {
    req.lv = /(?:^|;\s*)lv=1(?:;|$)/.test(req.headers.cookie || '');
    if (req.lv) {
      const orig = res.send.bind(res);
      res.send = (b) => orig(typeof b === 'string' && b.startsWith('<!doctype html><html lang="ru">') ? b.replace('<html lang="ru">', '<html lang="ru" class="lv">') : b);
    }
    next();
  });
  app.get('/a11y', (req, res) => {
    const on = req.query.on === '1' ? true : req.query.on === '0' ? false : !req.lv;
    res.cookie('lv', on ? '1' : '0', { maxAge: 365 * 864e5, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    let back = '/';
    try { const u = new URL(req.get('Referer') || '', `http://${req.get('Host')}`); if (u.host === req.get('Host') && !u.pathname.startsWith('/a11y')) back = u.pathname + u.search; } catch { /* по умолчанию на главную */ }
    res.redirect(back);
  });
  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
  app.use(express.urlencoded({ extended: false, limit: '20kb' }));
  app.use(express.json({ limit: '20kb' }));
  // Express 5: у POST без тела req.body не задан; пустой объект вместо ошибки 500
  app.use((req, res, next) => { if (req.body === undefined) req.body = {}; next(); });
  const secret = process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' ? null : 'dev-secret-only-for-local-run');
  if (!secret) throw new Error('Задайте SESSION_SECRET в переменных окружения');
  app.use(cookieSession({ name: 'dgtu', keys: [secret], httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 12 * 3600e3 }));
  // Защита от подделки запросов: POST только со своего сайта
  app.use((req, res, next) => {
    if (req.method !== 'POST') return next();
    const origin = req.get('origin') || req.get('referer');
    if (!origin) return next();
    try { if (new URL(origin).host === req.get('host')) return next(); } catch { /* ignore */ }
    fail(req, res, 403, 'Запрос отклонён', 'Форма была отправлена с другого сайта. Для защиты кабинета такие запросы не принимаются: открой страницу заново и повтори действие.');
  });
  app.use((req, res, next) => {
    req.user = req.session.uid ? M.user(req.session.uid) : null;
    res.locals.flash = req.session.flash || null;
    if (req.session.flash && req.method === 'GET') req.session.flash = null;
    next();
  });
  const flash = (req, text, link, linkText) => { req.session.flash = { text, link, linkText }; };
  const ctxOf = (req, extra = {}) => ({
    user: req.user, demoUsers: M.demoUsers(), flash: res_flash(req), needsAction: req.user && req.user.role === 'student' ? M.needsAction(req.user.id) : false,
    unread: req.user ? M.unreadCount(req.user.id) : 0, ...extra,
  });
  const res_flash = (req) => req.res.locals.flash;
  const send = (res, body) => res.type('html').send(String(body));
  const fail = (req, res, code, title, text, links) => {
    let ctx = { user: null };
    try { ctx = { user: req.user, needsAction: false, unread: 0 }; } catch { /* ignore */ }
    return res.status(code).type('html').send(String(errorPage({ ctx, title, text, links })));
  };
  const NOT_YOURS = 'Такой заявки нет среди твоих. Если ссылку прислали, проверь, что вошёл(а) под своим логином.';

  const needAuth = (role) => (req, res, next) => {
    if (!req.user) return req.accepts('html') && ['GET', 'HEAD'].includes(req.method) ? res.redirect('/login') : res.status(401).json({ error: 'Нужно войти' });
    if (role && req.user.role !== role) return req.user.role === 'staff' ? res.redirect('/staff') : fail(req, res, 403, 'Нет доступа', 'Этот раздел только для сотрудников деканата.');
    next();
  };
  const student = needAuth('student');
  const staff = needAuth('staff');

  // Заявка с проверкой доступа: чужая – 404, чтобы не раскрывать существование
  const loadRequest = (req, res, next) => {
    const r = M.request(Number(req.params.id));
    if (!r || !M.canSee(req.user, r) || r.status === 'draft') return fail(req, res, 404, 'Заявка не найдена', req.user && req.user.role === 'staff' ? 'Возможно, её номер изменился или демо-данные сбросили.' : NOT_YOURS, req.user && req.user.role === 'student' ? [['/requests', 'Мои заявки']] : []);
    req.r = r; next();
  };

  const upload = multer({
    storage: multer.diskStorage({ destination: UPLOADS, filename: (req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '')) }),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => cb(null, ['application/pdf', 'image/jpeg', 'image/png'].includes(file.mimetype)),
  }).single('doc');
  const withUpload = (req, res, next) => upload(req, res, (err) => { req.uploadError = err ? (err.code === 'LIMIT_FILE_SIZE' ? 'Файл больше 5 МБ' : 'Не удалось загрузить файл') : null; next(); });
  const saveFile = (rid, file, uid) => M.db.prepare('INSERT INTO request_files (request_id, name, stored, mime, size, uploaded_at, uploaded_by) VALUES (?,?,?,?,?,?,?)')
    .run(rid, Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 120), file.filename, file.mimetype, file.size, new Date().toISOString(), uid);

  // ---------- вход ----------
  const attempts = new Map();
  app.get('/login', (req, res) => (req.user ? res.redirect(req.user.role === 'staff' ? '/staff' : '/') : send(res, A.login({ demo: M.demoUsers(), notice: req.query.reset ? 'Демо-данные возвращены к началу. Можно проходить сценарий.' : null }))));
  // Сброс демо для проверяющих: не чаще раза в 20 секунд, только с этого сайта (проверка Origin выше)
  let lastReset = 0;
  app.post('/demo/reset', (req, res) => {
    if (!req.user) return res.redirect('/login');
    if (Date.now() - lastReset > 20e3) { lastReset = Date.now(); resetDemo(M.db); }
    flash(req, 'Демо-данные возвращены к началу. Можно проходить сценарий.');
    res.redirect(req.user.role === 'staff' ? '/staff' : '/');
  });
  // Ночной сброс в 3:00 МСК, чтобы каждый день сценарий начинался с чистого листа
  if (opts.nightlyReset) {
    let doneFor = T.dateKey();
    setInterval(() => {
      const key = T.dateKey();
      if (key !== doneFor && T.minutesOfDay() >= 180) { doneFor = key; resetDemo(M.db); console.log('Ночной сброс демо-данных', key); }
    }, 5 * 60e3).unref();
  }
  app.post('/login', (req, res) => {
    const key = req.ip; const a = attempts.get(key) || { n: 0, t: Date.now() };
    if (Date.now() - a.t > 60e3) { a.n = 0; a.t = Date.now(); }
    attempts.set(key, a);
    const login = String(req.body.login || '').trim();
    if (a.n >= 10) return res.status(429).send(String(A.login({ demo: M.demoUsers(), loginValue: login, error: 'Слишком много попыток. Подождите минуту.' })));
    const u = M.userByLogin(login);
    if (!u || !u.pass_hash || !bcrypt.compareSync(String(req.body.password || ''), u.pass_hash)) {
      a.n++; // считаем только неудачные попытки
      return res.status(401).send(String(A.login({ demo: M.demoUsers(), loginValue: login, error: 'Неверный логин или пароль. Проверьте раскладку и Caps Lock или войдите через демо-доступ ниже.' })));
    }
    req.session.uid = u.id;
    res.redirect(u.role === 'staff' ? '/staff' : '/');
  });
  // Переключение разрешено только между тремя синтетическими демо-аккаунтами.
  app.post('/demo/switch', needAuth(), (req, res) => {
    const demo = M.demoUsers();
    const target = demo.find((u) => u.login === String(req.body.login || ''));
    if (!demo.some((u) => u.id === req.user.id) || !target) return fail(req, res, 404, 'Демо-аккаунт не найден', 'Выбери один из аккаунтов в блоке демо-доступа.');
    req.session = { uid: target.id, flash: { text: `Открыт демо-аккаунт: ${target.short_name}` } };
    res.redirect(target.role === 'staff' ? '/staff' : '/me');
  });
  app.post('/login/demo', (req, res) => {
    if (!M.demoUsers().some((u) => u.login === String(req.body.login || ''))) return res.redirect('/login');
    const u = M.userByLogin(req.body.login);
    if (!u || !u.pass_hash) return res.redirect('/login');
    req.session.uid = u.id;
    res.redirect(u.role === 'staff' ? '/staff' : '/');
  });
  app.get('/forgot', (req, res) => send(res, A.forgot()));
  app.post('/logout', (req, res) => { req.session = null; res.redirect('/login'); });
  app.get('/healthz', (req, res) => res.json({ ok: true, time: new Date().toISOString(), assistant: assistant.enabled() ? 'gigachat' : 'rules' }));

  // ---------- студент ----------
  app.get('/', (req, res, next) => (req.user && req.user.role === 'staff' ? res.redirect('/staff') : next()), student, (req, res) => {
    const u = req.user;
    const reqs = M.requestsOf(u.id);
    const todo = [];
    for (const r of reqs.filter((x) => x.status === 'need_student')) todo.push({ amber: true, title: `${r.title}: нужен документ`, meta: `Заявка № ${r.number} ждёт документ`, href: `/requests/${r.id}#upload`, action: 'Загрузить' });
    for (const r of reqs.filter((x) => x.status === 'draft')) todo.push({ kind: 'draft', type: r.type, title: r.title, meta: r.type === 'tax' ? 'Черновик заполнен по договору · проверь и отправь' : 'Черновик заполнен из профиля', href: `/requests/new?type=${r.type}&draft=1`, action: 'Проверить' });
    const ds = M.disciplines(u.id);
    // Работы «на балл» (допуск уже есть) – ниже срочного и с пометкой
    const later = [];
    for (const t of M.tasks(u.id).filter((x) => new Date(x.due_at) - T.now() < 10 * T.DAY_MS)) {
      const d = ds.find((x) => t.title.toLowerCase().includes(x.subject.toLowerCase().slice(0, 6)));
      const ok = d && d.gap === 0;
      (ok ? later : todo).push({ title: t.title, meta: `До ${T.relDateTime(new Date(t.due_at))}${t.note ? ' · ' + t.note : ''}${ok ? ' · допуск уже есть, работа повысит итоговый балл' : ''}`, low: ok });
    }
    todo.push(...later);
    send(res, V.today(ctxOf(req, { next: M.nextPair(u.group_name), ds, todo, session: M.session(u.id, ds), todayPairs: M.dayPairs(u.group_name, T.dateKey()), nextSlot: M.nextStudySlot(u.id) })));
  });

  app.get('/study', student, (req, res) => {
    const u = req.user;
    let sel = /^\d{4}-\d{2}-\d{2}$/.test(req.query.d || '') ? req.query.d : T.dateKey();
    if (!req.query.d && T.weekday() === 7) sel = T.addDays(sel, 1);
    const monday = T.addDays(sel, 1 - T.weekdayOfKey(sel));
    const week = [0, 1, 2, 3, 4, 5].map((i) => { const key = T.addDays(monday, i); return { key, changed: M.dayPairs(u.group_name, key).some((p) => p.change), session: M.sessionOn(u.id, key) }; });
    const view = req.query.view === 'week' ? 'week' : 'day';
    if (view === 'week') week.forEach((d) => { d.pairs = M.dayPairs(u.group_name, d.key); });
    let nextDay = null;
    for (let i = 1; i <= 14 && !nextDay; i++) { const k = T.addDays(sel, i); const ps = M.dayPairs(u.group_name, k).filter((p) => !p.cancelled); if (ps.length) nextDay = { key: k, pair: ps[0] }; }
    send(res, V.schedule(ctxOf(req, { sel, week, view, nextDay, pairs: M.dayPairs(u.group_name, sel), exams: M.sessionOn(u.id, sel) })));
  });
  app.get('/study/grades', student, (req, res) => {
    const ds = M.disciplines(req.user.id);
    send(res, V.grades(ctxOf(req, { ds, session: M.session(req.user.id, ds), book: M.recordBook(req.user.id) })));
  });
  // Разбор допуска: цифры из журнала этого студента. Чужой id – 404, как у чужой заявки.
  const ownDiscipline = (req) => M.disciplines(req.user.id).find((d) => d.id === Number(req.params.id)) || null;
  app.get('/study/session-support', student, (req, res) => {
    send(res, V.sessionList(ctxOf(req, { risks: AD.openRisks(M.disciplines(req.user.id)) })));
  });
  app.get('/study/session-support/:id', student, (req, res) => {
    const d = ownDiscipline(req);
    if (!d || d.closed_text) return fail(req, res, 404, 'Дисциплина не найдена', 'Такой дисциплины нет среди твоих. Если ссылку прислали, проверь, что вошёл(а) под своим логином.', [['/study/session-support', 'Допуск к сессии']]);
    const session = M.session(req.user.id);
    send(res, V.sessionSupport(ctxOf(req, {
      d, exam: AD.examOf(session, d.id), consult: AD.consultOf(session, d.id), math: AD.arithmetic(d), draft: AD.letter({ user: req.user, d, exam: AD.examOf(session, d.id) }),
    })));
  });
  // План на 7 дней: слоты считает сервер по расписанию, состав – по журналу этого студента.
  const horizon = (user) => {
    const ds = M.disciplines(user.id);
    const session = M.session(user.id, ds);
    const nowKey = T.dateKey();
    const days = [];
    for (let i = 0; i < 7; i++) {
      const key = T.addDays(nowKey, i);
      const pairs = M.dayPairs(user.group_name, key).filter((p) => !p.cancelled);
      const exams = session.filter((s) => s.date_key === key).map((s) => ({ start: s.start, end: T.hhmm(Math.min(T.parseHHMM(s.start) + 90, 23 * 60)) }));
      days.push({ key, pairs: [...pairs, ...exams] });
    }
    return { ds, session, days, nowKey, nowMin: T.minutesOfDay() };
  };
  app.get('/study/plan', student, (req, res) => send(res, V.studyPlan(ctxOf(req, { plan: M.studyPlan(req.user.id), showForm: req.query.new === '1', prefer: req.query.part === 'evening' ? 'evening' : req.query.part === 'day' ? 'day' : null }))));
  app.post('/study/plan', student, (req, res) => {
    const minutes = Number(req.body.minutes);
    const part = req.body.part === 'evening' || req.body.part === 'day' ? req.body.part : null;
    if (!PLAN.ALLOWED.includes(minutes) || !part) { flash(req, 'Выбери 30, 60, 90 или 120 минут и день или вечер.'); return res.redirect('/study/plan?new=1'); }
    const h = horizon(req.user);
    const tasks = PLAN.queue(h.ds, h.session, req.user.gender);
    const { placed, left } = PLAN.place({ days: h.days, minutes, part, tasks, nowKey: h.nowKey, nowMin: h.nowMin });
    M.replaceStudyPlan(req.user.id, { minutes, part }, placed);
    const when = part === 'day' ? 'днём, с 8:00 до 17:00' : 'вечером, с 18:00 до 22:00';
    flash(req, placed.length
      ? `План составлен: до ${minutes} минут в день ${when}. Задач запланировано: ${placed.length}${left.length ? `. Осталось распределить: ${left.length}` : ''}. Отметка «Сделано» не меняет баллы.`
      : tasks.length ? 'Не получилось распределить работы на выбранное время. Попробуй другой период.' : 'Задач для подготовки сейчас нет.');
    res.redirect('/study/plan');
  });
  app.post('/study/plan/slots/:id/done', student, (req, res) => {
    if (!M.toggleStudySlot(req.user.id, req.params.id)) return fail(req, res, 404, 'Задача не найдена', 'Такой задачи нет в твоём плане. Если ссылку прислали, проверь, что вошёл(а) под своим логином.', [['/study/plan', 'Мой план']]);
    res.redirect('/study/plan');
  });
  app.get('/study/record', student, (req, res) => send(res, V.recordBook(ctxOf(req, { book: M.recordBook(req.user.id) }))));
  app.get('/study/record/pdf', student, (req, res) => {
    res.type('pdf').set('Content-Disposition', `inline; filename="record-book-${req.user.record_book}.pdf"`);
    pdf.recordBookPdf({ user: req.user, book: M.recordBook(req.user.id) }, res);
  });
  app.get('/study/nir', student, (req, res) => (req.user.level !== 'магистратура' ? res.redirect('/study') : send(res, V.nir(ctxOf(req, { stages: M.nir(req.user.id) })))));

  app.get('/requests', student, (req, res) => send(res, V.requestsList(ctxOf(req, { list: M.requestsOf(req.user.id) }))));
  // Годы для справки на вычет: за какой год справка уже заказана или выдана, форма покажет без кнопки заказа
  const taxYears = (userId, payments) => {
    const reqs = M.requestsOf(userId).filter((r) => r.type === 'tax' && !['draft', 'rejected'].includes(r.status));
    return TAX.yearsFromPayments(payments).map((y) => ({ ...y, taken: reqs.find((r) => String(r.purpose) === String(y.year)) || null }));
  };
  app.get('/requests/new', student, (req, res) => {
    const type = req.query.type;
    if (!TYPES[type]) return send(res, V.newRequestChoose(ctxOf(req, { situations: SIT.SITUATIONS })));
    if (TYPES[type].budgetOnly && req.user.funding !== 'бюджет') { flash(req, 'Справка о стипендии выдаётся тем, кто получает стипендию. На договоре академическая стипендия не назначается.'); return res.redirect('/requests/new'); }
    const d = M.draftOf(req.user.id);
    const draft = req.query.draft && d && d.type === type ? d : null;
    const payments = M.payments(req.user.id);
    // Демо: тестовый ИНН подставляется и без черновика, чтобы сценарий можно было пройти повторно
    const values = { purpose: req.query.purpose, details: type === 'tax' && payments.length ? TAX.DEMO_INN : '' };
    send(res, V.newRequestForm(ctxOf(req, { type, draft, values, payments, years: taxYears(req.user.id, payments) })));
  });
  app.post('/requests', student, withUpload, (req, res) => {
    const type = req.body.type; const t = TYPES[type];
    const payments = M.payments(req.user.id);
    const fail = (error) => { if (req.file) fs.rmSync(req.file.path, { force: true }); res.status(400); send(res, V.newRequestForm(ctxOf(req, { type: t ? type : 'study', values: req.body, error, payments, years: taxYears(req.user.id, payments) }))); };
    if (!t) return fail('Выбери тип заявки');
    if (t.budgetOnly && req.user.funding !== 'бюджет') return fail('Справка о стипендии выдаётся студентам, которые получают стипендию');
    if (req.uploadError) return fail(req.uploadError + '. Подойдут PDF, JPG или PNG до 5 МБ.');
    let purpose = req.body.purpose || null;
    if (t.purposes && !purposeOf(type, purpose)) return fail('Выбери, куда нужна справка');
    if (t.reasons && !t.reasons.includes(purpose)) purpose = t.reasons[0];
    const format = req.body.format;
    if (t.formats && !formatOf(type, format)) return fail('Выбери формат');
    const details = String(req.body.details || '').trim().slice(0, 500);
    if (type === 'tax') {
      const y = TAX.yearsFromPayments(payments).find((x) => x.eligibleForm && String(x.year) === String(purpose));
      if (!y) return fail('Выбери год, за который есть оплата по договору');
      if (!y.closed) return fail(`Справку за ${y.year} год можно заказать с января ${y.year + 1}, когда год закончится`);
      if (!details) return fail('Укажи ИНН из 12 цифр. Он обязателен в справке для налоговой.');
      if (!TAX.innOk(details)) return fail('ИНН не прошёл проверку: должно быть 12 цифр, две последние из них контрольные. Проверь, нет ли опечатки.');
      const dup = M.requestsOf(req.user.id).find((x) => x.type === 'tax' && String(x.purpose) === String(y.year) && ['submitted', 'in_work', 'need_student', 'ready'].includes(x.status));
      if (dup) return fail(`Справка за ${y.year} год уже ${dup.status === 'ready' ? 'выдана' : 'заказана'}: № ${dup.number}. Сумма за закончившийся год не меняется: повторно заказывать не нужно.`);
    }
    const note = type === 'tax' ? String(req.body.note || '').trim().slice(0, 500) : '';
    const id = M.submitRequest(req.user, { type, purpose, format, details, note });
    if (req.file) { saveFile(id, req.file, req.user.id); M.addEvent(id, req.user.id, 'uploaded', 'Справка о составе семьи'); }
    res.redirect(`/requests/${id}/sent`);
  });
  // Жизненные ситуации: пакет справок по данным кабинета, заказ одной кнопкой
  const sitData = (u) => { const ds = M.disciplines(u.id); return { user: u, payments: M.payments(u.id), stipends: M.stipends(u.id), disciplines: ds, session: M.session(u.id, ds), requests: M.requestsOf(u.id) }; };
  app.get('/situations/:id', student, (req, res, next) => {
    const s = SIT.build(req.params.id, sitData(req.user));
    if (!s) return next();
    send(res, V.situation(ctxOf(req, { s })));
  });
  app.post('/situations/:id', student, (req, res, next) => {
    const s = SIT.build(req.params.id, sitData(req.user));
    if (!s) return next();
    const want = [].concat(req.body.items || []);
    const picked = s.available.filter((o) => want.includes(o.key));
    if (!picked.length) { flash(req, 'Отметь хотя бы одну справку'); return res.redirect(`/situations/${s.id}`); }
    const bundle = picked.length > 1 ? `${s.id}:${req.user.id}:${Date.now()}` : null;
    for (const o of picked) M.submitRequest(req.user, { type: o.type, purpose: o.purpose, format: 'pdf', details: o.details || '', note: `Ситуация: ${s.title}`, bundle });
    flash(req, picked.length === 1 ? 'Справка заказана. Сообщим, когда будет готова.' : `Заказано ${picked.length} ${picked.length < 5 ? 'справки' : 'справок'}. Сообщим, когда будут готовы.`);
    res.redirect('/requests');
  });
  app.get('/requests/:id/sent', student, loadRequest, (req, res) => send(res, V.requestSent(ctxOf(req, { r: req.r }))));
  app.post('/requests/:id/notify', student, loadRequest, (req, res) => {
    M.db.prepare('UPDATE requests SET notify_ready = 1 WHERE id = ?').run(req.r.id);
    M.setSetting(req.user.id, 'notif_requests', '1');
    if (req.is('json')) return res.json({ ok: true });
    flash(req, 'Уведомления по заявке включены');
    res.redirect(`/requests/${req.r.id}`);
  });
  app.get('/requests/:id', needAuth(), loadRequest, (req, res) => {
    if (req.user.role === 'staff') return res.redirect(`/staff/requests/${req.r.id}`);
    send(res, V.requestDetail(ctxOf(req, { r: req.r, events: M.events(req.r.id), files: M.files(req.r.id) })));
  });
  app.post('/requests/:id/upload', student, loadRequest, withUpload, (req, res) => {
    const r = req.r;
    if (r.status !== 'need_student') { flash(req, 'Документ сейчас не нужен'); return res.redirect(`/requests/${r.id}`); }
    if (req.uploadError || !req.file) { flash(req, (req.uploadError || 'Выбери файл') + '. Подойдут PDF, JPG или PNG до 5 МБ.'); return res.redirect(`/requests/${r.id}#upload`); }
    saveFile(r.id, req.file, req.user.id);
    M.db.prepare('UPDATE requests SET status = ?, needs_text = NULL WHERE id = ?').run(r.assignee_id ? 'in_work' : 'submitted', r.id);
    M.addEvent(r.id, req.user.id, 'uploaded', req.file ? Buffer.from(req.file.originalname, 'latin1').toString('utf8').slice(0, 120) : null);
    flash(req, 'Документ загружен. Деканат продолжит рассмотрение.');
    res.redirect(`/requests/${r.id}`);
  });
  app.post('/requests/:id/message', student, loadRequest, (req, res) => {
    const text = String(req.body.text || '').trim().slice(0, 1000);
    if (text) M.addEvent(req.r.id, req.user.id, 'message', text);
    flash(req, 'Сообщение отправлено в деканат');
    res.redirect(`/requests/${req.r.id}#msg-h`);
  });
  app.get('/requests/:id/pdf', needAuth(), loadRequest, (req, res) => {
    const r = req.r;
    if (r.status !== 'ready' || !TYPES[r.type].producesPdf || r.format === 'paper') return fail(req, res, 404, 'PDF пока нет', 'Справка ещё не готова или выдаётся на бумаге в деканате. Статус смотри в карточке заявки.', [[`/requests/${r.id}`, 'Открыть заявку']]);
    res.type('pdf').set('Content-Disposition', `inline; filename="spravka-${r.number}.pdf"`);
    pdf.certificate({ r, student: M.user(r.student_id), staff: r.assignee_id ? M.user(r.assignee_id) : null, payments: M.payments(r.student_id), stipends: M.stipends(r.student_id) }, res);
  });
  app.get('/files/:id', needAuth(), (req, res) => {
    const f = M.file(Number(req.params.id));
    const r = f && M.request(f.request_id);
    if (!f || !M.canSee(req.user, r)) return fail(req, res, 404, 'Файл не найден', 'Файл удалён или принадлежит другому студенту.');
    res.type(f.mime || 'application/octet-stream').set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.sendFile(path.join(UPLOADS, path.basename(f.stored)));
  });
  app.get('/help/data', student, (req, res) => send(res, V.dataHelp(ctxOf(req))));
  app.get('/help/tax', student, (req, res) => send(res, V.taxHelp(ctxOf(req, { back: /^\/requests(\/\d+)?$/.test(req.query.back || '') ? req.query.back : '/requests/new?type=tax' }))));
  app.get('/help/doc', student, (req, res) => send(res, V.docHelp(ctxOf(req, { name: String(req.query.name || ''), back: /^\/[a-z0-9/?=&#-]*$/i.test(req.query.back || '') ? req.query.back : '/requests' }))));

  app.get('/me', student, (req, res) => send(res, V.me(ctxOf(req))));
  app.get('/me/docs', student, (req, res) => send(res, V.studentDocs(ctxOf(req, { book: M.recordBook(req.user.id) }))));
  app.get('/me/docs/id.pdf', student, (req, res) => {
    const meta = ({ anna: { issued: '01.09.2023', order: '3120-ЛС' }, ilya: { issued: '01.09.2024', order: '4466-ЛС' } })[req.user.login] || { issued: '01.09.2024', order: '1000-ЛС' };
    res.type('pdf').set('Content-Disposition', `inline; filename="student-id-${req.user.record_book}.pdf"`);
    pdf.studentIdPdf({ user: req.user, meta }, res);
  });
  app.get('/me/notifications', student, (req, res) => send(res, V.notifSettings(ctxOf(req, { settings: M.settings(req.user.id) }))));
  app.post('/me/notifications', student, (req, res) => {
    for (const c of NOTIF_CATEGORIES) M.setSetting(req.user.id, 'notif_' + c.key, req.body['notif_' + c.key] === '1' ? '1' : '0');
    if (req.is('json')) return res.json({ ok: true });
    flash(req, 'Настройки сохранены');
    res.redirect('/me/notifications');
  });
  app.get('/notifications', student, (req, res) => {
    const filter = ['deadlines', 'schedule', 'requests', 'announcements', 'grades'].includes(req.query.c) ? req.query.c : '';
    const html = V.notifications(ctxOf(req, { items: M.notifications(req.user.id), filter }));
    M.markAllRead(req.user.id);
    send(res, html);
  });
  app.get('/hard', student, (req, res) => send(res, V.hard(ctxOf(req))));
  app.get('/support', student, (req, res) => send(res, V.support(ctxOf(req))));
  app.get('/route', student, (req, res) => send(res, V.route(ctxOf(req, { room: String(req.query.room || '').slice(0, 20) }))));
  app.get('/find', student, (req, res) => send(res, V.findPage(ctxOf(req, { q: String(req.query.q || '').slice(0, 80) }))));
  app.get('/helper', student, (req, res) => send(res, V.helper(ctxOf(req, { q: String(req.query.q || '').slice(0, 300) }))));

  app.post('/api/assistant', student, async (req, res) => {
    const u = req.user;
    const ds = M.disciplines(u.id);
    const data = { user: u, next: M.nextPair(u.group_name), disciplines: ds, session: M.session(u.id, ds), requests: M.requestsOf(u.id), payments: M.payments(u.id), stipends: M.stipends(u.id), book: M.recordBook(u.id), nir: u.level === 'магистратура' ? M.nir(u.id) : [], dayPairs: (key) => M.dayPairs(u.group_name, key), plan: M.studyPlan(u.id), nextSlot: M.nextStudySlot(u.id) };
    const a = await assistant.answer(req.body.message, req.body.history, data);
    M.db.prepare('INSERT INTO assistant_log (user_id, at, question, source) VALUES (?,?,?,?)').run(u.id, new Date().toISOString(), a.intent, a.source);
    res.json(a);
  });
  // Для уведомлений браузера, пока кабинет открыт: только номер заявки, без содержания
  app.get('/api/poll', student, (req, res) => {
    const since = Number(req.query.since) || 0;
    const enabled = M.settings(req.user.id);
    const rows = M.db.prepare('SELECT id, category, link FROM notifications WHERE user_id = ? AND id > ? ORDER BY id').all(req.user.id, since)
      .filter((n) => enabled['notif_' + n.category] !== '0');
    const last = M.db.prepare('SELECT MAX(id) AS m FROM notifications WHERE user_id = ?').get(req.user.id).m || 0;
    res.json({ last, unread: M.unreadCount(req.user.id), items: rows.map((n) => ({ id: n.id, title: 'ДГТУ.Сейчас', body: n.category === 'requests' ? 'Есть изменение в заявке' : n.category === 'schedule' ? 'Есть изменение в расписании' : 'Новое уведомление', link: n.link })) });
  });

  // ---------- деканат ----------
  const staffCtx = (req, extra) => ({ user: req.user, demoUsers: M.demoUsers(), flash: res_flash(req), counts: M.staffCounts(), ...extra });
  app.get('/staff', staff, (req, res) => {
    const filter = ['new', 'work', 'student', 'done'].includes(req.query.f) ? req.query.f : 'new';
    send(res, S.queue(staffCtx(req, { list: M.staffQueue(filter), filter })));
  });
  app.get('/staff/requests/:id', staff, loadRequest, (req, res) => send(res, S.detail(staffCtx(req, { r: req.r, student: M.user(req.r.student_id), events: M.events(req.r.id), files: M.files(req.r.id), payments: M.payments(req.r.student_id), stipends: M.stipends(req.r.student_id), siblings: M.bundleOf(req.r) }))));
  app.get('/staff/requests/:id/preview', staff, loadRequest, (req, res) => {
    const r = req.r;
    if (!TYPES[r.type].producesPdf) return fail(req, res, 404, 'Для этой заявки PDF не формируется', 'Это заявление, а не справка: решение придёт в карточку заявки.', [[`/staff/requests/${r.id}`, 'Вернуться к заявке']]);
    res.type('pdf');
    pdf.certificate({ r: { ...r, closed_at: new Date().toISOString() }, student: M.user(r.student_id), staff: req.user, payments: M.payments(r.student_id), stipends: M.stipends(r.student_id) }, res);
  });
  const act = (fn) => [staff, loadRequest, (req, res) => {
    const r = req.r; const text = String(req.body.text || '').trim().slice(0, 1000);
    const msg = fn(r, text, req);
    if (msg) flash(req, msg);
    res.redirect(`/staff/requests/${r.id}`);
  }];
  const notifyStudent = (r, title, body) => M.notify(r.student_id, 'requests', title, body, `/requests/${r.id}`);
  app.post('/staff/requests/:id/take', ...act((r, _t, req) => {
    if (r.status !== 'submitted') return 'Заявка уже в работе';
    M.db.prepare("UPDATE requests SET status = 'in_work', assignee_id = ?, taken_at = ? WHERE id = ?").run(req.user.id, new Date().toISOString(), r.id);
    M.addEvent(r.id, req.user.id, 'taken');
    notifyStudent(r, `${r.title} взята в работу`, `Заявка № ${r.number}. Оформляет ${req.user.short_name.replace(/\.$/, '')}. Ожидаемый срок: ${T.relDateTime(new Date(r.eta_at))}.`);
    return 'Заявка взята в работу. Студент видит ваше имя и срок.';
  }));
  app.post('/staff/requests/:id/need', ...act((r, text, req) => {
    if (r.status !== 'in_work') return 'Сначала возьмите заявку в работу';
    if (!text) return 'Укажите, какой документ нужен';
    M.db.prepare("UPDATE requests SET status = 'need_student', needs_text = ?, assignee_id = COALESCE(assignee_id, ?), taken_at = COALESCE(taken_at, ?) WHERE id = ?").run(text, req.user.id, new Date().toISOString(), r.id);
    if (!r.taken_at) M.addEvent(r.id, req.user.id, 'taken');
    M.addEvent(r.id, req.user.id, 'need_doc', text);
    notifyStudent(r, `${requestTitle(r)}: нужен документ`, `Заявка № ${r.number}: ${text}`);
    return 'Запрос отправлен студенту';
  }));
  app.post('/staff/requests/:id/ready', ...act((r, text, req) => {
    if (r.status !== 'in_work') return 'Сначала возьмите заявку в работу';
    M.db.prepare("UPDATE requests SET status = 'ready', closed_at = ? WHERE id = ?").run(new Date().toISOString(), r.id);
    M.addEvent(r.id, req.user.id, 'ready', r.type === 'aid' ? text : null);
    const paper = r.format === 'paper';
    notifyStudent(r, r.type === 'aid' ? 'Решение по заявлению на матпомощь' : `${r.title} готова`, r.type === 'aid' ? `Заявка № ${r.number}` : paper ? `Заявка № ${r.number}. Забрать: корпус 1, каб. 210.` : `Заявка № ${r.number}. PDF в заявке.`);
    return r.type === 'aid' ? 'Решение отправлено студенту' : paper ? 'Отмечено: готова к выдаче' : 'PDF-справка сформирована, студент получил уведомление';
  }));
  app.post('/staff/requests/:id/reject', ...act((r, text, req) => {
    if (!['submitted', 'in_work', 'need_student'].includes(r.status) || !text) return 'Укажите причину';
    M.db.prepare("UPDATE requests SET status = 'rejected', reject_reason = ?, closed_at = ? WHERE id = ?").run(text, new Date().toISOString(), r.id);
    M.addEvent(r.id, req.user.id, 'rejected', text);
    notifyStudent(r, `${r.title}: заявка отклонена`, `Заявка № ${r.number}: ${text}`);
    return 'Заявка отклонена, студент увидит причину';
  }));
  app.post('/staff/requests/:id/message', ...act((r, text, req) => {
    if (!text) return null;
    M.addEvent(r.id, req.user.id, 'message', text);
    notifyStudent(r, `Сообщение по заявке № ${r.number}`, text.slice(0, 140));
    return 'Сообщение отправлено студенту';
  }));
  app.get('/staff/announce', staff, (req, res) => send(res, S.announce(staffCtx(req))));
  app.post('/staff/announce', staff, (req, res) => {
    const title = String(req.body.title || '').trim().slice(0, 120); const body = String(req.body.body || '').trim().slice(0, 600);
    if (title && body) for (const s of M.students()) M.notify(s.id, 'announcements', title, body, '/notifications');
    flash(req, title && body ? 'Объявление отправлено студентам' : 'Заполните заголовок и текст');
    res.redirect('/staff/announce');
  });
  app.post('/staff/reset', staff, (req, res) => { resetDemo(M.db); flash(req, 'Демо-данные возвращены к исходному состоянию'); res.redirect('/staff'); });

  app.use((req, res) => fail(req, res, 404, 'Страница не найдена', 'Возможно, ссылка устарела. Нужное можно найти через меню или спросить помощника.', req.user && req.user.role === 'student' ? [['/helper', 'Спросить помощника']] : []));
  app.use((err, req, res, next) => { console.error(err); fail(req, res, 500, 'Что-то пошло не так', 'Обнови страницу через минуту. Если ошибка повторится, напиши в деканат: корпус 1, каб. 210.'); });

  app.locals.M = M;
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp({ nightlyReset: true }).listen(port, () => console.log(`ДГТУ.Сейчас: http://localhost:${port} · помощник: ${assistant.enabled() ? 'GigaChat' : 'правила'}`));
}

module.exports = { createApp };
