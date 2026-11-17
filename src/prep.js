'use strict';
// Четыре готовых вопроса помощника. Цифры и письмо – из журнала, время – из плана.
// Модель эти ответы не пересказывает: иначе снова подменит баллы или подставит дату.
const T = require('./time');
const AD = require('./admission');

const low = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');
const has = (q, words) => words.some((w) => q.includes(w));

function risks(ds) {
  return (ds || []).filter((d) => !d.closed_text && d.gap > 0)
    .sort((a, b) => b.gap - a.gap || a.subject.localeCompare(b.subject, 'ru'));
}

function slotWhen(s) {
  const today = T.dateKey();
  const day = s.date_key === today ? 'сегодня' : s.date_key === T.addDays(today, 1) ? 'завтра' : `${T.wdLongKey(s.date_key)}, ${T.dayMonthKey(s.date_key)}`;
  return `${day}, ${T.hhmm(s.start_min)}–${T.hhmm(s.end_min)}`;
}

function eveningClasses(dayPairs) {
  if (typeof dayPairs !== 'function') return false;
  const today = T.dateKey();
  for (let i = 0; i < 7; i++) {
    const pairs = dayPairs(T.addDays(today, i)) || [];
    if (pairs.some((p) => !p.cancelled && T.parseHHMM(p.start) >= 18 * 60)) return true;
  }
  return false;
}

function which(q, lang) {
  if (lang === 'en') {
    if (has(q, ['more time', 'extra time', 'extension', 'extend the deadline', 'ask for more time', "can't finish", 'cannot finish'])) return 'extension';
    if (has(q, ['write to my teacher', 'write to the teacher', 'message the teacher', 'message my teacher', 'email the teacher', 'email my teacher'])) return 'letter';
    if (has(q, ['evening class', 'evening classes', 'study in the evening', 'when should i study'])) return 'evening';
    if (has(q, ['before the session', 'before my exam', 'before the exam', 'study plan', 'what should i do before'])) return 'plan';
    return null;
  }
  if (has(q, ['отсроч', 'больше времени', 'не успеваю', 'продлить срок', 'перенести срок'])) return 'extension';
  if (has(q, ['написать преподавател', 'письмо преподавател', 'сообщение преподавател'])) return 'letter';
  if (has(q, ['вечером', 'когда готовиться', 'готовиться вечер'])) return 'evening';
  if (has(q, ['до сессии', 'план на 7', 'план на неделю', 'ближайшая задача', 'что сделать до'])) return 'plan';
  return null;
}

function planAnswer(data, lang) {
  const slot = data.nextSlot;
  const main = risks(data.disciplines)[0];
  if (lang === 'en') {
    if (slot) return { text: `Next in your plan: ${slotWhen(slot)}, ${slot.title}. Marking it done does not change your points.`, actions: [{ label: 'Open the plan', href: '/study/plan' }] };
    if (main) return { text: `You don’t have a plan yet. The largest gap in the gradebook is ${main.subject}: ${main.points} of ${main.pass_threshold}, ${main.gap} more needed. The cabinet can place tasks between your classes. Choose 30–120 minutes, daytime or evening.`, actions: [{ label: 'Make a plan', href: '/study/plan' }, { label: 'See the calculation', href: `/study/session-support/${main.id}` }] };
    return { text: 'The admission threshold is already reached for every course. A study plan is not needed.', actions: [{ label: 'Open grades', href: '/study/grades' }] };
  }
  if (slot) return { text: `Ближайшее по плану: ${slotWhen(slot)}, ${slot.title}. Отметка «сделано» баллы не меняет.`, actions: [{ label: 'Открыть план', href: '/study/plan' }] };
  if (main) return { text: `Плана ещё нет. Самый большой недобор в журнале по «${main.subject}»: ${main.points} из ${main.pass_threshold}, не хватает ${main.gap}. Кабинет может поставить задачи в свободное от учебных занятий время. Выбери 30–120 минут и день или вечер.`, actions: [{ label: 'Составить план', href: '/study/plan' }, { label: 'Разобрать допуск', href: `/study/session-support/${main.id}` }] };
  return { text: 'Порог допуска уже набран по всем дисциплинам. План подготовки не нужен.', actions: [{ label: 'Открыть оценки', href: '/study/grades' }] };
}

function letterAnswer(data, lang) {
  const main = risks(data.disciplines)[0];
  if (!main) {
    return lang === 'en'
      ? { text: 'The admission threshold is already reached, so there is no letter about a missing score.', actions: [{ label: 'Open grades', href: '/study/grades' }] }
      : { text: 'Порог допуска уже набран, письмо о недоборе не нужно.', actions: [{ label: 'Открыть оценки', href: '/study/grades' }] };
  }
  const exam = AD.examOf(data.session, main.id);
  const draft = AD.letter({ user: data.user, d: main, exam });
  if (lang === 'en') {
    return {
      text: `The largest gap is ${main.subject}: ${main.points} of ${main.pass_threshold}, ${main.gap} more needed. The letter is filled from the gradebook. The cabinet does not send it: copy it on the admission page.\n\n${draft}`,
      actions: [{ label: 'Open the letter', href: `/study/session-support/${main.id}#letter` }],
    };
  }
  return {
    text: `Самый большой недобор по «${main.subject}»: ${main.points} из ${main.pass_threshold}, не хватает ${main.gap}. Письмо собрано из журнала. Кабинет его не отправляет: скопируй на странице допуска.\n\n${draft}`,
    actions: [{ label: 'Открыть письмо', href: `/study/session-support/${main.id}#letter` }],
  };
}

function extensionAnswer(data, lang) {
  const main = risks(data.disciplines)[0];
  if (!main) {
    return lang === 'en'
      ? { text: 'There is no missing score to ask an extension for. A new deadline is set by the teacher, the cabinet does not invent a date.', actions: [{ label: 'Open grades', href: '/study/grades' }] }
      : { text: 'Недобора, по которому просить отсрочку, нет. Новую дату назначает преподаватель: кабинет её не выдумывает.', actions: [{ label: 'Открыть оценки', href: '/study/grades' }] };
  }
  const href = `/study/session-support/${main.id}#letter`;
  if (lang === 'en') {
    return {
      text: `An extension is the teacher’s decision, the cabinet has no such rule and does not fill in a date. For ${main.subject} you have ${main.points} of ${main.pass_threshold}, so ${main.gap} more are needed. The letter already asks which work you can still submit and by which date. The cabinet does not send it.`,
      actions: [{ label: 'Open the letter', href }, { label: 'Make a plan', href: '/study/plan' }],
    };
  }
  return {
    text: `Отсрочку назначает преподаватель: в кабинете этого правила нет, дату не подставляю. По «${main.subject}» сейчас ${main.points} из ${main.pass_threshold}, не хватает ${main.gap}. Письмо уже спрашивает, какие работы ещё можно сдать и до какой даты. Кабинет его не отправляет.`,
    actions: [{ label: 'Открыть письмо', href }, { label: 'Составить план', href: '/study/plan' }],
  };
}

function eveningAnswer(data, lang) {
  const evening = eveningClasses(data.dayPairs);
  const href = evening ? '/study/plan?new=1&part=evening' : '/study/plan?new=1&part=day';
  const slot = data.nextSlot;
  const own = slot ? (lang === 'en' ? ` Next in the current plan: ${slotWhen(slot)}, ${slot.title}.` : ` Сейчас в плане ближайшее: ${slotWhen(slot)}, ${slot.title}.`) : '';
  if (lang === 'en') {
    return evening
      ? { text: `Your classes are in the evening. Put the plan in the evening window, 18:00–22:00: tasks go into the gaps and do not overlap a class.${own}`, actions: [{ label: 'Evening plan', href }] }
      : { text: `Your classes are in the daytime. The evening, 18:00–22:00, is free in the schedule, so you can put the plan there if the day is busy. A task is never placed on top of a class.${own}`, actions: [{ label: 'Open the plan', href: '/study/plan' }] };
  }
  return evening
    ? { text: `Учебные занятия у тебя вечером. План лучше ставить на вечер, 18:00–22:00: задачи встанут в свободное от учебных занятий время и не пересекутся с ними.${own}`, actions: [{ label: 'План на вечер', href }] }
    : { text: `Твои учебные занятия днём. Вечер, 18:00–22:00, в расписании свободен, план можно поставить и туда, если днём нет времени. Поверх учебного занятия задача не встанет.${own}`, actions: [{ label: 'Открыть план', href: '/study/plan' }] };
}

function match(question, data, lang) {
  const q = low(question);
  const id = which(q, lang);
  if (!id) return null;
  const body = id === 'plan' ? planAnswer(data, lang) : id === 'letter' ? letterAnswer(data, lang) : id === 'extension' ? extensionAnswer(data, lang) : eveningAnswer(data, lang);
  return { id, ...body };
}

module.exports = { match, which };
