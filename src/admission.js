'use strict';
// Разбор допуска: цифры только из журнала. Модель письмо не переписывает,
// чтобы не подменить баллы (на ревью GigaChat однажды получил 212 вместо 47).
const T = require('./time');

function openRisks(ds) {
  return (ds || []).filter((d) => !d.closed_text && d.gap > 0);
}

function examOf(session, id) {
  return (session || []).find((s) => s.discipline_id === id && s.kind !== 'консультация') || null;
}

function consultOf(session, id) {
  return (session || []).find((s) => s.discipline_id === id && s.kind === 'консультация') || null;
}

// Что дадут уже известные просроченные работы, если их примут на максимум.
// Это потолок по журналу, не обещание преподавателя.
function arithmetic(d) {
  const overdue = d.overdue || [];
  const overdueSum = overdue.reduce((s, w) => s + w.max, 0);
  const ifOverdueMax = d.points + overdueSum;
  return {
    overdueSum,
    ifOverdueMax,
    leftAfter: Math.max(0, d.pass_threshold - ifOverdueMax),
    covers: overdue.length > 0 && ifOverdueMax >= d.pass_threshold,
  };
}

function letter({ user, d, exam }) {
  const control = d.control === 'экзамен' ? 'экзамену' : 'зачёту';
  const when = exam
    ? `${exam.kind[0].toUpperCase()}${exam.kind.slice(1)} стоит в расписании на ${T.dayMonthKey(exam.date_key)}, ${exam.start}, ауд. ${exam.room}.`
    : 'Даты контроля в расписании сессии пока нет.';
  return [
    'Здравствуйте!',
    '',
    `Меня зовут ${user.short_name}, группа ${user.group_name}.`,
    `По дисциплине «${d.subject}» в кабинете сейчас ${d.points} из ${d.pass_threshold} баллов допуска к ${control}. Не хватает ${d.gap}.`,
    when,
    'Подскажите, пожалуйста, какие работы я ещё могу выполнить, чтобы набрать недостающие баллы, и до какой даты их можно сдать.',
    '',
    'С уважением,',
    `${user.short_name}, группа ${user.group_name}.`,
  ].join('\n');
}

module.exports = { openRisks, examOf, consultOf, arithmetic, letter };
