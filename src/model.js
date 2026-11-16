'use strict';
const T = require('./time');
const { TYPES, requestTitle, estimateEta } = require('./catalog');

const NOTIF_CATEGORIES = [
  { key: 'schedule', title: 'Изменения расписания', hint: 'Перенос, отмена, другая аудитория' },
  { key: 'requests', title: 'Мои заявки', hint: 'Когда нужно твоё действие и когда готово' },
  { key: 'deadlines', title: 'Сроки сдачи', hint: 'За 2 дня и в день сдачи, не позже 21:00' },
  { key: 'announcements', title: 'Объявления деканата', hint: 'Важные новости факультета' },
  { key: 'grades', title: 'Новые оценки', hint: 'Только факт: «выставлена оценка по предмету»' },
];

const STATUS = {
  draft: 'Черновик',
  submitted: 'Ждёт обработки в деканате',
  in_work: 'В обработке',
  need_student: 'Нужно твоё действие',
  ready: 'Готова',
  rejected: 'Отклонена',
};

function model(db) {
  const q = (sql) => db.prepare(sql);
  const iso = (d = T.now()) => new Date(d).toISOString();

  const m = {
    db,
    user: (id) => q('SELECT * FROM users WHERE id = ?').get(id),
    userByLogin: (login) => q('SELECT * FROM users WHERE login = ?').get(String(login || '').trim().toLowerCase()),
    demoUsers: () => q("SELECT id, login, short_name, role, demo_note FROM users WHERE login IS NOT NULL ORDER BY role DESC, id").all(),

    // ---------- Расписание ----------
    dayPairs(group, key) {
      const wd = T.weekdayOfKey(key);
      const par = T.parity(key);
      const rows = q("SELECT * FROM schedule WHERE group_name = ? AND weekday = ? AND (parity = 'all' OR parity = ?)").all(group, wd, par);
      const changes = q('SELECT * FROM schedule_changes WHERE date_key = ?').all(key);
      const out = [];
      for (const r of rows) {
        const ch = changes.find((c) => c.schedule_id === r.id);
        if (ch && ch.cancelled) { out.push({ ...r, cancelled: true, change: ch }); continue; }
        const p = { ...r, date_key: key, change: ch || null };
        if (ch) {
          p.old_room = ch.new_room ? r.room : null;
          p.old_start = ch.new_start ? r.start : null;
          if (ch.new_room) p.room = ch.new_room;
          if (ch.new_start) { p.start = ch.new_start; p.end = ch.new_end || r.end; }
        }
        out.push(p);
      }
      return out.sort((a, b) => T.parseHHMM(a.start) - T.parseHHMM(b.start));
    },
    // Ближайшая пара (идущая сейчас или следующая), до 14 дней вперёд
    nextPair(group, at = T.now()) {
      const today = T.dateKey(at);
      const min = T.minutesOfDay(at);
      for (let i = 0; i < 14; i++) {
        const key = T.addDays(today, i);
        const pairs = m.dayPairs(group, key).filter((p) => !p.cancelled);
        const p = pairs.find((x) => i > 0 || T.parseHHMM(x.end) > min);
        if (p) return { ...p, startsAt: T.at(key, T.parseHHMM(p.start)), endsAt: T.at(key, T.parseHHMM(p.end)), dayPairs: pairs };
      }
      return null;
    },

    // ---------- Успеваемость ----------
    disciplines(studentId) {
      const ds = q('SELECT * FROM disciplines WHERE student_id = ? ORDER BY id').all(studentId);
      const today = T.dateKey();
      return ds.map((d) => {
        const works = q('SELECT * FROM works WHERE discipline_id = ? ORDER BY id').all(d.id);
        const points = works.reduce((s, w) => s + (w.score || 0), 0);
        const open = works.filter((w) => w.score == null);
        const overdue = open.filter((w) => w.due_key && w.due_key < today);
        const upcoming = open.filter((w) => w.due_key && w.due_key >= today).sort((a, b) => a.due_key.localeCompare(b.due_key));
        const gap = Math.max(0, d.pass_threshold - points);
        let light = 'green';
        if (d.closed_text) light = 'done';
        else if (overdue.length || gap > 10) light = gap > 0 ? 'red' : 'amber';
        else if (gap > 0) light = 'amber';
        const autoGap = d.auto_threshold ? Math.max(0, d.auto_threshold - points) : null;
        const overdueMax = overdue.reduce((s, w) => s + w.max, 0);
        return { ...d, works, points, gap, light, overdue, upcoming, autoGap, overdueMax, afterOverdue: gap - overdueMax };
      });
    },
    // ---------- Сессия ----------
    // Допуск — демо-правило концепта: набран порог текущих баллов по дисциплине
    session(studentId, ds = m.disciplines(studentId)) {
      return q('SELECT * FROM session_items WHERE student_id = ? ORDER BY date_key, start').all(studentId).map((s) => {
        const d = ds.find((x) => x.id === s.discipline_id) || null;
        const admitted = d ? d.gap === 0 : null;
        return { ...s, d, admitted, gap: d ? d.gap : null };
      });
    },
    sessionOn: (studentId, key) => q('SELECT * FROM session_items WHERE student_id = ? AND date_key = ? ORDER BY start').all(studentId, key),
    recordBook(studentId) {
      const rows = q('SELECT * FROM record_book WHERE student_id = ? ORDER BY semester DESC, id').all(studentId);
      const sems = [];
      for (const r of rows) { let s = sems.find((x) => x.semester === r.semester); if (!s) sems.push(s = { semester: r.semester, rows: [] }); s.rows.push(r); }
      const score = { отлично: 5, хорошо: 4, удовлетворительно: 3 };
      const graded = rows.filter((r) => score[r.mark]);
      const avg = graded.length ? graded.reduce((s, r) => s + score[r.mark], 0) / graded.length : null;
      const debts = rows.filter((r) => r.mark === 'не явился' || r.mark === 'неудовлетворительно' || r.mark === 'не зачтено').length;
      return { sems, avg, total: rows.length, debts };
    },
    nir: (studentId) => q('SELECT * FROM nir_stages WHERE student_id = ? ORDER BY ord').all(studentId),
    stipends: (studentId) => q('SELECT * FROM stipends WHERE student_id = ? ORDER BY month').all(studentId),
    payments: (studentId) => q('SELECT * FROM payments WHERE student_id = ? ORDER BY paid_on').all(studentId),
    tasks: (studentId) => q('SELECT * FROM tasks WHERE student_id = ? AND due_at >= ? ORDER BY due_at').all(studentId, iso()),

    // План подготовки: один активный на студента. Отметка «сделано» живёт только здесь.
    studyPlan(studentId) {
      const plan = q('SELECT * FROM study_plans WHERE student_id = ? ORDER BY id DESC').get(studentId);
      if (!plan) return null;
      plan.slots = q('SELECT * FROM study_slots WHERE plan_id = ? ORDER BY date_key, start_min').all(plan.id);
      return plan;
    },
    replaceStudyPlan(studentId, plan, slots) {
      const tx = db.transaction(() => {
        const old = q('SELECT id FROM study_plans WHERE student_id = ?').all(studentId);
        for (const o of old) q('DELETE FROM study_slots WHERE plan_id = ?').run(o.id);
        q('DELETE FROM study_plans WHERE student_id = ?').run(studentId);
        const id = q('INSERT INTO study_plans (student_id, minutes, part, created_at) VALUES (?,?,?,?)').run(studentId, plan.minutes, plan.part, iso()).lastInsertRowid;
        const ins = q(`INSERT INTO study_slots (plan_id, student_id, discipline_id, kind, title, detail, date_key, start_min, end_min, done)
          VALUES (?,?,?,?,?,?,?,?,?,0)`);
        for (const s of slots) ins.run(id, studentId, s.discipline_id, s.kind, s.title, s.detail, s.date_key, s.start_min, s.end_min);
        return id;
      });
      return tx();
    },
    toggleStudySlot(studentId, slotId) {
      const s = q('SELECT * FROM study_slots WHERE id = ? AND student_id = ?').get(Number(slotId), studentId);
      if (!s) return null;
      q('UPDATE study_slots SET done = ? WHERE id = ?').run(s.done ? 0 : 1, s.id);
      return true;
    },
    nextStudySlot(studentId) {
      const plan = m.studyPlan(studentId);
      if (!plan) return null;
      const key = T.dateKey();
      const min = T.minutesOfDay();
      return plan.slots.find((s) => !s.done && (s.date_key > key || (s.date_key === key && s.end_min > min))) || null;
    },

    // ---------- Заявки ----------
    requestsOf(studentId) {
      return q("SELECT * FROM requests WHERE student_id = ? ORDER BY COALESCE(submitted_at, created_at) DESC").all(studentId).map(m.decorate);
    },
    decorate(r) {
      if (!r) return r;
      return { ...r, title: requestTitle(r), statusText: STATUS[r.status], assignee: r.assignee_id ? m.user(r.assignee_id) : null };
    },
    request: (id) => m.decorate(q('SELECT * FROM requests WHERE id = ?').get(id)),
    draftOf: (studentId) => m.decorate(q("SELECT * FROM requests WHERE student_id = ? AND status = 'draft' ORDER BY id DESC").get(studentId)),
    events: (rid) => q('SELECT e.*, u.short_name AS actor_name, u.role AS actor_role FROM events e LEFT JOIN users u ON u.id = e.actor_id WHERE request_id = ? ORDER BY at, e.id').all(rid),
    files: (rid) => q('SELECT * FROM request_files WHERE request_id = ? ORDER BY id').all(rid),
    file: (id) => q('SELECT * FROM request_files WHERE id = ?').get(id),

    // Право доступа: студент — только к своим заявкам, сотрудник — ко всем
    canSee(user, r) { return !!(user && r && (user.role === 'staff' || r.student_id === user.id)); },

    nextNumber() {
      const today = T.dateKey();
      const yymm = today.slice(2, 4) + today.slice(5, 7);
      const name = 'request_' + yymm;
      q('INSERT INTO counters (name, value) VALUES (?, 0) ON CONFLICT(name) DO NOTHING').run(name);
      q('UPDATE counters SET value = value + 1 WHERE name = ?').run(name);
      const v = q('SELECT value FROM counters WHERE name = ?').get(name).value;
      return `${yymm}-${String(v).padStart(3, '0')}`;
    },

    submitRequest(student, data) {
      const t = TYPES[data.type];
      if (!t) throw new Error('bad type');
      const now = T.now();
      const number = m.nextNumber();
      const draft = m.draftOf(student.id);
      const tx = db.transaction(() => {
        if (draft && draft.type === data.type) q('DELETE FROM requests WHERE id = ?').run(draft.id);
        const id = q(`INSERT INTO requests (number, student_id, type, purpose, details, format, status, created_at, submitted_at, eta_at, note)
          VALUES (?,?,?,?,?,?, 'submitted', ?, ?, ?, ?)`).run(number, student.id, data.type, data.purpose || null, data.details || null,
          data.format || null, iso(now), iso(now), iso(estimateEta(data.type, data.format, now)), data.note || null).lastInsertRowid;
        q('INSERT INTO events (request_id, at, actor_id, kind) VALUES (?,?,?,?)').run(id, iso(now), student.id, 'submitted');
        return id;
      });
      return tx();
    },

    addEvent(rid, actorId, kind, text) {
      q('INSERT INTO events (request_id, at, actor_id, kind, text) VALUES (?,?,?,?,?)').run(rid, iso(), actorId, kind, text || null);
    },
    notify(userId, category, title, body, link) {
      q('INSERT INTO notifications (user_id, at, category, title, body, link) VALUES (?,?,?,?,?,?)').run(userId, iso(), category, title, body || null, link || null);
    },
    notifications: (userId) => q('SELECT * FROM notifications WHERE user_id = ? ORDER BY at DESC, id DESC LIMIT 60').all(userId),
    unreadCount(userId) {
      const enabled = m.settings(userId);
      const rows = q('SELECT category FROM notifications WHERE user_id = ? AND read = 0').all(userId);
      return rows.filter((r) => enabled['notif_' + r.category] !== '0').length;
    },
    markAllRead: (userId) => q('UPDATE notifications SET read = 1 WHERE user_id = ?').run(userId),
    settings(userId) {
      const o = {};
      for (const r of q('SELECT key, value FROM settings WHERE user_id = ?').all(userId)) o[r.key] = r.value;
      return o;
    },
    setSetting: (userId, key, value) => q('INSERT INTO settings (user_id, key, value) VALUES (?,?,?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value').run(userId, key, String(value)),

    // Действие за студентом? (красная точка на «Заявках»)
    needsAction: (studentId) => q("SELECT COUNT(*) AS n FROM requests WHERE student_id = ? AND status = 'need_student'").get(studentId).n > 0,

    // ---------- Деканат ----------
    staffQueue(filter) {
      const where = {
        new: "r.status = 'submitted'",
        work: "r.status = 'in_work'",
        student: "r.status = 'need_student'",
        done: "r.status IN ('ready','rejected')",
      }[filter] || "r.status = 'submitted'";
      return q(`SELECT r.*, u.full_name AS student_name, u.group_name FROM requests r JOIN users u ON u.id = r.student_id
        WHERE ${where} ORDER BY COALESCE(r.submitted_at, r.created_at) ${filter === 'done' ? 'DESC' : 'ASC'}`).all().map(m.decorate);
    },
    staffCounts() {
      const o = { new: 0, work: 0, student: 0, done: 0 };
      for (const r of q("SELECT status, COUNT(*) AS n FROM requests WHERE status != 'draft' GROUP BY status").all()) {
        if (r.status === 'submitted') o.new += r.n;
        else if (r.status === 'in_work') o.work += r.n;
        else if (r.status === 'need_student') o.student += r.n;
        else o.done += r.n;
      }
      return o;
    },
    students: () => q("SELECT * FROM users WHERE role = 'student'").all(),
  };
  return m;
}

module.exports = { model, STATUS, NOTIF_CATEGORIES };
