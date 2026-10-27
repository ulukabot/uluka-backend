// lib/db.js
const { Pool } = require('pg');

// Use the connection string from your .env file
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway') 
    ? { rejectUnauthorized: false } 
    : false
});

async function logTradeOpen(tradeData) {
  if (!process.env.DATABASE_URL) {
    console.log('⚠️ No DATABASE_URL found. Skipping DB write.');
    return null;
  }
  
  const query = `
    INSERT INTO crypto_trades 
    (symbol, side, qty, entry_price, sl_price, tp_price, strategy, combo_name, confidence, votes, session, regime, htf_bias, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'OPEN')
    RETURNING id;
  `;
  const values = [
    tradeData.symbol, 
    tradeData.side, 
    tradeData.qty, 
    tradeData.entryPrice, 
    tradeData.slPrice, 
    tradeData.tpPrice, 
    tradeData.strategy || 'Uluka', 
    tradeData.comboName || '', 
    tradeData.confidence || 0, 
    tradeData.votes || 0, 
    tradeData.session || 'CRYPTO', 
    tradeData.regime || 'UNKNOWN', 
    tradeData.htfBias || 'NEUTRAL'
  ];

  try {
    const res = await pool.query(query, values);
    console.log(`💾 Trade saved to DB with ID: ${res.rows[0].id}`);
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
    console.log(`💾 Trade ID ${dbId} closed and updated in DB.`);
  } catch (err) {
    console.error('❌ DB Error (logTradeClose):', err.message);
  }
}

module.exports = {
  logTradeOpen,
  logTradeClose
};