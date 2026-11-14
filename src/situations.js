'use strict';
// Жизненные ситуации: студент выбирает, что у него происходит, а кабинет собирает пакет —
// какие справки заказать одной кнопкой, что подготовить самому и что важно по срокам.
// Состав пакета считается по данным кабинета; перечни документов — демо-правила концепта.
const T = require('./time');
const pl = (n) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? 'балл' : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? 'балла' : 'баллов'; };
const TAX = require('./tax');

const SITUATIONS = [
  { id: 'housing', title: 'Семья оформляет субсидию на ЖКУ', lead: 'Соцзащита учитывает, что ты учишься очно, и твою стипендию как доход семьи.', icon: 'home' },
  { id: 'job', title: 'Устраиваюсь на работу', lead: 'Справка для отдела кадров и что важно знать про сессию, если совмещаешь работу и учёбу.', icon: 'work' },
  { id: 'tax', title: 'Возвращаю налог за учёбу', lead: '13% от оплаты обучения можно вернуть через налоговую.', icon: 'tax' },
  { id: 'behind', title: 'Готовлюсь к сессии', lead: 'Что ещё сдать, сколько баллов нужно до допуска, даты зачётов и экзаменов.', icon: 'clock' },
  { id: 'money', title: 'Оформляю материальную помощь', lead: 'Заявление и документы, которые понадобятся.', icon: 'aid' },
];

// data: { user, payments, stipends, disciplines, session, requests }
function build(id, data) {
  const s = SITUATIONS.find((x) => x.id === id);
  if (!s) return null;
  const { user, payments = [], stipends = [], disciplines = [], session = [], requests = [] } = data;
  const busy = (type, purpose) => requests.find((r) => r.type === type && (purpose == null || r.purpose === purpose) && ['submitted', 'in_work', 'need_student', ...(type === 'tax' ? ['ready'] : [])].includes(r.status));
  const order = (key, type, purpose, title, hint, extra = {}) => {
    const b = busy(type, purpose);
    return { key, kind: 'order', type, purpose, title, hint, available: !b && extra.available !== false, reason: b ? (b.status === 'ready' ? `Уже выдана: № ${b.number} — PDF в «Заявках»` : `Уже заказана: № ${b.number}, ${b.statusText.toLowerCase()}`) : extra.reason, ...extra };
  };
  const out = { ...s, orders: [], todo: [], notes: [], links: [] };

  if (id === 'housing') {
    out.orders.push(order('study', 'study', 'social', 'Справка об обучении в органы социальной защиты', 'Подтверждает очную форму обучения · PDF, обычно в тот же день'));
    if (user.funding === 'бюджет' && stipends.length) {
      const sum = stipends.reduce((a, x) => a + x.amount, 0);
      out.orders.push(order('stipend', 'stipend', null, 'Справка о размере стипендии', `За последние ${stipends.length} мес.: ${TAX.rub(sum)} · PDF, 1 рабочий день`));
    } else {
      out.notes.push(user.funding === 'контракт' ? 'Справка о стипендии не нужна: на договоре академическая стипендия не назначается.' : 'Справка о стипендии не нужна: в кабинете нет выплат стипендии.');
    }
    out.todo.push('Документы о доходах родителей и составе семьи семья получает сама — точный перечень назовут в органе соцзащиты или МФЦ.');
    out.notes.push('Срок действия справок обычно ограничен — заказывай, когда семья готова подать документы (демо-правило).');
  }

  if (id === 'job') {
    out.orders.push(order('study', 'study', 'employer', 'Справка об обучении по месту работы', 'Для отдела кадров · PDF, обычно в тот же день'));
    if (user.form !== 'очная') {
      const first = session.find((x) => x.kind !== 'консультация');
      out.notes.push(`Ты учишься ${user.form === 'очно-заочная' ? 'очно-заочно' : 'заочно'}: на время сессии работодатель может предоставить учебный отпуск по справке-вызову. В этой версии кабинета её оформляют в деканате${first ? `; сессия начинается ${T.dayMonthKey(first.date_key)}` : ''}.`);
      out.links.push({ href: '/study/grades#session', label: 'Даты сессии' });
    }
  }

  if (id === 'tax') {
    const ys = TAX.yearsFromPayments(payments).filter((y) => y.eligibleForm);
    const closed = ys.filter((y) => y.closed);
    if (closed.length) {
      const y = closed[closed.length - 1];
      out.orders.push(order('tax', 'tax', String(y.year), `Справка для налогового вычета за ${y.year} год`, `Оплачено ${TAX.rub(y.sum)} · вернуть можно до ${TAX.rub(y.refund)} · PDF, 3 рабочих дня`, { details: TAX.DEMO_INN }));
      out.todo.push('После получения справки подай декларацию 3-НДФЛ в личном кабинете налогоплательщика и приложи справку.');
      const cur = ys.find((x) => !x.closed);
      if (cur) out.notes.push(`Справку за ${cur.year} год можно заказать с января ${cur.year + 1}.`);
      out.links.push({ href: '/help/tax', label: 'Как получить вычет' });
    } else {
      out.notes.push('В кабинете нет оплат по договору: вычет положен только за платное обучение. Если ты платишь за учёбу — напиши в деканат, проверим договор.');
    }
  }

  if (id === 'behind') {
    const risky = disciplines.filter((d) => !d.closed_text && (d.gap > 0 || d.overdue.length));
    if (!risky.length) out.notes.push('По всем дисциплинам порог набран и просрочек нет.');
    for (const d of risky) {
      const ex = session.find((x) => x.discipline_id === d.id && x.kind !== 'консультация');
      out.todo.push(`${d.subject}: ${d.gap ? `до допуска не хватает ${d.gap} ${pl(d.gap)}` : 'порог набран'}${d.overdue.length ? `; просрочены: ${d.overdue.map((w) => `${w.title} (до ${w.max} ${pl(w.max)})`).join(', ')}` : ''}${ex ? `; ${ex.kind} ${T.dayMonthKey(ex.date_key)}` : ''}. Преподаватель — ${d.teacher}`);
    }
    if (risky.length) out.links.push({ href: '/helper?q=' + encodeURIComponent('Мне нужно больше времени на работы. Как попросить отсрочку?'), label: 'Как попросить отсрочку' });
    out.links.push({ href: '/study/grades#session', label: 'Даты сессии и допуск' });
  }

  if (id === 'money') {
    const aid = requests.find((r) => r.type === 'aid' && ['submitted', 'in_work', 'need_student'].includes(r.status));
    if (aid) out.notes.push(`Заявление уже подано: № ${aid.number}, ${aid.statusText.toLowerCase()}.`);
    else out.links.push({ href: '/requests/new?type=aid', label: 'Подать заявление' });
    out.todo.push('Справка о составе семьи — в МФЦ или управляющей компании по месту регистрации; можно загрузить скан или фото.');
    out.notes.push('Основания и размер помощи определяет комиссия — это демо-правило концепта.');
    if (aid) out.links.push({ href: `/requests/${aid.id}`, label: 'Открыть заявление' });
  }
  out.available = out.orders.filter((o) => o.available);
  return out;
}

module.exports = { SITUATIONS, build };
