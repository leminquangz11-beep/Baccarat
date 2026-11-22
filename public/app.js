const $ = id => document.getElementById(id);
const SESSION_MS = 25_000;
let sessionTimer = null;
let sessionDeadline = 0;
let sessionActive = false;
let lastResult = null;

async function init() {
  const me = await fetch('/api/me', { credentials: 'include' });
  if (!me.ok) return location.href = 'login.html';
  const user = await me.json();
  $('usernameLbl').textContent = user.username;
  $('balance').textContent = user.balance.toLocaleString('vi-VN');

  await loadHistory();
  await loadTransfers();
  startSession();
}

function startSession() {
  sessionActive = true;
  sessionDeadline = Date.now() + SESSION_MS;
  lastResult = null;

  $('playerCards').innerHTML = '';
  $('bankerCards').innerHTML = '';
  $('playerScore').textContent = '0';
  $('bankerScore').textContent = '0';
  $('result').textContent = '';
  $('result').className = 'result';
  $('dealerMsg').textContent = 'Đặt cược trong 25 giây...';
  document.querySelectorAll('.bet').forEach(b => b.disabled = false);

  clearInterval(sessionTimer);
  sessionTimer = setInterval(() => {
    const left = Math.max(0, sessionDeadline - Date.now());
    const pct = (left / SESSION_MS) * 100;
    $('timerFill').style.width = pct + '%';
    $('timerText').textContent = Math.ceil(left / 1000);

    if (left <= 0) {
      clearInterval(sessionTimer);
      endSession();
    }
  }, 100);
}

function endSession() {
  sessionActive = false;
  document.querySelectorAll('.bet').forEach(b => b.disabled = true);
  $('timerFill').style.width = '0%';
  $('timerText').textContent = '0';
  $('dealerMsg').textContent = 'Hết phiên. Phiên mới sau 3s...';
  setTimeout(startSession, 3000);
}

document.querySelectorAll('.bet').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (!sessionActive) return;
    const side = btn.dataset.bet;
    const amount = parseInt($('betAmount').value);
    if (!amount || amount <= 0) { alert('Nhập số xu hợp lệ'); return; }

    btn.disabled = true;
    try {
      const r = await fetch('/api/bet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ side, amount })
      });
      const data = await r.json();
      if (!r.ok) { alert(data.error); btn.disabled = false; return; }

      lastResult = data;
      $('balance').textContent = data.balance.toLocaleString('vi-VN');
      await animateDeal(data);
      showResult(data);
      await loadHistory();
    } catch (e) { alert('Lỗi kết nối'); }
  });
});

function cardHtml(card) {
  const red = card.suit === '♥' || card.suit === '♦';
  return `<div class="card flip ${red ? 'red' : 'black'}">
    <span class="rank">${card.rank}</span>
    <span class="center">${card.suit}</span>
    <span class="suit">${card.suit}</span>
  </div>`;
}

async function animateDeal(data) {
  $('playerCards').innerHTML = '';
  $('bankerCards').innerHTML = '';
  $('playerScore').textContent = '0';
  $('bankerScore').textContent = '0';
  $('result').textContent = '';
  $('dealerMsg').textContent = '🎩 Dealer đang chia bài...';

  const seq = [
    ['player', data.player[0]], ['banker', data.banker[0]],
    ['player', data.player[1]], ['banker', data.banker[1]],
  ];
  if (data.player[2]) seq.push(['player', data.player[2]]);
  if (data.banker[2]) seq.push(['banker', data.banker[2]]);

  for (const [who, card] of seq) {
    const el = who === 'player' ? $('playerCards') : $('bankerCards');
    el.insertAdjacentHTML('beforeend', cardHtml(card));
    await new Promise(r => setTimeout(r, 300));
  }

  $('playerScore').textContent = data.pScore;
  $('bankerScore').textContent = data.bScore;
}

function showResult(data) {
  const names = { player: 'Player', banker: 'Banker', tie: 'Tie' };
  const winnerText = { player: 'Player thắng!', banker: 'Banker thắng!', tie: 'Hòa!' }[data.winner];
  const msg = data.won
    ? `🎉 ${winnerText} Bạn thắng ${data.payout.toLocaleString('vi-VN')} xu!`
    : `😢 ${winnerText} Bạn mất ${data.amount.toLocaleString('vi-VN')} xu.`;
  $('result').textContent = msg;
  $('result').className = 'result ' + (data.won ? 'win' : data.winner === 'tie' ? 'tie' : 'lose');
  $('dealerMsg').textContent = 'Tiếp tục đặt cược khi còn thời gian.';
  document.querySelectorAll('.bet').forEach(b => { if (sessionActive) b.disabled = false; });
}

async function loadHistory() {
  const r = await fetch('/api/history', { credentials: 'include' });
  const rows = await r.json();
  if (!rows.length) {
    $('history').innerHTML = '<div style="opacity:0.6;text-align:center;padding:8px;">Chưa có ván nào.</div>';
    return;
  }
  $('history').innerHTML = rows.map(b => {
    const won = b.payout > 0;
    const cls = won ? '#4ade80' : '#f87171';
    const side = { player: 'Player', banker: 'Banker', tie: 'Tie' }[b.bet_side];
    return `<div style="display:flex;justify-content:space-between;padding:6px 4px;border-bottom:1px solid rgba(255,255,255,0.08);">
      <span>${b.created_at.slice(5,16)}</span>
      <span>${side} ${b.amount}</span>
      <span>P${b.player_score} - B${b.banker_score}</span>
      <span style="color:${cls};font-weight:700;">${won ? '+' + b.payout : '-' + b.amount}</span>
    </div>`;
  }).join('');
}

async function loadTransfers() {
  const r = await fetch('/api/my-transfers', { credentials: 'include' });
  const rows = await r.json();
  if (!rows.length) {
    $('transfers').innerHTML = '<div style="opacity:0.6;text-align:center;padding:8px;">Chưa có giao dịch.</div>';
    return;
  }
  $('transfers').innerHTML = rows.map(t => {
    const isReceive = t.to_name !== 'admin' || t.from_name !== 'admin'; // fallback
    // Xác định hướng dựa vào việc mình là from hay to — nhưng API không trả id mình.
    // Đơn giản: hiển thị "from → to" + số xu, dấu + nếu mình là to.
    // Ta cần biết username của mình, lưu vào biến toàn cục:
    const me = window.__me || '';
    const receive = t.to_name === me;
    return `<div style="display:flex;justify-content:space-between;padding:6px 4px;border-bottom:1px solid rgba(255,255,255,0.08);">
      <span>${t.created_at.slice(5,16)}</span>
      <span>${t.from_name} → ${t.to_name}</span>
      <span style="color:${receive?'#4ade80':'#f87171'};font-weight:700;">
        ${receive?'+':'-'}${t.amount}
      </span>
    </div>`;
  }).join('');
}

$('logoutBtn').onclick = async () => {
  await fetch('/api/logout', { method: 'POST', credentials: 'include' });
  location.href = 'login.html';
};

init();
