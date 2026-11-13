'use strict';
// Расчёт по баллам делает программа, а не языковая модель: модель может ошибиться в арифметике
// (на ревью GigaChat «досчитал» работы до 100 баллов каждая и получил 212 вместо 47).
const T = require('./time');

const low = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');
const pl = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c; };
const balls = (n) => `${n} ${pl(n, 'балл', 'балла', 'баллов')}`;
const stems = (s) => low(s).split(/[^а-яa-z0-9]+/).filter((w) => w.length >= 5).map((w) => w.slice(0, 6));

// Дисциплина, упомянутая в вопросе (по основам слов названия)
function findDiscipline(question, ds) {
  const q = low(question);
  let best = null; let bestHits = 0;
  for (const d of ds) {
    const hits = stems(d.subject).filter((st) => q.includes(st)).length;
    if (hits > bestHits) { best = d; bestHits = hits; }
  }
  return best;
}
// Работы, упомянутые в вопросе
function findWorks(question, works) {
  const q = low(question);
  return works.filter((w) => stems(w.title).some((st) => q.includes(st)));
}

const control = (d) => (d.control === 'экзамен' ? 'экзамен' : 'зачёт');

function workLine(w, today) {
  if (!w.due_key) return `${w.title} — до ${balls(w.max)}`;
  const past = w.due_key < today;
  return `${w.title} — до ${balls(w.max)}, ${past ? 'срок прошёл' : 'срок'} ${T.dayMonthKey(w.due_key)}`;
}

// Подробный разбор одной дисциплины; asked — работы, о которых спросили
function explain(d, asked = []) {
  const today = T.dateKey();
  if (d.closed_text) return `${d.subject}: ${d.closed_text.toLowerCase()}.`;
  const open = d.works.filter((w) => w.score == null);
  const parts = [`${d.subject} (${control(d)}, преподаватель ${d.teacher}): сейчас ${balls(d.points)}, порог допуска — ${d.pass_threshold}.`];
  parts.push(d.gap > 0 ? `До порога не хватает ${balls(d.gap)}.` : 'Порог уже набран.');
  if (asked.length) {
    const add = asked.reduce((s, w) => s + (w.score == null ? w.max : 0), 0);
    const total = d.points + add;
    const names = asked.map((w) => w.title).join(' и ');
    const sum = [d.points, ...asked.filter((w) => w.score == null).map((w) => w.max)].join(' + ');
    parts.push(total >= d.pass_threshold
      ? `Если сдать ${names} на максимум: ${sum} = ${total} — порог будет набран.`
      : `Если сдать ${names} на максимум: ${sum} = ${total} — до порога останется ${balls(d.pass_threshold - total)}.`);
    const rest = open.filter((w) => !asked.includes(w));
    if (rest.length && total < d.pass_threshold) parts.push(`Ещё впереди: ${rest.map((w) => workLine(w, today)).join('; ')}.`);
  } else if (open.length) {
    parts.push(`Не сдано: ${open.map((w) => workLine(w, today)).join('; ')}.`);
    const overdue = open.filter((w) => w.due_key && w.due_key < today);
    if (overdue.length && d.gap > 0) {
      const t = d.points + overdue.reduce((s, w) => s + w.max, 0);
      parts.push(t >= d.pass_threshold ? `Если сдать просроченные работы на максимум, будет ${t} — порог набран.` : `Даже за просроченные работы на максимум будет ${t} — до порога останется ${balls(d.pass_threshold - t)}.`);
    }
  }
  if (d.auto_threshold && d.points < d.auto_threshold) parts.push(`До автомата (${d.auto_threshold}) — ${balls(d.auto_threshold - d.points)}.`);
  parts.push(`Итог по дисциплине ещё не выставлен.`);
  return parts.join(' ');
}

function summary(ds) {
  const bad = ds.filter((d) => !d.closed_text && d.gap > 0);
  if (!bad.length) return 'По всем дисциплинам порог допуска уже набран. Итоговые оценки ещё не выставлены.';
  return `Порог допуска не набран по ${bad.length} ${pl(bad.length, 'дисциплине', 'дисциплинам', 'дисциплинам')}: ` +
    bad.map((d) => `${d.subject} — ${balls(d.points)}, не хватает ${d.gap}${d.overdue.length ? `, просрочены: ${d.overdue.map((w) => `${w.title} (до ${w.max})`).join(', ')}` : ''}`).join('; ') + '. Спроси про конкретную дисциплину — посчитаю, что даст каждая работа.';
}

function answer(question, ds) {
  const d = findDiscipline(question, ds);
  if (d) return { text: explain(d, findWorks(question, d.works)), discipline: d };
  return { text: summary(ds), discipline: null };
}

module.exports = { answer, explain, summary, findDiscipline, balls, pl };
