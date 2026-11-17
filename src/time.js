'use strict';
// Время кабинета – московское (UTC+3, без перехода на летнее время).
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const WD_LONG = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

let fakeNow = null; // для тестов
function now() { return fakeNow ? new Date(fakeNow) : new Date(); }
function setNow(d) { fakeNow = d ? new Date(d).getTime() : null; }

// «Сдвинутая» дата: её UTC-поля = московские поля
function msk(d = now()) { return new Date(new Date(d).getTime() + MSK_OFFSET_MS); }
function fromMsk(shifted) { return new Date(shifted.getTime() - MSK_OFFSET_MS); }

function dateKey(d = now()) { return msk(d).toISOString().slice(0, 10); }
function weekday(d = now()) { const w = msk(d).getUTCDay(); return w === 0 ? 7 : w; } // 1 = пн … 7 = вс
function minutesOfDay(d = now()) { const m = msk(d); return m.getUTCHours() * 60 + m.getUTCMinutes(); }
function hhmm(min) { return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`; }
function parseHHMM(s) { const [h, m] = s.split(':').map(Number); return h * 60 + m; }

// Момент (UTC Date) для московской даты dateKey и минут дня
function at(key, minutes) {
  const [y, mo, da] = key.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, da, 0, 0) - MSK_OFFSET_MS + minutes * 60000);
}
function addDays(key, n) { return new Date(Date.parse(key + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10); }
function weekdayOfKey(key) { const w = new Date(key + 'T00:00:00Z').getUTCDay(); return w === 0 ? 7 : w; }

function dayMonth(d) { const m = msk(d); return `${m.getUTCDate()} ${MONTHS_GEN[m.getUTCMonth()]}`; }
function dayMonthKey(key) { const [, mo, da] = key.split('-').map(Number); return `${da} ${MONTHS_GEN[mo - 1]}`; }
function shortDate(d) { const m = msk(d); return `${String(m.getUTCDate()).padStart(2, '0')}.${String(m.getUTCMonth() + 1).padStart(2, '0')}.${m.getUTCFullYear()}`; }
function timeOf(d) { return hhmm(minutesOfDay(d)); }
function wdShortKey(key) { return WD_SHORT[new Date(key + 'T00:00:00Z').getUTCDay()]; }
function wdLongKey(key) { return WD_LONG[new Date(key + 'T00:00:00Z').getUTCDay()]; }

// Учебная неделя: неделя, в которую входит 1 сентября, – первая; нечётная = верхняя
function studyWeek(key = dateKey()) {
  const [y, mo] = key.split('-').map(Number);
  const startYear = mo >= 9 ? y : y - 1;
  const sept1 = `${startYear}-09-01`;
  const monday = addDays(sept1, 1 - weekdayOfKey(sept1));
  const days = Math.floor((Date.parse(key) - Date.parse(monday)) / DAY_MS);
  return Math.floor(days / 7) + 1;
}
function parity(key = dateKey()) { return studyWeek(key) % 2 === 1 ? 'num' : 'den'; }
function parityLabel(key = dateKey()) { return parity(key) === 'num' ? 'верхняя неделя' : 'нижняя неделя'; }

// Относительная подпись: «сегодня, 15:00», «завтра, 11 ноября», «в четверг, 12 ноября»
function relDay(d) {
  const key = dateKey(d); const today = dateKey();
  if (key === today) return 'сегодня';
  if (key === addDays(today, 1)) return 'завтра';
  if (key === addDays(today, -1)) return 'вчера';
  return dayMonthKey(key);
}
function relDateTime(d) { return `${relDay(d)}, ${timeOf(d)}`; }
function stamp(d) {
  const key = dateKey(d);
  return `${dayMonthKey(key)}, ${timeOf(d)}`;
}

// Рабочие дни (пн–пт) для сроков деканата
function isWorkday(key) { return weekdayOfKey(key) <= 5; }
function nextWorkday(key) { let k = addDays(key, 1); while (!isWorkday(k)) k = addDays(k, 1); return k; }
function addWorkdays(key, n) { let k = key; for (let i = 0; i < n; i++) k = nextWorkday(k); return k; }

module.exports = {
  now, setNow, msk, fromMsk, dateKey, weekday, minutesOfDay, hhmm, parseHHMM, at, addDays, weekdayOfKey,
  dayMonth, dayMonthKey, shortDate, timeOf, wdShortKey, wdLongKey, studyWeek, parity, parityLabel,
  relDay, relDateTime, stamp, isWorkday, nextWorkday, addWorkdays, DAY_MS, MONTHS_GEN,
};
