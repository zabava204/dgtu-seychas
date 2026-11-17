'use strict';
// Каталог заявок первой версии. Сроки и правила – демо-правила концепта, не нормативы ДГТУ.
const T = require('./time');

const TYPES = {
  study: {
    title: 'Справка об обучении',
    short: 'Справка об обучении',
    subtitle: 'Подтверждает, что ты учишься: в соцзащиту, по месту работы, по месту требования',
    official: 'Справка об обучении (Форма 2)',
    keywords: ['справк', 'места учеб', 'места учёб', 'жку', 'коммунал', 'субсид', 'льгот', 'соцзащит', 'работ', 'обучаюсь', 'студенческ'],
    purposeHint: 'Для субсидии или льготы по оплате ЖКУ выбирай «В органы социальной защиты».',
    purposes: [
      { id: 'other', label: 'По месту требования', full: 'для предоставления по месту требования', title: 'Справка об обучении' },
      { id: 'social', label: 'В органы социальной защиты', full: 'для предоставления в органы социальной защиты населения', title: 'Справка об обучении в органы соцзащиты' },
      { id: 'employer', label: 'По месту работы', full: 'для предоставления по месту работы', title: 'Справка об обучении по месту работы' },
    ],
    formats: [
      { id: 'pdf', label: 'Электронная', hint: 'PDF в заявке · в тот же рабочий день (демо-срок)' },
      { id: 'paper', label: 'Бумажная', hint: 'выдача в деканате, корпус 1, каб. 210 · 2 рабочих дня (демо-срок)' },
    ],
    producesPdf: true,
  },
  stipend: {
    title: 'Справка о размере стипендии',
    short: 'Справка о стипендии',
    subtitle: 'Выплаты за последние 6 месяцев – для соцзащиты, субсидий',
    official: 'Справка о стипендии',
    keywords: ['стипенд'],
    formats: [{ id: 'pdf', label: 'Электронная', hint: 'PDF в заявке · 1 рабочий день (демо-срок)' }],
    producesPdf: true,
    budgetOnly: true,
  },
  tax: {
    title: 'Справка для налогового вычета',
    short: 'Справка для вычета',
    subtitle: 'Об оплате образовательных услуг для ИФНС (КНД 1151158)',
    official: 'Справка об оплате образовательных услуг для ИФНС (КНД 1151158)',
    keywords: ['вычет', 'налог', 'ндфл', '13%', 'оплат обучен', 'оплату обучен'],
    formats: [{ id: 'pdf', label: 'Электронная', hint: 'PDF в заявке · 3 рабочих дня (демо-срок)' }],
    producesPdf: true,
  },
  aid: {
    title: 'Материальная помощь',
    short: 'Материальная помощь',
    keywords: ['матпомощ', 'материальн', 'деньг', 'выплат', 'помощь деньгами'],
    reasons: ['Сложная семейная ситуация', 'Лечение', 'Студенческая семья', 'Другое'],
    requiredDocs: ['Справка о составе семьи'],
    detailsLabel: 'Коротко о ситуации',
    detailsPlaceholder: 'Что случилось и какая помощь нужна',
    producesPdf: false,
  },
};

// Где взять документ – демо-подсказки с пометкой «уточните в деканате»
const DOC_HELP = {
  'Справка о составе семьи': {
    where: [
      'МФЦ «Мои документы» или управляющая компания / ТСЖ по месту регистрации.',
      'Если регистрация в другом городе – запросите документ там, электронной копии или скана достаточно для подачи.',
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
  if (r.type === 'tax' && r.purpose) return `${t.title} за ${r.purpose} год`;
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
  if (type === 'stipend') return T.at(T.addWorkdays(key, 1), 15 * 60);
  if (type === 'tax') return T.at(T.addWorkdays(key, 3), 15 * 60);
  return T.at(T.addWorkdays(key, 5), 15 * 60); // матпомощь: решение комиссии
}

// Сколько дней готовую справку обычно принимают организации. Демо-правило концепта:
// многие просят справку не старше 30 дней; точный срок назначает организация, куда её несут.
const VALID_DAYS = { study: 30, stipend: 30 };
function validity(r, now = T.now()) {
  if (!r || r.status !== 'ready' || !r.closed_at) return null;
  const issued = T.dateKey(new Date(r.closed_at));
  if (r.type === 'tax') return { kind: 'year', issued, text: `Справка за ${r.purpose} год не устаревает – повторно заказывать не нужно.` };
  const days = VALID_DAYS[r.type];
  if (!days) return null;
  const until = T.addDays(issued, days);
  const fresh = until >= T.dateKey(now);
  return { kind: 'days', issued, until, fresh, text: fresh ? `Обычно принимают до ${T.dayMonthKey(until)}: многие организации просят справку не старше ${days} дней. Точный срок уточни там, куда её несёшь (демо-правило). До этой даты новую заказывать не нужно.` : `Выдана ${T.dayMonthKey(issued)} – больше ${days} дней назад. Если организация просит свежую справку, закажи новую.` };
}

module.exports = { TYPES, DOC_HELP, purposeOf, formatOf, requestTitle, estimateEta, validity, VALID_DAYS };
