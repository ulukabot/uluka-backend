// ============================================================
// v2.1.2 – Force redeploy 
// ULUKA ULTRA — Node.js Backend (Full GAS Replacement)
// Version: 2.1 — GET + POST Compatibility
// ============================================================

const express = require('express');
const { Pool } = require('pg');
const app = express();
app.use(express.json());

app.get('/ping', (req, res) => res.send('pong'));   // <-- ADD THIS
app.get('/test123', (req, res) => res.send('FIXED VERSION RUNNING'));
// ─── PostgreSQL Connection ────────────────────────────────
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ─── Environment Variables ─────────────────────────────────
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_CHAT_ID      = process.env.ADMIN_CHAT_ID      || '';
const PREMIUM_GROUP_ID   = process.env.PREMIUM_GROUP_ID   || '';
const FREE_GROUP_ID      = process.env.FREE_GROUP_ID      || '';
const CLAUDE_API_KEY     = process.env.CLAUDE_API_KEY     || '';

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

// ─── SHARED VALIDATION LOGIC ──────────────────────────────
async function handleValidation(params) {
    const { key, account, instance, balance, broker } = params;
    const licence = await pool.query(
        'SELECT * FROM licences WHERE licence_key = $1 AND status = $2',
        [key, 'ACTIVE']
    );
    if (!licence.rows[0]) return { status: 401, body: 'NOT_FOUND' };
    const lic = licence.rows[0];
    if (lic.account_id && lic.account_id !== account) {
        return { status: 403, body: 'ACCOUNT_MISMATCH' };
    }
    const billing = await pool.query('SELECT * FROM billing WHERE account_id = $1', [account]);
    if (billing.rows[0] && billing.rows[0].payee_25 >= billing.rows[0].payee_limit) {
        return { status: 403, body: 'LIMIT_BLOCK' };
    }
    if (instance && !lic.instance_ids.includes(instance)) {
        await pool.query(
            'UPDATE licences SET instance_ids = array_append(instance_ids, $1), activations = activations + 1 WHERE licence_key = $2',
            [instance, key]
        );
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
                [account, lic.client_name, parseFloat(balance), parseFloat(balance), 0, 0, 'ACTIVE', parseFloat(balance), '0.00%', 50, broker || '']
            );
        }
    }
    const d = String(new Date(lic.expires_on).getDate()).padStart(2, '0');
    const m = String(new Date(lic.expires_on).getMonth() + 1).padStart(2, '0');
    const y = new Date(lic.expires_on).getFullYear();
    return { status: 200, body: `AUTHORIZED|${d}-${m}-${y}|${lic.client_name}|${lic.equity_cap || 0}|${lic.subscription || 'PRO'}` };
}

// ─── ROUTE 1: LEGACY GET (EA uses GET with query params) ──
app.get('/', async (req, res) => {
    try {
        console.log('✅ Root route hit!');
        console.log('Query params:', req.query);
        
        const type = req.query.type;

        // If type is 'validate', handle licence validation
        if (type === 'validate') {
            console.log('🔍 Validating licence...');
            const result = await handleValidation({
                key: req.query.key || '',
                account: req.query.account || '',
                instance: req.query.instance || '',
                balance: req.query.balance || '',
                broker: req.query.broker || ''
            });
            console.log('📤 Validation result:', result.status, result.body);
            return res.status(result.status).send(result.body);
        }
        
        // For any other request (including no type), return OK
        console.log('ℹ️ Returning OK (no validate)');
        return res.send('OK');
    } catch (err) {
        console.error('🔥 Root route error:', err.message);
        console.error(err.stack);
        res.status(500).send('Internal Server Error: ' + err.message);
    }
});

// ─── ROUTE 2: POST /validate (for future compatibility) ────
app.post('/validate', async (req, res) => {
    const result = await handleValidation(req.body);
    res.status(result.status).send(result.body);
});

// ─── ROUTE 3: POST /sync (for future compatibility) ──────
app.post('/sync', (req, res) => {
    res.json({ kill_switch: 'OFF', multiplier: 1.0, min_confidence: 65, news_filter: 'ON' });
});

// ─── ROUTE 4: GET /sync (for browser testing) ────────────
app.get('/sync', (req, res) => {
    res.json({ kill_switch: 'OFF', multiplier: 1.0, min_confidence: 65 });
});

// ─── ROUTE 5: TRADE SIGNAL (POST) ─────────────────────────
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

// ─── ROUTE 7: BILLING SYNC ─────────────────────────────────
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
                [d.account, d.client || 'New Client', parseFloat(d.balance || 0), parseFloat(d.balance || 0), 0, 0, 'ACTIVE', parseFloat(d.balance || 0), '0.00%', 50, d.broker || '']
            );
        }
        const billing = await pool.query('SELECT status FROM billing WHERE account_id = $1', [d.account]);
        if (billing.rows[0] && billing.rows[0].status === 'PAUSED') return res.send('PAUSED');
        res.send('SUCCESS');
    } catch(e) { res.status(500).send('ERROR'); }
});

// ─── ROUTE 8: POSITIONS ─────────────────────────────────────
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



       // ─── ROUTE 16: POST / (Handles ALL EA background POSTs) ───
app.post('/', async (req, res) => {
    try {
        // ─── 🔍 DEBUG: Log every POST request ────────────────
        console.log('📥 [POST /] received');
        console.log('  Body:', req.body);
        console.log('  Type:', req.body?.type || 'undefined');

        const d = req.body;
        const type = d.type;

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
                    [d.account, d.client || 'New Client', parseFloat(d.balance || 0), parseFloat(d.balance || 0), 0, 0, 'ACTIVE', parseFloat(d.balance || 0), '0.00%', 50, d.broker || '']
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

        // ─── 7. TRADE_SIGNAL (Hoots) ──────────────────────────────
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

        // ─── 10. DAILY_EOD (Master) ──────────────────────────────
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

        // ─── 11. ClientEOD (Client) ──────────────────────────────
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

        // ─── 12. Unknown type ─────────────────────────────────────
        console.warn('⚠️ Unknown POST type:', type);
        return res.status(404).send('Not Found');
    } catch (e) {
        console.error('🔥 POST / error:', e.message);
        res.status(500).send('ERROR');
    }
});

// ─── ULTIMATE CATCH-ALL (Handles EVERY request to any path) ───
app.all('*', async (req, res) => {
    try {
        console.log(`🔍 [CATCH-ALL] ${req.method} ${req.path}`);
        console.log('📦 Body:', req.body || 'none');
        // Return OK for everything – stops all 404s from the EA
        res.send('OK');
    } catch (e) {
        console.error('🔥 Catch-all error:', e.message);
        res.status(500).send('ERROR');
    }
});

// ─── START ──────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('Uluka Backend running on port ' + PORT));
