require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Helpers ----------
function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, is_admin: user.is_admin },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function auth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token không hợp lệ' });
  }
}

function adminOnly(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Chỉ admin' });
  next();
}

// ---------- Auth ----------
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || password.length < 4)
    return res.status(400).json({ error: 'Tên/mật khẩu không hợp lệ (mật khẩu ≥ 4 ký tự)' });

  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: 'Tên đã tồn tại' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(
    'INSERT INTO users (username, password, balance) VALUES (?, ?, 1000)'
  ).run(username, hash);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.cookie('token', signToken(user), { httpOnly: true, sameSite: 'lax' });
  res.json({ id: user.id, username: user.username, balance: user.balance, is_admin: 0 });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Sai tên hoặc mật khẩu' });

  res.cookie('token', signToken(user), { httpOnly: true, sameSite: 'lax' });
  res.json({
    id: user.id, username: user.username,
    balance: user.balance, is_admin: user.is_admin
  });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  const user = db.prepare('SELECT id, username, balance, is_admin FROM users WHERE id = ?')
    .get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Không tìm thấy user' });
  res.json(user);
});

// ---------- Game ----------
function createDeck() {
  const SUITS = ['♠','♥','♦','♣'];
  const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ suit: s, rank: r });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardValue(c) {
  if (['10','J','Q','K'].includes(c.rank)) return 0;
  if (c.rank === 'A') return 1;
  return parseInt(c.rank);
}

function handTotal(h) {
  return h.reduce((s, c) => s + cardValue(c), 0) % 10;
}

function playBaccarat() {
  const deck = createDeck();
  const player = [deck.pop(), deck.pop()];
  const banker = [deck.pop(), deck.pop()];
  const pNat = [8,9].includes(handTotal(player));
  const bNat = [8,9].includes(handTotal(banker));

  if (!pNat && !bNat) {
    let p3 = null;
    if (handTotal(player) <= 5) { p3 = deck.pop(); player.push(p3); }
    const bt = handTotal(banker);
    const v3 = p3 ? cardValue(p3) : null;
    let draw = false;
    if (p3 === null) draw = bt <= 5;
    else {
      if (bt <= 2) draw = true;
      else if (bt === 3) draw = v3 !== 8;
      else if (bt === 4) draw = [2,3,4,5,6,7].includes(v3);
      else if (bt === 5) draw = [4,5,6,7].includes(v3);
      else if (bt === 6) draw = [6,7].includes(v3);
    }
    if (draw) banker.push(deck.pop());
  }

  const pScore = handTotal(player);
  const bScore = handTotal(banker);
  const winner = pScore > bScore ? 'player' : bScore > pScore ? 'banker' : 'tie';
  return { player, banker, pScore, bScore, winner };
}

const PAYOUT = { player: 2, banker: 1.95, tie: 9 };

app.post('/api/bet', auth, (req, res) => {
  const { side, amount } = req.body;
  if (!['player','banker','tie'].includes(side))
    return res.status(400).json({ error: 'Cửa cược không hợp lệ' });
  const betAmount = parseInt(amount);
  if (!betAmount || betAmount <= 0)
    return res.status(400).json({ error: 'Số xu không hợp lệ' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (user.balance < betAmount)
    return res.status(400).json({ error: 'Không đủ xu' });

  db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(betAmount, user.id);

  const result = playBaccarat();
  const won = side === result.winner;
  const payout = won ? Math.floor(betAmount * PAYOUT[side]) : 0;

  if (payout > 0) {
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?')
      .run(payout, user.id);
  }

  db.prepare(`
    INSERT INTO bets (user_id, bet_side, amount, player_score, banker_score, winner, payout)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(user.id, side, betAmount, result.pScore, result.bScore, result.winner, payout);

  const newBalance = db.prepare('SELECT balance FROM users WHERE id = ?').get(user.id).balance;
  res.json({ ...result, bet: side, amount: betAmount, payout, balance: newBalance, won });
});

app.get('/api/history', auth, (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM bets WHERE user_id = ? ORDER BY id DESC LIMIT 30'
  ).all(req.user.id);
  res.json(rows);
});

// ---------- Admin: quản lý user ----------
app.get('/api/admin/users', auth, adminOnly, (req, res) => {
  const users = db.prepare(
    'SELECT id, username, balance, is_admin, created_at FROM users ORDER BY id'
  ).all();
  res.json(users);
});

app.post('/api/admin/set-balance', auth, adminOnly, (req, res) => {
  const { userId, balance } = req.body;
  const b = parseInt(balance);
  if (!userId || isNaN(b) || b < 0) return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
  db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(b, userId);
  res.json({ ok: true });
});

// ---------- Admin: chuyển tiền ----------
app.post('/api/admin/transfer', auth, adminOnly, (req, res) => {
  const { toUserId, amount, note } = req.body;
  const amt = parseInt(amount);
  if (!toUserId || isNaN(amt) || amt <= 0)
    return res.status(400).json({ error: 'Dữ liệu không hợp lệ (số xu > 0)' });

  const toUser = db.prepare('SELECT * FROM users WHERE id = ?').get(toUserId);
  if (!toUser) return res.status(404).json({ error: 'Không tìm thấy user nhận' });

  const admin = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (admin.balance < amt)
    return res.status(400).json({ error: `Admin không đủ xu (hiện có ${admin.balance})` });

  // Transaction: trừ admin, cộng user, ghi log
  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(amt, admin.id);
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amt, toUser.id);
    db.prepare(`
      INSERT INTO transfers (from_user_id, to_user_id, amount, note)
      VALUES (?, ?, ?, ?)
    `).run(admin.id, toUser.id, amt, note || null);
  });
  tx();

  const newAdmin = db.prepare('SELECT balance FROM users WHERE id = ?').get(admin.id);
  const newUser = db.prepare('SELECT balance FROM users WHERE id = ?').get(toUser.id);
  res.json({
    ok: true,
    adminBalance: newAdmin.balance,
    userBalance: newUser.balance,
    transferred: amt,
    to: toUser.username
  });
});

// Lịch sử chuyển tiền (admin xem toàn bộ)
app.get('/api/admin/transfers', auth, adminOnly, (req, res) => {
  const rows = db.prepare(`
    SELECT t.*, f.username AS from_name, u.username AS to_name
    FROM transfers t
    JOIN users f ON f.id = t.from_user_id
    JOIN users u ON u.id = t.to_user_id
    ORDER BY t.id DESC LIMIT 100
  `).all();
  res.json(rows);
});

// Lịch sử chuyển tiền của chính user (nhận tiền)
app.get('/api/my-transfers', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT t.*, f.username AS from_name, u.username AS to_name
    FROM transfers t
    JOIN users f ON f.id = t.from_user_id
    JOIN users u ON u.id = t.to_user_id
    WHERE t.to_user_id = ? OR t.from_user_id = ?
    ORDER BY t.id DESC LIMIT 30
  `).all(req.user.id, req.user.id);
  res.json(rows);
});

// Admin xem cược toàn hệ thống
app.get('/api/admin/bets', auth, adminOnly, (req, res) => {
  const rows = db.prepare(`
    SELECT b.*, u.username
    FROM bets b JOIN users u ON u.id = b.user_id
    ORDER BY b.id DESC LIMIT 100
  `).all();
  res.json(rows);
});

app.listen(PORT, () => console.log(`🚀 http://localhost:${PORT}`));
