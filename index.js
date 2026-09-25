// ============================================================
// v2.5 – fFull GAS Replacement + All Missing Features 
// ULUKA ULTRA — Complete Backend with Scheduled Jobs
// ============================================================

const express = require('express');
const { Pool } = require('pg');
const app = express();
app.use(express.json());
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || '';

console.log('🚀 VERSION 2.5 WITH ALL FEATURES - DEPLOYED AT ' + new Date().toISOString());

// ═══════════════════════════════════════════════════════════
// BREVO EMAIL SERVICE — uses built-in fetch (no npm install)
// ═══════════════════════════════════════════════════════════
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SENDER_EMAIL  = process.env.SENDER_EMAIL;
const SENDER_NAME   = process.env.SENDER_NAME || 'Uluka Ultra';

// ─── JSON PARSE ERROR HANDLER ──────────────────────────────
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    console.warn('⚠️ Backend ignored a malformed JSON payload from the EA.');
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  next();
});

// ─── CORS (manual – no external package) ──────────────────────
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, x-admin-secret');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// ─── PostgreSQL Connection ────────────────────────────────
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ─── Environment Variables ─────────────────────────────────
const DEFAULT_PAYEE_LIMIT = process.env.DEFAULT_PAYEE_LIMIT || 5000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_CHAT_ID      = process.env.ADMIN_CHAT_ID      || '';
const PREMIUM_GROUP_ID   = process.env.PREMIUM_GROUP_ID   || '';
const FREE_GROUP_ID      = process.env.FREE_GROUP_ID      || '';
const CLAUDE_API_KEY     = process.env.CLAUDE_API_KEY     || '';
const ADMIN_SECRET       = process.env.ADMIN_SECRET       || 'default-secret-change-me';

// ═══════════════════════════════════════════════════════════
// SNAPOTTER CARD RENDERER
// ═══════════════════════════════════════════════════════════
const SNAPOTTER_URL     = process.env.SNAPOTTER_URL     || '';
const SNAPOTTER_API_KEY = process.env.SNAPOTTER_API_KEY || '';

async function renderCard(htmlContent) {
  if (!SNAPOTTER_URL || !SNAPOTTER_API_KEY) {
    console.error('❌ SnapOtter credentials missing.');
    return null;
  }
  try {
    const url = `${SNAPOTTER_URL}/api/v1/tools/image/html-to-image`;
    console.log('🎨 renderCard POST →', url);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SNAPOTTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        html: htmlContent,
        format: 'png',
        viewportWidth: 800,
        viewportHeight: 400,
        deviceScaleFactor: 2
      }),
    });

    const responseText = await response.text();
    console.log('🎨 SnapOtter status:', response.status);
    console.log('🎨 SnapOtter body:', responseText.substring(0, 500));

    if (!response.ok) {
      throw new Error(`SnapOtter ${response.status}: ${responseText.substring(0, 200)}`);
    }

    let data;
    try { data = JSON.parse(responseText); } catch(e) {
      throw new Error('SnapOtter response not JSON: ' + responseText.substring(0, 200));
    }

    // Try every possible field SnapOtter might use
    const downloadUrl =
      data.downloadUrl ||
      data.url ||
      data.outputUrl ||
      data.file ||
      data.result ||
      data.path ||
      (data.data && (data.data.downloadUrl || data.data.url)) ||
      null;

    if (!downloadUrl) {
      throw new Error('No download URL in response: ' + JSON.stringify(data).substring(0, 300));
    }

    const fullUrl = downloadUrl.startsWith('http')
      ? downloadUrl
      : `${SNAPOTTER_URL}${downloadUrl}`;
    console.log('🎨 Fetching PNG →', fullUrl);

    const imageResponse = await fetch(fullUrl, {
      headers: { 'Authorization': `Bearer ${SNAPOTTER_API_KEY}` }
    });
    if (!imageResponse.ok) {
      throw new Error(`Image fetch failed: ${imageResponse.status}`);
    }
    const buffer = await imageResponse.arrayBuffer();
    console.log('✅ Card rendered | size:', buffer.byteLength, 'bytes');
    return buffer;

  } catch (error) {
    console.error('❌ renderCard error:', error.message);
    return null;
  }
}

// ─── HTML TEMPLATE — Trade Open Card ─────────────────────
function buildOpenCardHTML(d) {
  const isBuy = (d.action || '').toUpperCase() === 'BUY';
  const accent = isBuy ? '#00FF88' : '#FF5555';
  return `
    <div style="width:800px;height:400px;background:#0C1830;color:#FFFFFF;
                font-family:'Courier New',monospace;padding:30px;
                box-sizing:border-box;border:2px solid #1A304A;border-radius:12px;
                display:flex;flex-direction:column;justify-content:space-between;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:12px;letter-spacing:3px;color:#F0B429;">ULUKA ULTRA</div>
          <div style="font-size:10px;letter-spacing:4px;color:#8899BB;">PREMIUM HOOT</div>
        </div>
        <div style="font-size:32px;color:#F0B429;">🦉</div>
      </div>
      <div style="display:flex;justify-content:space-between;flex:1;margin-top:20px;gap:20px;">
        <div style="flex:1;">
          <div style="font-size:26px;font-weight:bold;color:${accent};">
            ${d.action || ''} ${d.symbol || ''}
          </div>
          <div style="font-size:14px;color:#8899BB;margin-top:8px;">
            Strategy: <span style="color:#FFFFFF;">${d.strategy || '—'}</span>
          </div>
          <div style="font-size:12px;color:#8899BB;margin-top:6px;">
            Session: <span style="color:#FFFFFF;">${d.session || '—'}</span>
          </div>
          <div style="font-size:12px;color:#8899BB;margin-top:6px;">
            Confidence: <span style="color:#F0B429;">${d.conf || '—'}%</span>
          </div>
          <div style="font-size:12px;color:#8899BB;margin-top:6px;">
            Lot: <span style="color:#FFFFFF;">${d.lot || '—'}</span> |
            Risk: <span style="color:#FFFFFF;">${d.risk_pct || '—'}%</span>
          </div>
        </div>
        <div style="flex:1;background:#060D1A;border-radius:8px;padding:16px;border:1px solid #1A304A;">
          <div style="font-size:11px;color:#8899BB;margin-bottom:10px;letter-spacing:2px;">PRICE LEVELS</div>
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
            <span style="color:#8899BB;">Entry</span>
            <span style="color:#FFFFFF;font-weight:bold;">${d.entry || '—'}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
            <span style="color:#FF5555;">SL</span>
            <span style="color:#FF5555;font-weight:bold;">${d.sl || '—'}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
            <span style="color:#00FF88;">TP1</span>
            <span style="color:#00FF88;font-weight:bold;">${d.tp1 || '—'} <span style="color:#8899BB;font-size:11px;">RR 1:${d.rr1 || '—'}</span></span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
            <span style="color:#00FF88;">TP2</span>
            <span style="color:#00FF88;font-weight:bold;">${d.tp2 || '—'} <span style="color:#8899BB;font-size:11px;">RR 1:${d.rr2 || '—'}</span></span>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span style="color:#00FF88;">TP3</span>
            <span style="color:#00FF88;font-weight:bold;">${d.tp3 || '—'} <span style="color:#8899BB;font-size:11px;">RR 1:${d.rr3 || '—'}</span></span>
          </div>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:#8899BB;
                  border-top:1px solid #1A304A;padding-top:10px;margin-top:14px;">
        <span>Ticket: ${d.ticket || '—'}</span>
        <span>${d.time || new Date().toISOString().slice(0,16).replace('T',' ')}</span>
      </div>
    </div>
  `;
}

// ─── HTML TEMPLATE — Free Open Card (teaser) ─────────────
function buildFreeOpenCardHTML(d) {
  const isBuy = (d.action || '').toUpperCase() === 'BUY';
  const accent = isBuy ? '#00FF88' : '#FF5555';
  return `
    <div style="width:800px;height:400px;background:#0C1830;color:#FFFFFF;
                font-family:'Courier New',monospace;padding:30px;
                box-sizing:border-box;border:2px solid #1A304A;border-radius:12px;
                display:flex;flex-direction:column;justify-content:space-between;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:12px;letter-spacing:3px;color:#F0B429;">ULUKA ULTRA</div>
          <div style="font-size:10px;letter-spacing:4px;color:#8899BB;">FREE HOOT</div>
        </div>
        <div style="font-size:32px;color:#F0B429;">🦉</div>
      </div>
      <div style="display:flex;justify-content:space-between;flex:1;margin-top:20px;gap:20px;">
        <div style="flex:1;">
          <div style="font-size:26px;font-weight:bold;color:${accent};">
            ${d.action || ''} ${d.symbol || ''}
          </div>
          <div style="font-size:12px;color:#8899BB;margin-top:8px;">
            Session: <span style="color:#FFFFFF;">${d.session || '—'}</span>
          </div>
          <div style="font-size:14px;color:#F0B429;margin-top:20px;font-weight:bold;">
            💎 Join Premium for full SL + TP2 + TP3
          </div>
        </div>
        <div style="flex:1;background:#060D1A;border-radius:8px;padding:16px;border:1px solid #1A304A;">
          <div style="font-size:11px;color:#8899BB;margin-bottom:10px;letter-spacing:2px;">TEASER LEVELS</div>
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
            <span style="color:#8899BB;">Entry</span>
            <span style="color:#FFFFFF;font-weight:bold;">${d.entry || '—'}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
            <span style="color:#8899BB;">SL</span>
            <span style="color:#8899BB;">🔒 Premium</span>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span style="color:#00FF88;">TP1</span>
            <span style="color:#00FF88;font-weight:bold;">${d.tp1 || '—'} <span style="color:#8899BB;font-size:11px;">RR 1:${d.rr1 || '—'}</span></span>
          </div>
        </div>
      </div>
      <div style="text-align:center;font-size:11px;color:#8899BB;
                  border-top:1px solid #1A304A;padding-top:10px;">
        👉 @WiseOwlUluka · t.me/ulukaowlbot
      </div>
    </div>
  `;
}

// ─── HTML TEMPLATE — Trade Close Card ─────────────────────
function buildCloseCardHTML(d) {
  const profit = parseFloat(d.profit || 0);
  const isWin = profit > 0.01;
  const isLoss = profit < -0.01;
  const accent = isWin ? '#00FF88' : (isLoss ? '#FF5555' : '#F0B429');
  const emoji = isWin ? '✅' : (isLoss ? '❌' : '⚖️');
  const profitStr = (profit >= 0 ? '+' : '-') + '$' + Math.abs(profit).toFixed(2);
  const dailyPnl = parseFloat(d.daily_pnl || 0);
  const dailyStr = (dailyPnl >= 0 ? '+' : '-') + '$' + Math.abs(dailyPnl).toFixed(2);

  return `
    <div style="width:800px;height:400px;background:#0C1830;color:#FFFFFF;
                font-family:'Courier New',monospace;padding:30px;
                box-sizing:border-box;border:2px solid #1A304A;border-radius:12px;
                display:flex;flex-direction:column;justify-content:space-between;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:12px;letter-spacing:3px;color:#F0B429;">ULUKA ULTRA</div>
          <div style="font-size:10px;letter-spacing:4px;color:#8899BB;">TRADE CLOSED</div>
        </div>
        <div style="font-size:32px;color:${accent};">${emoji}</div>
      </div>
      <div style="display:flex;justify-content:space-between;flex:1;margin-top:20px;gap:20px;">
        <div style="flex:1;">
          <div style="font-size:26px;font-weight:bold;color:${accent};">
            ${d.result || '—'} ${d.symbol || ''}
          </div>
          <div style="font-size:14px;color:#8899BB;margin-top:8px;">
            Direction: <span style="color:#FFFFFF;">${d.direction || d.action || '—'}</span>
          </div>
          <div style="font-size:14px;color:#8899BB;margin-top:6px;">
            Reason: <span style="color:#FFFFFF;">${d.reason || '—'}</span>
          </div>
          <div style="font-size:12px;color:#8899BB;margin-top:6px;">
            Ticket: <span style="color:#FFFFFF;">${d.ticket || '—'}</span>
          </div>
        </div>
        <div style="flex:1;background:#060D1A;border-radius:8px;padding:16px;border:1px solid #1A304A;text-align:center;">
          <div style="font-size:11px;color:#8899BB;margin-bottom:14px;letter-spacing:2px;">P&amp;L</div>
          <div style="font-size:36px;font-weight:bold;color:${accent};margin-bottom:14px;">
            ${profitStr}
          </div>
          <div style="font-size:12px;color:#8899BB;">
            Daily: <span style="color:#FFFFFF;font-weight:bold;">${dailyStr}</span>
          </div>
          ${d.health ? `<div style="font-size:12px;color:#8899BB;margin-top:6px;">
            Health: <span style="color:#FFFFFF;">${d.health}/100</span>
          </div>` : ''}
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:#8899BB;
                  border-top:1px solid #1A304A;padding-top:10px;margin-top:14px;">
        <span>Uluka Ultra</span>
        <span>${d.time || new Date().toISOString().slice(0,16).replace('T',' ')}</span>
      </div>
    </div>
  `;
}

// ─── HTML TEMPLATE — SL Update Card ───────────────────────
function buildSLUpdateCardHTML(d) {
  return `
    <div style="width:800px;height:400px;background:#0C1830;color:#FFFFFF;
                font-family:'Courier New',monospace;padding:30px;
                box-sizing:border-box;border:2px solid #1A304A;border-radius:12px;
                display:flex;flex-direction:column;justify-content:space-between;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:12px;letter-spacing:3px;color:#F0B429;">ULUKA ULTRA</div>
          <div style="font-size:10px;letter-spacing:4px;color:#8899BB;">POSITION UPDATE</div>
        </div>
        <div style="font-size:32px;color:#F0B429;">⚖️</div>
      </div>
      <div style="display:flex;justify-content:space-between;flex:1;margin-top:20px;gap:20px;">
        <div style="flex:1;">
          <div style="font-size:26px;font-weight:bold;color:#F0B429;">
            ${d.symbol || ''} ${d.direction || ''}
          </div>
          <div style="font-size:14px;color:#8899BB;margin-top:12px;">
            ${d.be_text || 'Stop Loss Updated'}
          </div>
          <div style="font-size:12px;color:#8899BB;margin-top:8px;">
            Ticket: <span style="color:#FFFFFF;">${d.ticket || '—'}</span>
          </div>
        </div>
        <div style="flex:1;background:#060D1A;border-radius:8px;padding:16px;border:1px solid #1A304A;">
          <div style="font-size:11px;color:#8899BB;margin-bottom:10px;letter-spacing:2px;">SL MOVED</div>
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
            <span style="color:#8899BB;">Entry</span>
            <span style="color:#FFFFFF;font-weight:bold;">${d.entry || '—'}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
            <span style="color:#8899BB;">New SL</span>
            <span style="color:#00FF88;font-weight:bold;">${d.new_sl || '—'}</span>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span style="color:#8899BB;">Open P&amp;L</span>
            <span style="color:#00FF88;font-weight:bold;">${d.open_pnl || '—'}</span>
          </div>
        </div>
      </div>
      <div style="text-align:center;font-size:11px;color:#8899BB;
                  border-top:1px solid #1A304A;padding-top:10px;">
        🛡️ Trade is now protected · ${d.time || ''}
      </div>
    </div>
  `;
}

// ─── HTML TEMPLATE — Activation Card ──────────────────────
function buildActivationCardHTML(d) {
  return `
    <div style="width:800px;height:400px;background:#0C1830;color:#FFFFFF;
                font-family:'Courier New',monospace;padding:30px;
                box-sizing:border-box;border:2px solid #1A304A;border-radius:12px;
                display:flex;flex-direction:column;justify-content:space-between;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:12px;letter-spacing:3px;color:#F0B429;">ULUKA ULTRA</div>
          <div style="font-size:10px;letter-spacing:4px;color:#8899BB;">NEW ACTIVATION</div>
        </div>
        <div style="font-size:32px;color:#00FF88;">🟢</div>
      </div>
      <div style="display:flex;justify-content:space-between;flex:1;margin-top:20px;gap:20px;">
        <div style="flex:1;">
          <div style="font-size:24px;font-weight:bold;color:#F0B429;">
            ${d.client_name || d.client || 'New Client'}
          </div>
          <div style="font-size:14px;color:#8899BB;margin-top:10px;">
            Account: <span style="color:#FFFFFF;">${d.account_id || '—'}</span>
          </div>
          <div style="font-size:12px;color:#8899BB;margin-top:6px;">
            Broker: <span style="color:#FFFFFF;">${d.broker || '—'}</span>
          </div>
          <div style="font-size:12px;color:#8899BB;margin-top:6px;">
            Symbol: <span style="color:#FFFFFF;">${d.symbol || '—'}</span>
          </div>
        </div>
        <div style="flex:1;background:#060D1A;border-radius:8px;padding:16px;border:1px solid #1A304A;">
          <div style="font-size:11px;color:#8899BB;margin-bottom:10px;letter-spacing:2px;">ACCOUNT</div>
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
            <span style="color:#8899BB;">Balance</span>
            <span style="color:#FFFFFF;font-weight:bold;">$${d.balance || '—'}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
            <span style="color:#8899BB;">Equity</span>
            <span style="color:#FFFFFF;font-weight:bold;">$${d.equity || '—'}</span>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span style="color:#8899BB;">Plan</span>
            <span style="color:#F0B429;font-weight:bold;">${d.plan || 'PAYE'}</span>
          </div>
        </div>
      </div>
      <div style="text-align:center;font-size:11px;color:#8899BB;
                  border-top:1px solid #1A304A;padding-top:10px;">
        ✅ EA is now live · ${d.time || ''}
      </div>
    </div>
  `;
}

// ─── HTML TEMPLATE — Admin EOD Card ───────────────────────
function buildAdminEODCardHTML(d) {
  const pnl = parseFloat(d.total_pnl || 0);
  const isProfit = pnl >= 0;
  const accent = isProfit ? '#00FF88' : '#FF5555';
  const pnlStr = (pnl >= 0 ? '+' : '-') + '$' + Math.abs(pnl).toFixed(2);
  const winRate = d.trades && parseFloat(d.trades) > 0
    ? Math.round((parseFloat(d.wins || 0) / parseFloat(d.trades)) * 100)
    : 0;

  return `
    <div style="width:800px;height:400px;background:#0C1830;color:#FFFFFF;
                font-family:'Courier New',monospace;padding:30px;
                box-sizing:border-box;border:2px solid #1A304A;border-radius:12px;
                display:flex;flex-direction:column;justify-content:space-between;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:12px;letter-spacing:3px;color:#F0B429;">ULUKA ULTRA</div>
          <div style="font-size:10px;letter-spacing:4px;color:#8899BB;">DAILY EOD REPORT</div>
        </div>
        <div style="font-size:32px;color:#F0B429;">📊</div>
      </div>
      <div style="display:flex;justify-content:space-between;flex:1;margin-top:16px;gap:16px;">
        <div style="flex:1;">
          <div style="font-size:32px;font-weight:bold;color:${accent};">
            ${pnlStr}
          </div>
          <div style="font-size:12px;color:#8899BB;margin-top:6px;">
            ${d.date || new Date().toDateString()}
          </div>
          <div style="font-size:12px;color:#8899BB;margin-top:14px;">
            Trades: <span style="color:#FFFFFF;font-weight:bold;">${d.trades || 0}</span>
          </div>
          <div style="font-size:12px;color:#8899BB;margin-top:6px;">
            Win Rate: <span style="color:#00FF88;font-weight:bold;">${winRate}%</span>
          </div>
        </div>
        <div style="flex:1;background:#060D1A;border-radius:8px;padding:14px;border:1px solid #1A304A;">
          <div style="font-size:10px;color:#8899BB;margin-bottom:8px;letter-spacing:2px;">PERFORMANCE</div>
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
            <span style="color:#8899BB;">Wins</span>
            <span style="color:#00FF88;font-weight:bold;">${d.wins || 0}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
            <span style="color:#8899BB;">Losses</span>
            <span style="color:#FF5555;font-weight:bold;">${d.losses || 0}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
            <span style="color:#8899BB;">Realized</span>
            <span style="color:#FFFFFF;font-weight:bold;">$${d.realized || 0}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
            <span style="color:#8899BB;">Floating</span>
            <span style="color:#FFFFFF;font-weight:bold;">$${d.floating || 0}</span>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span style="color:#8899BB;">Health</span>
            <span style="color:#F0B429;font-weight:bold;">${d.health || 0}/100</span>
          </div>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:#8899BB;
                  border-top:1px solid #1A304A;padding-top:8px;">
        <span>Balance: $${d.balance || '—'}</span>
        <span>Equity: $${d.equity || '—'}</span>
      </div>
    </div>
  `;
}

// ─── HTML TEMPLATE — Client EOD Card ──────────────────────
function buildClientEODCardHTML(d) {
  const pnl = parseFloat(d.total_pnl || 0);
  const isProfit = pnl >= 0;
  const accent = isProfit ? '#00FF88' : '#FF5555';
  const pnlStr = (pnl >= 0 ? '+' : '-') + '$' + Math.abs(pnl).toFixed(2);

  return `
    <div style="width:800px;height:400px;background:#0C1830;color:#FFFFFF;
                font-family:'Courier New',monospace;padding:30px;
                box-sizing:border-box;border:2px solid #1A304A;border-radius:12px;
                display:flex;flex-direction:column;justify-content:space-between;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:12px;letter-spacing:3px;color:#F0B429;">ULUKA ULTRA</div>
          <div style="font-size:10px;letter-spacing:4px;color:#8899BB;">YOUR DAILY REPORT</div>
        </div>
        <div style="font-size:32px;color:#F0B429;">🦉</div>
      </div>
      <div style="display:flex;justify-content:space-between;flex:1;margin-top:16px;gap:16px;">
        <div style="flex:1;">
          <div style="font-size:20px;font-weight:bold;color:#FFFFFF;">
            ${d.client || d.client_name || 'Trader'}
          </div>
          <div style="font-size:12px;color:#8899BB;margin-top:8px;">
            ${d.date || new Date().toDateString()}
          </div>
          <div style="font-size:36px;font-weight:bold;color:${accent};margin-top:22px;">
            ${pnlStr}
          </div>
        </div>
        <div style="flex:1;background:#060D1A;border-radius:8px;padding:14px;border:1px solid #1A304A;">
          <div style="font-size:10px;color:#8899BB;margin-bottom:10px;letter-spacing:2px;">TODAY'S SNAPSHOT</div>
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
            <span style="color:#8899BB;">Trades</span>
            <span style="color:#FFFFFF;font-weight:bold;">${d.trades || '—'}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
            <span style="color:#8899BB;">Wins</span>
            <span style="color:#00FF88;font-weight:bold;">${d.wins || '—'}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
            <span style="color:#8899BB;">Balance</span>
            <span style="color:#FFFFFF;font-weight:bold;">$${d.balance || '—'}</span>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span style="color:#8899BB;">Health</span>
            <span style="color:#F0B429;font-weight:bold;">${d.health || '—'}/100</span>
          </div>
        </div>
      </div>
      <div style="text-align:center;font-size:11px;color:#8899BB;
                  border-top:1px solid #1A304A;padding-top:8px;">
        Keep letting the owl work. 🦉
      </div>
    </div>
  `;
}

// ─── HTML TEMPLATE — PAYE Archive Card (admin) ─────────────
function buildPAYEArchiveCardHTML(d) {
  return `
    <div style="width:800px;height:400px;background:#0C1830;color:#FFFFFF;
                font-family:'Courier New',monospace;padding:30px;
                box-sizing:border-box;border:2px solid #1A304A;border-radius:12px;
                display:flex;flex-direction:column;justify-content:space-between;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:12px;letter-spacing:3px;color:#F0B429;">ULUKA ULTRA</div>
          <div style="font-size:10px;letter-spacing:4px;color:#8899BB;">WEEKLY PAYE ARCHIVE</div>
        </div>
        <div style="font-size:32px;color:#F0B429;">💰</div>
      </div>
      <div style="display:flex;justify-content:space-between;flex:1;margin-top:16px;gap:16px;">
        <div style="flex:1;">
          <div style="font-size:36px;font-weight:bold;color:#F0B429;">
            $${d.paye_amount || '0.00'}
          </div>
          <div style="font-size:12px;color:#8899BB;margin-top:8px;">
            Week P&L: <span style="color:#00FF88;font-weight:bold;">${d.week_profit || '—'}</span>
          </div>
          <div style="font-size:12px;color:#8899BB;margin-top:6px;">
            Period: <span style="color:#FFFFFF;">${d.week_dates || '—'}</span>
          </div>
        </div>
        <div style="flex:1;background:#060D1A;border-radius:8px;padding:14px;border:1px solid #1A304A;">
          <div style="font-size:10px;color:#8899BB;margin-bottom:8px;letter-spacing:2px;">DISTRIBUTION</div>
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
            <span style="color:#8899BB;">Clients</span>
            <span style="color:#FFFFFF;font-weight:bold;">${d.total_trades || 0}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
            <span style="color:#8899BB;">Client share (75%)</span>
            <span style="color:#00FF88;font-weight:bold;">${d.client_amount || '—'}</span>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span style="color:#8899BB;">Next period</span>
            <span style="color:#FFFFFF;">${d.next_period || '—'}</span>
          </div>
        </div>
      </div>
      <div style="text-align:center;font-size:11px;color:#8899BB;
                  border-top:1px solid #1A304A;padding-top:8px;">
        📅 ${d.week_label || ''} · ${new Date().toDateString()}
      </div>
    </div>
  `;
}

// ─── HTML TEMPLATE — PAYE Billing Card (client) ───────────
function buildPAYEBillingCardHTML(d) {
  return `
    <div style="width:800px;height:400px;background:#0C1830;color:#FFFFFF;
                font-family:'Courier New',monospace;padding:30px;
                box-sizing:border-box;border:2px solid #1A304A;border-radius:12px;
                display:flex;flex-direction:column;justify-content:space-between;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:12px;letter-spacing:3px;color:#F0B429;">ULUKA ULTRA</div>
          <div style="font-size:10px;letter-spacing:4px;color:#8899BB;">PAYE BILLING</div>
        </div>
        <div style="font-size:32px;color:#F0B429;">💎</div>
      </div>
      <div style="display:flex;justify-content:space-between;flex:1;margin-top:16px;gap:16px;">
        <div style="flex:1;">
          <div style="font-size:18px;font-weight:bold;color:#FFFFFF;">
            ${d.client_name || 'Client'}
          </div>
          <div style="font-size:12px;color:#8899BB;margin-top:8px;">
            Week: <span style="color:#FFFFFF;">${d.week_dates || '—'}</span>
          </div>
          <div style="font-size:32px;font-weight:bold;color:#F0B429;margin-top:18px;">
            $${d.paye_amount || '0.00'}
          </div>
          <div style="font-size:12px;color:#8899BB;margin-top:4px;">Amount due</div>
        </div>
        <div style="flex:1;background:#060D1A;border-radius:8px;padding:14px;border:1px solid #1A304A;">
          <div style="font-size:10px;color:#8899BB;margin-bottom:8px;letter-spacing:2px;">BREAKDOWN</div>
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
            <span style="color:#8899BB;">Net Profit</span>
            <span style="color:#00FF88;font-weight:bold;">${d.week_profit || '—'}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
            <span style="color:#8899BB;">You keep (75%)</span>
            <span style="color:#00FF88;font-weight:bold;">${d.client_amount || '—'}</span>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span style="color:#8899BB;">Payment</span>
            <span style="color:#FFFFFF;">${d.pay_method || 'Crypto'}</span>
          </div>
        </div>
      </div>
      <div style="text-align:center;font-size:11px;color:#F0B429;
                  border-top:1px solid #1A304A;padding-top:8px;">
        📲 Send payment to @WiseOwlUluka · Due Monday
      </div>
    </div>
  `;
}

// ─── HTML TEMPLATE — Welcome Premium ──────────────────────
function buildWelcomePremiumCardHTML(username) {
  return `
    <div style="width:800px;height:400px;background:linear-gradient(135deg,#0C1830 0%,#1a2850 100%);
                color:#FFFFFF;font-family:'Courier New',monospace;padding:40px;
                box-sizing:border-box;border:3px solid #F0B429;border-radius:12px;
                display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;">
      <div style="font-size:52px;margin-bottom:16px;">🦉</div>
      <div style="font-size:28px;font-weight:bold;color:#F0B429;letter-spacing:2px;">
        WELCOME TO PREMIUM
      </div>
      <div style="font-size:18px;color:#FFFFFF;margin-top:14px;">
        ${username || 'Trader'}
      </div>
      <div style="font-size:13px;color:#8899BB;margin-top:20px;line-height:1.6;max-width:560px;">
        You now receive full hoots — including SL, TP1, TP2, TP3<br>
        All trade cards · Live results · Priority support
      </div>
      <div style="font-size:12px;color:#F0B429;margin-top:24px;font-weight:bold;">
        Let the owl work. 🦉
      </div>
    </div>
  `;
}

// ─── HTML TEMPLATE — Welcome Free ─────────────────────────
function buildWelcomeFreeCardHTML(username) {
  return `
    <div style="width:800px;height:400px;background:linear-gradient(135deg,#0C1830 0%,#1a2850 100%);
                color:#FFFFFF;font-family:'Courier New',monospace;padding:40px;
                box-sizing:border-box;border:3px solid #00D4FF;border-radius:12px;
                display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;">
      <div style="font-size:52px;margin-bottom:16px;">🦉</div>
      <div style="font-size:28px;font-weight:bold;color:#00D4FF;letter-spacing:2px;">
        WELCOME TO FREE HOOTS
      </div>
      <div style="font-size:18px;color:#FFFFFF;margin-top:14px;">
        ${username || 'Trader'}
      </div>
      <div style="font-size:13px;color:#8899BB;margin-top:20px;line-height:1.6;max-width:560px;">
        You'll receive teaser hoots when conditions align<br>
        Upgrade to Premium for full SL + TP levels
      </div>
      <div style="font-size:12px;color:#00D4FF;margin-top:24px;font-weight:bold;">
        💎 Upgrade: @WiseOwlUluka
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════
// SEND PHOTO TO TELEGRAM (multipart/form-data, no npm package)
// ═══════════════════════════════════════════════════════════
async function sendPhotoToChat(chatId, imageBuffer, caption) {
  if (!TELEGRAM_BOT_TOKEN || !chatId) {
    console.error('❌ sendPhotoToChat: missing token or chatId');
    return false;
  }
  try {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (caption) {
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');
    }
    const blob = new Blob([imageBuffer], { type: 'image/png' });
    form.append('photo', blob, 'card.png');

    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
      method: 'POST',
      body: form
    });

    const data = await res.json();
    if (!data.ok) {
      console.error('❌ sendPhoto failed:', data.description);
      return false;
    }
    console.log('✅ Photo sent to', chatId);
    return true;
  } catch (err) {
    console.error('❌ sendPhoto error:', err.message);
    return false;
  }
}

// ─── TEST ENDPOINT ────────────────────────────────────────
app.get('/test-card', async (req, res) => {
  const sample = {
    action: 'BUY', symbol: 'XAUUSD', strategy: 'Order Block',
    session: 'London', conf: '78', entry: '3350.45', sl: '3345.00',
    tp1: '3360.00', rr1: '1.8', tp2: '3370.00', rr2: '3.5',
    tp3: '3385.00', rr3: '6.3', lot: '0.05', risk_pct: '0.5',
    ticket: '12345678', time: '25 Sep 2026 14:30'
  };
  const html = buildOpenCardHTML(sample);
  const image = await renderCard(html);
  if (image) {
    res.set('Content-Type', 'image/png');
    res.send(Buffer.from(image));
  } else {
    res.status(500).send('Card generation failed — check Railway logs');
  }
});

// ─── TEST: Render AND send card to Telegram ──────────────
app.get('/test-send-card', async (req, res) => {
  const chatId = req.query.chat || ADMIN_CHAT_ID;
  const sample = {
    action: 'BUY', symbol: 'XAUUSD', strategy: 'Order Block',
    session: 'London', conf: '78', entry: '3350.45', sl: '3345.00',
    tp1: '3360.00', rr1: '1.8', tp2: '3370.00', rr2: '3.5',
    tp3: '3385.00', rr3: '6.3', lot: '0.05', risk_pct: '0.5',
    ticket: '12345678', time: new Date().toISOString().slice(0,16).replace('T',' ')
  };
  const html = buildOpenCardHTML(sample);
  const image = await renderCard(html);
  if (!image) {
    return res.status(500).json({ ok: false, step: 'renderCard', error: 'Card render failed' });
  }
  const sent = await sendPhotoToChat(
    chatId,
    image,
    `🧪 <b>Test Card</b> — sent to ${chatId}`
  );
  res.json({ ok: sent, chatId, cardSize: image.byteLength });
});

// ─── TEST: Render close card and send to Telegram ──────────
app.get('/test-close-card', async (req, res) => {
  const chatId = req.query.chat || ADMIN_CHAT_ID;
  const win = req.query.win !== 'false';
  const sample = {
    symbol: 'XAUUSD', direction: 'BUY',
    result: win ? 'PROFIT' : 'LOSS',
    reason: win ? 'TP Hit' : 'SL Hit',
    profit: win ? 47.20 : -18.60,
    daily_pnl: win ? 124.50 : -12.30,
    ticket: '12345678',
    health: 82,
    time: new Date().toISOString().slice(0,16).replace('T',' ')
  };
  const image = await renderCard(buildCloseCardHTML(sample));
  if (!image) return res.status(500).json({ ok: false, error: 'render failed' });
  const sent = await sendPhotoToChat(chatId, image, win ? '🧪 Win card test' : '🧪 Loss card test');
  res.json({ ok: sent, chatId, cardSize: image.byteLength, variant: win ? 'WIN' : 'LOSS' });
});

// ─── TEST: Render SL update card and send to Telegram ──────
app.get('/test-sl-card', async (req, res) => {
  const chatId = req.query.chat || ADMIN_CHAT_ID;
  const sample = {
    symbol: 'XAUUSD', direction: 'BUY', ticket: '12345678',
    entry: '3350.45', new_sl: '3350.50', open_pnl: '+$28.40',
    be_text: 'Stop moved to Break-Even — trade is now risk-free',
    time: new Date().toISOString().slice(0,16).replace('T',' ')
  };
  const image = await renderCard(buildSLUpdateCardHTML(sample));
  if (!image) return res.status(500).json({ ok: false, error: 'render failed' });
  const sent = await sendPhotoToChat(chatId, image, '🧪 SL update test');
  res.json({ ok: sent, chatId, cardSize: image.byteLength });
});

// ─── TEST: Activation card ─────────────────────────────
app.get('/test-activation-card', async (req, res) => {
  const chatId = req.query.chat || ADMIN_CHAT_ID;
  const img = await renderCard(buildActivationCardHTML({
    client_name: 'John Doe', account_id: '12345678',
    broker: 'IC Markets', symbol: 'XAUUSD',
    balance: '2500.00', equity: '2512.40', plan: 'PAYE',
    time: new Date().toISOString().slice(0,16).replace('T',' ')
  }));
  if (!img) return res.status(500).json({ ok: false, error: 'render failed' });
  const sent = await sendPhotoToChat(chatId, img, '🧪 Activation card test');
  res.json({ ok: sent, chatId, cardSize: img.byteLength });
});

// ─── TEST: Admin EOD card ──────────────────────────────
app.get('/test-eod-card', async (req, res) => {
  const chatId = req.query.chat || ADMIN_CHAT_ID;
  const img = await renderCard(buildAdminEODCardHTML({
    date: new Date().toDateString(),
    trades: 7, wins: 5, losses: 2, win_rate: '71',
    realized: '124.50', floating: '-8.20',
    total_pnl: '116.30', balance: '2616.30', equity: '2608.10',
    health: 82
  }));
  if (!img) return res.status(500).json({ ok: false, error: 'render failed' });
  const sent = await sendPhotoToChat(chatId, img, '🧪 Admin EOD card test');
  res.json({ ok: sent, chatId, cardSize: img.byteLength });
});

// ─── TEST: Client EOD card ─────────────────────────────
app.get('/test-client-eod-card', async (req, res) => {
  const chatId = req.query.chat || ADMIN_CHAT_ID;
  const img = await renderCard(buildClientEODCardHTML({
    client: 'John Doe', date: new Date().toDateString(),
    trades: 4, wins: 3,
    total_pnl: '47.20', balance: '2547.20', health: 79
  }));
  if (!img) return res.status(500).json({ ok: false, error: 'render failed' });
  const sent = await sendPhotoToChat(chatId, img, '🧪 Client EOD card test');
  res.json({ ok: sent, chatId, cardSize: img.byteLength });
});

app.get('/test-paye-archive-card', async (req, res) => {
  const chatId = req.query.chat || ADMIN_CHAT_ID;
  const img = await renderCard(buildPAYEArchiveCardHTML({
    paye_amount: '78.10', week_profit: '+$312.40',
    week_dates: '20–25 Sep 2026', week_label: 'Week 39',
    total_trades: 32, client_amount: '$234.30',
    next_period: '27 Sep – 3 Oct'
  }));
  if (!img) return res.status(500).json({ ok: false, error: 'render failed' });
  const sent = await sendPhotoToChat(chatId, img, '🧪 PAYE archive test');
  res.json({ ok: sent, chatId, cardSize: img.byteLength });
});

app.get('/test-paye-billing-card', async (req, res) => {
  const chatId = req.query.chat || ADMIN_CHAT_ID;
  const img = await renderCard(buildPAYEBillingCardHTML({
    client_name: 'John Doe', week_dates: '20–25 Sep 2026',
    paye_amount: '78.10', week_profit: '+$312.40',
    client_amount: '$234.30', pay_method: 'USDT TRC20'
  }));
  if (!img) return res.status(500).json({ ok: false, error: 'render failed' });
  const sent = await sendPhotoToChat(chatId, img, '🧪 PAYE billing test');
  res.json({ ok: sent, chatId, cardSize: img.byteLength });
});

app.get('/test-welcome-premium-card', async (req, res) => {
  const chatId = req.query.chat || ADMIN_CHAT_ID;
  const img = await renderCard(buildWelcomePremiumCardHTML('@TestTrader'));
  if (!img) return res.status(500).json({ ok: false, error: 'render failed' });
  const sent = await sendPhotoToChat(chatId, img, '🧪 Welcome Premium test');
  res.json({ ok: sent, chatId, cardSize: img.byteLength });
});

app.get('/test-welcome-free-card', async (req, res) => {
  const chatId = req.query.chat || ADMIN_CHAT_ID;
  const img = await renderCard(buildWelcomeFreeCardHTML('@FreeTrader'));
  if (!img) return res.status(500).json({ ok: false, error: 'render failed' });
  const sent = await sendPhotoToChat(chatId, img, '🧪 Welcome Free test');
  res.json({ ok: sent, chatId, cardSize: img.byteLength });
});

// ─── Helpers ───────────────────────────────────────────────
async function sendToTelegram(chatId, text, keyboard) {
    if (!TELEGRAM_BOT_TOKEN || !chatId) return false;
    try {
        const payload = {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        };
        if (keyboard) payload.reply_markup = JSON.stringify(keyboard);
        const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return response.status === 200;
    } catch(e) { return false; }
}

async function sendAdminAlert(msg) {
    if (ADMIN_CHAT_ID) await sendToTelegram(ADMIN_CHAT_ID, '🦉 ' + msg);
}

// ─── SHARED VALIDATION LOGIC (GAS-identical) ─────────────
async function handleValidation(params) {
    console.log('🔥 handleValidation called for account:', params.account);
    const { key, account, instance, balance, broker, hwid, personal_chat_id } = params;
    const licence = await pool.query(
        'SELECT * FROM licences WHERE licence_key = $1 AND status = $2',
        [key, 'ACTIVE']
    );
    if (!licence.rows[0]) return { status: 401, body: 'NOT_FOUND' };
    const lic = licence.rows[0];

    if (!lic.account_id && account) {
        await pool.query(
            'UPDATE licences SET account_id = $1 WHERE licence_key = $2',
            [account, key]
        );
        console.log(`🔒 Auto-bound key ${key} to account ${account}`);
    }

    if (lic.account_id && lic.account_id !== account) {
        return { status: 403, body: 'ACCOUNT_MISMATCH' };
    }

    const billing = await pool.query('SELECT * FROM billing WHERE account_id = $1', [account]);
   if (billing.rows[0] && parseFloat(billing.rows[0].payee_25) >= parseFloat(billing.rows[0].payee_limit)) {
        return { status: 403, body: 'LIMIT_BLOCK' };
    }

    if (instance && !lic.instance_ids.includes(instance)) {
        await pool.query(
            'UPDATE licences SET instance_ids = array_append(instance_ids, $1), activations = activations + 1 WHERE licence_key = $2',
            [instance, key]
        );

        if (hwid) {
            await pool.query(
                'UPDATE licences SET hwid = $1 WHERE licence_key = $2',
                [hwid, key]
            );
        }

        if (personal_chat_id) {
            await pool.query(
                'UPDATE licences SET telegram_id = $1 WHERE licence_key = $2',
                [personal_chat_id, key]
            );
        }

        await sendAdminAlert(`🆕 NEW ACTIVATION\nClient: ${lic.client_name}\nAccount: ${account}\nKey: ${key}`);
    }

        if (balance && account) {
        const existing = await pool.query('SELECT * FROM billing WHERE account_id = $1', [account]);
        if (existing.rows[0]) {
            await pool.query(
                `UPDATE billing SET current_balance = $1, net_profit = $2, payee_25 = $3, last_sync = NOW() WHERE account_id = $4`,
                [parseFloat(balance), parseFloat(balance) - existing.rows[0].start_balance, Math.max(0, (parseFloat(balance) - existing.rows[0].start_balance) * 0.25), account]
            );
        } else {
            await pool.query(
                `INSERT INTO billing (account_id, client_name, start_balance, current_balance, net_profit, payee_25, status, initial_equity, dd_percent, payee_limit, last_sync, broker) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11)`,
                [account, lic.client_name, parseFloat(balance), parseFloat(balance), 0, 0, 'ACTIVE', parseFloat(balance), '0.00%', DEFAULT_PAYEE_LIMIT, broker || '']
            );
        }
    }

    // ✅ FIX: Always stamp licences.last_sync on every validation request
    // (placed outside the balance check so it fires even when balance is missing)
    await pool.query(
        'UPDATE licences SET last_sync = NOW() WHERE licence_key = $1',
        [key]
    );

    const d = String(new Date(lic.expires_on).getDate()).padStart(2, '0');
    const m = String(new Date(lic.expires_on).getMonth() + 1).padStart(2, '0');
    const y = new Date(lic.expires_on).getFullYear();
    return { status: 200, body: `AUTHORIZED|${d}-${m}-${y}|${lic.client_name}|${lic.equity_cap || 0}|${lic.subscription || 'PRO'}` };
}
// ─── SHARED HOOT FORMATTER ────────────────────────────────
function buildHootMessages(d) {
    const lotDisplay = d.lot !== undefined ? d.lot : 'N/A';
    const riskDisplay = d.riskPercent !== undefined ? `${d.riskPercent}%` : 'N/A';

    const premiumMsg = `
🦉 ULUKA PREMIUM HOOT
Status: ${d.action === 'BUY' ? '🟢 BUY' : '🔴 SELL'}
Symbol: ${d.symbol}
Strategy: ${d.strategy}
Entry: ${d.entry}
SL: ${d.sl}
TP1: ${d.tp1} RR 1:${d.rr1}
TP2: ${d.tp2} RR 1:${d.rr2}
TP3: ${d.tp3} RR 1:${d.rr3}
Lot: ${lotDisplay}
Risk (Account %): ${riskDisplay}
Ticket: ${d.ticket}
    `;

    const freeMsg = `
🦉 FREE HOOT
${d.action} on ${d.symbol}
TP1: ${d.tp1}
💎 Join Premium for full levels
    `;

    return { premiumMsg, freeMsg };
}
// ─── ROUTE 1: LEGACY GET ────────────────────────────────────
app.get('/', async (req, res) => {
    try {
        console.log('✅ Root route hit!');
        
        const type = req.query.type;

        if (type === 'validate') {
            console.log('🔍 Validating licence...');
            const result = await handleValidation({
                key: req.query.key || '',
                account: req.query.account || '',
                instance: req.query.instance || '',
                balance: req.query.balance || '',
                broker: req.query.broker || '',
                hwid: req.query.hwid || '',
                personal_chat_id: req.query.personal_chat_id || ''
            });
            console.log('📤 Validation result:', result.status, result.body);
            return res.status(result.status).send(result.body);
        }
        
        console.log('ℹ️ Returning OK (no validate)');
        return res.send('OK');
    } catch (err) {
        console.error('🔥 Root route error:', err.message);
        console.error(err.stack);
        res.status(500).send('Internal Server Error: ' + err.message);
    }
});

// ─── ROUTE 2: POST /validate ────────────────────────────────
app.post('/validate', async (req, res) => {
    const result = await handleValidation(req.body);
    res.status(result.status).send(result.body);
});

// ─── ROUTE 3: POST /sync ────────────────────────────────────
app.post('/sync', (req, res) => {
    res.json({ kill_switch: 'OFF', multiplier: 1.0, min_confidence: 0, news_filter: 'ON' });
});

// ─── ROUTE 4: GET /sync ─────────────────────────────────────
app.get('/sync', (req, res) => {
    res.json({ 
        kill_switch: 'OFF', 
        multiplier: 1.0, 
        min_confidence: 0,   // <-- set to 0 to disable cloud override
        high_news_block: highImpactUSDBlock ? 'ON' : 'OFF',
        medium_news_block: mediumImpactUSDBlock ? 'ON' : 'OFF'
    });
});

// ─── ROUTE 5: TRADE SIGNAL ──────────────────────────────────
app.post('/hoot', async (req, res) => {
    try {
        const d = req.body;
        if ((d.source || '').toUpperCase() !== 'MASTER') {
            console.log('📥 Blocked non-MASTER hoot attempt:', d.source);
            return res.send('NON_MASTER_BLOCKED');
        }

        // ── Use the shared formatter ──
        const { premiumMsg, freeMsg } = buildHootMessages(d);

        if (PREMIUM_GROUP_ID) await sendToTelegram(PREMIUM_GROUP_ID, premiumMsg);
        if (FREE_GROUP_ID) await sendToTelegram(FREE_GROUP_ID, freeMsg);
        res.send('HOOT_SENT');
    } catch(e) { 
        console.error('🔥 /hoot error:', e.message);
        res.status(500).send('ERROR'); 
    }
});

// ─── ROUTE 6: TRADE CLOSE ──────────────────────────────────
app.post('/close', async (req, res) => {
    try {
        const d = req.body;

          if ((d.source || '').toUpperCase() !== 'MASTER') {
    console.log('📥 Blocked non-MASTER close attempt:', d.source);
    return res.send('NON_MASTER_BLOCKED');
}
        
        const msg = `🦉 TRADE CLOSED\n${d.result} — ${d.symbol}\nP&L: ${d.profit}\nReason: ${d.reason}\nTicket: ${d.ticket}`;
        if (PREMIUM_GROUP_ID) await sendToTelegram(PREMIUM_GROUP_ID, msg);
        if (FREE_GROUP_ID) await sendToTelegram(FREE_GROUP_ID, `🦉 UPDATE\n${d.result} on ${d.symbol}\n💎 Join Premium for details`);
        res.send('CLOSE_OK');
    } catch(e) { res.status(500).send('ERROR'); }
});

       
// ─── ROUTE 8: POSITIONS ──────────────────────────────────────
app.post('/positions', async (req, res) => {
    try {
        const d = req.body;
        await pool.query('DELETE FROM open_positions WHERE account_id = $1', [d.account_id]);
        for (const p of (d.positions || [])) {
            await pool.query(
                `INSERT INTO open_positions (account_id, symbol, direction, lot, open_price, pips, floating_pnl, strategy, ticket, updated) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
                [
                    d.account_id,
                    p.symbol,
                    p.direction,
                    parseFloat(p.lot || 0),
                    parseFloat(p.open_price || 0),
                    parseFloat(p.pips || 0),
                    parseFloat(p.floating_pnl || 0),
                    p.strategy || '',
                    p.ticket || ''
                ]
            );
        }
        res.send('OK');
    } catch(e) { res.status(500).send('ERROR'); }
});

// ─── ROUTE 9: TRADE LOG ─────────────────────────────────────
app.post('/trade_log', async (req, res) => {
    try {
        const d = req.body;
        await pool.query(
            `INSERT INTO trade_log (time, account_id, source, symbol, action, price, lot, pnl, result, strategy, balance, equity, ai_decision, ai_reason, news_sentiment, news_summary, cot_sentiment, shadow_mode, client_name) VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
            [
                d.account_id,
                d.source || 'UNKNOWN',
                d.symbol,
                d.action,
                d.price || 0,
                d.lot || 0,
                d.pnl_value || 0,
                d.pnl_text || '',
                d.strategy || '',
                d.balance || 0,
                d.equity || 0,
                d.ai_decision || 'N/A',
                d.ai_reason || '',
                d.news_sentiment || 'NEUTRAL',
                d.news_summary || '',
                d.cot_sentiment || 'NEUTRAL',
                d.shadow_mode === 'TRUE',
                d.client || ''
            ]
        );
        res.send('OK');
    } catch(e) { res.status(500).send('ERROR'); }
});

// ─── ROUTE 10: EOD ADMIN ────────────────────────────────────
app.post('/eod', async (req, res) => {
    try {
        await sendAdminAlert(`📊 EOD REPORT\n${req.body.date}\nP&L: ${req.body.total_pnl}`);
        res.send('OK');
    } catch(e) { res.status(500).send('ERROR'); }
});

// ─── ROUTE 11: CLIENT EOD ──────────────────────────────────
app.post('/client_eod', async (req, res) => {
    try {
        const d = req.body;
        if (d.chat_id) {
            await sendToTelegram(d.chat_id, `🦉 YOUR DAILY REPORT\n${d.date}\nP&L: ${d.total_pnl}\nBalance: $${d.balance}`);
        }
        res.send('OK');
    } catch(e) { res.status(500).send('ERROR'); }
});

// ─── ROUTE 12: ACTIVATION ──────────────────────────────────
app.post('/activation', async (req, res) => {
    try {
        await sendAdminAlert(`🖥 EA ACTIVATION\n${req.body.text}`);
        res.send('OK');
    } catch(e) { res.status(500).send('ERROR'); }
});

// ─── ROUTE 13: POSITION UPDATE ─────────────────────────────
app.post('/position_update', async (req, res) => {
    try {
        const d = req.body;
         if ((d.source || '').toUpperCase() !== 'MASTER') {
    console.log('📥 Blocked non-MASTER position update:', d.source);
    return res.send('NON_MASTER_BLOCKED');
}
        if (PREMIUM_GROUP_ID) {
            await sendToTelegram(PREMIUM_GROUP_ID, `⚖️ POSITION UPDATE\n${d.symbol} ${d.direction}\nNew SL: ${d.new_sl}\n${d.be_text || ''}`);
        }
        res.send('OK');
    } catch(e) { res.status(500).send('ERROR'); }
});

// ─── ROUTE 14: AI DECISION ──────────────────────────────────
app.post('/ai_decision', async (req, res) => {
    try {
        if (!CLAUDE_API_KEY) {
            return res.json({
                decision: 'TAKE',
                confidence_adjustment: 0,
                risk_multiplier: 1.0,
                reason: 'No Claude key',
                news_sentiment: 'NEUTRAL',
                news_summary: '',
                cot_sentiment: 'NEUTRAL'
            });
        }
        const context = req.body;
        const prompt = `
Trade: ${context.symbol} ${context.action}.
Strategy: ${context.strategy || 'Unknown'}.
Confidence: ${context.confidence || 50}.
HTF bias: ${context.htf_bias || 'NEUTRAL'}.
Session: ${context.session || 'London'}.
Daily P&L: ${context.daily_pnl || 0}.
Health: ${context.health || 50}.

Market Metrics:
- ATR ratio: ${context.atr_ratio || 1.0}
- Bollinger Width: ${context.bb_width || 0}
- ADX Strength: ${context.adx_strength || 20}

Decision logic:
TAKE if the session is reasonable, HTF bias supports the trade, and confidence is above 60%.
SKIP only if multiple conditions strongly oppose the trade (e.g., dead session, extremely low ADX, high spread, or bad health).
Make a balanced, professional judgment based on the data provided.

Respond ONLY with JSON: {"decision":"SKIP" or "TAKE","reason":"brief explanation"}
`;
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': CLAUDE_API_KEY,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 200,
                system: 'You are a JSON-only responder.',
                messages: [{ role: 'user', content: prompt }]
            })
        });
        const data = await response.json();
        let text = data.content?.[0]?.text || '{"decision":"TAKE","reason":"Fallback"}';
        const match = text.match(/\{.*\}/s);
        if (match) {
            const result = JSON.parse(match[0]);
            return res.json({
                decision: result.decision === 'TAKE' ? 'TAKE' : 'SKIP',
                confidence_adjustment: parseInt(result.confidence_adjustment) || 0,
                risk_multiplier: parseFloat(result.risk_multiplier) || 1.0,
                reason: result.reason || '',
                news_sentiment: result.news_sentiment || 'NEUTRAL',
                news_summary: result.news_summary || '',
                cot_sentiment: result.cot_sentiment || 'NEUTRAL'
            });
        }
        res.json({ decision: 'TAKE', reason: 'Claude parse fallback' });
    } catch(e) { res.json({ decision: 'TAKE', reason: 'Error fallback' }); }
});

// ------- ROUTE 15-----

// ─── ROUTE: MORNING BRIEF (with Live Prices) ────────────────
app.post('/api/morning-brief', async (req, res) => {
    try {
        if (!CLAUDE_API_KEY) {
            return res.status(503).send('Claude API key not configured.');
        }

        const { account_id, client_name } = req.body;

        // ─── 1. FETCH LIVE PRICES ────────────────────────────────
        // Using exchangerate.host (free, no API key) for XAU/USD, XAG/USD
        // For DXY we use a dedicated endpoint (or you can get it from your broker)
        let prices = {
    XAUUSD: 'N/A',
    XAGUSD: 'N/A',
    DXY: 'N/A'
};

// 1. Get XAU/USD from gold-api.com (free, no key)
try {
    const goldResp = await fetch('https://api.gold-api.com/price/XAU', { timeout: 5000 });
    if (goldResp.ok) {
        const goldData = await goldResp.json();
        if (goldData.price) {
            prices.XAUUSD = goldData.price.toFixed(2);
        }
    }
} catch (e) {
    console.warn('⚠️ Gold API failed:', e.message);
}

// 2. Get XAG/USD from exchangerate.host (fallback for silver)
try {
    const fxResp = await fetch('https://api.exchangerate.host/latest?base=USD&symbols=XAG', { timeout: 5000 });
    if (fxResp.ok) {
        const fxData = await fxResp.json();
        if (fxData.rates && fxData.rates.XAG) {
            prices.XAGUSD = (1 / fxData.rates.XAG).toFixed(2);
        }
    }
} catch (e) {
    console.warn('⚠️ Silver API failed:', e.message);
}

// 3. DXY – leave as 'N/A'
        // If price fetch failed, use a fallback (last known from broker) – but we don't have that here.
        // To prevent hallucination, we'll set a "not available" message and force Claude to say so.

        // ─── 2. FETCH ACCOUNT DATA ────────────────────────────────
        let accountData = '';
        if (account_id) {
            const billingResult = await pool.query(
                `SELECT current_balance, net_profit, payee_25 FROM billing WHERE account_id = $1`,
                [account_id]
            );
            if (billingResult.rows.length > 0) {
                const b = billingResult.rows[0];
                accountData = `
Account: ${account_id}
Balance: $${parseFloat(b.current_balance || 0).toFixed(2)}
Net Profit: $${parseFloat(b.net_profit || 0).toFixed(2)}
Payee (25%): $${parseFloat(b.payee_25 || 0).toFixed(2)}
`;
            }
        }

        const today = new Date().toLocaleDateString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });

        // ─── 3. BUILD PROMPT WITH LIVE PRICES ─────────────────────
        const prompt = `
You are Uluka Ultra's AI trading assistant. Generate a concise, professional morning trading brief for today (${today}).

**IMPORTANT – USE THESE EXACT LIVE PRICES (fetched moments ago):**
- XAUUSD (Gold): $${prices.XAUUSD} per ounce
- XAGUSD (Silver): $${prices.XAGUSD} per ounce
- DXY (Dollar Index): ${prices.DXY} (if not available, state "approx 103-104 range")

Use this structure:
1. 🌅 Brief header with date and session (London Open)
2. 📊 Market context table with the assets and the prices above
3. 🔍 Key observations (2-3 bullet points about current market conditions)
4. ⚡ Active trade reminder (if any, use the data below)
5. ⚠️ Risk reminders

**CRITICAL RULES:**
- Do NOT invent prices. If a price is listed as "N/A", write "N/A" or "unavailable".
- If you don't have a real price, do NOT guess – state that the price is not available.
- Base your analysis ONLY on the prices provided.

${accountData ? `\nCurrent account data:\n${accountData}` : ''}

Respond in PLAIN TEXT with markdown-style formatting (headers with #, bullet points with -, tables with |).
Do NOT wrap in JSON. Do NOT use HTML.
`;

        // ─── 4. CALL CLAUDE ────────────────────────────────────────
        const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
    },
    body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: 'You are a professional trading assistant. Always respond in plain text with markdown formatting. Never use JSON or HTML.',
        messages: [{ role: 'user', content: prompt }]
    })
});

        const data = await response.json();
        const brief = data.content?.[0]?.text || 'Unable to generate brief at this time.';

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(brief);

    } catch (error) {
        console.error('❌ Morning brief error:', error.message);
        res.status(500).send('Unable to generate morning brief. Please try again later.');
    }
});

// ─── ROUTE 16: HEALTH ───────────────────────────────────────
app.get('/health', (req, res) => res.send('OK'));

// ============================================================
// DASHBOARD API ENDPOINTS
// ============================================================

app.get('/api/public/stats', async (req, res) => {
    try {
        const activeResult = await pool.query(
            "SELECT COUNT(*) AS activeclients FROM licences WHERE status = 'ACTIVE'"
        );
        const profitResult = await pool.query(
            "SELECT COALESCE(SUM(net_profit), 0) AS totalnetprofit FROM billing WHERE status = 'ACTIVE'"
        );
        const winRateResult = await pool.query(`
            SELECT COALESCE(
                (SELECT COUNT(*) FROM trade_log WHERE CAST(pnl AS NUMERIC) > 0) * 100.0 / 
                NULLIF((SELECT COUNT(*) FROM trade_log), 0),
                0
            ) AS avgwinrate
        `);
        const openPosResult = await pool.query(
            "SELECT COUNT(*) AS openpositions FROM open_positions"
        );

        const response = {
            activeClients: parseInt(activeResult.rows[0]?.activeclients || 0),
            totalNetProfit: parseFloat(profitResult.rows[0]?.totalnetprofit || 0),
            avgWinRate: parseFloat(winRateResult.rows[0]?.avgwinrate || 0),
            openPositions: parseInt(openPosResult.rows[0]?.openpositions || 0)
        };
        res.json(response);
    } catch (err) {
        console.error('🔥 /api/public/stats error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/clients', async (req, res) => {
    const secret = req.headers['x-admin-secret'];
    if (secret !== ADMIN_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const query = `
            SELECT 
                l.client_name AS name,
                l.account_id,
                l.status,
                l.expires_on AS expiry,
                l.subscription,
                b.current_balance AS balance,
                b.net_profit AS profit,
                b.payee_25,
                b.dd_percent AS dd,
                GREATEST(0, 100 - COALESCE(CAST(REPLACE(b.dd_percent, '%', '') AS NUMERIC), 0) * 1) AS health,
                COALESCE(
                    (SELECT COUNT(*) FROM trade_log WHERE account_id = l.account_id AND pnl > 0) * 100.0 /
                    NULLIF((SELECT COUNT(*) FROM trade_log WHERE account_id = l.account_id), 0),
                    0
                ) AS win_rate,
                (SELECT COUNT(*) FROM trade_log WHERE account_id = l.account_id AND time > NOW() - INTERVAL '7 days') AS trades_this_week,
                (SELECT COUNT(*) FROM open_positions WHERE account_id = l.account_id) AS open_positions
            FROM licences l
            LEFT JOIN billing b ON l.account_id = b.account_id
            WHERE l.status = 'ACTIVE' OR l.status = 'EXPIRED' OR l.status = 'WARNING'
            ORDER BY l.client_name
        `;
        const result = await pool.query(query);
        const clients = result.rows.map(row => ({
            ...row,
            expiry: row.expiry ? row.expiry.toISOString().split('T')[0] : 'N/A',
            status: row.status.toLowerCase(),
            health: Math.round(row.health || 0),
            balance: parseFloat(row.balance || 0),
            profit: parseFloat(row.profit || 0),
            dd: row.dd || '0.00%',
            winRate: parseFloat(row.win_rate || 0),
            tradesThisWeek: parseInt(row.trades_this_week || 0),
            openPositions: parseInt(row.open_positions || 0)
        }));
        res.json(clients);
    } catch (err) {
        console.error('🔥 /api/admin/clients error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/billing/:account', async (req, res) => {
    const account = req.params.account;
    try {
        const result = await pool.query(
            `SELECT 
                current_balance, 
                net_profit, 
                payee_25,
                status,
                start_balance,
                initial_equity
            FROM billing WHERE account_id = $1`,
            [account]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Account not found' });
        }
        const row = result.rows[0];
        const stats = await pool.query(
            `SELECT 
                COUNT(*) AS total_trades,
                COUNT(*) FILTER (WHERE pnl > 0) AS wins,
                COUNT(*) FILTER (WHERE pnl < 0) AS losses,
                COALESCE(SUM(pnl), 0) AS total_pnl,
                COALESCE(AVG(pnl), 0) AS avg_pnl,
                MAX(pnl) AS max_win,
                MIN(pnl) AS max_loss
            FROM trade_log WHERE account_id = $1`,
            [account]
        );
        const s = stats.rows[0];
        const totalTrades = parseInt(s.total_trades || 0);
        const wins = parseInt(s.wins || 0);
        const losses = parseInt(s.losses || 0);
        const winRate = totalTrades > 0 ? (wins / totalTrades * 100) : 0;

        res.json({
            current_balance: parseFloat(row.current_balance || 0),
            net_profit: parseFloat(row.net_profit || 0),
            payee_25: parseFloat(row.payee_25 || 0),
            status: row.status || 'ACTIVE',
            start_balance: parseFloat(row.start_balance || 0),
            initial_equity: parseFloat(row.initial_equity || 0),
            total_trades: totalTrades,
            win_rate: winRate,
            wins: wins,
            losses: losses,
            total_pnl: parseFloat(s.total_pnl || 0),
            avg_pnl: parseFloat(s.avg_pnl || 0),
            max_win: parseFloat(s.max_win || 0),
            max_loss: parseFloat(s.max_loss || 0)
        });
    } catch (err) {
        console.error('🔥 /api/billing/:account error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/positions/:account', async (req, res) => {
    const account = req.params.account;
    try {
        const result = await pool.query(
            `SELECT 
                symbol, 
                direction, 
                lot, 
                open_price AS "openPrice", 
                pips, 
                floating_pnl AS "floatingPnl", 
                strategy,
                ticket
            FROM open_positions WHERE account_id = $1`,
            [account]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('🔥 /api/positions/:account error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/trades/:account', async (req, res) => {
    const account = req.params.account;
    const limit = parseInt(req.query.limit) || 50;
    try {
        const result = await pool.query(
            `SELECT 
                time,
                symbol,
                action,
                price,
                lot,
                pnl,
                result,
                strategy,
                balance,
                equity
            FROM trade_log 
            WHERE account_id = $1 
            ORDER BY time DESC 
            LIMIT $2`,
            [account, limit]
        );
        const trades = result.rows.map(row => ({
            time: row.time ? row.time.toISOString() : '',
            symbol: row.symbol,
            action: row.action,
            price: parseFloat(row.price || 0),
            lot: parseFloat(row.lot || 0),
            pnl: parseFloat(row.pnl || 0),
            result: row.result || '',
            strategy: row.strategy || '',
            balance: parseFloat(row.balance || 0),
            equity: parseFloat(row.equity || 0)
        }));
        res.json(trades);
    } catch (err) {
        console.error('🔥 /api/trades/:account error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    const { account, licence } = req.body;
    if (!account || !licence) {
        return res.status(400).json({ ok: false, error: 'Missing account or licence key' });
    }
    try {
        const result = await pool.query(
            `SELECT client_name, licence_key, status, expires_on, subscription, equity_cap 
             FROM licences 
             WHERE account_id = $1 AND licence_key = $2`,
            [account, licence]
        );
        if (result.rows.length === 0) {
            return res.status(401).json({ ok: false, error: 'Invalid credentials' });
        }
        const row = result.rows[0];
        if (row.status !== 'ACTIVE') {
            return res.status(403).json({ ok: false, error: 'Licence is not active' });
        }
                const expiryDate = row.expires_on;
        const daysLeft = Math.ceil((new Date(expiryDate) - new Date()) / (1000 * 60 * 60 * 24));
        
        // 🔥 FIXED: Removed undefined variables (stats, clients, etc.)
               // 🔥 FIXED: Removed undefined variables (stats, clients, etc.)
        res.json({
            success: true,
            ok: true,  // <--- ADD THIS LINE
            client_name: row.client_name,
            subscription: row.subscription,
            expiry: row.expires_on,
            days_left: daysLeft
        });
    } catch (err) {
        console.error('🔥 /api/login error:', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});
// ============================================================
// 🆕 PUBLIC DASHBOARD ENDPOINTS (for public.html)
// ============================================================

// ─── 1. Equity Curve (aggregated across all clients) ──────
app.get('/api/public/equity', async (req, res) => {
    try {
        // Get total starting equity from all active clients
        const baseQuery = `
            SELECT COALESCE(SUM(initial_equity), 0) AS total_start
            FROM billing 
            WHERE status = 'ACTIVE'
        `;
        const baseResult = await pool.query(baseQuery);
        const baseEquity = parseFloat(baseResult.rows[0]?.total_start || 0);

        // If no base equity, use a default of $5,000
        const startEquity = baseEquity > 0 ? baseEquity : 5000;

        // Get daily cumulative P&L from trade_log
        const query = `
            WITH daily_pnl AS (
                SELECT 
                    DATE(time) AS date,
                    COALESCE(SUM(CAST(pnl AS NUMERIC)), 0) AS daily_profit
                FROM trade_log
                WHERE time IS NOT NULL
                GROUP BY DATE(time)
                ORDER BY DATE(time)
            ),
            cumulative AS (
                SELECT 
                    date,
                    daily_profit,
                    SUM(daily_profit) OVER (ORDER BY date) AS cumulative_pnl
                FROM daily_pnl
            )
            SELECT 
                date,
                ROUND((${startEquity} + cumulative_pnl)::NUMERIC, 2) AS equity
            FROM cumulative
            ORDER BY date
        `;

        const result = await pool.query(query);

        // If no data, return a single point with the starting equity
        if (result.rows.length === 0) {
            return res.json([{ 
                date: new Date().toISOString().split('T')[0], 
                equity: startEquity 
            }]);
        }

        res.json(result.rows);
    } catch (err) {
        console.error('❌ /api/public/equity error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── 2. Recent Trades (across all clients) ─────────────────
app.get('/api/public/trades', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;

        const query = `
            SELECT 
                symbol,
                action AS type,
                price AS entry,
                CAST(NULL AS TEXT) AS sl,
                CAST(NULL AS TEXT) AS tp,
                CAST(pnl AS NUMERIC) AS profit,
                strategy,
                time
            FROM trade_log
            WHERE pnl IS NOT NULL
            ORDER BY time DESC
            LIMIT $1
        `;

        const result = await pool.query(query, [limit]);

        // If no trades, return empty array
        if (result.rows.length === 0) {
            return res.json([]);
        }

        // Format the response
        const trades = result.rows.map(row => ({
            symbol: row.symbol || '—',
            type: row.type || '—',
            entry: row.entry ? parseFloat(row.entry).toFixed(2) : '—',
            sl: row.sl || '—',
            tp: row.tp || '—',
            profit: parseFloat(row.profit || 0),
            strategy: row.strategy || '—',
            time: row.time ? row.time.toISOString() : ''
        }));

        res.json(trades);
    } catch (err) {
        console.error('❌ /api/public/trades error:', err.message);
        res.status(500).json({ error: err.message });
    }
});
// ============================================================
// KEY GENERATOR – ADMIN API + GUI
// ============================================================

app.post('/api/admin/generate-key', async (req, res) => {
    try {
        const secret = req.headers['x-admin-secret'] || req.body.admin_secret;
        if (secret !== ADMIN_SECRET) {
            return res.status(401).json({ error: 'Unauthorized: Invalid admin secret' });
        }

        const {
            client_name,
            subscription = 'PRO',
            expires_on,
            equity_cap = 0,
            status = 'ACTIVE',
            duration = '1 Year',
            account_id = null,
            telegram_id = null,
            email = null,
            hwid = null
        } = req.body;

        if (!client_name) return res.status(400).json({ error: 'Missing client_name' });
        if (!expires_on) return res.status(400).json({ error: 'Missing expires_on (YYYY-MM-DD)' });

        let licence_key;
        let keyExists = true;
        let attempts = 0;
        while (keyExists && attempts < 10) {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            let random = '';
            for (let i = 0; i < 8; i++) random += chars.charAt(Math.floor(Math.random() * chars.length));
            licence_key = `ULUKA-${random}`;
            const check = await pool.query('SELECT licence_key FROM licences WHERE licence_key = $1', [licence_key]);
            if (check.rows.length === 0) keyExists = false;
            attempts++;
        }
        if (keyExists) return res.status(500).json({ error: 'Failed to generate unique key' });

        const result = await pool.query(
            `INSERT INTO licences (
                licence_key, client_name, subscription, expires_on, equity_cap, status,
                duration, account_id, telegram_id, email, hwid, creation_date, activations, blacklisted
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), 0, FALSE)
            RETURNING *`,
            [licence_key, client_name, subscription, expires_on, equity_cap, status,
             duration, account_id, telegram_id, email, hwid]
        );

        res.status(201).json({
            success: true,
            message: 'Licence key generated!',
            licence: result.rows[0]
        });
    } catch (error) {
        console.error('🔥 Key gen error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/admin/generate', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Uluka Ultra – Key Generator</title>
    <style>
        body {
            background: #060D1A;
            color: #e0e0e0;
            font-family: 'Courier New', monospace;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
        }
        .container {
            background: #0C1830;
            border: 1px solid #1A304A;
            border-radius: 12px;
            padding: 40px;
            width: 100%;
            max-width: 480px;
            box-shadow: 0 8px 30px rgba(0,0,0,0.8);
        }
        h1 {
            color: #F0B429;
            text-align: center;
            letter-spacing: 2px;
            font-size: 22px;
            margin-top: 0;
            margin-bottom: 30px;
        }
        label {
            display: block;
            margin-top: 16px;
            font-size: 11px;
            color: #8899BB;
            letter-spacing: 1px;
            text-transform: uppercase;
        }
        input, select {
            width: 100%;
            padding: 12px;
            background: #060D1A;
            border: 1px solid #1A304A;
            border-radius: 6px;
            color: #ffffff;
            font-size: 14px;
            box-sizing: border-box;
            margin-top: 4px;
        }
        input:focus, select:focus {
            border-color: #F0B429;
            outline: none;
        }
        button {
            width: 100%;
            padding: 14px;
            background: #F0B429;
            border: none;
            border-radius: 6px;
            color: #060D1A;
            font-weight: bold;
            font-size: 16px;
            cursor: pointer;
            margin-top: 24px;
            letter-spacing: 2px;
            transition: background 0.2s;
        }
        button:hover {
            background: #d19b1f;
        }
        #result {
            margin-top: 24px;
            padding: 16px;
            border-radius: 6px;
            background: #060D1A;
            border: 1px solid #1A304A;
            word-break: break-all;
            font-size: 14px;
            display: none;
        }
        #result.success {
            border-color: #00FF88;
            display: block;
        }
        #result.error {
            border-color: #FF5555;
            display: block;
        }
        .key-highlight {
            color: #F0B429;
            font-weight: bold;
            font-size: 18px;
            background: #0C1830;
            padding: 8px 12px;
            border-radius: 4px;
            display: inline-block;
        }
        .footer {
            margin-top: 20px;
            text-align: center;
            font-size: 10px;
            color: #334466;
        }
        .subtitle {
            text-align: center;
            color: #8899BB;
            font-size: 12px;
            margin-top: -10px;
            margin-bottom: 10px;
        }
    </style>
</head>
<body>
<div class="container">
    <h1>🦉 ULUKA ULTRA</h1>
    <div class="subtitle">One‑Click Key Generator</div>

    <form id="keyForm">
        <label>Client Name *</label>
        <input type="text" id="client_name" placeholder="e.g. John Doe" required>

        <label>Subscription</label>
        <select id="subscription">
            <option value="PRO">PRO</option>
            <option value="PREMIUM">PREMIUM</option>
            <option value="TRIAL">TRIAL</option>
            <option value="PAYE">PAYE</option>
        </select>

        <label>Expiry Date *</label>
        <input type="date" id="expires_on" required>

                <label>Equity Cap ($)</label>
        <input type="number" id="equity_cap" placeholder="0 (no cap)" value="0">

        <label>Client Email (for reports)</label>
        <input type="email" id="email" placeholder="client@example.com">

        <label>Admin Secret *</label>
        <input type="password" id="admin_secret" placeholder="Your ADMIN_SECRET from Railway" required>

        <button type="submit">⚡ GENERATE KEY</button>
    </form>

    <div id="result"></div>
    <div class="footer">Secured · Uluka Ultra v2.5</div>
</div>

<script>
    document.getElementById('keyForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const client_name = document.getElementById('client_name').value.trim();
        const subscription = document.getElementById('subscription').value;
        const expires_on = document.getElementById('expires_on').value;
                const equity_cap = parseFloat(document.getElementById('equity_cap').value) || 0;
        const email = document.getElementById('email').value.trim();
        const admin_secret = document.getElementById('admin_secret').value.trim();

        const resultDiv = document.getElementById('result');
        resultDiv.style.display = 'block';
        resultDiv.className = '';
        resultDiv.innerHTML = '⏳ Generating...';

        if (!client_name || !expires_on || !admin_secret) {
            resultDiv.className = 'error';
            resultDiv.innerHTML = '❌ Please fill in all required fields (*).';
            return;
        }

        try {
            const response = await fetch('/api/admin/generate-key', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-admin-secret': admin_secret
                },
                                body: JSON.stringify({
                    client_name,
                    subscription,
                    expires_on,
                    equity_cap,
                    email
                })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                resultDiv.className = 'success';
                resultDiv.innerHTML = \`
                    ✅ <b>Key Generated!</b><br><br>
                    <span class="key-highlight">\${data.licence.licence_key}</span><br><br>
                    <b>Client:</b> \${data.licence.client_name}<br>
                    <b>Plan:</b> \${data.licence.subscription}<br>
                    <b>Expires:</b> \${data.licence.expires_on}<br>
                    <b>Cap:</b> $\${data.licence.equity_cap}<br>
                    <b>Email:</b> \${data.licence.email || '(not set)'}
                \`;
            } else {
                resultDiv.className = 'error';
                resultDiv.innerHTML = \`❌ Error: \${data.error || 'Unknown error'}\`;
            }
        } catch (err) {
            resultDiv.className = 'error';
            resultDiv.innerHTML = \`❌ Network error: \${err.message}\`;
        }
    });
</script>
</body>
</html>
    `);
});

// ─── ADMIN: TOP UP AI CREDITS ─────────────────────────────
app.post('/api/admin/topup-credits', async (req, res) => {
    try {
        const secret = req.headers['x-admin-secret'] || req.body.admin_secret;
        if (secret !== ADMIN_SECRET) {
            return res.status(401).json({ error: 'Unauthorized: Invalid admin secret' });
        }

        const { account_id, amount } = req.body;

        if (!account_id) {
            return res.status(400).json({ error: 'Missing account_id' });
        }
        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
            return res.status(400).json({ error: 'Invalid amount (must be a positive number)' });
        }

        const finalAmount = parseFloat(amount);

        // Check if the billing record exists
        const check = await pool.query('SELECT account_id FROM billing WHERE account_id = $1', [account_id]);
        if (check.rows.length === 0) {
            // Create a new billing record if it doesn't exist yet
            await pool.query(
                `INSERT INTO billing (account_id, ai_credits, ai_credits_reset_month) 
                 VALUES ($1, $2, EXTRACT(MONTH FROM NOW()))`,
                [account_id, finalAmount]
            );
        } else {
            // Add the amount to existing credits
            await pool.query(
                'UPDATE billing SET ai_credits = ai_credits + $1 WHERE account_id = $2',
                [finalAmount, account_id]
            );
        }

        // Fetch the new balance to return
        const updated = await pool.query('SELECT ai_credits FROM billing WHERE account_id = $1', [account_id]);
        const newBalance = parseFloat(updated.rows[0]?.ai_credits || 0);

        console.log(`🔋 AI credits topped up for account ${account_id}: +${finalAmount} (new balance: ${newBalance})`);

        res.json({
            success: true,
            message: `Credits added successfully!`,
            account_id: account_id,
            amount_added: finalAmount,
            new_balance: newBalance
        });

    } catch (error) {
        console.error('🔥 Top-up error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── ADMIN: TOP-UP UI ──────────────────────────────────────
app.get('/admin/topup', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Uluka Ultra – Top-Up AI Credits</title>
    <style>
        body {
            background: #060D1A;
            color: #e0e0e0;
            font-family: 'Courier New', monospace;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
        }
        .container {
            background: #0C1830;
            border: 1px solid #1A304A;
            border-radius: 12px;
            padding: 40px;
            width: 100%;
            max-width: 480px;
            box-shadow: 0 8px 30px rgba(0,0,0,0.8);
        }
        h1 {
            color: #F0B429;
            text-align: center;
            letter-spacing: 2px;
            font-size: 22px;
            margin-top: 0;
            margin-bottom: 30px;
        }
        label {
            display: block;
            margin-top: 16px;
            font-size: 11px;
            color: #8899BB;
            letter-spacing: 1px;
            text-transform: uppercase;
        }
        input, select {
            width: 100%;
            padding: 12px;
            background: #060D1A;
            border: 1px solid #1A304A;
            border-radius: 6px;
            color: #ffffff;
            font-size: 14px;
            box-sizing: border-box;
            margin-top: 4px;
        }
        input:focus, select:focus {
            border-color: #F0B429;
            outline: none;
        }
        button {
            width: 100%;
            padding: 14px;
            background: #F0B429;
            border: none;
            border-radius: 6px;
            color: #060D1A;
            font-weight: bold;
            font-size: 16px;
            cursor: pointer;
            margin-top: 24px;
            letter-spacing: 2px;
            transition: background 0.2s;
        }
        button:hover {
            background: #d19b1f;
        }
        #result {
            margin-top: 24px;
            padding: 16px;
            border-radius: 6px;
            background: #060D1A;
            border: 1px solid #1A304A;
            word-break: break-all;
            font-size: 14px;
            display: none;
        }
        #result.success {
            border-color: #00FF88;
            display: block;
        }
        #result.error {
            border-color: #FF5555;
            display: block;
        }
        .footer {
            margin-top: 20px;
            text-align: center;
            font-size: 10px;
            color: #334466;
        }
        .subtitle {
            text-align: center;
            color: #8899BB;
            font-size: 12px;
            margin-top: -10px;
            margin-bottom: 10px;
        }
    </style>
</head>
<body>
<div class="container">
    <h1>🔋 TOP UP AI CREDITS</h1>
    <div class="subtitle">Refill a client's wallet instantly</div>

    <form id="topupForm">
        <label>Account ID *</label>
        <input type="text" id="account_id" placeholder="e.g. 123456789" required>

        <label>Amount ($) *</label>
        <input type="number" id="amount" placeholder="e.g. 10.00" step="0.01" min="0.01" required>

        <label>Admin Secret *</label>
        <input type="password" id="admin_secret" placeholder="Your ADMIN_SECRET from Railway" required>

        <button type="submit">⚡ TOP UP CREDITS</button>
    </form>

    <div id="result"></div>
    <div class="footer">Secured · Uluka Ultra v2.5</div>
</div>

<script>
    document.getElementById('topupForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const account_id = document.getElementById('account_id').value.trim();
        const amount = parseFloat(document.getElementById('amount').value) || 0;
        const admin_secret = document.getElementById('admin_secret').value.trim();

        const resultDiv = document.getElementById('result');
        resultDiv.style.display = 'block';
        resultDiv.className = '';
        resultDiv.innerHTML = '⏳ Processing...';

        if (!account_id || !amount || !admin_secret) {
            resultDiv.className = 'error';
            resultDiv.innerHTML = '❌ Please fill in all required fields.';
            return;
        }

        try {
            const response = await fetch('/api/admin/topup-credits', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-admin-secret': admin_secret
                },
                body: JSON.stringify({
                    account_id: account_id,
                    amount: amount
                })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                resultDiv.className = 'success';
                resultDiv.innerHTML = \`
                    ✅ <b>Credits Added!</b><br><br>
                    <b>Account:</b> \${data.account_id}<br>
                    <b>Added:</b> $\${data.amount_added}<br>
                    <b>New Balance:</b> $\${data.new_balance}
                \`;
            } else {
                resultDiv.className = 'error';
                resultDiv.innerHTML = \`❌ Error: \${data.error || 'Unknown error'}\`;
            }
        } catch (err) {
            resultDiv.className = 'error';
            resultDiv.innerHTML = \`❌ Network error: \${err.message}\`;
        }
    });
</script>
</body>
</html>
    `);
});
// ─── ADMIN: CHECK AI CREDITS ──────────────────────────────
app.get('/api/admin/check-credits/:account_id', async (req, res) => {
    const accountId = req.params.account_id;
    try {
        const result = await pool.query(
            'SELECT ai_credits, ai_credits_reset_month FROM billing WHERE account_id = $1',
            [accountId]
        );
        if (result.rows.length === 0) {
            return res.json({ 
                account_id: accountId, 
                ai_credits: 0, 
                message: 'No billing record found for this account. EA will create one on first AI call.' 
            });
        }
        const row = result.rows[0];
        res.json({
            account_id: accountId,
            ai_credits: parseFloat(row.ai_credits || 0),
            ai_credits_reset_month: parseInt(row.ai_credits_reset_month || 0),
            message: 'OK'
        });
    } catch (err) {
        console.error('Credit check error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// ADMIN ENDPOINTS FOR SCHEDULED TASKS
// ============================================================

app.get('/admin/run-expiry', async (req, res) => {
    const secret = req.query.secret;
    if (secret !== ADMIN_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const result = await pool.query(
            `UPDATE licences SET status = 'EXPIRED' WHERE expires_on < NOW() AND status = 'ACTIVE' RETURNING licence_key, client_name`
        );
        const expired = result.rows;
        if (expired.length > 0) {
            const names = expired.map(r => r.client_name).join('\n');
            await sendAdminAlert(`⏰ <b>LICENCES EXPIRED</b>\n${expired.length} licences:\n${names}`);
        }
        res.json({ success: true, expiredCount: expired.length, details: expired });
    } catch (err) {
        console.error('Expiry check error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/admin/run-offline-check', async (req, res) => {
    const secret = req.query.secret;
    if (secret !== ADMIN_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const result = await pool.query(
            `SELECT account_id, client_name, last_sync 
             FROM billing 
             WHERE status = 'ACTIVE' AND (last_sync IS NULL OR last_sync < NOW() - INTERVAL '48 hours')`
        );
        const offline = result.rows;
        if (offline.length > 0) {
            let msg = `📡 <b>EA OFFLINE ALERT</b>\n${offline.length} accounts have not synced in 48h:\n\n`;
            offline.forEach(r => {
                msg += `👤 ${r.client_name} (${r.account_id}) – last sync: ${r.last_sync ? r.last_sync.toLocaleString() : 'Never'}\n`;
            });
            await sendAdminAlert(msg);
        }
        res.json({ success: true, offlineCount: offline.length, details: offline });
    } catch (err) {
        console.error('Offline check error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/admin/test-alert', async (req, res) => {
    const secret = req.query.secret;
    if (secret !== ADMIN_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const ok = await sendAdminAlert('✅ <b>System Online v2.5</b>\nUluka Activated\nTime: ' + new Date().toLocaleString());
        res.json({ success: ok, message: ok ? 'Test alert sent!' : 'Failed to send.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/admin/clear-hwid', async (req, res) => {
    const secret = req.headers['x-admin-secret'] || req.body.admin_secret;
    if (secret !== ADMIN_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const { licence_key } = req.body;
    if (!licence_key) {
        return res.status(400).json({ error: 'Missing licence_key' });
    }
    try {
        const result = await pool.query(
            `UPDATE licences 
             SET hwid = NULL, account_id = NULL, instance_ids = '{}', activations = 0 
             WHERE licence_key = $1 
             RETURNING licence_key, client_name`,
            [licence_key]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Licence not found' });
        }
        await sendAdminAlert(`🔓 <b>HWID CLEARED</b>\nKey: <code>${licence_key}</code>\nClient: ${result.rows[0].client_name}`);
        res.json({ success: true, message: 'HWID and bindings cleared for ' + licence_key });
    } catch (err) {
        console.error('Clear HWID error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── Scheduled Jobs ──────────────────────────────────────────
setInterval(async () => {
    try {
        const result = await pool.query(
            `UPDATE licences SET status = 'EXPIRED' WHERE expires_on < NOW() AND status = 'ACTIVE' RETURNING licence_key, client_name`
        );
        if (result.rows.length > 0) {
            const names = result.rows.map(r => r.client_name).join('\n');
            await sendAdminAlert(`⏰ <b>AUTO-EXPIRY</b>\n${result.rows.length} licences expired:\n${names}`);
        }
    } catch (err) {
        console.error('Scheduled expiry check error:', err.message);
    }
}, 60 * 60 * 1000); // 1 hour

setInterval(async () => {
    try {
        const result = await pool.query(
            `SELECT account_id, client_name, last_sync 
             FROM billing 
             WHERE status = 'ACTIVE' AND (last_sync IS NULL OR last_sync < NOW() - INTERVAL '48 hours')`
        );
        if (result.rows.length > 0) {
            let msg = `📡 <b>AUTO-OFFLINE ALERT</b>\n${result.rows.length} accounts offline for 48h:\n\n`;
            result.rows.forEach(r => {
                msg += `👤 ${r.client_name} (${r.account_id}) – last sync: ${r.last_sync ? r.last_sync.toLocaleString() : 'Never'}\n`;
            });
            await sendAdminAlert(msg);
        }
    } catch (err) {
        console.error('Scheduled offline check error:', err.message);
    }
}, 6 * 60 * 60 * 1000); // 6 hours

console.log('✅ Scheduled jobs started: expiry (1h), offline (6h)');

// ─── Rate limiting ────────────────────────────────────────────
const rateLimitCache = {};

function isRateLimited(accountId, limitSeconds = 3) {
    const key = `ratelimit_${accountId}`;
    const now = Date.now();
    if (rateLimitCache[key] && (now - rateLimitCache[key]) < limitSeconds * 1000) {
        return true;
    }
    rateLimitCache[key] = now;
    return false;
}

// ─── POST / (Handles ALL EA background POSTs) ──────────────
app.post('/', async (req, res) => {
    try {
        console.log('📥 [POST /] received');
        console.log('  Type:', req.body?.type || 'undefined');

        const d = req.body;
        const type = d.type;
        const account = d.account || d.account_id || 'unknown';

                // ─── 0. VALIDATE (FIX FOR 403 ERROR) ─────────────────────
        if (type === 'validate') {
            console.log('🔍 [POST /] Validating licence...');
            const result = await handleValidation({
                key: d.key || '',
                account: d.account || '',
                instance: d.instance || '',
                balance: d.balance || '',
                broker: d.broker || '',
                hwid: d.hwid || '',
                personal_chat_id: d.personal_chat_id || ''
            });
            console.log('📤 [POST /] Validation result:', result.status, result.body);
            return res.status(result.status).send(result.body);
        }

        const skipRateLimit = ['BILLING_SYNC', 'validate', 'OPEN_POSITIONS'];
        if (account !== 'unknown' && !skipRateLimit.includes(type) && isRateLimited(account, 3)) {
            console.warn('Rate limited:', account, type);
            return res.status(429).send('RATE_LIMITED');
        }

       // ─── 1. BILLING_SYNC ───────────────────────────────────
if (type === 'BILLING_SYNC') {
    if (!d.account) return res.status(400).send('MISSING_ACCOUNT');
    const existing = await pool.query('SELECT * FROM billing WHERE account_id = $1', [d.account]);
    if (existing.rows[0]) {
        await pool.query(
            `UPDATE billing SET 
                current_balance = $1, 
                net_profit = $2, 
                payee_25 = $3, 
                dd_percent = $4, 
                last_sync = NOW() 
            WHERE account_id = $5`,
            [
                parseFloat(d.balance || 0),
                parseFloat(d.balance || 0) - existing.rows[0].start_balance,
                Math.max(0, (parseFloat(d.balance || 0) - existing.rows[0].start_balance) * 0.25),
                d.dd_percent || '0.00%',
                d.account
            ]
        );
    } else {
        await pool.query(
            `INSERT INTO billing (account_id, client_name, start_balance, current_balance, net_profit, payee_25, status, initial_equity, dd_percent, payee_limit, last_sync, broker) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11)`,
            [d.account, d.client || 'New Client', parseFloat(d.balance || 0), parseFloat(d.balance || 0), 0, 0, 'ACTIVE', parseFloat(d.balance || 0), d.dd_percent || '0.00%', DEFAULT_PAYEE_LIMIT, d.broker || '']
        );
    }
        // ✅ FIX: Also stamp licences.last_sync so dashboards reading that table stay current
    await pool.query(
        'UPDATE licences SET last_sync = NOW() WHERE account_id = $1',
        [d.account]
    );

    const billing = await pool.query('SELECT status FROM billing WHERE account_id = $1', [d.account]);
    if (billing.rows[0] && billing.rows[0].status === 'PAUSED') return res.send('PAUSED');
    return res.send('SUCCESS');
}

        // ─── 2. OPEN_POSITIONS ──────────────────────────────────
        if (type === 'OPEN_POSITIONS') {
            if (!d.account_id) return res.status(400).send('MISSING_ACCOUNT');
            await pool.query('DELETE FROM open_positions WHERE account_id = $1', [d.account_id]);
            for (const p of (d.positions || [])) {
                await pool.query(
                    `INSERT INTO open_positions (account_id, symbol, direction, lot, open_price, pips, floating_pnl, strategy, ticket, updated) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
                    [d.account_id, p.symbol, p.direction, parseFloat(p.lot || 0), parseFloat(p.open_price || 0), parseFloat(p.pips || 0), parseFloat(p.floating_pnl || 0), p.strategy || '', p.ticket || '']
                );
            }
            return res.send('OK');
        }

        // ─── 3. TRADE_LOG ──────────────────────────────────────
        if (type === 'TRADE_LOG') {
            await pool.query(
                `INSERT INTO trade_log (time, account_id, source, symbol, action, price, lot, pnl, result, strategy, balance, equity, ai_decision, ai_reason, news_sentiment, news_summary, cot_sentiment, shadow_mode, client_name) VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
                [d.account_id, d.source || 'UNKNOWN', d.symbol, d.action, d.price || 0, d.lot || 0, d.pnl_value || 0, d.pnl_text || '', d.strategy || '', d.balance || 0, d.equity || 0, d.ai_decision || 'N/A', d.ai_reason || '', d.news_sentiment || 'NEUTRAL', d.news_summary || '', d.cot_sentiment || 'NEUTRAL', d.shadow_mode === 'TRUE', d.client || '']
            );
            return res.send('OK');
        }

                // ─── 4. AI_DECISION ─────────────────────────────────────
        if (type === 'AI_DECISION') {
            if (!CLAUDE_API_KEY) {
                return res.json({
                    decision: 'TAKE',
                    confidence_adjustment: 0,
                    risk_multiplier: 1.0,
                    reason: 'No Claude key',
                    news_sentiment: 'NEUTRAL',
                    news_summary: '',
                    cot_sentiment: 'NEUTRAL'
                });
            }

            const accId = d.account || d.account_id || 'unknown';

            // 1. Check / reset monthly credits
            try {
                const credResult = await pool.query(
                    'SELECT ai_credits, ai_credits_reset_month FROM billing WHERE account_id = $1',
                    [accId]
                );
                let row = credResult.rows[0];
                
                // If no billing row exists, create one with default 10.00
                if (!row) {
                    await pool.query(
                        'INSERT INTO billing (account_id, ai_credits, ai_credits_reset_month) VALUES ($1, 10.00, EXTRACT(MONTH FROM NOW()))',
                        [accId]
                    );
                    row = { ai_credits: 10.00, ai_credits_reset_month: new Date().getMonth() + 1 };
                }

                let credits = parseFloat(row.ai_credits);
                let resetMonth = parseInt(row.ai_credits_reset_month);
                const currentMonth = new Date().getMonth() + 1;

                // Reset credits at the start of each month
                if (currentMonth !== resetMonth) {
                    credits = 10.00;   // Reset to $10 monthly allowance
                    resetMonth = currentMonth;
                    await pool.query(
                        'UPDATE billing SET ai_credits = 10.00, ai_credits_reset_month = $1 WHERE account_id = $2',
                        [resetMonth, accId]
                    );
                }

                // 2. If credits are exhausted → block AI with warning
                if (credits <= 0) {
                    console.log(`⛔ Monthly AI allowance exhausted for ${accId}`);
                    return res.json({
                        decision: 'TAKE',
                        reason: 'Monthly AI credits used up. Contact admin to top up.',
                        warning: 'CREDIT_EXHAUSTED'
                    });
                }

                // 3. Process AI call normally
                const context = d;
                const prompt = `
Trade: ${context.symbol} ${context.action}.
Strategy: ${context.strategy || 'Unknown'}.
Confidence: ${context.confidence || 50}.
HTF bias: ${context.htf_bias || 'NEUTRAL'}.
Session: ${context.session || 'London'}.
Daily P&L: ${context.daily_pnl || 0}.
Health: ${context.health || 50}.

Market Metrics:
- ATR ratio: ${context.atr_ratio || 1.0}
- Bollinger Width: ${context.bb_width || 0}
- ADX Strength: ${context.adx_strength || 20}

Decision logic:
TAKE if the session is reasonable, HTF bias supports the trade, and confidence is above 60%.
SKIP only if multiple conditions strongly oppose the trade (e.g., dead session, extremely low ADX, high spread, or bad health).
Make a balanced, professional judgment based on the data provided.

Respond ONLY with JSON: {"decision":"SKIP" or "TAKE","reason":"brief explanation"}
`;
                const response = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                        'x-api-key': CLAUDE_API_KEY,
                        'anthropic-version': '2023-06-01',
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'claude-haiku-4-5-20251001',
                        max_tokens: 200,
                        system: 'You are a JSON-only responder.',
                        messages: [{ role: 'user', content: prompt }]
                    })
                });
                const data = await response.json();
                let text = data.content?.[0]?.text || '{"decision":"TAKE","reason":"Fallback"}';
                const match = text.match(/\{.*\}/s);
                
                if (match) {
                    const result = JSON.parse(match[0]);
                    
                    // 🔥 Deduct cost (approximately $0.0003 per call)
                    const callCost = 0.0003;
                    await pool.query('UPDATE billing SET ai_credits = ai_credits - $1 WHERE account_id = $2', [callCost, accId]);

                    return res.json({
                        decision: result.decision === 'TAKE' ? 'TAKE' : 'SKIP',
                        confidence_adjustment: parseInt(result.confidence_adjustment) || 0,
                        risk_multiplier: parseFloat(result.risk_multiplier) || 1.0,
                        reason: result.reason || '',
                        news_sentiment: result.news_sentiment || 'NEUTRAL',
                        news_summary: result.news_summary || '',
                        cot_sentiment: result.cot_sentiment || 'NEUTRAL'
                    });
                }
                return res.json({ decision: 'TAKE', reason: 'Claude parse fallback' });

            } catch (creditErr) {
                console.error('AI Credit system error:', creditErr.message);
                return res.json({ decision: 'TAKE', reason: 'Credit system error' });
            }
        }

        // ─── 5. ActivationAlert ──────────────────────────────────
if (type === 'ActivationAlert') {
    console.log('📢 Activation alert received from:', d.source, d.client);
    await sendAdminAlert(`🖥 EA ACTIVATION\n${d.text || 'Client activated'}`);

    // Fetch full licence + billing data for the card
    let cardData = {
        client_name: d.client,
        account_id: d.account || d.account_id,
        broker: d.broker,
        symbol: d.symbol,
        plan: 'PAYE',
        balance: d.balance,
        equity: d.equity,
        time: d.time || new Date().toISOString().slice(0,16).replace('T',' ')
    };
    try {
        const accId = d.account || d.account_id;
        if (accId) {
            const lic = await pool.query('SELECT client_name, subscription FROM licences WHERE account_id = $1', [accId]);
            const bill = await pool.query('SELECT current_balance FROM billing WHERE account_id = $1', [accId]);
            if (lic.rows[0]) {
                cardData.client_name = lic.rows[0].client_name || cardData.client_name;
                cardData.plan = lic.rows[0].subscription || 'PAYE';
            }
            if (bill.rows[0]) {
                cardData.balance = parseFloat(bill.rows[0].current_balance || 0).toFixed(2);
            }
        }
    } catch(e) { console.warn('Activation data fetch:', e.message); }

    const activationImg = await renderCard(buildActivationCardHTML(cardData));
    if (activationImg && ADMIN_CHAT_ID) {
        await sendPhotoToChat(ADMIN_CHAT_ID, activationImg,
            `🟢 <b>NEW ACTIVATION — ${cardData.client_name}</b>`);
    }
    return res.send('OK');
}

        // ─── 6. TRADE_CLOSE ─────────────────────────────────────
        if (type === 'TRADE_CLOSE') {
    // 🔥 BLOCK ANYTHING THAT IS NOT MASTER
    if ((d.source || '').toUpperCase() !== 'MASTER') {
        console.log('📥 Blocked non-MASTER TRADE_CLOSE:', d.source);
        return res.send('NON_MASTER_BLOCKED');
    }
            try {
                const msg = `🦉 TRADE CLOSED\n${d.result} — ${d.symbol}\nP&L: $${d.profit}\nReason: ${d.reason}\nTicket: ${d.ticket}`;
                if (PREMIUM_GROUP_ID) await sendToTelegram(PREMIUM_GROUP_ID, msg);
                if (FREE_GROUP_ID) await sendToTelegram(FREE_GROUP_ID, `🦉 UPDATE\n${d.result} on ${d.symbol}\n💎 Join Premium for details`);
                return res.send('CLOSE_OK');
            } catch(e) {
                console.error('🔥 TRADE_CLOSE error:', e.message);
                return res.status(500).send('ERROR');
            }
        }

                       // ─── 6. TRADE_CLOSE ───────────────────────────────────────
if (type === 'TRADE_CLOSE') {
    if ((d.source || '').toUpperCase() !== 'MASTER') {
        console.log('📥 Blocked non-MASTER TRADE_CLOSE:', d.source);
        return res.send('NON_MASTER_BLOCKED');
    }
    try {
        const profit = parseFloat(d.profit || 0);
        const profitStr = (profit >= 0 ? '+' : '-') + '$' + Math.abs(profit).toFixed(2);
        const msg = `🦉 <b>TRADE CLOSED</b>\n${d.result} — ${d.symbol}\nP&L: <b>${profitStr}</b>\nReason: ${d.reason}\nTicket: ${d.ticket}`;
        if (PREMIUM_GROUP_ID) await sendToTelegram(PREMIUM_GROUP_ID, msg);
        if (FREE_GROUP_ID) await sendToTelegram(FREE_GROUP_ID, `🦉 UPDATE\n${d.result} on ${d.symbol}\n💎 Join Premium for details`);

        // ─── Render + send CLOSE card to both groups ───
        const cardData = {
            symbol: d.symbol,
            direction: d.direction || d.action,
            result: d.result,
            reason: d.reason,
            profit: profit,
            daily_pnl: d.daily_pnl,
            ticket: d.ticket,
            health: d.health,
            time: d.time
        };
        const closeImg = await renderCard(buildCloseCardHTML(cardData));
        if (closeImg) {
            const caption = `${profit > 0 ? '✅' : '❌'} <b>${d.result} — ${d.symbol}</b> · ${profitStr}`;
            if (PREMIUM_GROUP_ID) await sendPhotoToChat(PREMIUM_GROUP_ID, closeImg, caption);
            if (FREE_GROUP_ID) await sendPhotoToChat(FREE_GROUP_ID, closeImg, caption);
        }

        return res.send('CLOSE_OK');
    } catch(e) {
        console.error('🔥 TRADE_CLOSE error:', e.message);
        return res.status(500).send('ERROR');
    }
}

       // ─── 8. POSITION_UPDATE ──────────────────────────────────
if (type === 'POSITION_UPDATE') {
    if ((d.source || '').toUpperCase() !== 'MASTER') {
        console.log('📥 Blocked non-MASTER POSITION_UPDATE:', d.source);
        return res.send('NON_MASTER_BLOCKED');
    }
    try {
        const msg = `⚖️ <b>POSITION UPDATE</b>\n${d.symbol} ${d.direction}\nNew SL: <b>${d.new_sl}</b>\n${d.be_text || ''}`;
        if (PREMIUM_GROUP_ID) await sendToTelegram(PREMIUM_GROUP_ID, msg);

        // ─── Render + send SL UPDATE card to Premium only ───
        const slImg = await renderCard(buildSLUpdateCardHTML({
            symbol: d.symbol, direction: d.direction, ticket: d.ticket,
            entry: d.entry, new_sl: d.new_sl, open_pnl: d.open_pnl,
            be_text: d.be_text || (d.update_type === 'BE_SET' ? 'Stop moved to Break-Even — trade is now risk-free' : 'Trailing stop tightened'),
            time: new Date().toISOString().slice(0,16).replace('T',' ')
        }));
        if (slImg && PREMIUM_GROUP_ID) {
            await sendPhotoToChat(PREMIUM_GROUP_ID, slImg,
                `🛡️ <b>SL UPDATED — ${d.symbol} #${d.ticket}</b>`);
        }

        return res.send('OK');
    } catch(e) {
        console.error('🔥 POSITION_UPDATE error:', e.message);
        return res.status(500).send('ERROR');
    }
}

        // ─── 9. GuardianAlert ────────────────────────────────────
        if (type === 'GuardianAlert') {
            try {
                const msg = `👼 GUARDIAN ANGEL\n${d.msg || 'Alert triggered'}\nClient: ${d.client || ''}\nAccount: ${d.account || ''}\nDD: ${d.dd || 'N/A'}%\nEquity: $${d.equity || 'N/A'}`;
                if (ADMIN_CHAT_ID) await sendToTelegram(ADMIN_CHAT_ID, msg);
                return res.send('OK');
            } catch(e) {
                console.error('🔥 GuardianAlert error:', e.message);
                return res.status(500).send('ERROR');
            }
        }

        // ─── 10. DAILY_EOD ─────────────────────────────────────
if (type === 'DAILY_EOD') {
    try {
        const msg = `📊 <b>DAILY EOD REPORT (Master)</b>\nAccount: ${d.account_id || d.account}\nClient: ${d.client || 'Master'}\nTrades: ${d.trades}\nWins: ${d.wins} | Losses: ${d.losses}\nWin Rate: ${d.win_rate}%\nRealized: $${d.realized}\nFloating: $${d.floating}\nTotal: <b>$${d.total_pnl}</b>\nBalance: $${d.balance}\nEquity: $${d.equity}\nHealth: ${d.health}`;
        if (ADMIN_CHAT_ID) await sendToTelegram(ADMIN_CHAT_ID, msg);

        // Render + send EOD card to Admin + Premium + Free
        const eodImg = await renderCard(buildAdminEODCardHTML({
            date: d.date || new Date().toDateString(),
            trades: d.trades, wins: d.wins, losses: d.losses,
            win_rate: d.win_rate, realized: d.realized, floating: d.floating,
            total_pnl: d.total_pnl, balance: d.balance, equity: d.equity,
            health: d.health
        }));
        if (eodImg) {
            const caption = `📊 <b>EOD REPORT</b> · ${d.date || new Date().toDateString()}`;
            if (ADMIN_CHAT_ID)     await sendPhotoToChat(ADMIN_CHAT_ID,     eodImg, caption);
            if (PREMIUM_GROUP_ID)  await sendPhotoToChat(PREMIUM_GROUP_ID,  eodImg, caption);
            if (FREE_GROUP_ID)     await sendPhotoToChat(FREE_GROUP_ID,     eodImg, caption);
        }
        return res.send('OK');
    } catch(e) {
        console.error('🔥 DAILY_EOD error:', e.message);
        return res.status(500).send('ERROR');
    }
}

        // ─── 11. ClientEOD ─────────────────────────────────────
if (type === 'ClientEOD') {
    try {
        const msg = `🦉 <b>YOUR DAILY REPORT</b>\n${d.date || ''}\nP&L: <b>$${d.total_pnl || 0}</b>\nBalance: $${d.balance || 0}`;
        if (d.chat_id) await sendToTelegram(d.chat_id, msg);

        // Render + send Client EOD card
        const clientImg = await renderCard(buildClientEODCardHTML({
            client: d.client, client_name: d.client_name,
            date: d.date,
            trades: d.trades, wins: d.wins,
            total_pnl: d.total_pnl, balance: d.balance,
            health: d.health
        }));
        if (clientImg && d.chat_id) {
            await sendPhotoToChat(d.chat_id, clientImg,
                `📊 <b>Your EOD Report — ${d.date || new Date().toDateString()}</b>`);
        }
        return res.send('OK');
    } catch(e) {
        console.error('🔥 ClientEOD error:', e.message);
        return res.status(500).send('ERROR');
    }
}

        // ─── 12. LossPatternAlert ──────────────────────────────────
        if (type === 'LossPatternAlert') {
            const msg = `⚠️ <b>LOSS PATTERN DETECTED</b>\n\n` +
                        `👤 <b>Client:</b> ${d.client || 'Unknown'}\n` +
                        `📊 <b>Symbol:</b> ${d.symbol || ''}\n` +
                        `🎯 <b>Strategy:</b> ${d.strategy || ''}\n` +
                        `🕐 <b>Session:</b> ${d.session || ''}\n` +
                        `📉 <b>Win Rate:</b> ${d.win_rate || 0}% (last ${d.window || 10} trades)\n` +
                        `⚡ Consider disabling this combo.`;
            await sendAdminAlert(msg);
            if (d.chat_id) await sendToTelegram(d.chat_id, msg);
            return res.send('LP_OK');
        }

        // ─── 13. Unknown type ─────────────────────────────────────
        console.warn('⚠️ Unknown POST type:', type);
        return res.status(404).send('Not Found');
    } catch (e) {
        console.error('🔥 POST / error:', e.message);
        res.status(500).send('ERROR');
    }
});

console.log('✅ ROUTE 16 (POST /) registered');

// ============================================================
// 🆕 SPECIFIC ACCOUNT EQUITY ENDPOINT
// ============================================================
app.get('/api/equity/:account', async (req, res) => {
    const account = req.params.account;
    try {
        const result = await pool.query(
            `SELECT current_balance FROM billing WHERE account_id = $1`,
            [account]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Account not found' });
        }
        const currentBalance = parseFloat(result.rows[0].current_balance || 0);
        res.json({
            account: account,
            balance: currentBalance,
            equity: currentBalance
        });
    } catch (err) {
        console.error('🔥 /api/equity/:account error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── BACKGROUND NEWS CACHING (Finnhub Only) ──────────────
let highImpactUSDBlock = false;
let mediumImpactUSDBlock = false;
let lastNewsCheck = 0;
let lastSourceUsed = "None";

async function updateNewsCache() {
    try {
        const now = Date.now();
        let data = [];
        let sourceUsed = "";

        if (process.env.FINNHUB_API_KEY) {
            try {
                const key = process.env.FINNHUB_API_KEY;
                const url = `https://finnhub.io/api/v1/news?category=forex&minId=0&token=${key}`;
                const response = await fetch(url, { timeout: 8000 });
                if (response.ok) {
                    const news = await response.json();
                    if (Array.isArray(news) && news.length > 0) {
                        const highKeywords = ['fomc', 'fed', 'interest rate', 'nonfarm', 'cpi', 'inflation', 'gdp', 'employment'];
                        const mediumKeywords = ['jobless', 'retail', 'housing', 'durable', 'trade', 'manufacturing', 'ism', 'consumer confidence'];
                        const filtered = news
                            .filter(item => {
                                const h = (item.headline || '').toLowerCase();
                                const s = (item.summary || '').toLowerCase();
                                return h.includes('usd') || s.includes('usd') || h.includes('dollar') || s.includes('dollar');
                            })
                            .map(item => {
                                const h = (item.headline || '').toLowerCase();
                                let impact = 'MEDIUM';
                                if (highKeywords.some(kw => h.includes(kw))) impact = 'HIGH';
                                else if (mediumKeywords.some(kw => h.includes(kw))) impact = 'MEDIUM';
                                return {
                                    title: item.headline || 'N/A',
                                    impact: impact,
                                    time: new Date(item.datetime * 1000).toISOString()
                                };
                            });
                        if (filtered.length > 0) {
                            data = filtered;
                            sourceUsed = "Finnhub News";
                            console.log(`✅ Finnhub News: ${data.length} USD-related events`);
                        }
                    }
                }
            } catch (e) {
                console.warn('⚠️ Finnhub News error:', e.message);
            }
        }

        highImpactUSDBlock = false;
        mediumImpactUSDBlock = false;

        for (const event of data) {
            if (!event.time) continue;
            const eventTime = new Date(event.time).getTime();
            if (eventTime > now && (eventTime - now) < 1800000) {
                const impact = event.impact;
                if (impact === 'HIGH') {
                    highImpactUSDBlock = true;
                    console.log(`📰 HIGH EVENT: ${event.title} at ${event.time}`);
                } else if (impact === 'MEDIUM') {
                    mediumImpactUSDBlock = true;
                    console.log(`📰 MEDIUM EVENT: ${event.title} at ${event.time}`);
                }
            }
        }

        lastNewsCheck = Date.now();

        if (sourceUsed) {
            lastSourceUsed = sourceUsed;
            console.log(`📰 News cache updated from ${sourceUsed} | High: ${highImpactUSDBlock} | Medium: ${mediumImpactUSDBlock}`);
        } else {
            console.warn('⚠️ No news data – block disabled.');
        }

    } catch (err) {
        highImpactUSDBlock = false;
        mediumImpactUSDBlock = false;
        lastNewsCheck = Date.now();
        console.warn('📰 News cache error:', err.message);
    }
}
// ─── API: Test News Status ──────────────────────────────────
app.get('/api/test-news', async (req, res) => {
    const formatIST = (dateObj) => {
        return new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
        }).format(dateObj);
    };

    const nowDate = new Date();
    const lastUpdate = new Date(lastNewsCheck);

    res.json({
        status: 'SUCCESS',
        api_fetch_status: lastSourceUsed !== 'None' ? '✅ API reachable (cached)' : '❌ No API key configured',
        source_used: lastSourceUsed || 'None',
        total_events_fetched: 0,
        high_news_blocked: highImpactUSDBlock,
        medium_news_blocked: mediumImpactUSDBlock,
        message: `High: ${highImpactUSDBlock ? 'ON' : 'OFF'} | Medium: ${mediumImpactUSDBlock ? 'ON' : 'OFF'}`,
        current_server_time_utc: nowDate.toISOString(),
        current_server_time_ist: formatIST(nowDate),
        last_cache_update_utc: lastUpdate.toISOString(),
        last_cache_update_ist: formatIST(lastUpdate),
        note: 'Cache updated every hour from Finnhub. Last source: ' + lastSourceUsed
    });
});

// ─── AI EVALUATION DASHBOARD (Admin Only) ──────────────────
app.get('/api/admin/ai-evaluation', async (req, res) => {
    const secret = req.query.secret;
    if (secret !== ADMIN_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        // Grab the last 100 trades where Shadow Mode was ON (logged but not blocked)
        const query = `
            SELECT ai_decision, pnl 
            FROM trade_log 
            WHERE shadow_mode = TRUE 
            ORDER BY time DESC 
            LIMIT 500
        `;
        const result = await pool.query(query);
        const trades = result.rows;

        if (trades.length === 0) {
            return res.json({ message: "Not enough trades yet. Let the EA run in Shadow Mode for now." });
        }

        let takeCount = 0, skipCount = 0;
        let takeWins = 0, skipWins = 0;

        trades.forEach(t => {
            const ai = (t.ai_decision || '').toUpperCase();
            const pnl = parseFloat(t.pnl || 0);
            const isWin = pnl > 0.01;

            if (ai === 'TAKE') {
                takeCount++;
                if (isWin) takeWins++;
            } else if (ai === 'SKIP') {
                skipCount++;
                if (isWin) skipWins++;
            }
        });

        const takeWinRate = takeCount > 0 ? (takeWins / takeCount * 100) : 0;
        const skipWinRate = skipCount > 0 ? (skipWins / skipCount * 100) : 0;

        res.json({
            total_evaluated: trades.length,
            ai_takes: takeCount,
            ai_skips: skipCount,
            take_win_rate: parseFloat(takeWinRate.toFixed(1)),
            skip_win_rate: parseFloat(skipWinRate.toFixed(1)),
            recommendation: takeWinRate >= 60 ? "✅ Consider turning Shadow Mode OFF (Live Mode)." : "⏳ Keep Shadow Mode ON until win rate improves."
        });

    } catch (err) {
        console.error('AI Eval error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── MORNING BRIEF GENERATOR ──────────────────────────────
async function generateMorningBrief(accountId = null, clientName = null) {
    if (!CLAUDE_API_KEY) return '⚠️ Claude API key not configured.';

    // ─── FETCH LIVE PRICES ──────────────────────────────
let prices = {
    XAUUSD: 'N/A',
    XAGUSD: 'N/A',
    DXY: 'N/A'
};

// 1. Get XAU/USD from gold-api.com (free, no key)
try {
    const goldResp = await fetch('https://api.gold-api.com/price/XAU', { timeout: 5000 });
    if (goldResp.ok) {
        const goldData = await goldResp.json();
        if (goldData.price) {
            prices.XAUUSD = goldData.price.toFixed(2);
        }
    }
} catch (e) {
    console.warn('⚠️ Gold API failed:', e.message);
}

// 2. Get XAG/USD from exchangerate.host (fallback for silver)
try {
    const fxResp = await fetch('https://api.exchangerate.host/latest?base=USD&symbols=XAG', { timeout: 5000 });
    if (fxResp.ok) {
        const fxData = await fxResp.json();
        if (fxData.rates && fxData.rates.XAG) {
            prices.XAGUSD = (1 / fxData.rates.XAG).toFixed(2);
        }
    }
} catch (e) {
    console.warn('⚠️ Silver API failed:', e.message);
}

// 3. DXY – leave as 'N/A'

    let accountData = '';
    if (accountId) {
        const billingResult = await pool.query(
            `SELECT current_balance, net_profit, payee_25 FROM billing WHERE account_id = $1`,
            [accountId]
        );
        if (billingResult.rows.length > 0) {
            const b = billingResult.rows[0];
            accountData = `
Account: ${accountId}
Balance: $${parseFloat(b.current_balance || 0).toFixed(2)}
Net Profit: $${parseFloat(b.net_profit || 0).toFixed(2)}
Payee (25%): $${parseFloat(b.payee_25 || 0).toFixed(2)}
`;
        }
    }

    const today = new Date().toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });

    const prompt = `
You are Uluka Ultra's AI trading assistant. Generate a concise, professional morning trading brief for today (${today}).

**IMPORTANT – USE THESE EXACT LIVE PRICES (fetched moments ago):**
- XAUUSD (Gold): $${prices.XAUUSD} per ounce
- XAGUSD (Silver): $${prices.XAGUSD} per ounce
- DXY (Dollar Index): ${prices.DXY} (if not available, state "approx 103-104 range")

Use this structure:
1. 🌅 Brief header with date and session (London Open)
2. 📊 Market context table with the assets and the prices above
3. 🔍 Key observations (2-3 bullet points about current market conditions)
4. ⚡ Active trade reminder (if any, use the data below)
5. ⚠️ Risk reminders

**CRITICAL RULES:**
- Do NOT invent prices. If a price is listed as "N/A", write "N/A" or "unavailable".
- If you don't have a real price, do NOT guess – state that the price is not available.
- Base your analysis ONLY on the prices provided.

${accountData ? `\nCurrent account data:\n${accountData}` : ''}

Make, it professional and useful for a trader, Respond in PLAIN TEXT with markdown-style formatting (headers with #, bullet points with -, tables with |).
Do NOT wrap in JSON. Do NOT use HTML.
`;
    
    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': CLAUDE_API_KEY,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 600,
                system: 'You are a professional trading assistant. Always respond in plain text with markdown formatting. Never use JSON or HTML.',
                messages: [{ role: 'user', content: prompt }]
            })
        });

        const data = await response.json();
        return data.content?.[0]?.text || '⚠️ Unable to generate brief at this time.';
    } catch (error) {
        console.error('❌ Morning brief generation error:', error.message);
        return '⚠️ Error generating morning brief.';
    }
}

// ─── ROUTE: SEND MORNING BRIEF TO TELEGRAM ──────────────
app.post('/admin/send-morning-brief', async (req, res) => {
    const secret = req.query.secret || req.body.secret;
    if (secret !== ADMIN_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const brief = await generateMorningBrief();
        if (!brief) {
            return res.status(500).json({ error: 'Failed to generate brief' });
        }

        let sent = false;
        if (PREMIUM_GROUP_ID) {
            sent = await sendToTelegram(PREMIUM_GROUP_ID, brief);
        }
        if (FREE_GROUP_ID && !sent) {
            sent = await sendToTelegram(FREE_GROUP_ID, brief);
        }

        if (sent) {
            console.log('✅ Morning brief sent to Telegram');
            res.json({ success: true, message: 'Morning brief sent!' });
        } else {
            res.status(500).json({ error: 'Failed to send to Telegram' });
        }
    } catch (error) {
        console.error('🔥 Error sending morning brief:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ─── SCHEDULED JOB: Morning brief at London Open (08:00 GMT) ──
function scheduleMorningBrief() {
    const now = new Date();
    const nextRun = new Date(now);
    nextRun.setUTCHours(8, 0, 0, 0); // 08:00 GMT
    if (now.getUTCHours() >= 8) {
        nextRun.setUTCDate(nextRun.getUTCDate() + 1);
    }
    const delay = nextRun.getTime() - now.getTime();

    setTimeout(async () => {
        console.log('🌅 Running scheduled morning brief...');
        try {
            const brief = await generateMorningBrief();
            if (brief) {
                if (PREMIUM_GROUP_ID) await sendToTelegram(PREMIUM_GROUP_ID, brief);
                if (FREE_GROUP_ID) await sendToTelegram(FREE_GROUP_ID, brief);
                console.log('✅ Scheduled morning brief sent');
            }
        } catch (e) {
            console.error('❌ Scheduled morning brief failed:', e.message);
        }
        // Re-schedule for next day
        scheduleMorningBrief();
    }, delay);
}

// Start the scheduler
scheduleMorningBrief();
console.log('📅 Morning brief scheduler started (daily at 08:00 GMT)');


// ─── Debug: Show current news state ──────────────────────────
app.get('/news-state', (req, res) => {
    res.json({
        lastNewsCheck: lastNewsCheck,
        lastNewsCheckISO: lastNewsCheck ? new Date(lastNewsCheck).toISOString() : null,
        lastSourceUsed: lastSourceUsed,
        highImpactUSDBlock: highImpactUSDBlock,
        mediumImpactUSDBlock: mediumImpactUSDBlock,
        now: new Date().toISOString()
    });
});

// ─── Force a cache update and show result ────────────────────
app.get('/force-cache', async (req, res) => {
    await updateNewsCache();
    res.json({
        message: 'Cache updated',
        lastNewsCheck: lastNewsCheck,
        lastNewsCheckISO: new Date(lastNewsCheck).toISOString(),
        lastSourceUsed: lastSourceUsed,
        highImpactUSDBlock: highImpactUSDBlock,
        mediumImpactUSDBlock: mediumImpactUSDBlock
    });
});

// ─── GET TEST: Morning Brief (just open in browser) ──────────
app.get('/api/test-brief', async (req, res) => {
    try {
        const brief = await generateMorningBrief();
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(brief);
    } catch (e) {
        res.status(500).send('Error: ' + e.message);
    }
});

// ─── Debug: Check if FINNHUB_API_KEY is set ──────────────
app.get('/debug-key', (req, res) => {
    const key = process.env.FINNHUB_API_KEY;
    res.json({
        hasKey: !!key,
        keyLength: key ? key.length : 0,
        keyPrefix: key ? key.substring(0, 6) : 'none'
    });
});

/**
 * Send a transactional email via Brevo (fetch-based, no SDK needed)
 */
async function sendEmail({ to, subject, htmlBody, textBody }) {
  if (!BREVO_API_KEY || !SENDER_EMAIL) {
    console.error('❌ Brevo credentials missing. Check Railway variables.');
    return { ok: false, error: 'Missing credentials' };
  }
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: SENDER_NAME, email: SENDER_EMAIL },
        to: [{ email: to }],
        subject: subject,
        htmlContent: htmlBody,
        textContent: textBody || htmlBody.replace(/<[^>]+>/g, '')
      })
    });
    if (!response.ok) {
      const errorData = await response.json();
      console.error(`❌ Brevo error: ${response.status} - ${JSON.stringify(errorData)}`);
      return { ok: false, error: `HTTP ${response.status}` };
    }
    const result = await response.json();
    console.log(`📧 Email sent to ${to} | Message ID: ${result.messageId}`);
    return { ok: true, messageId: result.messageId };
  } catch (err) {
    console.error(`❌ Brevo fetch error: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

function emailWrapper(preheader, bodyHtml) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#060D1A;font-family:'Courier New',monospace;">
<div style="display:none;max-height:0;overflow:hidden;color:#060D1A;">${preheader}</div>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#060D1A;">
  <tr><td align="center" style="padding:24px 16px;">
    <table width="540" cellpadding="0" cellspacing="0" border="0"
           style="max-width:540px;background:#0C1830;border:1px solid #1A304A;border-radius:8px;overflow:hidden;">
      <tr><td height="6" style="background:#F0B429;font-size:0;">&nbsp;</td></tr>
      <tr><td style="padding:20px 28px 16px;">
        <table width="100%"><tr>
          <td><span style="font-size:11px;font-weight:bold;color:#FFFFFF;letter-spacing:3px;">ULUKA ULTRA</span><br>
              <span style="font-size:8px;color:#F0B429;letter-spacing:4px;">LIVE HOOTS</span></td>
          <td align="right"><span style="font-size:24px;">🦉</span></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:0 28px;"><div style="height:1px;background:#1A304A;"></div></td></tr>
      <tr><td style="padding:24px 28px;">${bodyHtml}</td></tr>
      <tr><td style="padding:16px 28px;background:#020810;">
        <p style="margin:0;font-size:9px;color:#334466;">@UlukaOwlbot · Automated report · Reply for support</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

const emailH1 = (text, color = '#FFFFFF') =>
  `<h1 style="margin:0 0 8px;font-size:22px;color:${color};font-family:'Courier New',monospace;">${text}</h1>`;

const emailH2 = (text, color = '#8899BB') =>
  `<h2 style="margin:20px 0 8px;font-size:10px;font-weight:normal;color:${color};letter-spacing:3px;font-family:'Courier New',monospace;">${text}</h2>`;

const emailP = (text, color = '#8899BB') =>
  `<p style="margin:0 0 14px;font-size:14px;color:${color};line-height:1.6;font-family:Arial,sans-serif;">${text}</p>`;

const emailStatRow = (label, value, valueColor = '#FFFFFF') =>
  `<tr>
    <td style="padding:10px 14px;border-bottom:1px solid #1A304A;font-size:12px;color:#8899BB;font-family:'Courier New',monospace;">${label}</td>
    <td style="padding:10px 14px;border-bottom:1px solid #1A304A;font-size:13px;font-weight:bold;color:${valueColor};font-family:'Courier New',monospace;text-align:right;">${value}</td>
  </tr>`;

const emailTable = (rows) =>
  `<table width="100%" style="background:#060D1A;border:1px solid #1A304A;border-radius:6px;margin:16px 0;">${rows}</table>`;

const emailBtn = (text, url, color = '#F0B429') =>
  `<div style="margin:20px 0 8px;"><a href="${url}" style="display:inline-block;padding:14px 28px;border:1px solid ${color};border-radius:4px;font-size:12px;font-weight:bold;color:${color};font-family:'Courier New',monospace;letter-spacing:2px;text-decoration:none;">${text}</a></div>`;

const emailHeroStat = (label, value, color = '#00FF88') =>
  `<div style="background:#060D1A;border:1px solid #1A304A;border-radius:6px;padding:20px;margin:16px 0;text-align:center;">
    <div style="font-size:9px;color:#8899BB;letter-spacing:3px;font-family:'Courier New',monospace;margin-bottom:8px;">${label}</div>
    <div style="font-size:32px;font-weight:bold;color:${color};font-family:'Courier New',monospace;">${value}</div>
  </div>`;

// ─── START NEWS CACHE ──────────────────────────────────────
updateNewsCache(); // Run once on startup
setInterval(updateNewsCache, 60 * 60 * 1000); // Refresh every hour

// ═══════════════════════════════════════════════════════════
// EMAIL SEQUENCES
// ═══════════════════════════════════════════════════════════

async function sendWeeklyPerformanceEmail(accountId) {
  const billing = await pool.query('SELECT * FROM billing WHERE account_id = $1', [accountId]);
  const lic = await pool.query('SELECT * FROM licences WHERE account_id = $1', [accountId]);
  if (!billing.rows[0] || !lic.rows[0]) return;
  const b = billing.rows[0];
  const email = lic.rows[0].email;
  if (!email) return;

  const netProfit = parseFloat(b.net_profit || 0);
  const profitStr = (netProfit >= 0 ? '+' : '') + '$' + Math.abs(netProfit).toFixed(2);
  const color = netProfit >= 0 ? '#00FF88' : '#FF5555';

  const body = `
    ${emailH1(`Good evening ${lic.rows[0].client_name},`)}
    ${emailP('Here is your weekly Uluka Ultra performance summary.')}
    ${emailHeroStat("WEEK'S REALIZED P&L", profitStr, color)}
    ${emailH2('ACCOUNT SUMMARY')}
    ${emailTable(
      emailStatRow('Current Balance', '$' + parseFloat(b.current_balance || 0).toFixed(2)) +
      emailStatRow('Net Profit', profitStr, color) +
      emailStatRow('Plan', lic.rows[0].subscription || 'PAYE')
    )}
    ${emailBtn('🦉 View Dashboard', 'https://uluka-dashboard.netlify.app')}
  `;

  await sendEmail({
    to: email,
    subject: `🦉 Weekly Report · ${profitStr} · Uluka Ultra`,
    htmlBody: emailWrapper('Your weekly results are in.', body),
  });
}

async function sendOnboardingEmail(accountId, dayNumber) {
  const lic = await pool.query('SELECT * FROM licences WHERE account_id = $1', [accountId]);
  if (!lic.rows[0] || !lic.rows[0].email) return;
  const email = lic.rows[0].email;
  const name = lic.rows[0].client_name || 'Trader';

  const templates = {
    1: {
      subject: '🦉 Welcome to Uluka Ultra — Your EA is live',
      body: `
        ${emailH1(`Welcome to the nest, ${name}.`)}
        ${emailP('Uluka Ultra is now live on your account. The AI is watching every tick across all major sessions.')}
        ${emailH2('WHAT HAPPENS FROM HERE')}
        ${emailTable(
          emailStatRow('Trade alerts', 'Card fires to Telegram when EA enters') +
          emailStatRow('SL updates', 'Break-even notification') +
          emailStatRow('EOD report', 'Daily summary at 23:50 UTC')
        )}
        ${emailBtn('🎧 Contact Support', 'https://t.me/UlukaOwlbot', '#B46FFF')}
      `,
    },
    3: {
      subject: '🦉 Day 3 with Uluka Ultra — Quick check-in',
      body: `
        ${emailH1(`3 days in, ${name}.`)}
        ${emailP('The EA has been running for 3 days. By now you have seen your first trade cards.')}
        ${emailP('<strong>The EA does not trade every day.</strong> It waits for the right conditions.')}
        ${emailBtn('🎧 Contact Support', 'https://t.me/UlukaOwlbot', '#B46FFF')}
      `,
    },
    7: {
      subject: '🦉 First Week Complete · Uluka Ultra',
      body: `
        ${emailH1('First week complete.')}
        ${emailP(`Here is how your first 7 days looked, ${name}.`)}
        ${emailP('Your weekly performance report now arrives every Friday evening automatically.')}
        ${emailBtn('🦉 Get Uluka Ultra', 'https://t.me/WiseOwlUluka', '#F0B429')}
      `,
    },
  };

  const tpl = templates[dayNumber];
  if (!tpl) return;

  await sendEmail({
    to: email,
    subject: tpl.subject,
    htmlBody: emailWrapper(`Day ${dayNumber} update.`, tpl.body),
  });
}

async function sendPaymentReminder(accountId) {
  const billing = await pool.query('SELECT * FROM billing WHERE account_id = $1', [accountId]);
  const lic = await pool.query('SELECT * FROM licences WHERE account_id = $1', [accountId]);
  if (!billing.rows[0] || !lic.rows[0]) return;
  const b = billing.rows[0];
  const email = lic.rows[0].email;
  if (!email) return;

  const netProfit = parseFloat(b.net_profit || 0);
  if (netProfit <= 0) return;

  const paye = netProfit * 0.25;
  const payeStr = '$' + Math.max(paye, 99).toFixed(2);

  const body = `
    ${emailH1(`Payment reminder, ${lic.rows[0].client_name}.`)}
    ${emailP('Your PAYE payment for last week is due today.')}
    ${emailHeroStat('AMOUNT DUE', payeStr, '#F0B429')}
    ${emailTable(
      emailStatRow("Week's Net Profit", '+$' + netProfit.toFixed(2), '#00FF88') +
      emailStatRow('Platform Fee (25%)', payeStr, '#F0B429')
    )}
    ${emailBtn('✅ Confirm Payment', 'mailto:ulukabot@gmail.com', '#00FF88')}
  `;

  await sendEmail({
    to: email,
    subject: `💰 PAYE Due Today · ${payeStr} · Uluka Ultra`,
    htmlBody: emailWrapper(`PAYE payment of ${payeStr} due today.`, body),
  });
}

async function sendMonthlyReport(accountId) {
  const billing = await pool.query('SELECT * FROM billing WHERE account_id = $1', [accountId]);
  const lic = await pool.query('SELECT * FROM licences WHERE account_id = $1', [accountId]);
  if (!billing.rows[0] || !lic.rows[0]) return;
  const b = billing.rows[0];
  const email = lic.rows[0].email;
  if (!email) return;

  const monthName = new Date().toLocaleString('en-GB', { month: 'long', year: 'numeric' });

  const body = `
    ${emailH1(`${monthName} Report`)}
    ${emailP(`Full monthly summary for ${lic.rows[0].client_name}.`)}
    ${emailHeroStat("MONTH'S P&L", '$' + parseFloat(b.net_profit || 0).toFixed(2))}
    ${emailTable(
      emailStatRow('Opening Balance', '$' + parseFloat(b.start_balance || 0).toFixed(2)) +
      emailStatRow('Closing Balance', '$' + parseFloat(b.current_balance || 0).toFixed(2)) +
      emailStatRow('Net Profit', '$' + parseFloat(b.net_profit || 0).toFixed(2))
    )}
    ${emailBtn('🦉 Uluka Ultra Channel', 'https://t.me/WiseOwlUluka', '#F0B429')}
  `;

  await sendEmail({
    to: email,
    subject: `🦉 ${monthName} Report · Uluka Ultra`,
    htmlBody: emailWrapper(`${monthName} results inside.`, body),
  });
}

// ═══════════════════════════════════════════════════════════
// CRON ENDPOINTS
// ═══════════════════════════════════════════════════════════

app.all('/cron/weekly-emails', async (req, res) => {
 const incomingSecret = req.headers['x-cron-secret'] || req.query.secret;
if (incomingSecret !== process.env.CRON_SECRET) {
    return res.status(401).send('Unauthorized');
}
  try {
    const clients = await pool.query(
      "SELECT DISTINCT account_id FROM licences WHERE status = 'ACTIVE' AND account_id IS NOT NULL"
    );
    for (const row of clients.rows) {
      await sendWeeklyPerformanceEmail(row.account_id).catch(e =>
        console.error(`Weekly email failed for ${row.account_id}:`, e.message)
      );
    }
    res.json({ ok: true, sent: clients.rows.length });
  } catch (err) {
    console.error('Cron weekly-emails error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.all('/cron/onboarding-check', async (req, res) => {
  const incomingSecret = req.headers['x-cron-secret'] || req.query.secret;
if (incomingSecret !== process.env.CRON_SECRET) {
    return res.status(401).send('Unauthorized');
}
  try {
    const result = await pool.query(`
      SELECT account_id, creation_date
      FROM licences
      WHERE status = 'ACTIVE' AND creation_date IS NOT NULL
    `);
    for (const row of result.rows) {
      const daysSince = Math.floor((Date.now() - new Date(row.creation_date)) / 86400000);
      if ([1, 3, 7].includes(daysSince)) {
        await sendOnboardingEmail(row.account_id, daysSince).catch(e =>
          console.error(`Onboarding D${daysSince} failed:`, e.message)
        );
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.all('/cron/payment-reminders', async (req, res) => {
  const incomingSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (incomingSecret !== process.env.CRON_SECRET) {
    return res.status(401).send('Unauthorized');
  }
  try {
    const clients = await pool.query(
      "SELECT account_id FROM licences WHERE status = 'ACTIVE' AND subscription LIKE '%PAYE%'"
    );
    for (const row of clients.rows) {
      await sendPaymentReminder(row.account_id).catch(e =>
        console.error(`Payment reminder failed:`, e.message)
      );
    }
    res.json({ ok: true, sent: clients.rows.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.all('/cron/monthly-reports', async (req, res) => {
  const incomingSecret = req.headers['x-cron-secret'] || req.query.secret;
if (incomingSecret !== process.env.CRON_SECRET) {
    return res.status(401).send('Unauthorized');
}
  if (new Date().getUTCDate() !== 1) {
    return res.json({ ok: true, skipped: 'Not 1st of month' });
  }
  try {
    const clients = await pool.query(
      "SELECT DISTINCT account_id FROM licences WHERE status = 'ACTIVE' AND account_id IS NOT NULL"
    );
    for (const row of clients.rows) {
      await sendMonthlyReport(row.account_id).catch(e =>
        console.error(`Monthly report failed:`, e.message)
      );
    }
    res.json({ ok: true, sent: clients.rows.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Test route — visit in browser to verify email works
app.get('/test-email', async (req, res) => {
  const result = await sendEmail({
    to: process.env.SENDER_EMAIL,
    subject: '🦉 Uluka Test Email',
    htmlBody: emailWrapper('Test', emailH1('Brevo is working!') + emailP('If you see this, email migration is complete.')),
  });
  res.json(result);
});

// ═══════════════════════════════════════════════════════════
// UNIFIED CRON DISPATCHER — runs every hour, dispatches jobs
// ═══════════════════════════════════════════════════════════
app.all('/cron/dispatcher', async (req, res) => {
  const incomingSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (incomingSecret !== process.env.CRON_SECRET) {
    return res.status(401).send('Unauthorized');
  }

  const now = new Date();
  const utcHour   = now.getUTCHours();
  const utcDay    = now.getUTCDay();   // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  const utcDate   = now.getUTCDate();
  const results   = {};

  try {
    // Friday 22:xx UTC → weekly performance emails
    if (utcDay === 5 && utcHour === 22) {
      const clients = await pool.query(
        "SELECT DISTINCT account_id FROM licences WHERE status = 'ACTIVE' AND account_id IS NOT NULL"
      );
      for (const row of clients.rows) {
        await sendWeeklyPerformanceEmail(row.account_id).catch(e =>
          console.error(`Weekly email failed for ${row.account_id}:`, e.message)
        );
      }
      results.weekly_emails = clients.rows.length;
    }

    // Every day at 09:xx UTC → onboarding check
    if (utcHour === 9) {
      const clients = await pool.query(
        "SELECT account_id, creation_date FROM licences WHERE status = 'ACTIVE' AND creation_date IS NOT NULL"
      );
      let onboardingSent = 0;
      for (const row of clients.rows) {
        const daysSince = Math.floor((Date.now() - new Date(row.creation_date)) / 86400000);
        if ([1, 3, 7].includes(daysSince)) {
          await sendOnboardingEmail(row.account_id, daysSince).catch(e =>
            console.error(`Onboarding D${daysSince} failed:`, e.message)
          );
          onboardingSent++;
        }
      }
      results.onboarding = onboardingSent;
    }

    // Monday 09:xx UTC → payment reminders
    if (utcDay === 1 && utcHour === 9) {
      const clients = await pool.query(
        "SELECT account_id FROM licences WHERE status = 'ACTIVE' AND subscription LIKE '%PAYE%'"
      );
      for (const row of clients.rows) {
        await sendPaymentReminder(row.account_id).catch(e =>
          console.error(`Payment reminder failed:`, e.message)
        );
      }
      results.payment_reminders = clients.rows.length;
    }

    // 1st of month 08:xx UTC → monthly reports
    if (utcDate === 1 && utcHour === 8) {
      const clients = await pool.query(
        "SELECT DISTINCT account_id FROM licences WHERE status = 'ACTIVE' AND account_id IS NOT NULL"
      );
      for (const row of clients.rows) {
        await sendMonthlyReport(row.account_id).catch(e =>
          console.error(`Monthly report failed:`, e.message)
        );
      }
      results.monthly_reports = clients.rows.length;
    }

    res.json({ ok: true, utcHour, utcDay, utcDate, results });
  } catch (err) {
    console.error('Dispatcher error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ⚠️ TEMPORARY — test route to trigger weekly emails via browser
// Remove this route after cron jobs are confirmed working
app.get('/test-weekly-emails', async (req, res) => {
  try {
    const clients = await pool.query(
      "SELECT DISTINCT account_id FROM licences WHERE status = 'ACTIVE' AND account_id IS NOT NULL"
    );
    const results = [];
    for (const row of clients.rows) {
      const lic = await pool.query('SELECT email FROM licences WHERE account_id = $1', [row.account_id]);
      const hasEmail = lic.rows[0]?.email ? '✅' : '❌ no email';
      results.push({ account_id: row.account_id, email_status: hasEmail });
      await sendWeeklyPerformanceEmail(row.account_id).catch(e =>
        console.error(`Weekly email failed for ${row.account_id}:`, e.message)
      );
    }
    res.json({ ok: true, sent: clients.rows.length, details: results });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// SUPPORT BOT — migrated from GAS
// ═══════════════════════════════════════════════════════════

const SUPPORT_FAQ = {
  "not trading": `🦉 <b>EA Not Trading — Common Causes</b>\n\n1. <b>Session filter</b> — EA only trades enabled sessions.\n2. <b>News window</b> — EA pauses 30-45 min before/after high-impact news.\n3. <b>Daily limit hit</b> — EA pauses until tomorrow.\n4. <b>Spread too high</b> — EA waits for tighter spread.\n5. <b>Confidence too low</b> — Market regime doesn't meet threshold.\n6. <b>No signal</b> — EA only enters when all conditions align.\n\nRun <b>/status</b> to check your EA's state. 🦉`,

  "health score": `🦉 <b>Health Score Explained</b>\n\nYour health score (0–100) reflects overall account performance:\n\n• <b>Win rate</b>\n• <b>Drawdown</b>\n• <b>Daily P&L</b>\n• <b>Streak</b>\n• <b>Risk discipline</b>\n\n<b>Green 80+</b> — Excellent\n<b>Yellow 60-79</b> — Good\n<b>Red below 60</b> — Review settings`,

  "renew": `🦉 <b>Renewal</b>\n\nYour subscription renews automatically 7 days before expiry. You'll receive a payment link here.\n\nTo check expiry, run <b>/status</b>.\n\nQuestions? Message @WiseOwlUluka.`,

  "stop loss": `🦉 <b>Stop Loss Not Showing?</b>\n\nIn <b>Stealth Mode</b>, the broker SL shows as 0. This is intentional — the EA manages SL internally.\n\nYour position IS protected. Run <b>/status</b> to see internal levels.`,

  "prop firm": `🦉 <b>Prop Firm Mode</b>\n\nEnable in EA inputs:\n• Select your firm (FTMO, FundedNext, None)\n• EA auto-sets daily/max DD/lot limits\n• Trades blocked at 80% of any limit\n\n<b>Important:</b> Verify current firm rules — they change.`,

  "telegram": `🦉 <b>Not Receiving Telegram Signals?</b>\n\n1. Set <b>Personal_Chat_ID</b> in EA inputs.\n2. Start @UlukaOwlbot (send /start).\n3. Join Premium group.\n4. First signal arrives after EA opens a trade.\n\nRun <b>/status</b> to confirm.`,

  "drawdown": `🦉 <b>Drawdown Protection</b>\n\nUluka has 3 layers:\n\n1. <b>Per-trade risk</b> — max % risked\n2. <b>Daily loss limit</b> — EA stops when hit\n3. <b>Floating DD guard</b> — closes all positions\n\nGuardian Angel monitors every 60s.`,

  "withdraw": `🦉 <b>Withdrawals</b>\n\nYou can withdraw anytime. EA trades your live balance.\n\nDeposits/withdrawals mid-month are tracked separately so PAYE stays accurate.`,

  "error": `🦉 <b>EA Error — Quick Checklist</b>\n\n1. Check MT5 Journal tab.\n2. Whitelist WebRequest URLs in MT5 Options → Expert Advisors.\n3. Confirm licence key exactly (no spaces).\n4. Contact @WiseOwlUluka if it says ACCOUNT_MISMATCH.`,
};

// Dedicated send function for the SUPPORT bot (uses SUPPORT_BOT_TOKEN)
async function sendSupportReply(chatId, text) {
  const token = process.env.SUPPORT_BOT_TOKEN;
  if (!token || !chatId) {
    console.error('❌ SUPPORT_BOT_TOKEN missing or chatId empty');
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error(`❌ Support bot send failed: ${data.description}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`❌ Support bot send error: ${err.message}`);
    return false;
  }
}

function buildSupportSystemPrompt(clientData) {
  return `You are the official AI support assistant for Uluka Ultra, an automated MT5 forex trading EA.

ABOUT ULUKA ULTRA:
- Automated Expert Advisor for MT5
- SMC (Smart Money Concepts): BOS, CHoCH, FVG, Order Blocks
- Features: Stealth SL/TP, Guardian Angel DD monitor, Break-Even, ATR trailing, DNA Fingerprint, Health Score, Prop Firm mode (FTMO/FundedNext)
- PAYE billing: 25% of client profits
- Support: @WiseOwlUluka | Bot: @UlukaOwlbot

CLIENT CONTEXT:
${clientData ? `
Name: ${clientData.name}
Account: ${clientData.account}
Balance: $${clientData.balance}
Net P&L: $${clientData.netProfit}
Plan: ${clientData.plan}
Expires: ${clientData.expires}
Status: ${clientData.status}
Drawdown: ${clientData.drawdown}
Last Sync: ${clientData.lastSync}
` : "Client not identified — general Uluka Ultra support."}

RULES:
- Answer ONLY questions about Uluka Ultra EA, trading settings, account status, billing, Telegram signals.
- If asked about unrelated topics, politely redirect to trading/EA topics.
- Be concise. Max 200 words.
- If you cannot answer, say: "I'll flag this for our team — expect a reply within 24 hours."
- Never invent features or settings.
- Always sign off with 🦉
- Format with HTML tags: <b>bold</b>, no markdown.`;
}

async function getClientByTelegramId(chatId) {
  try {
    const lic = await pool.query('SELECT * FROM licences WHERE telegram_id = $1', [String(chatId)]);
    if (!lic.rows[0]) return null;
    const l = lic.rows[0];
    const bill = await pool.query('SELECT * FROM billing WHERE account_id = $1', [l.account_id]);
    const b = bill.rows[0] || {};
    return {
      name:      l.client_name || 'Client',
      account:   l.account_id,
      plan:      l.subscription || 'Standard',
      expires:   l.expires_on,
      status:    l.status,
      balance:   parseFloat(b.current_balance || 0).toFixed(2),
      netProfit: parseFloat(b.net_profit || 0).toFixed(2),
      dd:        b.dd_percent || '0.00%',
      lastSync:  b.last_sync ? new Date(b.last_sync).toLocaleString() : 'N/A',
    };
  } catch (err) {
    console.error('getClientByTelegramId error:', err.message);
    return null;
  }
}

async function getClaudeSupport(userMessage, clientData) {
  try {
    if (!CLAUDE_API_KEY) return null;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: buildSupportSystemPrompt(clientData),
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    if (!res.ok) {
      console.error('Claude support API error:', res.status);
      return null;
    }
    const json = await res.json();
    return json.content && json.content[0] ? json.content[0].text : null;
  } catch (err) {
    console.error('getClaudeSupport error:', err.message);
    return null;
  }
}

async function escalateToAdmin(chatId, userMessage, clientData) {
  const clientInfo = clientData
    ? `${clientData.name} (Acc: ${clientData.account})`
    : `Unknown (Chat ID: ${chatId})`;
  await sendAdminAlert(
    `❓ <b>SUPPORT ESCALATION</b>\n` +
    `<b>Client:</b> ${clientInfo}\n` +
    `<b>Message:</b> "${userMessage}"\n\n` +
    `Reply directly to Chat ID: <code>${chatId}</code>`
  );
  return `🦉 Your question has been passed to our team. You'll hear back within 24 hours.\n\nFor urgent issues, contact @WiseOwlUluka directly.`;
}

function notLinkedMessage() {
  return `🦉 <b>Account Not Linked</b>\n\nYour Telegram ID isn't linked to a licence yet.\n\nMake sure your <b>Personal_Chat_ID</b> is set correctly in your EA inputs, then restart the EA.\n\nIf you're a new client, contact @WiseOwlUluka.`;
}

async function getResultsMessage() {
  try {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const t = await pool.query(
      `SELECT symbol, action, pnl, strategy FROM trade_log
       WHERE time::date = $1 ORDER BY time DESC`,
      [todayStr]
    );
    const trades = t.rows;
    let wins = 0, losses = 0, totalPnl = 0, bestPnl = 0, bestSym = '—', worstPnl = 0, worstSym = '—';
    trades.forEach(row => {
      const pnl = parseFloat(row.pnl || 0);
      totalPnl += pnl;
      if (pnl > 0) wins++; else if (pnl < 0) losses++;
      if (pnl > bestPnl)  { bestPnl = pnl; bestSym = row.symbol; }
      if (pnl < worstPnl) { worstPnl = pnl; worstSym = row.symbol; }
    });
    const winRate = trades.length > 0 ? Math.round(wins / trades.length * 100) : 0;
    const pnlStr = (totalPnl >= 0 ? '+' : '') + '$' + Math.abs(totalPnl).toFixed(2);
    const pnlIcon = totalPnl >= 0 ? '🟢' : '🔴';
    const dateStr = today.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = today.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' IST';
    if (trades.length === 0) {
      return `🦉 <b>ULUKA LIVE RESULTS</b>\n📅 ${dateStr}\n\nNo trades executed today yet.\n\nThe owl is watching — hoot fires when conditions align.\n\n<i>Updated: ${timeStr}</i>`;
    }
    let msg = `🦉 <b>ULUKA LIVE RESULTS</b>\n📅 ${dateStr}\n━━━━━━━━━━━━━━\n📊 <b>TODAY'S PERFORMANCE</b>\n`;
    msg += `• Trades:   <code>${trades.length}</code>\n`;
    msg += `• Wins:     <code>${wins}</code>  |  Losses: <code>${losses}</code>\n`;
    msg += `• Win Rate: <code>${winRate}%</code>\n`;
    msg += `${pnlIcon} P&amp;L:    <b>${pnlStr}</b>\n`;
    if (bestSym !== '—')  msg += `🏆 Best:    <code>${bestSym} +$${bestPnl.toFixed(2)}</code>\n`;
    if (worstSym !== '—') msg += `📉 Worst:   <code>${worstSym} -$${Math.abs(worstPnl).toFixed(2)}</code>\n`;
    msg += `\n<i>Live account · Updated ${timeStr}</i>\n\n💎 <b>Want Uluka trading for you?</b>\n👉 @UlukaOwlbot — PAYE model, pay only on profits.`;
    return msg;
  } catch (err) {
    console.error('getResultsMessage error:', err.message);
    return '🦉 Results temporarily unavailable. Try again shortly.';
  }
}

async function handleSupportCommand(chatId, command, clientData) {
  const cmd = command.toLowerCase().replace('/', '').split('@')[0].trim();

  if (cmd === 'start' || cmd === 'help') {
    const welcome = clientData
      ? `🦉 <b>Welcome back, ${clientData.name}!</b>\n\nHere's what I can do:\n\n`
      : `🦉 <b>Welcome to Uluka Ultra Support!</b>\n\nI don't recognise your Telegram ID yet. Make sure your <b>Personal_Chat_ID</b> is set in your EA inputs.\n\n`;
    return welcome +
      `/status — Your live account snapshot\n` +
      `/balance — Current balance & P&L\n` +
      `/health — Health score & drawdown\n` +
      `/results — Today's live performance\n` +
      `/pause — Pause your EA trading\n` +
      `/resume — Resume your EA trading\n` +
      `/renew — Subscription info\n` +
      `/help — Show this menu\n\n` +
      `Or just <b>type your question</b> — I'll answer instantly. 🦉`;
  }

  if (cmd === 'status') {
    if (!clientData) return notLinkedMessage();
    return `🦉 <b>Account Status — ${clientData.name}</b>\n\n` +
      `<b>Account:</b> ${clientData.account}\n` +
      `<b>Balance:</b> $${clientData.balance}\n` +
      `<b>Net P&L:</b> $${clientData.netProfit}\n` +
      `<b>Drawdown:</b> ${clientData.dd}\n` +
      `<b>Plan:</b> ${clientData.plan}\n` +
      `<b>Expires:</b> ${clientData.expires}\n` +
      `<b>Status:</b> ${clientData.status}\n` +
      `<b>Last Sync:</b> ${clientData.lastSync}\n\n` +
      `Need help with something specific? Just ask. 🦉`;
  }

  if (cmd === 'balance') {
    if (!clientData) return notLinkedMessage();
    const pnlSign = parseFloat(clientData.netProfit) >= 0 ? '+' : '';
    return `🦉 <b>Balance Snapshot — ${clientData.name}</b>\n\n` +
      `<b>Current Balance:</b> $${clientData.balance}\n` +
      `<b>Net P&L (all-time):</b> ${pnlSign}$${clientData.netProfit}\n` +
      `<b>Last Sync:</b> ${clientData.lastSync}\n\n` +
      `<i>Updates every 5 minutes when EA is running.</i> 🦉`;
  }

  if (cmd === 'health') {
    if (!clientData) return notLinkedMessage();
    return `🦉 <b>Account Health — ${clientData.name}</b>\n\n` +
      `<b>Status:</b> ${clientData.status}\n` +
      `<b>Drawdown:</b> ${clientData.dd}\n` +
      `<b>Last Sync:</b> ${clientData.lastSync}\n\n` +
      `Run /status for full snapshot. 🦉`;
  }

  if (cmd === 'pause') {
    if (!clientData) return notLinkedMessage();
    await pool.query("UPDATE billing SET status = 'PAUSED' WHERE account_id = $1", [clientData.account]);
    await sendAdminAlert(`⏸ <b>EA PAUSED</b>\nClient: ${clientData.name}\nAccount: ${clientData.account}\nVia /pause command`);
    return `⏸ <b>EA Paused</b>\n\nYour EA has been paused. No new trades will be opened.\n\nType /resume to restart trading. 🦉`;
  }

  if (cmd === 'resume') {
    if (!clientData) return notLinkedMessage();
    await pool.query("UPDATE billing SET status = 'ACTIVE' WHERE account_id = $1", [clientData.account]);
    await sendAdminAlert(`▶️ <b>EA RESUMED</b>\nClient: ${clientData.name}\nAccount: ${clientData.account}\nVia /resume command`);
    return `▶️ <b>EA Resumed</b>\n\nYour EA is now active. Trading resumes on the next hoot. 🦉`;
  }

  if (cmd === 'renew') {
    if (!clientData) return notLinkedMessage();
    return `🦉 <b>Subscription — ${clientData.name}</b>\n\n` +
      `<b>Plan:</b> ${clientData.plan}\n` +
      `<b>Expires:</b> ${clientData.expires}\n\n` +
      `Renewal links sent 7 days before expiry.\n\nTo renew early, contact @WiseOwlUluka. 🦉`;
  }

  if (cmd === 'results') {
    return await getResultsMessage();
  }

  return null;
}

function matchFAQ(text) {
  const lower = text.toLowerCase();
  for (const [keyword, answer] of Object.entries(SUPPORT_FAQ)) {
    if (lower.includes(keyword)) return answer;
  }
  return null;
}

async function handleTelegramUpdate(update) {
  try {
    const msg = update.message || update.edited_message;
    if (!msg) return;

    // New member joined
    if (msg.new_chat_members && msg.new_chat_members.length > 0) {
      const chatName = msg.chat.title || msg.chat.id;
      const chatId = msg.chat.id.toString();
      if (FREE_GROUP_ID && chatId === FREE_GROUP_ID) {
        msg.new_chat_members.forEach(member => {
          const name = [member.first_name, member.last_name].filter(Boolean).join(' ');
          const username = member.username ? '@' + member.username : 'no username';
          sendAdminAlert(`👋 <b>New Free Group Member</b>\n👤 ${name} (${username})\n🆔 <code>${member.id}</code>\n📢 ${chatName}`);
        });
      }
      return;
    }

    if (!msg.text) return;
    const chatId = msg.chat.id.toString();
    const text   = msg.text.trim();

    const clientData = await getClientByTelegramId(chatId);

       // Layer 1: commands
    if (text.startsWith('/')) {
      const reply = await handleSupportCommand(chatId, text, clientData);
      if (reply) {
        await sendSupportReply(chatId, reply);
        return;
      }
    }

    // Layer 2: FAQ keyword match
    const faqReply = matchFAQ(text);
    if (faqReply) {
      await sendSupportReply(chatId, faqReply);
      return;
    }

    // Layer 3: Claude AI
    const claudeReply = await getClaudeSupport(text, clientData);
    if (claudeReply) {
      await sendSupportReply(chatId, claudeReply);
      return;
    }

    // Layer 4: escalate
    const esc = await escalateToAdmin(chatId, text, clientData);
    await sendSupportReply(chatId, esc);

  } catch (err) {
    console.error('handleTelegramUpdate error:', err.message);
  }
}

// ─── Telegram webhook receiver ───
app.post('/telegram-webhook', async (req, res) => {
  // Respond to Telegram IMMEDIATELY so it doesn't retry
  res.status(200).send('OK');
  // Then process in background
  handleTelegramUpdate(req.body).catch(err =>
    console.error('Webhook processing error:', err.message)
  );
});

// ⚠️ TEMPORARY — diagnostic for Telegram delivery
app.get('/debug-telegram', async (req, res) => {
  const testId = req.query.chat_id || ADMIN_CHAT_ID;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const results = {
    token_set: !!token,
    token_prefix: token ? token.substring(0, 12) + '...' : 'MISSING',
    admin_chat_id: ADMIN_CHAT_ID,
    testing_chat_id: testId,
  };

  // Test 1 — is the token valid?
  try {
    const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const meData = await meRes.json();
    results.getMe = meData.ok ? `✅ @${meData.result.username}` : `❌ ${meData.description}`;
  } catch (e) {
    results.getMe = `❌ ${e.message}`;
  }

  // Test 2 — can we send to the chat ID?
  try {
    const sendRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: testId,
        text: '🧪 Debug test — if you see this, delivery works!',
      }),
    });
    const sendData = await sendRes.json();
    results.sendMessage = sendData.ok ? '✅ delivered' : `❌ ${sendData.description}`;
    results.telegram_response = sendData;
  } catch (e) {
    results.sendMessage = `❌ ${e.message}`;
  }

  res.json(results);
});

// Test route — simulate a Telegram message
app.get('/test-support-bot', async (req, res) => {
  const testChatId = req.query.chat_id || ADMIN_CHAT_ID;
  const testText = req.query.text || '/start';
  try {
    await handleTelegramUpdate({
      message: {
        chat: { id: testChatId, type: 'private' },
        text: testText,
        from: { id: testChatId },
      },
    });
    res.json({ ok: true, sent_to: testChatId, message: testText });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── START ──────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('Uluka Backend running on port ' + PORT));
