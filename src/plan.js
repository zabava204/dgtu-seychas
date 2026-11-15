'use strict';
// План на 7 дней. Время ставит программа по расписанию, состав — по журналу.
// Модель не назначает слоты и не придумывает работы: в прошлый раз она «досчитала» баллы до 212.
const T = require('./time');

const WINDOWS = { day: [8 * 60, 17 * 60], evening: [18 * 60, 22 * 60] };
const MIN_SLOT = 30;
const ALLOWED = [30, 60, 90, 120];

function selfWord(gender) { return gender === 'm' ? 'самому' : 'самой'; }

// Очередь из журнала: уточнить просроченное или подготовиться к известной работе.
// Дисциплины без недобора не попадают в план.
function queue(ds, session, gender) {
  const examDate = (id) => {
    const s = (session || []).find((x) => x.discipline_id === id && x.kind !== 'консультация');
    return s ? s.date_key : '9999-99-99';
  };
  const risks = (ds || []).filter((d) => !d.closed_text && d.gap > 0)
    .sort((a, b) => examDate(a.id).localeCompare(examDate(b.id)) || b.gap - a.gap);
  const tasks = [];
  const word = selfWord(gender);
  for (const d of risks) {
    const upcoming = (d.upcoming || [])[0];
    if (d.overdue.length) {
      const names = d.overdue.map((w) => `${w.title} (до ${w.max})`).join(', ');
      const rest = d.afterOverdue > 0
        ? ` Даже если их примут на максимум, до порога останется ${d.afterOverdue}. Спроси, какие ещё задания можно получить: в журнале этого списка нет.`
        : ' Спроси, примут ли их после срока.';
      tasks.push({
        discipline_id: d.id, kind: 'clarify',
        title: `Уточнить у преподавателя: ${d.subject}`,
        detail: `Просрочено: ${names}.${rest} Преподаватель — ${d.teacher}.`,
      });
    } else if (!upcoming) {
      tasks.push({
        discipline_id: d.id, kind: 'clarify',
        title: `Уточнить у преподавателя: ${d.subject}`,
        detail: `Не хватает ${d.gap}. Несданных работ в журнале нет. Кабинет не знает, какие задания преподаватель ещё может принять.`,
      });
    }
    if (upcoming) {
      tasks.push({
        discipline_id: d.id, kind: 'self_study',
        title: `Подготовиться ${word}: ${upcoming.title}`,
        detail: `«${d.subject}». В журнале эта работа до ${upcoming.max} баллов, срок ${T.dayMonthKey(upcoming.due_key)}. Отметка в плане баллы не меняет.`,
      });
    }
  }
  return tasks;
}

function overlaps(a0, a1, b0, b1) { return a0 < b1 && b0 < a1; }

// Свободные промежутки внутри окна. Занятые пары и зачёты вырезаются.
function freeGaps(window, pairs, notBefore) {
  let cursor = Math.max(window[0], notBefore);
  const end = window[1];
  const busy = (pairs || []).filter((p) => !p.cancelled)
    .map((p) => [T.parseHHMM(p.start), T.parseHHMM(p.end)])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  const gaps = [];
  for (const [s, e] of busy) {
    if (e <= cursor) continue;
    if (s > cursor) gaps.push([cursor, Math.min(s, end)]);
    cursor = Math.max(cursor, e);
    if (cursor >= end) break;
  }
  if (cursor < end) gaps.push([cursor, end]);
  return gaps.filter(([a, b]) => b - a >= MIN_SLOT && a < end);
}

// Один блок в день, не длиннее выбранных минут и не раньше текущего момента.
function place({ days, minutes, part, tasks, nowKey, nowMin }) {
  const window = WINDOWS[part];
  const placed = [];
  let i = 0;
  if (!window || !ALLOWED.includes(minutes)) return { placed, left: tasks || [] };
  for (const day of days || []) {
    if (i >= (tasks || []).length) break;
    if (!day.key || day.key < nowKey) continue;
    const notBefore = day.key === nowKey ? Math.ceil(nowMin / 5) * 5 : window[0];
    const gaps = freeGaps(window, day.pairs, notBefore);
    const gap = gaps.find(([a, b]) => b - a >= minutes) || gaps[0];
    if (!gap) continue;
    const len = Math.min(minutes, gap[1] - gap[0]);
    const start = gap[0];
    const end = start + len;
    const hit = (day.pairs || []).filter((p) => !p.cancelled).some((p) => overlaps(start, end, T.parseHHMM(p.start), T.parseHHMM(p.end)));
    if (hit || (day.key === nowKey && start < nowMin) || end - start > minutes) continue;
    placed.push({ ...tasks[i], date_key: day.key, start_min: start, end_min: end, short: len < minutes });
    i += 1;
  }
  return { placed, left: (tasks || []).slice(i) };
}

module.exports = { queue, place, freeGaps, overlaps, WINDOWS, ALLOWED, MIN_SLOT };
