'use strict';
// Автономная оценка каскада на фиксированных демо-данных, без сети и живой LLM.
// Запуск из любого каталога: node scripts/evaluate-assistant.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dgtu-assistant-evals-'));
process.env.DATA_DIR = tmp;
process.env.DB_FILE = path.join(tmp, 'eval.sqlite');
delete process.env.GIGACHAT_AUTH_KEY;
let blockedNetworkCalls = 0;
const denyNetwork = () => { blockedNetworkCalls++; throw new Error('Сеть отключена в оценке помощника'); };
global.fetch = denyNetwork;
for (const name of ['http', 'https']) {
  const transport = require(name);
  transport.request = denyNetwork;
  transport.get = denyNetwork;
}
const T = require('../src/time');
const FIXTURE_NOW = '2026-11-16T07:00:00.000Z';
T.setNow(FIXTURE_NOW);
const { open } = require('../src/db');
const { model } = require('../src/model');
const assistant = require('../src/assistant');

// Эталоны зафиксированы по src/seed.js, а не вычисляются функцией ответа.
// Проверяется смысл, маршрут и ограничения. Полное совпадение фразы не требуется.
const cases = [
  { id: 'anna-arithmetic-47', user: 'anna', question: 'Хватит ли финансового и маркетингового плана по бизнес-планированию, чтобы набрать порог 50?', expected: { source: 'calc', cascade: 'calc', includes: ['12 + 20 + 15 = 47', 'останется 3 балла'], excludes: ['212'] }, purpose: 'Регрессия: сумма 12 + 20 + 15 равна 47, до порога 50 остаётся 3.' },
  { id: 'ilya-gap-19', user: 'ilya', question: 'Сколько баллов не хватает по методам анализа в менеджменте?', expected: { source: 'calc', cascade: 'calc', includes: ['19'], excludes: ['Бизнес-планирование'], actionPrefix: '/study/session-support/' }, purpose: 'Данные второго студента: собственный недобор 19 и переход к разбору.' },
  { id: 'anna-monday-day', user: 'anna', question: 'Какие пары в понедельник?', expected: { source: 'calc', cascade: 'calc', includes: ['понедельник, 16 ноября', '9:00–10:35 Маркетинг', '10:45–12:20 Статистика', '13:20–14:55 Иностранный язык'], excludes: ['Методы анализа в менеджменте'], actionPrefix: '/study?d=2026-11-16' }, purpose: 'Три дневные пары Анны, без расписания Ильи.' },
  { id: 'ilya-monday-evening', user: 'ilya', question: 'Какие пары в понедельник?', expected: { source: 'calc', cascade: 'calc', includes: ['18:30–20:05 Методы анализа в менеджменте', '2-501'], excludes: ['9:00–10:35 Маркетинг'] }, purpose: 'Вечерняя пара Ильи отличается от дневного расписания Анны.' },
  { id: 'anna-record-average', user: 'anna', question: 'Какой у меня средний балл?', expected: { source: 'calc', cascade: 'calc', includes: ['4,45'], actionPrefix: '/study/record' }, purpose: 'Средний балл из вымышленной зачётной книжки Анны.' },
  { id: 'ilya-nir-42', user: 'ilya', question: 'Что с моей НИР, какой у меня балл?', expected: { source: 'calc', cascade: 'calc', includes: ['42 из 100', 'доработку'], actionPrefix: '/study/nir' }, purpose: 'Сумма этапов НИР 42 и состояние доработки.' },
  { id: 'ilya-tax-2025', user: 'ilya', question: 'Можно справку для вычета за 2025 год?', expected: { source: 'calc', cascade: 'calc', includes: ['96 000 ₽', '12 480 ₽'], actionPrefix: '/requests/new?type=tax' }, purpose: 'Демо-расчёт: 96 000 × 13% = 12 480; это не проверка налоговых правил.' },
  { id: 'anna-housing-rule', user: 'anna', question: 'Нужна справка для субсидии на ЖКУ', expected: { source: 'rules', cascade: 'decision', includes: ['обучении'], actionPrefix: '/requests/new?type=study' }, purpose: 'Уверенное правило обрабатывается веткой decision, без LLM.' },
  { id: 'anna-term-not-reversed', user: 'anna', question: 'Что такое академическая разница?', expected: { source: 'calc', cascade: 'calc', includes: ['которых не было в твоём прежнем учебном плане, но они есть в новом'], actionPrefix: '/me' }, purpose: 'Термин из фиксированного словаря. В текущем коде он помечен exact и идёт через calc.' },
  { id: 'anna-letter-no-send', user: 'anna', question: 'Как написать преподавателю о допуске?', expected: { source: 'calc', cascade: 'calc', includes: ['12 из 50', 'Не хватает 38', 'не отправляет'], excludes: ['письмо отправлено', '[дата]'], actionPattern: '^/study/session-support/\\d+#letter$' }, purpose: 'Верные числа и честное ограничение: письмо не отправляется из кабинета.' },
  { id: 'anna-schedule-english', user: 'anna', question: 'What classes do I have on Monday?', expected: { source: 'calc', cascade: 'calc', lang: 'en', includes: ['Monday, 16 November:', 'room 2-301'], actionPrefix: '/study?d=2026-11-16' }, purpose: 'Английский вопрос сохраняет точную ветку и ведёт к правильной дате.' },
  { id: 'ilya-free-question-fallback', user: 'ilya', question: 'Посоветуй роман для летних каникул', expected: { source: 'rules', cascade: 'fallback', lang: 'ru', includes: ['Пока не знаю, как помочь с этим'], excludes: ['я уже проверил', 'я отправил', 'я оформил'] }, purpose: 'Неизвестный свободный вопрос при отключённом ключе: явный запасной ответ, без обещания совершённого действия.' },
  { id: 'ilya-tax-unfinished-year', user: 'ilya', question: 'Можно справку за 2026 год?', expected: { source: 'calc', cascade: 'calc', includes: ['с января 2027'], excludesActionPrefix: '/requests/new?type=tax' }, purpose: 'Незакончившийся год не приводит к кнопке заказа справки.' },
  { id: 'anna-retrieval-sentinels', user: 'anna', question: 'Как оформить вычет?', kind: 'retrieval', expected: { excludes: ['987654321', 'SENTINEL-REQUEST-PRIVATE', 'SENTINEL-SUBJECT-PRIVATE'] }, purpose: 'Специальные значения баллов, платежа и заявки не попадают в автоматически собранные справочные блоки.' },
];

function dataFor(M, login) {
  const u = M.userByLogin(login), ds = M.disciplines(u.id);
  return { user: u, next: M.nextPair(u.group_name), disciplines: ds, session: M.session(u.id, ds), requests: M.requestsOf(u.id), payments: M.payments(u.id), stipends: M.stipends(u.id), book: M.recordBook(u.id), nir: u.level === 'магистратура' ? M.nir(u.id) : [], dayPairs: (key) => M.dayPairs(u.group_name, key), plan: M.studyPlan(u.id), nextSlot: M.nextStudySlot(u.id) };
}
function check(result, expected) {
  for (const key of ['source', 'cascade', 'lang']) if (expected[key]) assert.equal(result[key], expected[key], key);
  for (const term of expected.includes || []) assert.ok(result.text.includes(term), `нет ожидаемого фрагмента: ${term}`);
  for (const term of expected.excludes || []) assert.ok(!result.text.toLowerCase().includes(term.toLowerCase()), `есть запрещённый фрагмент: ${term}`);
  const actions = result.actions || [];
  if (expected.actionPrefix) assert.ok(actions.some((a) => a.href.startsWith(expected.actionPrefix)), 'нет ожидаемого перехода');
  if (expected.actionPattern) assert.ok(actions.some((a) => new RegExp(expected.actionPattern).test(a.href)), 'нет перехода по шаблону');
  if (expected.excludesActionPrefix) assert.ok(!actions.some((a) => a.href.startsWith(expected.excludesActionPrefix)), 'есть запрещённый переход');
}

(async () => {
  let db; const results = [];
  try {
    assert.equal(assistant.enabled(), false, 'GigaChat должен быть отключён');
    db = open(); const M = model(db);
    for (const c of cases) {
      let actual;
      try {
        const data = dataFor(M, c.user);
        if (c.kind === 'retrieval') {
          data.disciplines = [{ subject: 'SENTINEL-SUBJECT-PRIVATE', points: 987654321 }];
          data.payments = [{ amount: 987654321 }];
          data.requests = [{ number: 'SENTINEL-REQUEST-PRIVATE', status: 'in_work' }];
          const blocks = assistant.retrieveFacts(c.question, data);
          actual = { source: 'retrieval', cascade: 'retrieval', text: blocks.map((b) => b.text).join('\n'), blockIds: blocks.map((b) => b.id), actions: [] };
          assert.ok(actual.blockIds.includes('tax'), 'нет тематического справочного блока');
        } else actual = await assistant.answer(c.question, [], data);
        check(actual, c.expected);
        results.push({ ...c, passed: true, actual });
      } catch (e) { results.push({ ...c, passed: false, actual: actual || null, failure: e.message }); }
    }
    assert.equal(blockedNetworkCalls, 0, 'попыток обращения к сети быть не должно');
  } finally {
    if (db) db.close();
    T.setNow(null);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const passed = results.filter((r) => r.passed).length;
  const distribution = results.reduce((a, r) => { const branch = r.actual?.cascade || 'error'; a[branch] = (a[branch] || 0) + 1; return a; }, {});
  const report = { schemaVersion: 1, fixtureNow: FIXTURE_NOW, scope: 'Детерминированный каскад и fallback без GigaChat. Качество ответов живой LLM не оценивалось.', method: 'Изолированная seeded SQLite; прямой вызов answer с теми же полями модели данных, что и API; фиксация московской даты; запрещены http, https и fetch.', groundTruth: 'Числа, расписание и ожидаемые действия зафиксированы по вымышленным данным src/seed.js; арифметика 12+20+15=47 и демо-расчёт 96000×0.13=12480 заданы независимо от кода ответа. Устойчивые смысловые фрагменты и инварианты вместо полного совпадения текста.', total: results.length, passed, failed: results.length - passed, branchDistribution: distribution, blockedNetworkCalls, temporaryDatabaseRemoved: !fs.existsSync(tmp), results };
  fs.writeFileSync(path.join(ROOT, 'docs/assistant-evals.json'), JSON.stringify(report, null, 2) + '\n');
  const rows = results.map((r) => `| ${r.id} | ${r.user} | ${r.actual?.cascade || 'error'} | ${r.passed ? 'Пройден' : 'Ошибка: ' + r.failure} | ${r.purpose} |`);
  fs.writeFileSync(path.join(ROOT, 'docs/assistant-evals.md'), [
    '# Воспроизводимая оценка помощника', '',
    `Результат: **${passed}/${results.length}**, ошибок: **${results.length - passed}**. Это результат на фиксированном наборе, а не оценка качества всех возможных вопросов.`, '',
    'Запуск: `node scripts/evaluate-assistant.js`. Нужны зависимости приложения (`npm ci`) и Node.js 22. Отчёты пересоздаются локально.', '',
    '## Метод', '', report.method, '', report.groundTruth, '',
    `Время демо-данных зафиксировано: ${FIXTURE_NOW} (16 ноября 2026, 10:00 МСК). При изменении seed ожидаемые данные нужно пересмотреть явно; они не выводятся из проверяемой функции.`, '',
    'Ключ GigaChat удаляется до загрузки модулей; сетевые функции заменены запретом. Попыток сети: ' + blockedNetworkCalls + '. Временная БД удалена: ' + (report.temporaryDatabaseRemoved ? 'да' : 'нет') + '.', '',
    '## Результаты', '',
    '| Случай | Студент | Ветка | Статус | Что проверяется |', '|---|---|---|---|---|', ...rows, '',
    'Распределение проверок: ' + Object.entries(distribution).map(([k, v]) => `${k} — ${v}`).join('; ') + '.', '',
    '## Что означают ветки', '',
    '- `calc`: точный ответ программы. В текущей реализации сюда также попадает фиксированный словарь терминов (`exact`), а не только арифметика.',
    '- `decision`: уверенное правило для известной ситуации; текст не переписывается моделью.',
    '- `fallback`: свободный вопрос без доступной LLM получает запасной ответ.',
    '- `retrieval`: отдельная проверка автоматической подборки справочных блоков. Это не ответ модели.', '',
    '## Границы проверки', '',
    'Живой GigaChat и ветка `llm` не запускались. Эти 14 случаев не доказывают качество свободных генеративных ответов, устойчивость ко всем формулировкам, нагрузке или prompt injection. Для живой LLM нужен отдельный набор и ручная оценка с подключённым API.', '',
    'Прямой вызов `answer` не проверяет авторизацию HTTP API и интерфейс. Эти слои проверяются существующими автотестами приложения и отдельными браузерными прогонами. Набор дополняет их, а не заменяет.', '',
    'Проверка retrieval показывает, что специальные значения из структурированных записей не включаются автоматически. Она не означает обезличивание текста вопроса: введённое пользователем содержание может попасть в LLM в рабочем режиме.', '',
    'Полные ожидаемые условия, ответы, переходы и статус каждого случая: `docs/assistant-evals.json`.', '',
  ].join('\n'));
  console.log(JSON.stringify({ total: report.total, passed, failed: report.failed, branches: distribution, blockedNetworkCalls, temporaryDatabaseRemoved: report.temporaryDatabaseRemoved }));
  process.exitCode = report.failed ? 1 : 0;
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
