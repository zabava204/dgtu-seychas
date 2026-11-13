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
const pdf = require('./pdf');
const assistant = require('./assistant');
const TAX = require('./tax');

function createApp({ db = open() } = {}) {
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
  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
  app.use(express.urlencoded({ extended: false, limit: '20kb' }));
  app.use(express.json({ limit: '20kb' }));
  const secret = process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' ? null : 'dev-secret-only-for-local-run');
  if (!secret) throw new Error('Задайте SESSION_SECRET в переменных окружения');
  app.use(cookieSession({ name: 'dgtu', keys: [secret], httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 12 * 3600e3 }));
  // Защита от подделки запросов: POST только со своего сайта
  app.use((req, res, next) => {
    if (req.method !== 'POST') return next();
    const origin = req.get('origin') || req.get('referer');
    if (!origin) return next();
    try { if (new URL(origin).host === req.get('host')) return next(); } catch { /* ignore */ }
    res.status(403).send('Запрос с чужого сайта отклонён');
  });
  app.use((req, res, next) => {
    req.user = req.session.uid ? M.user(req.session.uid) : null;
    res.locals.flash = req.session.flash || null;
    if (req.session.flash && req.method === 'GET') req.session.flash = null;
    next();
  });
  const flash = (req, text, link, linkText) => { req.session.flash = { text, link, linkText }; };
  const ctxOf = (req, extra = {}) => ({
    user: req.user, flash: res_flash(req), needsAction: req.user && req.user.role === 'student' ? M.needsAction(req.user.id) : false,
    unread: req.user ? M.unreadCount(req.user.id) : 0, ...extra,
  });
  const res_flash = (req) => req.res.locals.flash;
  const send = (res, body) => res.type('html').send(String(body));

  const needAuth = (role) => (req, res, next) => {
    if (!req.user) return req.accepts('html') && req.method === 'GET' ? res.redirect('/login') : res.status(401).json({ error: 'Нужно войти' });
    if (role && req.user.role !== role) return req.user.role === 'staff' ? res.redirect('/staff') : res.status(403).send('Нет доступа');
    next();
  };
  const student = needAuth('student');
  const staff = needAuth('staff');

  // Заявка с проверкой доступа: чужая — 404, чтобы не раскрывать существование
  const loadRequest = (req, res, next) => {
    const r = M.request(Number(req.params.id));
    if (!r || !M.canSee(req.user, r) || r.status === 'draft') return res.status(404).send('Заявка не найдена');
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
  app.get('/login', (req, res) => (req.user ? res.redirect(req.user.role === 'staff' ? '/staff' : '/') : send(res, A.login({ demo: M.demoUsers() }))));
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
  app.post('/login/demo', (req, res) => {
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
    for (const r of reqs.filter((x) => x.status === 'need_student')) todo.push({ amber: true, title: `${r.type === 'aid' ? 'Матпомощь' : r.title}: нужен документ`, meta: `Заявка № ${r.number} ждёт документ`, href: `/requests/${r.id}#upload`, action: 'Загрузить' });
    for (const r of reqs.filter((x) => x.status === 'draft')) todo.push({ title: r.title, meta: r.type === 'tax' ? 'Черновик заполнен по договору · проверь и отправь' : 'Черновик заполнен из профиля', href: `/requests/new?type=${r.type}&draft=1`, action: 'Проверить' });
    for (const t of M.tasks(u.id).filter((x) => new Date(x.due_at) - T.now() < 10 * T.DAY_MS)) todo.push({ title: t.title, meta: `До ${T.relDateTime(new Date(t.due_at))}${t.note ? ' · ' + t.note : ''}` });
    send(res, V.today(ctxOf(req, { next: M.nextPair(u.group_name), ds: M.disciplines(u.id), todo })));
  });

  app.get('/study', student, (req, res) => {
    const u = req.user;
    let sel = /^\d{4}-\d{2}-\d{2}$/.test(req.query.d || '') ? req.query.d : T.dateKey();
    if (!req.query.d && T.weekday() === 7) sel = T.addDays(sel, 1);
    const monday = T.addDays(sel, 1 - T.weekdayOfKey(sel));
    const week = [0, 1, 2, 3, 4, 5].map((i) => { const key = T.addDays(monday, i); return { key, changed: M.dayPairs(u.group_name, key).some((p) => p.change) }; });
    send(res, V.schedule(ctxOf(req, { sel, week, pairs: M.dayPairs(u.group_name, sel) })));
  });
  app.get('/study/grades', student, (req, res) => send(res, V.grades(ctxOf(req, { ds: M.disciplines(req.user.id) }))));
  app.get('/study/nir', student, (req, res) => (req.user.level !== 'магистратура' ? res.redirect('/study') : send(res, V.nir(ctxOf(req, { stages: M.nir(req.user.id) })))));

  app.get('/requests', student, (req, res) => send(res, V.requestsList(ctxOf(req, { list: M.requestsOf(req.user.id) }))));
  app.get('/requests/new', student, (req, res) => {
    const type = req.query.type;
    if (!TYPES[type]) return send(res, V.newRequestChoose(ctxOf(req)));
    const d = M.draftOf(req.user.id);
    const draft = req.query.draft && d && d.type === type ? d : null;
    const payments = M.payments(req.user.id);
    send(res, V.newRequestForm(ctxOf(req, { type, draft, values: { purpose: req.query.purpose }, payments, years: TAX.yearsFromPayments(payments) })));
  });
  app.post('/requests', student, withUpload, (req, res) => {
    const type = req.body.type; const t = TYPES[type];
    const payments = M.payments(req.user.id);
    const fail = (error) => { if (req.file) fs.rmSync(req.file.path, { force: true }); res.status(400); send(res, V.newRequestForm(ctxOf(req, { type: t ? type : 'study', values: req.body, error, payments, years: TAX.yearsFromPayments(payments) }))); };
    if (!t) return fail('Выберите тип заявки');
    if (req.uploadError) return fail(req.uploadError + '. Подойдут PDF, JPG или PNG до 5 МБ.');
    let purpose = req.body.purpose || null;
    if (t.purposes && !purposeOf(type, purpose)) return fail('Выберите, куда нужна справка');
    if (t.reasons && !t.reasons.includes(purpose)) purpose = t.reasons[0];
    const format = req.body.format;
    if (t.formats && !formatOf(type, format)) return fail('Выберите формат');
    const details = String(req.body.details || '').trim().slice(0, 500);
    if (type === 'visa' && details.length < 3) return fail('Укажите страну и даты поездки');
    if (type === 'tax') {
      const y = TAX.yearsFromPayments(payments).find((x) => x.eligibleForm && String(x.year) === String(purpose));
      if (!y) return fail('Выберите год, за который есть оплата по договору');
      if (!y.closed) return fail(`Справку за ${y.year} год можно заказать с января ${y.year + 1}, когда год закончится`);
      if (!details) return fail('Укажи ИНН — 12 цифр. Он обязателен в справке для налоговой.');
      if (!TAX.innOk(details)) return fail('ИНН не прошёл проверку: должно быть 12 цифр, две последние — контрольные. Проверь, нет ли опечатки.');
    }
    const note = type === 'tax' ? String(req.body.note || '').trim().slice(0, 500) : '';
    const id = M.submitRequest(req.user, { type, purpose, format, details, note });
    if (req.file) { saveFile(id, req.file, req.user.id); M.addEvent(id, req.user.id, 'uploaded', 'Справка о составе семьи'); }
    res.redirect(`/requests/${id}/sent`);
  });
  app.get('/requests/:id/sent', student, loadRequest, (req, res) => send(res, V.requestSent(ctxOf(req, { r: req.r }))));
  app.post('/requests/:id/notify', student, loadRequest, (req, res) => {
    M.db.prepare('UPDATE requests SET notify_ready = 1 WHERE id = ?').run(req.r.id);
    M.setSetting(req.user.id, 'notif_requests', '1');
    if (req.is('json')) return res.json({ ok: true });
    flash(req, 'Сообщим, когда справка будет готова');
    res.redirect(`/requests/${req.r.id}`);
  });
  app.get('/requests/:id', needAuth(), loadRequest, (req, res) => {
    if (req.user.role === 'staff') return res.redirect(`/staff/requests/${req.r.id}`);
    send(res, V.requestDetail(ctxOf(req, { r: req.r, events: M.events(req.r.id), files: M.files(req.r.id) })));
  });
  app.post('/requests/:id/upload', student, loadRequest, withUpload, (req, res) => {
    const r = req.r;
    if (r.status !== 'need_student') { flash(req, 'Документ сейчас не нужен'); return res.redirect(`/requests/${r.id}`); }
    if (req.uploadError || !req.file) { flash(req, (req.uploadError || 'Выберите файл') + '. Подойдут PDF, JPG или PNG до 5 МБ.'); return res.redirect(`/requests/${r.id}#upload`); }
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
    if (r.status !== 'ready' || !TYPES[r.type].producesPdf || r.format === 'paper') return res.status(404).send('PDF нет');
    res.type('pdf').set('Content-Disposition', `inline; filename="spravka-${r.number}.pdf"`);
    pdf.certificate({ r, student: M.user(r.student_id), staff: r.assignee_id ? M.user(r.assignee_id) : null, payments: M.payments(r.student_id) }, res);
  });
  app.get('/files/:id', needAuth(), (req, res) => {
    const f = M.file(Number(req.params.id));
    const r = f && M.request(f.request_id);
    if (!f || !M.canSee(req.user, r)) return res.status(404).send('Файл не найден');
    res.type(f.mime || 'application/octet-stream').set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.sendFile(path.join(UPLOADS, path.basename(f.stored)));
  });
  app.get('/help/data', student, (req, res) => send(res, V.dataHelp(ctxOf(req))));
  app.get('/help/tax', student, (req, res) => send(res, V.taxHelp(ctxOf(req, { back: /^\/requests(\/\d+)?$/.test(req.query.back || '') ? req.query.back : '/requests/new?type=tax' }))));
  app.get('/help/doc', student, (req, res) => send(res, V.docHelp(ctxOf(req, { name: String(req.query.name || ''), back: /^\/[a-z0-9/?=&#-]*$/i.test(req.query.back || '') ? req.query.back : '/requests' }))));

  app.get('/me', student, (req, res) => send(res, V.me(ctxOf(req))));
  app.get('/me/notifications', student, (req, res) => send(res, V.notifSettings(ctxOf(req, { settings: M.settings(req.user.id) }))));
  app.post('/me/notifications', student, (req, res) => {
    for (const c of NOTIF_CATEGORIES) M.setSetting(req.user.id, 'notif_' + c.key, req.body['notif_' + c.key] === '1' ? '1' : '0');
    if (req.is('json')) return res.json({ ok: true });
    flash(req, 'Настройки сохранены');
    res.redirect('/me/notifications');
  });
  app.get('/notifications', student, (req, res) => {
    const filter = ['schedule', 'requests', 'announcements', 'grades'].includes(req.query.c) ? req.query.c : '';
    const html = V.notifications(ctxOf(req, { items: M.notifications(req.user.id), filter }));
    M.markAllRead(req.user.id);
    send(res, html);
  });
  app.get('/hard', student, (req, res) => send(res, V.hard(ctxOf(req))));
  app.get('/route', student, (req, res) => send(res, V.route(ctxOf(req, { room: String(req.query.room || '').slice(0, 20) }))));
  app.get('/helper', student, (req, res) => send(res, V.helper(ctxOf(req, { q: String(req.query.q || '').slice(0, 300) }))));

  app.post('/api/assistant', student, async (req, res) => {
    const u = req.user;
    const data = { user: u, next: M.nextPair(u.group_name), disciplines: M.disciplines(u.id), requests: M.requestsOf(u.id), payments: M.payments(u.id) };
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
  const staffCtx = (req, extra) => ({ user: req.user, flash: res_flash(req), counts: M.staffCounts(), ...extra });
  app.get('/staff', staff, (req, res) => {
    const filter = ['new', 'work', 'student', 'done'].includes(req.query.f) ? req.query.f : 'new';
    send(res, S.queue(staffCtx(req, { list: M.staffQueue(filter), filter })));
  });
  app.get('/staff/requests/:id', staff, loadRequest, (req, res) => send(res, S.detail(staffCtx(req, { r: req.r, student: M.user(req.r.student_id), events: M.events(req.r.id), files: M.files(req.r.id), payments: M.payments(req.r.student_id) }))));
  app.get('/staff/requests/:id/preview', staff, loadRequest, (req, res) => {
    const r = req.r;
    if (!TYPES[r.type].producesPdf) return res.status(404).send('Нет PDF');
    res.type('pdf');
    pdf.certificate({ r: { ...r, closed_at: new Date().toISOString() }, student: M.user(r.student_id), staff: req.user, payments: M.payments(r.student_id) }, res);
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
    notifyStudent(r, `${r.title} взята в работу`, `Заявка № ${r.number}. Оформляет ${req.user.short_name}. Ожидаемый срок — ${T.relDateTime(new Date(r.eta_at))}.`);
    return 'Заявка взята в работу. Студент видит ваше имя и срок.';
  }));
  app.post('/staff/requests/:id/need', ...act((r, text, req) => {
    if (!['submitted', 'in_work'].includes(r.status) || !text) return 'Укажите, какой документ нужен';
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

  app.use((req, res) => res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><div class="app no-nav" style="padding:40px 20px"><h1>Страница не найдена</h1><p><a href="/">На главную</a></p></div>'));
  app.use((err, req, res, next) => { console.error(err); res.status(500).type('html').send('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><div class="app no-nav" style="padding:40px 20px"><h1>Что-то пошло не так</h1><p>Попробуйте обновить страницу. <a href="/">На главную</a></p></div>'); });

  app.locals.M = M;
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => console.log(`ДГТУ.Сейчас: http://localhost:${port} · помощник: ${assistant.enabled() ? 'GigaChat' : 'правила'}`));
}

module.exports = { createApp };
