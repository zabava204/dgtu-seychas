'use strict';
// Вычет за собственное обучение (ст. 219 НК РФ). Цифры – по материалам ФНС на ноябрь 2026,
// в интерфейсе подаются как подсказка, а не налоговая консультация.
const T = require('./time');
const OWN_LIMIT = 150000; // общий лимит социальных вычетов в год с расходов 2024 года
const RATE = 0.13;
const FIRST_YEAR = 2024; // с расходов 2024 года достаточно справки об оплате (приказ ФНС № ЕД-7-11/755@)

// Справку выдают за закончившийся календарный год: за текущий – с января следующего
function yearsFromPayments(payments, today = T.dateKey()) {
  const cur = Number(today.slice(0, 4));
  const by = {};
  for (const p of payments) { const y = Number(p.paid_on.slice(0, 4)); by[y] = (by[y] || 0) + p.amount; }
  return Object.entries(by).map(([y, sum]) => ({ year: Number(y), sum, base: Math.min(sum, OWN_LIMIT), refund: Math.round(Math.min(sum, OWN_LIMIT) * RATE), eligibleForm: Number(y) >= FIRST_YEAR, closed: Number(y) < cur }))
    .sort((a, b) => b.year - a.year);
}
const rub = (n) => n.toLocaleString('ru-RU').replace(/\u00a0/g, ' ') + ' ₽';
const innOk = (s) => {
  if (!/^\d{12}$/.test(s)) return false;
  const d = s.split('').map(Number);
  const c = (w) => (w.reduce((a, k, i) => a + k * d[i], 0) % 11) % 10;
  return c([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[10] && c([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[11];
};
// ИНН физлица – 12 цифр, две последние – контрольные. Демо-ИНН начинается с «00»:
// такого кода региона нет, поэтому номер не может принадлежать реальному человеку.
function withChecksum(ten) {
  const d = ten.split('').map(Number);
  const c1 = ([7, 2, 4, 10, 3, 5, 9, 4, 6, 8].reduce((a, k, i) => a + k * d[i], 0) % 11) % 10;
  d.push(c1);
  const c2 = ([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8].reduce((a, k, i) => a + k * d[i], 0) % 11) % 10;
  return d.join('') + c2;
}
const DEMO_INN = withChecksum('0071482596');
// Что ответить на вопрос о вычете: год из вопроса (или последний закончившийся),
// оплаты за него и уже заказанная или выданная справка. Считает программа, не модель.
function situation(question, payments = [], requests = [], today = T.dateKey()) {
  const years = yearsFromPayments(payments, today).filter((y) => y.eligibleForm);
  const m = String(question || '').match(/20\d\d/);
  const asked = m ? Number(m[0]) : null;
  const y = asked ? years.find((x) => x.year === asked) || null : years.find((x) => x.closed) || null;
  const cur = years.find((x) => !x.closed) || null;
  const year = asked || (y && y.year) || null;
  const req = year ? requests.filter((r) => r.type === 'tax' && String(r.purpose) === String(year) && r.status !== 'rejected' && r.status !== 'draft')[0] || null : null;
  return { asked, year, y, cur, req, any: years.length > 0 };
}

module.exports = { situation, OWN_LIMIT, RATE, FIRST_YEAR, yearsFromPayments, rub, innOk, DEMO_INN };
