const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

router.get('/statement', async (req, res) => {
  try {
    const { period = 'month', product = 'crypto', accountId, start, end } = req.query;

    const isForex = product === 'forex';
    const tableName = isForex ? 'trade_log' : 'crypto_trades';
    
    let dateFilter = '';
    let queryParams = [];
    let paramIndex = 1;
    
    const timeCol = isForex ? 'time' : 'opened_at';
    const timeColCast = `${timeCol}::timestamp`;

    if (period === 'week') {
      dateFilter = `AND ${timeColCast} >= DATE_TRUNC('week', NOW())`;
    } else if (period === 'month') {
      dateFilter = `AND ${timeColCast} >= DATE_TRUNC('month', NOW())`;
    } else if (period === 'year') {
      dateFilter = `AND ${timeColCast} >= DATE_TRUNC('year', NOW())`;
    } else if (period === 'custom' && start && end) {
      dateFilter = `AND ${timeColCast} >= $${paramIndex}::timestamp AND ${timeColCast} <= $${paramIndex + 1}::timestamp`;
      queryParams.push(start, end + ' 23:59:59');
      paramIndex += 2;
    }

    let accountFilter = '';
    if (accountId) {
      accountFilter = `AND account_id = $${paramIndex}`;
      queryParams.push(accountId);
      paramIndex++;
    } else if (isForex) {
      // ✅ Only look at MASTER trades for the public dashboard
      accountFilter = `AND source = 'MASTER'`; 
    } else {
      accountFilter = `AND is_master = TRUE`;
    }

    const statusFilter = isForex ? '' : "WHERE status = 'CLOSED'";

    let query = '';
    if (isForex) {
      // ✅ FETCH balance column to calculate true starting equity
      query = `
        SELECT symbol, pnl as pnl_usd, balance, ${timeColCast} as opened_at, ${timeColCast} as closed_at
        FROM ${tableName}
        WHERE 1=1
        ${dateFilter}
        ${accountFilter}
        ORDER BY ${timeColCast} ASC
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

    let totalProfit = 0, wins = 0, losses = 0;
    const symbols = {};
    
    // ✅ CALCULATE TRUE STARTING BALANCE
    let startEquity = 1000; // Fallback if no trades or missing balance
    if (trades.length > 0 && trades[0].balance !== undefined && trades[0].balance !== null) {
        // First trade balance minus its PnL = Starting Balance
        startEquity = parseFloat(trades[0].balance) - parseFloat(trades[0].pnl_usd);
        if (startEquity <= 0) startEquity = 1000; // Safety net for edge cases
    }

    let currentEquity = startEquity; 
    let peakEquity = startEquity;
    let maxDrawdown = 0;

    trades.forEach(trade => {
      const pnl = parseFloat(trade.pnl_usd) || 0;
      totalProfit += pnl;

      if (pnl > 0) wins++;
      else if (pnl < 0) losses++;

      currentEquity += pnl;
      if (currentEquity > peakEquity) peakEquity = currentEquity;
      const dd = peakEquity - currentEquity;
      if (dd > maxDrawdown) maxDrawdown = dd;

      if (!symbols[trade.symbol]) {
        symbols[trade.symbol] = { symbol: trade.symbol, totalTrades: 0, wins: 0, losses: 0, profit: 0 };
      }
      
      const s = symbols[trade.symbol];
      s.totalTrades++;
      s.profit += pnl;
      if (pnl > 0) s.wins++;
      else if (pnl < 0) s.losses++;
    });

    const totalTrades = trades.length;
    const accuracy = totalTrades > 0 ? ((wins / (wins + losses || 1)) * 100).toFixed(1) : 0;
    
    // ✅ Now peakEquity is accurate (e.g. 10,000), so drawdown percentage is accurate
    const maxDdPercent = peakEquity > 0 ? Math.min(100, ((maxDrawdown / peakEquity) * 100)).toFixed(2) : "0.00";

    const symbolArray = Object.values(symbols).map(s => ({
      ...s,
      accuracy: s.totalTrades > 0 ? ((s.wins / (s.wins + s.losses || 1)) * 100).toFixed(1) : 0
    })).sort((a, b) => b.totalTrades - a.totalTrades); 

    res.json({
      success: true,
      data: {
        summary: {
          totalTrades, wins, losses,
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
