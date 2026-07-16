// ============================================================
// v2.5 – Full GAS Replacement + All Missing Features 
// ULUKA ULTRA — Complete Backend with Scheduled Jobs
// ============================================================

const express = require('express');
const { Pool } = require('pg');
const app = express();
app.use(express.json());

console.log('🚀 VERSION 2.5 WITH ALL FEATURES - DEPLOYED AT ' + new Date().toISOString());

// ─── CORS (allow Netlify) ────────────────────────────────
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, x-admin-secret');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
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
    console.log('🔍 SERVER SEES:', JSON.stringify(billing.rows[0]));
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

// ─── ROUTE 1: LEGACY GET ────────────────────────────────────
app.get('/', async (req, res) => {
    try {
        console.log('✅ Root route hit!');
        console.log('Query params:', req.query);
        
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
    res.json({ kill_switch: 'OFF', multiplier: 1.0, min_confidence: 65 });
});

// ─── ROUTE 5: TRADE SIGNAL ──────────────────────────────────
app.post('/hoot', async (req, res) => {
    try {
        const d = req.body;
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
Lot: ${d.lot}
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
        res.send('HOOT_SENT');
    } catch(e) { res.status(500).send('ERROR'); }
});

// ─── ROUTE 6: TRADE CLOSE ──────────────────────────────────
app.post('/close', async (req, res) => {
    try {
        const d = req.body;
        const msg = `🦉 TRADE CLOSED\n${d.result} — ${d.symbol}\nP&L: ${d.profit}\nReason: ${d.reason}\nTicket: ${d.ticket}`;
        if (PREMIUM_GROUP_ID) await sendToTelegram(PREMIUM_GROUP_ID, msg);
        if (FREE_GROUP_ID) await sendToTelegram(FREE_GROUP_ID, `🦉 UPDATE\n${d.result} on ${d.symbol}\n💎 Join Premium for details`);
        res.send('CLOSE_OK');
    } catch(e) { res.status(500).send('ERROR'); }
});

// ─── ROUTE 7: BILLING SYNC ──────────────────────────────────
app.post('/billing', async (req, res) => {
    try {
        const d = req.body;
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
        res.send('SUCCESS');
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
Confidence: ${context.confidence || 50}.
HTF bias: ${context.htf_bias || 'NEUTRAL'}.
Session: ${context.session || 'London'}.
Daily P&L: ${context.daily_pnl || 0}.
Health: ${context.health || 50}.
Last trades: ${JSON.stringify(context.last_trades || [])}.
Decision: TAKE only if all conditions strong. Default SKIP if uncertain.
Respond with JSON: {"decision":"SKIP" or "TAKE","confidence_adjustment":0,"risk_multiplier":1.0,"reason":"brief","news_sentiment":"NEUTRAL","news_summary":"","cot_sentiment":"NEUTRAL"}
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

// ─── ROUTE 15: HEALTH ───────────────────────────────────────
app.get('/health', (req, res) => res.send('OK'));

// ============================================================
// DASHBOARD API ENDPOINTS
// ============================================================

app.get('/api/public/stats', async (req, res) => {
    try {
        const activeResult = await pool.query(
            "SELECT COUNT(*) AS activeClients FROM licences WHERE status = 'ACTIVE'"
        );
        const activeClients = parseInt(activeResult.rows[0]?.activeClients || 0);

        const profitResult = await pool.query(
            "SELECT COALESCE(SUM(net_profit), 0) AS totalNetProfit FROM billing WHERE status = 'ACTIVE'"
        );
        const totalNetProfit = parseFloat(profitResult.rows[0]?.totalNetProfit || 0);

        const winRateResult = await pool.query(`
            SELECT COALESCE(
                (SELECT COUNT(*) FROM trade_log WHERE pnl > 0) * 100.0 / 
                NULLIF((SELECT COUNT(*) FROM trade_log), 0),
                0
            ) AS avgWinRate
        `);
        const avgWinRate = parseFloat(winRateResult.rows[0]?.avgWinRate || 0);

        const openPosResult = await pool.query(
            "SELECT COUNT(*) AS openPositions FROM open_positions"
        );
        const openPositions = parseInt(openPosResult.rows[0]?.openPositions || 0);

        res.json({
            activeClients,
            totalNetProfit,
            avgWinRate,
            openPositions
        });
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
        console.log('  Body:', req.body);
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
            const context = d;
            const prompt = `
Trade: ${context.symbol} ${context.action}.
Confidence: ${context.confidence || 50}.
HTF bias: ${context.htf_bias || 'NEUTRAL'}.
Session: ${context.session || 'London'}.
Daily P&L: ${context.daily_pnl || 0}.
Health: ${context.health || 50}.
Last trades: ${JSON.stringify(context.last_trades || [])}.
Decision: TAKE only if all conditions strong. Default SKIP if uncertain.
Respond with JSON: {"decision":"SKIP" or "TAKE","confidence_adjustment":0,"risk_multiplier":1.0,"reason":"brief","news_sentiment":"NEUTRAL","news_summary":"","cot_sentiment":"NEUTRAL"}
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
            return res.json({ decision: 'TAKE', reason: 'Claude parse fallback' });
        }

        // ─── 5. ActivationAlert ──────────────────────────────────
        if (type === 'ActivationAlert') {
            console.log('📢 Activation alert received from:', d.source, d.client);
            await sendAdminAlert(`🖥 EA ACTIVATION\n${d.text || 'Client activated'}`);
            return res.send('OK');
        }

        // ─── 6. TRADE_CLOSE ─────────────────────────────────────
        if (type === 'TRADE_CLOSE') {
            console.log('✅ TRADE_CLOSE matched!');
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
            try {
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
Lot: ${d.lot}
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

// ─── START ──────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('Uluka Backend running on port ' + PORT));
