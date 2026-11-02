const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// GET /api/reports/statement
router.get('/statement', async (req, res) => {
  try {
    const { period = 'month', product = 'crypto', accountId, start, end } = req.query;

    // 1. Determine the Table and Column Names
    // Note: Change the forex column names on the right if your trade_log table uses different ones!
    const isForex = product === 'forex';
    const tableName = isForex ? 'trade_log' : 'crypto_trades';
    
    const colSymbol = 'symbol';
    const colPnl = isForex ? 'profit' : 'pnl_usd';       // ⚠️ Forex might use 'profit' or 'pnl'
    const colOpen = isForex ? 'open_time' : 'opened_at'; // ⚠️ Forex might use 'open_time' or 'time'
    const colClose = isForex ? 'close_time' : 'closed_at'; // ⚠️ Forex might use 'close_time' or 'time'
    const colAccount = 'account_id';
    const colMaster = 'is_master';

    // 2. Build the Date Filter
    let dateFilter = '';
    let queryParams = [];
    let paramIndex = 1;

    if (period === 'week') {
      dateFilter = `AND ${colOpen} >= DATE_TRUNC('week', NOW())`;
    } else if (period === 'month') {
      dateFilter = `AND ${colOpen} >= DATE_TRUNC('month', NOW())`;
    } else if (period === 'year') {
      dateFilter = `AND ${colOpen} >= DATE_TRUNC('year', NOW())`;
    } else if (period === 'custom' && start && end) {
      dateFilter = `AND ${colOpen} >= $${paramIndex}::timestamp AND ${colOpen} <= $${paramIndex + 1}::timestamp`;
      queryParams.push(start, end + ' 23:59:59');
      paramIndex += 2;
    }

    // 3. Build the Account Filter
    let accountFilter = '';
    if (accountId) {
      accountFilter = `AND ${colAccount} = $${paramIndex}`;
      queryParams.push(accountId);
      paramIndex++;
    } else {
      // Some forex tables might not have an 'is_master' column. If it crashes, remove this line.
      accountFilter = `AND ${colMaster} = TRUE`;
    }

    // 4. Fetch Trades (Aliasing columns to standard names so the rest of the code works)
    const query = `
      SELECT 
        ${colSymbol} as symbol, 
        ${colPnl} as pnl_usd, 
        ${colOpen} as opened_at, 
        ${colClose} as closed_at
      FROM ${tableName}
      WHERE status = 'CLOSED'
      ${dateFilter}
      ${accountFilter}
      ORDER BY ${colClose} ASC
    `;

    const result = await pool.query(query, queryParams);
    const trades = result.rows;

    // 5. Calculate Summary & Symbol Breakdown
    let totalProfit = 0;
    let wins = 0;
    let losses = 0;
    const symbols = {};

    let currentEquity = 0; 
    let peakEquity = 0;
    let maxDrawdown = 0;

    trades.forEach(trade => {
      const pnl = parseFloat(trade.pnl_usd) || 0;
      totalProfit += pnl;

      // Win/Loss logic
      if (pnl > 0) wins++;
      else if (pnl < 0) losses++;

      // Drawdown logic
      currentEquity += pnl;
      if (currentEquity > peakEquity) peakEquity = currentEquity;
      const dd = peakEquity - currentEquity;
      if (dd > maxDrawdown) maxDrawdown = dd;

      // Symbol Breakdown Logic
      if (!symbols[trade.symbol]) {
        symbols[trade.symbol] = {
          symbol: trade.symbol,
          totalTrades: 0,
          wins: 0,
          losses: 0,
          profit: 0
        };
      }
      
      const s = symbols[trade.symbol];
      s.totalTrades++;
      s.profit += pnl;
      if (pnl > 0) s.wins++;
      else if (pnl < 0) s.losses++;
    });

    // 6. Format the Response
    const totalTrades = trades.length;
    const accuracy = totalTrades > 0 ? ((wins / (wins + losses || 1)) * 100).toFixed(1) : 0;
    const maxDdPercent = peakEquity > 0 ? ((maxDrawdown / peakEquity) * 100).toFixed(2) : "0.00";

    const symbolArray = Object.values(symbols).map(s => ({
      ...s,
      accuracy: s.totalTrades > 0 ? ((s.wins / (s.wins + s.losses || 1)) * 100).toFixed(1) : 0
    })).sort((a, b) => b.totalTrades - a.totalTrades); 

    res.json({
      success: true,
      data: {
        summary: {
          totalTrades,
          wins,
          losses,
          accuracy: parseFloat(accuracy),
          totalProfit: parseFloat(totalProfit.toFixed(2)),
          maxDrawdownUSD: parseFloat(maxDrawdown.toFixed(2)),
          maxDrawdownPercent: parseFloat(maxDdPercent)
        },
        symbols: symbolArray
      }
    });

  } catch (err) {
    console.error('❌ Report Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to generate report' });
  }
});

module.exports = router;
