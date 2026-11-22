const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const db = new Database('baccarat.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    balance INTEGER NOT NULL DEFAULT 1000,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    bet_side TEXT NOT NULL,
    amount INTEGER NOT NULL,
    player_score INTEGER NOT NULL,
    banker_score INTEGER NOT NULL,
    winner TEXT NOT NULL,
    payout INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// Tạo admin mặc định nếu chưa có
const adminUser = process.env.ADMIN_USER || 'admin';
const adminPass = process.env.ADMIN_PASS || 'admin123';
const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(adminUser);
if (!exists) {
  const hash = bcrypt.hashSync(adminPass, 10);
  db.prepare('INSERT INTO users (username, password, balance, is_admin) VALUES (?, ?, 0, 1)')
    .run(adminUser, hash);
  console.log(`✅ Đã tạo admin: ${adminUser} / ${adminPass}`);
}

module.exports = db;
