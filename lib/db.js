// lib/db.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function logTradeOpen(tradeData) {
  if (!process.env.DATABASE_URL) return null;
  const query = `
    INSERT INTO crypto_trades 
    (symbol, side, qty, entry_price, sl_price, tp_price, strategy, combo_name, confidence, votes, session, regime, htf_bias, status, order_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'OPEN', $14)
    RETURNING id;
  `;
  const values = [
    tradeData.symbol, tradeData.side.toUpperCase(), tradeData.qty, tradeData.entryPrice, 
    tradeData.slPrice, tradeData.tp3Price || tradeData.tpPrice, tradeData.strategy || 'Uluka', 
    tradeData.comboName || '', tradeData.confidence || 0, tradeData.votes || 0, 
    tradeData.session || 'CRYPTO', tradeData.regime || 'UNKNOWN', tradeData.htfBias || 'NEUTRAL',
    tradeData.orderId || null // 👈 Save orderId for sync
  ];
  try {
    const res = await pool.query(query, values);
    return res.rows[0].id;
  } catch (err) {
    console.error('❌ DB Error (logTradeOpen):', err.message);
    return null;
  }
}

async function logTradeClose(dbId, closePrice, pnlUSD, closeReason) {
  if (!process.env.DATABASE_URL || !dbId) return;
  const query = `
    UPDATE crypto_trades 
    SET close_price = $1, pnl_usd = $2, status = 'CLOSED', close_reason = $3, closed_at = NOW()
    WHERE id = $4;
  `;
  try {
    await pool.query(query, [closePrice, pnlUSD, closeReason, dbId]);
  } catch (err) {
    console.error('❌ DB Error (logTradeClose):', err.message);
  }
}

async function updateDNA(symbol, dimension, keyValue, isWin, profit) {
  if (!process.env.DATABASE_URL) return;
  const winInc = isWin ? 1 : 0;
  const lossInc = isWin ? 0 : 1;
  const profitInc = profit > 0 ? profit : 0;
  const lossIncUSD = profit < 0 ? Math.abs(profit) : 0;

  const query = `
    INSERT INTO crypto_dna (symbol, dimension, key_value, wins, losses, total_profit, total_loss)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (symbol, dimension, key_value) DO UPDATE SET
      wins = crypto_dna.wins + EXCLUDED.wins,
      losses = crypto_dna.losses + EXCLUDED.losses,
      total_profit = crypto_dna.total_profit + EXCLUDED.total_profit,
      total_loss = crypto_dna.total_loss + EXCLUDED.total_loss,
      updated_at = NOW();
  `;
  try {
    await pool.query(query, [symbol, dimension, keyValue, winInc, lossInc, profitInc, lossIncUSD]);
  } catch (err) {
    console.error(`❌ DNA Update Failed:`, err.message);
  }
}

async function getDNAStats(symbol, dimension, keyValue) {
  if (!process.env.DATABASE_URL) return null;
  const query = `SELECT wins, losses FROM crypto_dna WHERE symbol = $1 AND dimension = $2 AND key_value = $3`;
  try {
    const res = await pool.query(query, [symbol, dimension, keyValue]);
    if (res.rows.length === 0) return null;
    return res.rows[0];
  } catch (err) {
    return null;
  }
}

module.exports = {
  logTradeOpen,
  logTradeClose,
  updateDNA,
  getDNAStats
};