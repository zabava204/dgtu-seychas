'use strict';
// Демо-данные. Все люди, группы, оценки и заявки вымышленные.
const bcrypt = require('bcryptjs');
const T = require('./time');
const { estimateEta } = require('./catalog');
const { DEMO_INN } = require('./tax');

const DEMO_PASSWORD = 'demo2026';
const FACULTY = 'Менеджмент и бизнес';

function seed(db) {
  const now = T.now();
  const today = T.dateKey(now);
  const iso = (d) => new Date(d).toISOString();
  const ago = (h) => iso(now.getTime() - h * 3600e3);
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 8);
  const yymm = today.slice(2, 4) + today.slice(5, 7);
  const num = (n) => `${yymm}-${String(n).padStart(3, '0')}`;

  const insUser = db.prepare(`INSERT INTO users (login, pass_hash, role, full_name, short_name, name_dat, first_name, gender,
    group_name, course, level, program, faculty, form, funding, record_book, curator, position, demo_note)
    VALUES (@login, @pass_hash, @role, @full_name, @short_name, @name_dat, @first_name, @gender, @group_name, @course, @level,
    @program, @faculty, @form, @funding, @record_book, @curator, @position, @demo_note)`);
  const user = (u) => insUser.run({
    login: null, pass_hash: null, name_dat: null, first_name: null, gender: null, group_name: null, course: null, level: null,
    program: null, faculty: FACULTY, form: null, funding: null, record_book: null, curator: null, position: null, demo_note: null, ...u,
  }).lastInsertRowid;

  const anna = user({
    login: 'anna', pass_hash: hash, role: 'student', full_name: 'Орлова Анна Сергеевна', short_name: 'Анна Орлова',
    name_dat: 'Орловой Анне Сергеевне', first_name: 'Анна', gender: 'f', group_name: 'МН-31', course: 3, level: 'бакалавриат',
    program: '38.03.02 Менеджмент', form: 'очная', funding: 'бюджет', record_book: '23-0471', curator: 'Петрова И. В.',
    demo_note: 'бакалавр · 3 курс · дневные пары',
  });
  const ilya = user({
    login: 'ilya', pass_hash: hash, role: 'student', full_name: 'Смирнов Илья Андреевич', short_name: 'Илья Смирнов',
    name_dat: 'Смирнову Илье Андреевичу', first_name: 'Илья', gender: 'm', group_name: 'ММН-21', course: 2, level: 'магистратура',
    program: '38.04.02 Менеджмент', form: 'очно-заочная', funding: 'контракт', record_book: '25-1186', curator: 'Ким А. С.',
    demo_note: 'магистрант · 2 курс, контракт · вечерние пары, НИР',
  });
  const staff = user({
    login: 'dekanat', pass_hash: hash, role: 'staff', full_name: 'Соколова Елена Викторовна', short_name: 'Соколова Е. В.',
    first_name: 'Елена', gender: 'f', position: 'специалист деканата', demo_note: 'обработка заявок',
  });
  // Студенты без входа — чтобы очередь деканата была живой
  const others = {
    petrov: user({ role: 'student', full_name: 'Петров Денис Олегович', short_name: 'Денис Петров', name_dat: 'Петрову Денису Олеговичу', gender: 'm', group_name: 'МН-32', course: 3, level: 'бакалавриат', program: '38.03.02 Менеджмент', form: 'очная', funding: 'бюджет', record_book: '23-0518' }),
    kim: user({ role: 'student', full_name: 'Ким Лиана Робертовна', short_name: 'Лиана Ким', name_dat: 'Ким Лиане Робертовне', gender: 'f', group_name: 'МН-21', course: 2, level: 'бакалавриат', program: '38.03.02 Менеджмент', form: 'очная', funding: 'бюджет', record_book: '24-0233' }),
    volkova: user({ role: 'student', full_name: 'Волкова Мария Игоревна', short_name: 'Мария Волкова', name_dat: 'Волковой Марии Игоревне', gender: 'f', group_name: 'ММН-11', course: 1, level: 'магистратура', program: '38.04.02 Менеджмент', form: 'очно-заочная', funding: 'бюджет', record_book: '25-1190' }),
    guseynov: user({ role: 'student', full_name: 'Гусейнов Тимур Рашидович', short_name: 'Тимур Гусейнов', name_dat: 'Гусейнову Тимуру Рашидовичу', gender: 'm', group_name: 'МН-41', course: 4, level: 'бакалавриат', program: '38.03.02 Менеджмент', form: 'очная', funding: 'контракт', record_book: '22-0391' }),
  };

  // ---------- Расписание (шаблон недели) ----------
  const insS = db.prepare('INSERT INTO schedule (group_name, weekday, parity, start, end, subject, kind, room, teacher, online) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const S = (g, wd, par, st, en, subj, kind, room, teacher, online = 0) => insS.run(g, wd, par, st, en, subj, kind, room, teacher, online).lastInsertRowid;
  const P1 = ['9:00', '10:35'], P2 = ['10:45', '12:20'], P3 = ['13:20', '14:55'], P4 = ['15:05', '16:40'];
  S('МН-31', 1, 'all', ...P1, 'Маркетинг', 'лекция', '2-301', 'Белова Е. Н.');
  S('МН-31', 1, 'all', ...P2, 'Статистика', 'практика', '3-215', 'Гаврилов П. Р.');
  S('МН-31', 1, 'all', ...P3, 'Иностранный язык', 'практика', '8-410', 'Морозова Т. А.');
  const econTue = S('МН-31', 2, 'all', ...P1, 'Экономика организации', 'лекция', '8-202', 'Соколов Д. А.');
  S('МН-31', 2, 'all', ...P2, 'Управление персоналом', 'практика', '1-310', 'Лебедева О. В.');
  S('МН-31', 2, 'num', ...P3, 'Финансовый менеджмент', 'лекция', '2-110', 'Карпов В. И.');
  S('МН-31', 3, 'all', ...P2, 'Бизнес-планирование', 'практика', '3-401', 'Белова Е. Н.');
  S('МН-31', 3, 'all', ...P3, 'Статистика', 'лекция', '1-220', 'Гаврилов П. Р.');
  S('МН-31', 3, 'den', ...P4, 'Физическая культура', 'практика', 'спорткомплекс', 'Орехов С. С.');
  S('МН-31', 4, 'all', ...P1, 'Маркетинг', 'практика', '2-305', 'Белова Е. Н.');
  S('МН-31', 4, 'all', ...P2, 'Финансовый менеджмент', 'практика', '2-112', 'Карпов В. И.');
  S('МН-31', 5, 'all', ...P1, 'Бизнес-планирование', 'лекция', '1-118', 'Белова Е. Н.');
  S('МН-31', 5, 'all', ...P2, 'Экономика организации', 'практика', '8-206', 'Соколов Д. А.');
  S('МН-31', 5, 'num', ...P3, 'Иностранный язык', 'практика', '8-410', 'Морозова Т. А.');

  S('ММН-21', 1, 'all', '18:30', '20:05', 'Методы анализа в менеджменте', 'лекция', '2-501', 'Белова Е. Н.');
  S('ММН-21', 2, 'all', '18:30', '20:05', 'Иностранный язык в профессиональной сфере', 'практика', '8-305', 'Морозова Т. А.');
  S('ММН-21', 3, 'all', '18:30', '20:05', 'Финансовый анализ', 'лекция', '2-118', 'Карпов В. И.');
  const innovThu = S('ММН-21', 4, 'all', '18:00', '19:35', 'Инновационные подходы к принятию решений', 'практика', '2-318', 'Соколов Д. А.');
  S('ММН-21', 6, 'all', '10:15', '11:50', 'Методы анализа в менеджменте', 'практика', null, 'Белова Е. Н.', 1);

  // Изменения: ближайшая «Экономика организации» во вторник — другая аудитория; у Ильи перенос в четверг
  const nextOn = (wd, endMin) => {
    for (let i = 0; i < 8; i++) {
      const k = T.addDays(today, i);
      if (T.weekdayOfKey(k) === wd && (i > 0 || T.minutesOfDay(now) < endMin)) return k;
    }
  };
  const insC = db.prepare('INSERT INTO schedule_changes (schedule_id, date_key, new_room, new_start, new_end, created_at) VALUES (?,?,?,?,?,?)');
  insC.run(econTue, nextOn(2, T.parseHHMM('10:35')), '1-405', null, null, ago(2.5));
  insC.run(innovThu, nextOn(4, T.parseHHMM('21:05')), '2-501', '19:30', '21:05', ago(17));

  // ---------- Успеваемость ----------
  const insD = db.prepare('INSERT INTO disciplines (student_id, subject, teacher, control, pass_threshold, auto_threshold, closed_text, updated_at) VALUES (?,?,?,?,?,?,?,?)');
  const insW = db.prepare('INSERT INTO works (discipline_id, title, max, score, due_key) VALUES (?,?,?,?,?)');
  const D = (sid, subj, teacher, control, pass, auto, closed, works) => {
    const id = insD.run(sid, subj, teacher, control, pass, auto, closed, ago(3)).lastInsertRowid;
    for (const [title, max, score, dueIn] of works) insW.run(id, title, max, score, dueIn == null ? null : T.addDays(today, dueIn));
  };
  D(anna, 'Экономика организации', 'Соколов Д. А.', 'экзамен', 50, null, null, [['Контрольная 1', 20, 17, null], ['Кейс', 20, 16, null], ['Тест', 10, 9, null], ['Контрольная 2', 20, 17, null], ['Расчётная работа', 30, null, 16]]);
  D(anna, 'Маркетинг', 'Белова Е. Н.', 'зачёт', 50, null, null, [['Тест 1', 10, 9, null], ['Анализ рынка', 20, 18, null], ['Тест 2', 10, 9, null], ['Кейс', 15, 14, null], ['Реферат', 20, null, 2], ['Проект', 25, null, 24]]);
  D(anna, 'Статистика', 'Гаврилов П. Р.', 'зачёт', 50, null, null, [['Практикум 1', 15, 12, null], ['Практикум 2', 15, 11, null], ['Контрольная', 20, 13, null], ['Практикум 3', 15, 8, null], ['Итоговый тест', 35, null, 30]]);
  D(anna, 'Бизнес-планирование', 'Белова Е. Н.', 'экзамен', 50, null, null, [['Идея и рынок', 15, 12, null], ['Финансовый план', 20, null, -3], ['Маркетинговый план', 15, null, -1], ['Защита', 50, null, 33]]);
  D(anna, 'Управление персоналом', 'Лебедева О. В.', 'зачёт', 50, null, null, [['Кейс 1', 20, 18, null], ['Кейс 2', 20, 17, null], ['Тест', 20, 18, null], ['Эссе', 20, 18, null], ['Итог', 20, null, 28]]);
  D(anna, 'Иностранный язык', 'Морозова Т. А.', 'зачёт', 50, null, null, [['Модуль 1', 25, 21, null], ['Модуль 2', 25, 20, null], ['Модуль 3', 25, 19, null], ['Итог', 25, null, 30]]);

  D(ilya, 'Методы анализа в менеджменте', 'Белова Е. Н.', 'зачёт', 50, null, null, [['Работа 1', 10, 8, null], ['Работа 2', 10, 7, null], ['Работа 3', 10, null, -6], ['Работа 4', 10, null, -2], ['Проект', 40, 16, null], ['Итог', 20, null, 21]]);
  D(ilya, 'Иностранный язык в профессиональной сфере', 'Морозова Т. А.', 'зачёт', 50, null, null, [['Модуль 1', 25, 19, null], ['Модуль 2', 25, 18, null], ['Аннотация статьи', 15, 15, null], ['Эссе', 15, null, 8], ['Итог', 20, null, 30]]);
  D(ilya, 'Инновационные подходы к принятию решений', 'Соколов Д. А.', 'экзамен', 50, 80, null, [['Кейс 1', 25, 22, null], ['Кейс 2', 25, 21, null], ['Командный проект', 30, 23, null], ['Доклад', 20, 8, null]]);
  D(ilya, 'Финансовый анализ', 'Карпов В. И.', 'зачёт', 50, null, 'Зачтено досрочно', [['Все работы', 100, 86, null]]);

  // НИР магистранта
  const insN = db.prepare('INSERT INTO nir_stages (student_id, ord, title, max, score, state, note, due_key) VALUES (?,?,?,?,?,?,?,?)');
  insN.run(ilya, 1, 'Планирование', 10, 10, 'signed', null, null);
  insN.run(ilya, 2, 'Библиография', 10, 10, 'signed', null, null);
  insN.run(ilya, 3, 'Научный поиск', 30, 22, 'returned', 'Руководитель: «Уточните цель и гипотезу во введении»', T.addDays(today, 6));
  insN.run(ilya, 4, 'Апробация', 30, null, 'todo', 'Доклад на семинаре кафедры — нужно загрузить презентацию', T.addDays(today, 9));
  insN.run(ilya, 5, 'Отчёт', 20, null, 'todo', 'Черновик готов', T.addDays(today, 40));

  // Задачи с дедлайнами
  const insT = db.prepare('INSERT INTO tasks (student_id, title, due_at, note) VALUES (?,?,?,?)');
  insT.run(anna, 'Реферат по маркетингу', iso(T.at(T.addDays(today, 2), 23 * 60 + 59)), 'Сдать в Moodle');
  insT.run(ilya, 'Эссе по иностранному языку', iso(T.at(T.addDays(today, 8), 23 * 60 + 59)), '+15 баллов');
  insT.run(ilya, 'Презентация для апробации НИР', iso(T.at(T.addDays(today, 9), 18 * 60)), 'Семинар кафедры');

  // ---------- Заявки ----------
  const insR = db.prepare(`INSERT INTO requests (number, student_id, type, purpose, details, format, status, needs_text, assignee_id,
    created_at, submitted_at, taken_at, closed_at, eta_at) VALUES (@number, @student_id, @type, @purpose, @details, @format, @status,
    @needs_text, @assignee_id, @created_at, @submitted_at, @taken_at, @closed_at, @eta_at)`);
  const insE = db.prepare('INSERT INTO events (request_id, at, actor_id, kind, text) VALUES (?,?,?,?,?)');
  const insF = db.prepare('INSERT INTO request_files (request_id, name, stored, mime, size, uploaded_at, uploaded_by) VALUES (?,?,?,?,?,?,?)');
  const R = (r, events) => {
    const id = insR.run({ purpose: null, details: null, format: null, needs_text: null, assignee_id: null, submitted_at: null, taken_at: null, closed_at: null, eta_at: null, ...r }).lastInsertRowid;
    for (const [at, actor, kind, text] of events) insE.run(id, at, actor, kind, text || null);
    return id;
  };

  // Анна
  R({ number: num(7), student_id: anna, type: 'study', purpose: 'employer', format: 'pdf', status: 'ready', assignee_id: staff,
    created_at: ago(14 * 24 + 2), submitted_at: ago(14 * 24 + 2), taken_at: ago(14 * 24 + 1.6), closed_at: ago(14 * 24 - 3), eta_at: ago(14 * 24 - 5) },
  [[ago(14 * 24 + 2), anna, 'submitted'], [ago(14 * 24 + 1.6), staff, 'taken'], [ago(14 * 24 - 3), staff, 'ready']]);
  R({ number: num(31), student_id: anna, type: 'aid', purpose: 'Сложная семейная ситуация', details: 'Подаю впервые.', status: 'need_student',
    needs_text: 'Загрузи справку о составе семьи (не старше 30 дней)', assignee_id: staff,
    created_at: ago(3 * 24 + 1), submitted_at: ago(3 * 24 + 1), taken_at: ago(2 * 24 + 3), eta_at: null },
  [[ago(3 * 24 + 1), anna, 'submitted'], [ago(2 * 24 + 3), staff, 'taken'], [ago(2 * 24 + 2.9), staff, 'need_doc', 'Загрузи справку о составе семьи (не старше 30 дней)']]);
  const r48taken = ago(19);
  R({ number: num(48), student_id: anna, type: 'study', purpose: 'social', format: 'pdf', status: 'in_work', assignee_id: staff,
    created_at: ago(20), submitted_at: ago(20), taken_at: r48taken, eta_at: iso(T.at(T.addWorkdays(today, 1), 15 * 60)) },
  [[ago(20), anna, 'submitted'], [r48taken, staff, 'taken']]);
  R({ number: 'draft-' + anna, student_id: anna, type: 'study', purpose: 'transport', format: 'pdf', status: 'draft', created_at: ago(1) }, []);

  // Илья
  R({ number: num(51), student_id: ilya, type: 'visa', details: 'Сербия, 2–9 января', format: 'pdf', status: 'submitted',
    created_at: ago(3), submitted_at: ago(3), eta_at: iso(estimateEta('visa', 'pdf', new Date(ago(3)))) }, [[ago(3), ilya, 'submitted']]);

  // Оплата обучения Ильи по договору (для справки на вычет) и черновик заявки
  // Илья поступил в прошлом году: справку можно заказать только за закончившийся год,
  // оплаты текущего года войдут в справку после 1 января.
  const curYear = Number(today.slice(0, 4)); const prevYear = curYear - 1;
  const contract = `Д-${prevYear}/1186`;
  const insP = db.prepare('INSERT INTO payments (student_id, contract, paid_on, amount, payer, note) VALUES (?,?,?,?,?,?)');
  const pay = (date, amount, note) => { if (date <= today) insP.run(ilya, contract, date, amount, 'Смирнов Илья Андреевич', note); };
  pay(`${prevYear}-08-20`, 48000, '1 семестр, часть 1');
  pay(`${prevYear}-10-15`, 48000, '1 семестр, часть 2');
  pay(`${curYear}-02-10`, 96000, '2 семестр');
  pay(`${curYear}-08-20`, 48000, '3 семестр, часть 1');
  pay(`${curYear}-10-15`, 48000, '3 семестр, часть 2');
  R({ number: 'draft-' + ilya, student_id: ilya, type: 'tax', purpose: String(prevYear), details: DEMO_INN, format: 'pdf', status: 'draft', created_at: ago(1) }, []);

  // Другие студенты
  R({ number: num(33), student_id: others.kim, type: 'aid', purpose: 'Студенческая семья', details: 'Рождение ребёнка в октябре.', status: 'in_work',
    assignee_id: staff, created_at: ago(50), submitted_at: ago(50), taken_at: ago(26), eta_at: iso(T.at(T.addWorkdays(today, 3), 15 * 60)) },
  [[ago(50), others.kim, 'submitted'], [ago(26), staff, 'taken']]);
  const kimReq = db.prepare('SELECT id FROM requests WHERE number = ?').get(num(33)).id;
  insF.run(kimReq, 'справка_о_составе_семьи.pdf', 'demo-sample.pdf', 'application/pdf', 1200, ago(50), others.kim);
  R({ number: num(44), student_id: others.volkova, type: 'visa', details: 'Турция, 28 декабря – 5 января', format: 'pdf', status: 'ready', assignee_id: staff,
    created_at: ago(5 * 24), submitted_at: ago(5 * 24), taken_at: ago(4 * 24), closed_at: ago(2 * 24), eta_at: ago(2 * 24) },
  [[ago(5 * 24), others.volkova, 'submitted'], [ago(4 * 24), staff, 'taken'], [ago(2 * 24), staff, 'ready']]);
  R({ number: num(49), student_id: others.petrov, type: 'study', purpose: 'other', details: 'Для спортивной секции', format: 'paper', status: 'submitted',
    created_at: ago(2), submitted_at: ago(2), eta_at: iso(estimateEta('study', 'paper', new Date(ago(2)))) }, [[ago(2), others.petrov, 'submitted']]);
  R({ number: num(50), student_id: others.guseynov, type: 'study', purpose: 'employer', format: 'pdf', status: 'submitted',
    created_at: ago(0.5), submitted_at: ago(0.5), eta_at: iso(estimateEta('study', 'pdf', new Date(ago(0.5)))) }, [[ago(0.5), others.guseynov, 'submitted']]);

  db.prepare('INSERT INTO counters (name, value) VALUES (?, ?)').run('request_' + yymm, 51);

  // ---------- Уведомления ----------
  const insNt = db.prepare('INSERT INTO notifications (user_id, at, category, title, body, link, read) VALUES (?,?,?,?,?,?,?)');
  const tueKey = nextOn(2, T.parseHHMM('10:35'));
  insNt.run(anna, ago(2.5), 'schedule', 'Экономика организации — ауд. 1-405', `${T.dayMonthKey(tueKey)}, 9:00. Было: 8-202, время прежнее.`, '/study', 0);
  insNt.run(anna, ago(19), 'requests', `Справка в соцзащиту взята в работу`, `Заявка № ${num(48)}. Ожидаемый срок — ${T.relDateTime(T.at(T.addWorkdays(today, 1), 15 * 60))}.`, '/requests', 0);
  insNt.run(anna, ago(2 * 24 + 2.9), 'requests', 'Матпомощь: нужен документ', `Заявка № ${num(31)}: загрузи справку о составе семьи.`, '/requests', 1);
  insNt.run(anna, ago(4 * 24), 'announcements', 'Приём заявлений на материальную помощь', 'До 30 ноября. Условия и список документов — в разделе «Заявки».', '/requests/new?type=aid', 1);
  insNt.run(ilya, ago(17), 'schedule', 'Инновационные подходы — перенос', `Четверг: 19:30–21:05, ауд. 2-501. Было: 18:00, ауд. 2-318.`, '/study', 0);
  insNt.run(ilya, ago(26), 'announcements', 'Справки для налогового вычета — онлайн', 'Справку об оплате обучения для налоговой теперь можно заказать в «Заявках».', '/requests/new?type=tax', 0);
  insNt.run(ilya, ago(30), 'grades', 'НИР: этап «Научный поиск» вернули на доработку', 'Смотри комментарий руководителя.', '/study/nir', 0);

  // Настройки уведомлений по умолчанию
  const insSet = db.prepare('INSERT INTO settings (user_id, key, value) VALUES (?,?,?)');
  for (const uid of [anna, ilya]) {
    for (const [k, v] of [['notif_schedule', '1'], ['notif_requests', '1'], ['notif_deadlines', '1'], ['notif_announcements', '0'], ['notif_grades', '0']]) insSet.run(uid, k, v);
  }
}

module.exports = { seed, DEMO_PASSWORD };
