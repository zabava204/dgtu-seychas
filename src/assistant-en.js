'use strict';
// Помощник на английском для иностранных студентов – первая небольшая часть английской версии.
// Факты (расписание, заявки, баллы, сессия, вычет, стипендия) считает программа, как и в русской версии.
// Названия дисциплин остаются как в учебном плане – на русском.
const T = require('./time');
const TAX = require('./tax');
const PREP = require('./prep');

const has = (q, words) => words.some((w) => q.includes(w));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dm = (key) => { const [, m, d] = key.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };
const wd = (key) => WD[new Date(key + 'T00:00:00Z').getUTCDay()];
const rub = (n) => TAX.rub(n).replace(/\s?₽/, '') + ' RUB';
const KIND = { зачёт: 'credit test', 'зачёт с оценкой': 'graded credit test', экзамен: 'exam', консультация: 'consultation' };
const kind = (k) => KIND[k] || k;
const STATUS = { draft: 'draft', submitted: 'waiting for the dean’s office', in_work: 'in progress', need_student: 'your action is needed', ready: 'ready – the PDF is in “Requests”', rejected: 'rejected' };
const PURPOSE = { other: 'for any organisation', social: 'for social security', employer: 'for your employer' };
function title(r) {
  if (r.type === 'study') return `Certificate of enrollment (Form 2)${PURPOSE[r.purpose] ? ', ' + PURPOSE[r.purpose] : ''}`;
  if (r.type === 'tax') return `Tax deduction certificate${r.purpose ? ' for ' + r.purpose : ''}`;
  if (r.type === 'stipend') return 'Scholarship certificate';
  if (r.type === 'aid') return 'Financial aid application';
  return 'Request';
}
const OFFICE = 'the dean’s office (building 1, room 210, Mon–Fri 9:00–17:00)';

// Вопрос на английском: латиницы больше, чем кириллицы
function isEnglish(question) {
  const s = String(question || '');
  const lat = (s.match(/[a-z]/gi) || []).length;
  const cyr = (s.match(/[а-яё]/gi) || []).length;
  return lat >= 3 && lat > cyr * 2;
}

function intents(question, data) {
  const q = String(question || '').toLowerCase();
  const out = { id: 'other', text: null, actions: [], lang: 'en' };
  const set = (id, text, actions = [], exact = false) => Object.assign(out, { id, text, actions, exact });
  const nowKey = T.dateKey();

  if (has(q, ['suicid', 'kill myself', 'want to die', 'self-harm', 'depress', 'panic', 'anxiety', 'feel bad', 'can’t cope', "can't cope", 'too hard', 'overwhelm', 'stress'])) {
    return set('support', 'Thank you for writing. You are not alone with this. If your life is in danger, call 112. The Psychological support page has anonymous contacts and next steps.', [{ label: 'Psychological support', href: '/hard#psy' }]);
  }
  const prep = PREP.match(question, data, 'en');
  if (prep) return set(prep.id, prep.text, prep.actions, true);
  if (has(q, ['english', 'other language', 'speak russian', 'translate', 'foreign student', 'international student'])) {
    return set('lang', 'Yes, you can ask me in English. I answer from your cabinet data: classes for any day, your requests, credit tests and exams, points, certificates. Course names stay in Russian, as in the official curriculum. The rest of the cabinet is in Russian for now; official certificates are issued in Russian.', [{ label: 'Classes tomorrow', href: '/helper?q=' + encodeURIComponent('What classes do I have tomorrow?') }]);
  }
  // Заявки и их статус
  if (has(q, ['status', 'my request', 'my application', 'is it ready', 'ready yet', 'when will', 'my certificate'])) {
    const open = data.requests.filter((r) => ['submitted', 'in_work', 'need_student'].includes(r.status));
    const ready = data.requests.filter((r) => r.status === 'ready').slice(0, 2);
    const line = (r) => `No. ${r.number} “${title(r)}” – ${STATUS[r.status]}${r.status !== 'need_student' && r.eta_at ? `, expected ${dm(T.dateKey(new Date(r.eta_at)))}` : ''}`;
    const text = open.length || ready.length ? [open.length ? `Open requests:\n${open.map(line).join('\n')}` : 'No open requests.', ready.length ? `Ready: ${ready.map((r) => `No. ${r.number} “${title(r)}”`).join(', ')}.` : ''].filter(Boolean).join('\n') : 'You have no requests yet.';
    return set('status', text, open.length === 1 ? [{ label: `Open request No. ${open[0].number}`, href: `/requests/${open[0].id}` }] : [{ label: 'My requests', href: '/requests' }], true);
  }
  // Сессия: зачёты и экзамены
  if (has(q, ['exam', 'credit test', 'session', 'finals']) && (data.session || []).length) {
    const items = data.session.filter((s) => s.kind !== 'консультация');
    const text = 'Exam session in your cabinet:\n' + items.map((s) => `${dm(s.date_key)} (${wd(s.date_key)}), ${s.start}, room ${s.room} – ${kind(s.kind)}: ${s.subject}${s.admitted ? ' · admitted' : ` · ${s.gap} more points needed for admission`}`).join('\n');
    return set('session', text, [{ label: 'Session and admission', href: '/study/grades#session' }], true);
  }
  // Баллы
  if (has(q, ['point', 'score', 'grade', 'mark', 'admission', 'admitted', 'threshold'])) {
    const ds = data.disciplines.filter((d) => !d.closed_text);
    const text = 'Current points (out of 100):\n' + ds.map((d) => `${d.subject} – ${d.points}, threshold ${d.pass_threshold}${d.gap ? `, ${d.gap} more needed` : ', threshold reached'}${d.overdue.length ? `; overdue: ${d.overdue.map((w) => w.title).join(', ')}` : ''}`).join('\n') + '\nAdmission to the session is a demo rule: the threshold of current points is reached.';
    return set('grades', text, [{ label: 'Open grades', href: '/study/grades' }], true);
  }
  // Расписание на день
  if (has(q, ['class', 'lesson', 'lecture', 'seminar', 'schedule', 'timetable', 'room', 'where do i go'])) {
    let key = null;
    if (has(q, ['day after tomorrow'])) key = T.addDays(nowKey, 2);
    else if (has(q, ['tomorrow'])) key = T.addDays(nowKey, 1);
    else if (has(q, ['today', 'now'])) key = nowKey;
    if (!key) { const i = WD.findIndex((w) => q.includes(w.toLowerCase())); if (i >= 0) { const n = i === 0 ? 7 : i; key = T.addDays(nowKey, (n - T.weekdayOfKey(nowKey) + 7) % 7); } }
    if (key && data.dayPairs) {
      const ps = data.dayPairs(key).filter((p) => !p.cancelled);
      const ex = (data.session || []).filter((x) => x.date_key === key);
      const lines = [...ex.map((x) => `${x.start} ${kind(x.kind)}: ${x.subject}, room ${x.room}`), ...ps.map((p) => `${p.start}–${p.end} ${p.subject}, ${p.online ? 'online' : 'room ' + p.room}${p.old_room || p.old_start ? ' (changed)' : ''}`)];
      return set('schedule', lines.length ? `${wd(key)}, ${dm(key)}:\n${lines.join('\n')}` : `${wd(key)}, ${dm(key)} – no classes.`, [{ label: 'Day schedule', href: `/study?d=${key}` }], true);
    }
    const n = data.next;
    return set('schedule', n ? `Your next class: ${n.subject}, ${wd(T.dateKey(n.startsAt))} ${dm(T.dateKey(n.startsAt))}, ${T.timeOf(n.startsAt)}, ${n.online ? 'online' : 'room ' + n.room}.` : 'No classes in the next two weeks.', [{ label: 'Schedule', href: '/study' }], true);
  }
  // Налоговый вычет
  if (has(q, ['tax', 'deduction', 'refund'])) {
    const ys = TAX.yearsFromPayments(data.payments || []).filter((y) => y.eligibleForm);
    const y = ys.filter((x) => x.closed).pop();
    const cur = ys.find((x) => !x.closed);
    return set('tax', y ? `In ${y.year} you paid ${rub(y.sum)} under your contract, so you can get back up to ${rub(y.refund)} if your income is taxed at 13%. Order the certificate for ${y.year} and attach it to the 3-NDFL declaration in the taxpayer’s personal account.${cur ? ` The certificate for ${cur.year} can be ordered from January ${cur.year + 1}.` : ''}` : 'The tax deduction is for paid (contract) studies. Your cabinet has no contract payments.', y ? [{ label: 'Order the certificate', href: '/requests/new?type=tax' }] : [{ label: 'My dean’s office', href: '/me' }], true);
  }
  // Student ID / record book
  if (has(q, ['student id', 'student card', 'record book', 'grade book', 'transcript card'])) {
    const u = data.user;
    const b = data.book;
    return set('idcard', `Student ID and record book: ${u.full_name}, ${u.faculty}, year ${u.course}, group ${u.group_name}, No. ${u.record_book}.${b && b.avg ? ` Record-book average – ${b.avg.toFixed(2)}.` : ''} Open them in “My documents”.`, [{ label: 'My documents', href: '/me/docs' }, { label: 'Record book', href: '/study/record' }], true);
  }
  // Стипендия
  if (has(q, ['scholarship', 'stipend'])) {
    const st = data.stipends || [];
    if (data.user.funding !== 'бюджет') return set('stipend', 'You study under a contract, so the academic scholarship is not paid and there is no scholarship certificate.', [{ label: 'My dean’s office', href: '/me' }], true);
    const last = st[st.length - 1];
    return set('stipend', last ? `State academic scholarship – ${rub(last.amount)} per month; ${rub(st.reduce((a, x) => a + x.amount, 0))} over the last ${st.length} months. You can order a scholarship certificate online.` : 'There are no scholarship payments in your cabinet.', [{ label: 'Order the certificate', href: '/requests/new?type=stipend' }], true);
  }
  // Справки
  if (has(q, ['visa', 'embassy', 'consulate', 'migration', 'registration'])) {
    return set('visa', `Letters for a visa, migration registration or an embassy can’t be ordered online in this version. Please contact ${OFFICE} or the international students office.`, [{ label: 'My dean’s office', href: '/me' }]);
  }
  if (has(q, ['certificate', 'proof of study', 'enrollment', 'enrolment', 'document'])) {
    return set('study', 'You can order a Certificate of enrollment (Form 2) in “Requests”: choose where it is needed and the format (PDF or paper). A PDF is usually ready the same day (demo rule). Official certificates are issued in Russian.', [{ label: 'Order a certificate', href: '/requests/new?type=study' }, { label: 'All certificates', href: '/requests/new' }]);
  }
  if (has(q, ['dean', 'office', 'contact', 'phone', 'who can help'])) {
    return set('office', `Your dean’s office: ${OFFICE}. You can also write to the dean’s office in any request.`, [{ label: 'My dean’s office', href: '/me' }]);
  }
  return out;
}

function fallbackText() {
  return 'I’m not sure how to help with this yet. Try: “What classes do I have tomorrow?”, “When are my exams?”, “What is the status of my request?”, “How do I get a certificate of enrollment?” – or contact ' + OFFICE + '.';
}

module.exports = { isEnglish, intents, fallbackText };
