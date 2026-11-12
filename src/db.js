'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { seed } = require('./seed');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, login TEXT UNIQUE, pass_hash TEXT, role TEXT NOT NULL,
  full_name TEXT NOT NULL, short_name TEXT NOT NULL, name_dat TEXT, first_name TEXT, gender TEXT,
  group_name TEXT, course INTEGER, level TEXT, program TEXT, faculty TEXT, form TEXT, funding TEXT,
  record_book TEXT, curator TEXT, position TEXT, demo_note TEXT
);
CREATE TABLE IF NOT EXISTS schedule (
  id INTEGER PRIMARY KEY, group_name TEXT NOT NULL, weekday INTEGER NOT NULL, parity TEXT NOT NULL DEFAULT 'all',
  start TEXT NOT NULL, end TEXT NOT NULL, subject TEXT NOT NULL, kind TEXT NOT NULL, room TEXT, teacher TEXT, online INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS schedule_changes (
  id INTEGER PRIMARY KEY, schedule_id INTEGER NOT NULL REFERENCES schedule(id), date_key TEXT NOT NULL,
  new_room TEXT, new_start TEXT, new_end TEXT, cancelled INTEGER DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS disciplines (
  id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES users(id), subject TEXT NOT NULL, teacher TEXT,
  control TEXT NOT NULL, pass_threshold INTEGER NOT NULL, auto_threshold INTEGER, closed_text TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY, discipline_id INTEGER NOT NULL REFERENCES disciplines(id), title TEXT NOT NULL,
  max INTEGER NOT NULL, score INTEGER, due_key TEXT
);
CREATE TABLE IF NOT EXISTS nir_stages (
  id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES users(id), ord INTEGER NOT NULL, title TEXT NOT NULL,
  max INTEGER NOT NULL, score INTEGER, state TEXT NOT NULL, note TEXT, due_key TEXT
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES users(id), title TEXT NOT NULL, due_at TEXT NOT NULL, note TEXT
);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY, number TEXT UNIQUE NOT NULL, student_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL, purpose TEXT, details TEXT, format TEXT, status TEXT NOT NULL, needs_text TEXT,
  assignee_id INTEGER REFERENCES users(id), created_at TEXT NOT NULL, submitted_at TEXT, taken_at TEXT,
  closed_at TEXT, eta_at TEXT, notify_ready INTEGER DEFAULT 0, reject_reason TEXT
);
CREATE TABLE IF NOT EXISTS request_files (
  id INTEGER PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES requests(id), name TEXT NOT NULL, stored TEXT NOT NULL,
  mime TEXT, size INTEGER, uploaded_at TEXT NOT NULL, uploaded_by INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES requests(id), at TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id), kind TEXT NOT NULL, text TEXT
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), at TEXT NOT NULL, category TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT, link TEXT, read INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES users(id), contract TEXT NOT NULL, paid_on TEXT NOT NULL,
  amount INTEGER NOT NULL, payer TEXT NOT NULL, note TEXT
);
CREATE TABLE IF NOT EXISTS settings (user_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY (user_id, key));
CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY, user_id INTEGER, at TEXT NOT NULL, page TEXT, solved INTEGER, text TEXT);
CREATE TABLE IF NOT EXISTS assistant_log (id INTEGER PRIMARY KEY, user_id INTEGER, at TEXT NOT NULL, question TEXT, source TEXT);
`;

const TABLES = ['payments', 'assistant_log', 'feedback', 'notifications', 'events', 'request_files', 'requests', 'tasks', 'nir_stages',
  'works', 'disciplines', 'schedule_changes', 'schedule', 'settings', 'counters', 'users'];

function open(file = process.env.DB_FILE || path.join(DATA_DIR, 'dgtu.sqlite')) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  db.dataDir = DATA_DIR;
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count === 0) seed(db);
  return db;
}

// Полный сброс демо-данных (кнопка в кабинете деканата и запуск тестов)
function resetDemo(db) {
  const tx = db.transaction(() => {
    db.pragma('foreign_keys = OFF');
    for (const t of TABLES) db.prepare(`DELETE FROM ${t}`).run();
    db.pragma('foreign_keys = ON');
    seed(db);
  });
  tx();
  const dir = path.join(db.dataDir, 'uploads');
  for (const f of fs.readdirSync(dir)) { if (!f.startsWith('demo-')) fs.rmSync(path.join(dir, f), { force: true }); }
}

module.exports = { open, resetDemo, DATA_DIR };
