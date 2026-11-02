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

    const isForex = product === 'forex';
    const tableName = isForex ? 'trade_log' : 'crypto_trades';
    
    // 1. Build the Date Filter (using different column names)
    let dateFilter = '';
    let queryParams = [];
    let paramIndex = 1;
    const timeCol = isForex ? 'time' : 'opened_at';

    if (period === 'week') {
      dateFilter = `AND ${timeCol} >= DATE_TRUNC('week', NOW())`;
    } else if (period === 'month') {
      dateFilter = `AND ${timeCol} >= DATE_TRUNC('month', NOW())`;
    } else if (period === 'year') {
      dateFilter = `AND ${timeCol} >= DATE_TRUNC('year', NOW())`;
    } else if (period === 'custom' && start && end) {
      dateFilter = `AND ${timeCol} >= $${paramIndex}::timestamp AND ${timeCol} <= $${paramIndex + 1}::timestamp`;
      queryParams.push(start, end + ' 23:59:59');
      paramIndex += 2;
    }

    // 2. Build the Account Filter
    let accountFilter = '';
    if (accountId) {
      accountFilter = `AND account_id = $${paramIndex}`;
      queryParams.push(accountId);
      paramIndex++;
    } else if (!isForex) {
      // Only apply is_master filter for Crypto (Forex table doesn't have it)
      accountFilter = `AND is_master = TRUE`;
    }

    // 3. Build Status Filter
    // Forex table doesn't have a 'status' column, so we skip it for Forex
    const statusFilter = isForex ? '' : "WHERE status = 'CLOSED'";

    // 4. Fetch Trades (Aliasing Forex columns to match Crypto names for the JS logic)
    let query = '';
    
    if (isForex) {
      query = `
        SELECT 
          symbol, 
          pnl as pnl_usd, 
          time as opened_at, 
          time as closed_at
        FROM ${tableName}
        ${statusFilter}
        WHERE 1=1
        ${dateFilter}
        ${accountFilter}
        ORDER BY time ASC
      `;
    } else {
      query = `
        SELECT symbol, pnl_usd, opened_at, closed_at
        FROM ${tableName}
        ${statusFilter}
        ${dateFilter}
        ${accountFilter}
        ORDER BY closed_at ASC
      `;
    }

    const result = await pool.query(query, queryParams);
    const trades = result.rows;

    // 5. Calculate Summary & Symbol Breakdown (This part stays the same)
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
