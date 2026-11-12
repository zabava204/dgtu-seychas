'use strict';
// Каталог заявок первой версии. Сроки и правила — демо-правила концепта, не нормативы ДГТУ.
const T = require('./time');

const TYPES = {
  study: {
    title: 'Справка с места учёбы',
    short: 'Справка с места учёбы',
    keywords: ['справк', 'места учеб', 'места учёб', 'проездн', 'транспорт', 'соцзащит', 'работодател', 'обучаюсь', 'студенческ'],
    purposes: [
      { id: 'transport', label: 'Для проездного', full: 'для оформления льготной транспортной карты', title: 'Справка для проездного' },
      { id: 'social', label: 'В соцзащиту', full: 'для предоставления в органы социальной защиты населения', title: 'Справка в соцзащиту' },
      { id: 'employer', label: 'Работодателю', full: 'для предоставления по месту работы', title: 'Справка с места учёбы' },
      { id: 'other', label: 'Другое', full: 'для предоставления по месту требования', title: 'Справка с места учёбы' },
    ],
    formats: [
      { id: 'pdf', label: 'Электронная', hint: 'PDF в заявке · обычно в тот же день' },
      { id: 'paper', label: 'Бумажная', hint: 'выдача в деканате, корпус 1, каб. 210 · 2 рабочих дня' },
    ],
    producesPdf: true,
  },
  visa: {
    title: 'Справка для визы (на английском)',
    short: 'Справка для визы',
    keywords: ['виз', 'english', 'английск', 'посольств', 'загран'],
    formats: [{ id: 'pdf', label: 'Электронная', hint: 'PDF в заявке · 3 рабочих дня' }],
    detailsLabel: 'Страна и даты поездки',
    detailsPlaceholder: 'Например: Сербия, 2–9 января',
    producesPdf: true,
  },
  aid: {
    title: 'Материальная помощь',
    short: 'Материальная помощь',
    keywords: ['матпомощ', 'материальн', 'деньг', 'выплат', 'помощь деньгами'],
    reasons: ['Сложная семейная ситуация', 'Лечение', 'Студенческая семья', 'Другое'],
    requiredDocs: ['Справка о составе семьи'],
    detailsLabel: 'Коротко о ситуации',
    detailsPlaceholder: 'Видит только сотрудник деканата',
    producesPdf: false,
  },
};

// Где взять документ — демо-подсказки с пометкой «уточните в деканате»
const DOC_HELP = {
  'Справка о составе семьи': {
    where: [
      'МФЦ «Мои документы» или управляющая компания / ТСЖ по месту регистрации.',
      'Если регистрация в другом городе — запросите документ там, электронной копии или скана достаточно для подачи.',
    ],
    note: 'Демо-правило концепта: справка не старше 30 дней. Точные требования уточните в деканате (корпус 1, каб. 210).',
  },
};

function purposeOf(type, id) { return (TYPES[type]?.purposes || []).find((p) => p.id === id); }
function formatOf(type, id) { return (TYPES[type]?.formats || []).find((f) => f.id === id); }

function requestTitle(r) {
  const t = TYPES[r.type];
  if (!t) return 'Заявка';
  if (r.type === 'study') return purposeOf('study', r.purpose)?.title || t.title;
  return t.title;
}

// Ожидаемая готовность: от момента взятия/подачи
function estimateEta(type, format, from = T.now()) {
  const key = T.dateKey(from);
  const min = T.minutesOfDay(from);
  if (type === 'study' && format !== 'paper') {
    if (T.isWorkday(key) && min < 15 * 60) return T.at(key, 17 * 60);
    return T.at(T.nextWorkday(key), 17 * 60);
  }
  if (type === 'study') return T.at(T.addWorkdays(key, 2), 15 * 60);
  if (type === 'visa') return T.at(T.addWorkdays(key, 3), 15 * 60);
  return T.at(T.addWorkdays(key, 5), 15 * 60); // матпомощь: решение комиссии
}

module.exports = { TYPES, DOC_HELP, purposeOf, formatOf, requestTitle, estimateEta };
