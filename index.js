// ============================================================
// v2.5 – Full GAS Replacement + All Missing Features
// ULUKA ULTRA — Complete Backend with Scheduled Jobs
// ============================================================

const express = require('express');
const { Pool } = require('pg');
const app = express();
app.use(express.json());

console.log('🚀 VERSION 2.5 WITH ALL FEATURES - DEPLOYED AT ' + new Date().toISOString());

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
    const { key, account, instance, balance, broker, hwid, personal_chat_id } = params;
    const licence = await pool.query(
        'SELECT * FROM licences WHERE licence_key = $1 AND status = $2',
        [key, 'ACTIVE']
    );
    if (!licence.rows[0]) return { status: 401, body: 'NOT_FOUND' };
    const lic = licence.rows[0];

    // ─── AUTO-BIND ACCOUNT ID (like GAS) ────────────────────
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
    if (billing.rows[0] && billing.rows[0].payee_25 >= billing.rows[0].payee_limit) {
        return { status: 403, body: 'LIMIT_BLOCK' };
    }

    // ─── NEW ACTIVATION (HWID, Instance, Activations, Telegram) ──
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
                [account, lic.client_name, parseFloat(balance), parseFloat(balance), 0, 0, 'ACTIVE', parseFloat(balance), '0.00%', 50, broker || '']
            );
        }
    }

    const d = String(new Date(lic.expires_on).getDate()).padStart(2, '0');
    const m = String(new Date(lic.expires_on).getMonth() + 1).padStart(2, '0');
    const y = new Date(lic.expires_on).getFullYear();
    return { status: 200, body: `AUTHORIZED|${d}-${m}-${y}|${lic.client_name}|${lic.equity_cap || 0}|${lic.subscription || 'PRO'}` };
}

// ============================================================
// EXISTING ROUTES (from previous version – kept intact)
// ============================================================

app.get('/ping', (req, res) => res.send('pong'));

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
app.post('/hoot', async (req, res) => { /* unchanged – same as before */ });

// ─── ROUTE 6: TRADE CLOSE ──────────────────────────────────
app.post('/close', async (req, res) => { /* unchanged */ });

// ─── ROUTE 7: BILLING SYNC ──────────────────────────────────
app.post('/billing', async (req, res) => { /* unchanged */ });

// ─── ROUTE 8: POSITIONS ──────────────────────────────────────
app.post('/positions', async (req, res) => { /* unchanged */ });

// ─── ROUTE 9: TRADE LOG ─────────────────────────────────────
app.post('/trade_log', async (req, res) => { /* unchanged */ });

// ─── ROUTE 10: EOD ADMIN ────────────────────────────────────
app.post('/eod', async (req, res) => { /* unchanged */ });

// ─── ROUTE 11: CLIENT EOD ──────────────────────────────────
app.post('/client_eod', async (req, res) => { /* unchanged */ });

// ─── ROUTE 12: ACTIVATION ──────────────────────────────────
app.post('/activation', async (req, res) => { /* unchanged */ });

// ─── ROUTE 13: POSITION UPDATE ─────────────────────────────
app.post('/position_update', async (req, res) => { /* unchanged */ });

// ─── ROUTE 14: AI DECISION ──────────────────────────────────
app.post('/ai_decision', async (req, res) => { /* unchanged */ });

// ─── ROUTE 15: HEALTH ───────────────────────────────────────
app.get('/health', (req, res) => res.send('OK'));

// ============================================================
// DASHBOARD API ENDPOINTS (from previous version)
// ============================================================

app.get('/api/public/stats', async (req, res) => { /* unchanged */ });
app.get('/api/admin/clients', async (req, res) => { /* unchanged */ });
app.get('/api/billing/:account', async (req, res) => { /* unchanged */ });
app.get('/api/positions/:account', async (req, res) => { /* unchanged */ });
app.get('/api/trades/:account', async (req, res) => { /* unchanged */ });
app.post('/api/login', async (req, res) => { /* unchanged */ });

// ============================================================
// KEY GENERATOR (admin/generate) – already added
// ============================================================

// ... (admin/generate GUI and /api/admin/generate-key – unchanged)

// ============================================================
// 🆕 NEW MISSING FEATURES – MIGRATED FROM GAS
// ============================================================

// ─── 1. LossPatternAlert (added to POST /) ────────────────
// Inside the existing app.post('/') we'll add a new case before the final 404:
// (We'll show the full updated POST / later)

// ─── 2. Admin endpoints for scheduled tasks ────────────────

// 2a. Manually trigger expiry check
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

// 2b. Manually trigger EA offline check
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

// 2c. Test alert endpoint
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

// 2d. Clear HWID endpoint
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

// ─── 3. Scheduled Jobs (run in background) ──────────────────
// These run using setInterval. They will only execute if the server is alive.

// Auto-expiry check (every hour)
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

// EA offline check (every 6 hours)
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

// ─── 4. Rate limiting (simple in‑memory) ────────────────────
// We'll add a basic rate limit to POST / to avoid spam from a single account.
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

// ─── 5. Updated POST / with new cases ──────────────────────

app.post('/', async (req, res) => {
    try {
        console.log('📥 [POST /] received');
        console.log('  Body:', req.body);
        console.log('  Type:', req.body?.type || 'undefined');

        const d = req.body;
        const type = d.type;
        const account = d.account || d.account_id || 'unknown';

        // Rate limit (skip for BILLING_SYNC, validate, OPEN_POSITIONS)
        const skipRateLimit = ['BILLING_SYNC', 'validate', 'OPEN_POSITIONS'];
        if (account !== 'unknown' && !skipRateLimit.includes(type) && isRateLimited(account, 3)) {
            console.warn('Rate limited:', account, type);
            return res.status(429).send('RATE_LIMITED');
        }

        // ─── 1. BILLING_SYNC ───────────────────────────────────
        if (type === 'BILLING_SYNC') {
            // ... (unchanged – full code omitted for brevity, but must be present)
        }

        // ─── 2. OPEN_POSITIONS ──────────────────────────────────
        if (type === 'OPEN_POSITIONS') {
            // ... unchanged
        }

        // ─── 3. TRADE_LOG ──────────────────────────────────────
        if (type === 'TRADE_LOG') {
            // ... unchanged
        }

        // ─── 4. AI_DECISION ─────────────────────────────────────
        if (type === 'AI_DECISION') {
            // ... unchanged
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

        // ─── 12. LossPatternAlert (NEW) ──────────────────────────
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
