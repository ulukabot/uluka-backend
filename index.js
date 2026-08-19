// ============================================================
// v2.5 – fFull GAS Replacement + All Missing Features 
// ULUKA ULTRA — Complete Backend with Scheduled Jobs
// ============================================================

const express = require('express');
const { Pool } = require('pg');
const app = express();
app.use(express.json());

console.log('🚀 VERSION 2.5 WITH ALL FEATURES - DEPLOYED AT ' + new Date().toISOString());

function parseAlphaVantageTime(timeStr) {
    if (!timeStr || timeStr.length < 15) return null;
    const year = parseInt(timeStr.substring(0, 4));
    const month = parseInt(timeStr.substring(4, 6)) - 1;
    const day = parseInt(timeStr.substring(6, 8));
    const hour = parseInt(timeStr.substring(9, 11));
    const min = parseInt(timeStr.substring(11, 13));
    const sec = parseInt(timeStr.substring(13, 15));
    return new Date(Date.UTC(year, month, day, hour, min, sec));
}

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
    res.json({ kill_switch: 'OFF', multiplier: 1.0, min_confidence: 65, news_filter: 'ON' });
});

// ─── ROUTE 4: GET /sync ─────────────────────────────────────
app.get('/sync', (req, res) => {
    res.json({ 
        kill_switch: 'OFF', 
        multiplier: 1.0, 
        min_confidence: 65,
        high_news_block: highImpactUSDBlock ? 'ON' : 'OFF',  // Separate flags
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

        try {
            // Fetch XAU/USD and XAG/USD via exchangerate.host
            // Note: base=USD, symbols=XAU,XAG returns the amount of XAU per 1 USD → we invert for USD per ounce.
            const fxResp = await fetch('https://api.exchangerate.host/latest?base=USD&symbols=XAU,XAG');
            if (fxResp.ok) {
                const fxData = await fxResp.json();
                if (fxData.rates) {
                    // exchangerate.host returns XAU per 1 USD, so 1 / rate = USD per ounce
                    if (fxData.rates.XAU) {
                        prices.XAUUSD = (1 / fxData.rates.XAU).toFixed(2);
                    }
                    if (fxData.rates.XAG) {
                        prices.XAGUSD = (1 / fxData.rates.XAG).toFixed(2);
                    }
                }
            }
        } catch (e) {
            console.warn('⚠️ Could not fetch XAU/XAG prices from exchangerate.host:', e.message);
        }

        // For DXY, we can use a simple fallback or fetch from another source.
        // For demonstration, we'll try a free DXY endpoint (e.g., from twelve data or alpha vantage).
        // If unavailable, we'll leave as 'N/A' or use a static placeholder.
        try {
            // Example: using a free DXY quote from a public API (you may need to replace with your own source)
            // Many free APIs don't provide DXY directly, but we can use the EUR/USD as a proxy, or just leave as N/A.
            // For this demo, we'll try to fetch from a simple source.
            const dxyResp = await fetch('https://api.exchangerate.host/latest?base=USD&symbols=EUR');
            if (dxyResp.ok) {
                const dxyData = await dxyResp.json();
                // Rough proxy: DXY ≈ 100 / (EUR/USD) * something? Not accurate, so we'll just provide a placeholder.
                // Instead, we'll give a neutral value and let Claude know it's a proxy.
                // Better: leave DXY as 'N/A' and let Claude use its knowledge of recent DXY levels.
                // We'll just set to a generic "~103.5" only if we can't fetch.
                // Actually, we'll just not set DXY and let Claude use common sense.
            }
        } catch (e) {}

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
                GREATEST(0, 100 - COALESCE(CAST(REPLACE(b.dd_percent, '%', '') AS NUMERIC), 0) * 10) AS health,
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
        res.json({
            ok: true,
            clientName: row.client_name,
            licence: {
                status: row.status,
                expiryDate: expiryDate.toISOString().split('T')[0],
                daysLeft: daysLeft,
                subscription: row.subscription,
                equityCap: parseFloat(row.equity_cap || 0)
            }
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
                    equity_cap
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
                    <b>Cap:</b> $\${data.licence.equity_cap}
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
                    `UPDATE billing SET current_balance = $1, net_profit = $2, payee_25 = $3, last_sync = NOW() WHERE account_id = $4`,
                    [parseFloat(d.balance || 0), parseFloat(d.balance || 0) - existing.rows[0].start_balance, Math.max(0, (parseFloat(d.balance || 0) - existing.rows[0].start_balance) * 0.25), d.account]
                );
            } else {
                await pool.query(
                    `INSERT INTO billing (account_id, client_name, start_balance, current_balance, net_profit, payee_25, status, initial_equity, dd_percent, payee_limit, last_sync, broker) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11)`,
                    [d.account, d.client || 'New Client', parseFloat(d.balance || 0), parseFloat(d.balance || 0), 0, 0, 'ACTIVE', parseFloat(d.balance || 0), '0.00%', DEFAULT_PAYEE_LIMIT, d.broker || '']
                );
            }
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

                        // ─── 7. TRADE_SIGNAL ──────────────────────────────────────
        if (type === 'TRADE_SIGNAL') {
            if ((d.source || '').toUpperCase() !== 'MASTER') {
                console.log('📥 Blocked non-MASTER TRADE_SIGNAL:', d.source);
                return res.send('NON_MASTER_BLOCKED');
            }
            try {
                // Display both fields safely
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
                if (PREMIUM_GROUP_ID) await sendToTelegram(PREMIUM_GROUP_ID, premiumMsg);
                if (FREE_GROUP_ID) await sendToTelegram(FREE_GROUP_ID, freeMsg);
                return res.send('HOOT_SENT');
            } catch(e) {
                console.error('🔥 TRADE_SIGNAL error:', e.message);
                return res.status(500).send('ERROR');
            }
        }

        // ─── 8. POSITION_UPDATE ──────────────────────────────────
       if (type === 'POSITION_UPDATE') {
    // 🔥 BLOCK ANYTHING THAT IS NOT MASTER
    if ((d.source || '').toUpperCase() !== 'MASTER') {
        console.log('📥 Blocked non-MASTER POSITION_UPDATE:', d.source);
        return res.send('NON_MASTER_BLOCKED');
    }
            try {
                const msg = `⚖️ POSITION UPDATE\n${d.symbol} ${d.direction}\nNew SL: ${d.new_sl}\n${d.be_text || ''}`;
                if (PREMIUM_GROUP_ID) await sendToTelegram(PREMIUM_GROUP_ID, msg);
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

        // ─── 10. DAILY_EOD ─────────────────────────────────────────
        if (type === 'DAILY_EOD') {
            try {
                const msg = `📊 DAILY EOD REPORT (Master)\nAccount: ${d.account_id || d.account}\nClient: ${d.client || 'Master'}\nTrades: ${d.trades}\nWins: ${d.wins}\nLosses: ${d.losses}\nWin Rate: ${d.win_rate}%\nRealized: $${d.realized}\nFloating: $${d.floating}\nTotal P&L: $${d.total_pnl}\nBalance: $${d.balance}\nEquity: $${d.equity}\nHealth: ${d.health}`;
                if (ADMIN_CHAT_ID) await sendToTelegram(ADMIN_CHAT_ID, msg);
                return res.send('OK');
            } catch(e) {
                console.error('🔥 DAILY_EOD error:', e.message);
                return res.status(500).send('ERROR');
            }
        }

        // ─── 11. ClientEOD ─────────────────────────────────────────
        if (type === 'ClientEOD') {
            try {
                const msg = `🦉 YOUR DAILY REPORT\n${d.date || ''}\nP&L: $${d.total_pnl || 0}\nBalance: $${d.balance || 0}`;
                if (d.chat_id) await sendToTelegram(d.chat_id, msg);
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

// ─── BACKGROUND NEWS CACHING (Neutral data source) ──────────────
let highImpactUSDBlock = false; // Separate flag for High
let mediumImpactUSDBlock = false; // Separate flag for Medium
let lastNewsCheck = 0;
let lastSourceUsed = "None";

async function updateNewsCache() {
    try {
        const today = new Date().toISOString().split('T')[0];
        let data = null;
        let sourceUsed = "";
        const now = Date.now();

        // ─── SOURCE 1: n1try.com ──────────────────────────
        try {
            const url = `https://n1try.com/api/forex-factory/events?date=${today}`;
            const response = await fetch(url, { headers: { 'User-Agent': 'Uluka-Backend' }, timeout: 5000 });
            if (response.ok) {
                data = await response.json();
                sourceUsed = "n1try.com";
            }
        } catch (e) { /* ignore */ }

        // ─── SOURCE 2: economic-calendar.xyz ──────────────
        if (!data) {
            try {
                const url = `https://economic-calendar.xyz/api/events?date=${today}`;
                const response = await fetch(url, { headers: { 'User-Agent': 'Uluka-Backend' }, timeout: 5000 });
                if (response.ok) {
                    data = await response.json();
                    sourceUsed = "economic-calendar.xyz";
                }
            } catch (e) { /* ignore */ }
        }

        // ─── SOURCE 3: Alpha Vantage (with time parser) ──
if (!data && process.env.ALPHA_VANTAGE_KEY) {
    try {
        const key = process.env.ALPHA_VANTAGE_KEY;
        const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=USD&limit=50&apikey=${key}`;
        const response = await fetch(url, { timeout: 8000 });
        if (response.ok) {
            const avData = await response.json();
            // Check for rate limit or error message
            if (avData.Information && avData.Information.includes('rate limit')) {
                console.warn('⚠️ Alpha Vantage rate limit reached – skipping.');
            } else if (avData.feed && Array.isArray(avData.feed)) {
                // ✅ Set sourceUsed immediately – we got a valid feed, even if empty
                sourceUsed = "Alpha Vantage";
                
                const parsed = avData.feed
                    .map(item => {
                        const dt = parseAlphaVantageTime(item.time_published);
                        if (!dt) return null;
                        return {
                            title: item.title || 'N/A',
                            impact: 'Medium',
                            time: dt.toISOString()
                        };
                    })
                    .filter(e => e !== null)
                    .map(event => {
                        const title = event.title.toLowerCase();
                        if (title.includes('fomc') || title.includes('interest rate') || title.includes('fed') ||
                            title.includes('nonfarm') || title.includes('cpi') || title.includes('inflation') ||
                            title.includes('gdp') || title.includes('employment')) {
                            event.impact = 'High';
                        } else if (title.includes('jobless') || title.includes('retail') || title.includes('housing') ||
                                   title.includes('durable') || title.includes('trade')) {
                            event.impact = 'Medium';
                        }
                        return event;
                    });
                
                // Only set data if there are upcoming events (to possibly block trades)
                if (parsed.length > 0) {
                    data = parsed;
                }
                // If parsed is empty, data stays null – that's fine, no events to block.
                console.log(`ℹ️ Alpha Vantage feed fetched (${parsed.length} upcoming events in next 30 mins).`);
            }
        }
    } catch (e) {
        console.warn('Alpha Vantage fetch error:', e.message);
    }
}

        // ─── Reset block flags ──────────────────────────────
        highImpactUSDBlock = false;
        mediumImpactUSDBlock = false;

        // ─── Parse data if available ─────────────────────────
        if (data && Array.isArray(data)) {
            for (const event of data) {
                if (!event.time) continue;
                const eventTime = new Date(event.time).getTime();
                if (eventTime > now && (eventTime - now) < 1800000) { // within next 30 mins
                    const impact = (event.impact || '').toLowerCase();
                    if (impact === 'high') {
                        highImpactUSDBlock = true;
                        console.log(`📰 HIGH EVENT CACHED (${sourceUsed}): ${event.title} at ${event.time}`);
                    } else if (impact === 'medium') {
                        mediumImpactUSDBlock = true;
                        console.log(`📰 MEDIUM EVENT CACHED (${sourceUsed}): ${event.title} at ${event.time}`);
                    }
                }
            }
        }

        lastNewsCheck = Date.now();

        if (sourceUsed) {
            lastSourceUsed = sourceUsed;
            console.log(`📰 News cache updated from ${sourceUsed} | High: ${highImpactUSDBlock} | Medium: ${mediumImpactUSDBlock}`);
        } else {
            console.warn('⚠️ No news API reachable – news block disabled.');
        }

    } catch (err) {
        highImpactUSDBlock = false;
        mediumImpactUSDBlock = false;
        lastNewsCheck = Date.now();
        console.warn('📰 News cache error:', err.message);
    }
}

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
        api_fetch_status: '✅ API reachable (cached)',
        source_used: lastSourceUsed || 'Unknown',
        total_events_fetched: 0,
        high_news_blocked: highImpactUSDBlock,
        medium_news_blocked: mediumImpactUSDBlock,
        message: `High: ${highImpactUSDBlock ? 'ON' : 'OFF'} | Medium: ${mediumImpactUSDBlock ? 'ON' : 'OFF'}`,
        current_server_time_utc: nowDate.toISOString(),
        current_server_time_ist: formatIST(nowDate),
        last_cache_update_utc: lastUpdate.toISOString(),
        last_cache_update_ist: formatIST(lastUpdate),
        note: 'Cache is updated every hour. Last successful source: ' + lastSourceUsed
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

Use this structure:
1. 🌅 Brief header with date and session (London Open)
2. 📊 Market context table (XAUUSD, XAGUSD, DXY sentiment and key levels)
3. 🔍 Key observations (2-3 bullet points about current market conditions)
4. ⚡ Active trade reminder (if any, use the data below)
5. ⚠️ Risk reminders

IMPORTANT: Respond in PLAIN TEXT with markdown-style formatting (headers with #, bullet points with -, tables with |). 
Do NOT wrap in JSON. Do NOT use HTML. Just plain text with markdown.

${accountData ? `\nCurrent account data:\n${accountData}` : ''}

Make it professional, balanced, and useful for a trader starting their day.
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

app.get('/test-av', async (req, res) => {
    const key = process.env.ALPHA_VANTAGE_KEY;
    if (!key) {
        return res.status(500).send('ALPHA_VANTAGE_KEY environment variable is not set.');
    }
    const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=USD&limit=10&apikey=${key}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        res.json(data);
    } catch (e) {
        res.status(500).send('Fetch error: ' + e.message);
    }
});

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

// ─── START ──────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('Uluka Backend running on port ' + PORT));
