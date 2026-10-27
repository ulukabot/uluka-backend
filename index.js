// index.js
require('dotenv').config();
const BybitClient = require('./lib/bybit');
const ind = require('./lib/indicators');
const strat = require('./lib/strategies');
const tradeEngine = require('./lib/tradeEngine');
const config = require('./config');

// --- PAPER TRADING STATE ---
const paperAccount = {
  balance: 10000,
  equity: 10000,
  openPositions: [] // Array to hold active trades
};

// Helper to format time
const now = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

async function runTick() {
  const bybit = new BybitClient({ testnet: true });

  for (const symbol of config.symbols) {
    try {
      const klines = await bybit.getKlines({ symbol, interval: config.timeframe, limit: 100 });
      const ticker = await bybit.getTicker(symbol);
      const currentPrice = parseFloat(ticker.lastPrice);
      
      // 1. Manage Existing Positions FIRST (Check SL/TP)
      manageOpenPositions(symbol, currentPrice, bybit);

      // 2. Check for new signals
      const info = await bybit.getInstrumentsInfo(symbol);
      const tickSize = parseFloat(info.priceFilter.tickSize);
      
      const { closes } = ind.parseKlines(klines);
      const emaFast = ind.calculateEMA(closes, 10);
      const emaSlow = ind.calculateEMA(closes, 45);

      const signal = strat.getScoreSignal(symbol, klines, tickSize, currentPrice, emaFast, emaSlow);

      // 3. If a signal exists, execute
      if (signal.signalType !== 0) {
        // Check if we already have an open position for this symbol
        const alreadyOpen = paperAccount.openPositions.find(p => p.symbol === symbol);
        
        if (!alreadyOpen) {
          const plan = tradeEngine.buildTradePlan(symbol, signal, currentPrice, klines, info, paperAccount.balance, config);
          if (plan) {
            executePaperTrade(plan, signal);
          }
        }
      }
    } catch (e) {
      console.error(`[${now()}] ❌ Error on ${symbol}:`, e.message);
    }
  }
}

function executePaperTrade(plan, signal) {
  const position = {
    ...plan,
    openTime: now(),
    status: 'OPEN',
    maxFavorableExcursion: 0,
    breakEvenSet: false
  };
  
  paperAccount.openPositions.push(position);
  
  console.log(`\n[${now()}] 🟢 PAPER TRADE OPENED: ${plan.side.toUpperCase()} ${plan.symbol}`);
  console.log(`  Qty: ${plan.qty} | Entry: $${plan.entryPrice}`);
  console.log(`  SL: $${plan.slPrice} | TP: $${plan.tpPrice}`);
  console.log(`  Risk: $${plan.riskUSD}`);
  console.log(`  Reason: Votes=${signal.buyScore/17} vs ${signal.sellScore/17} | Regime: ${signal.regime}`);
}

function manageOpenPositions(symbol, currentPrice, bybit) {
  for (let i = paperAccount.openPositions.length - 1; i >= 0; i--) {
    let pos = paperAccount.openPositions[i];
    if (pos.symbol !== symbol) continue;

    let pnl = 0;
    let pnlPercent = 0;

    // Check Buy or Sell
    if (pos.side === 'Buy') {
      pnl = (currentPrice - pos.entryPrice) * pos.qty;
      pnlPercent = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
      
      // Check Stop Loss
      if (currentPrice <= pos.slPrice) {
        closePaperTrade(i, pos.slPrice, 'SL Hit');
        continue;
      }
      // Check Take Profit
      if (currentPrice >= pos.tpPrice) {
        closePaperTrade(i, pos.tpPrice, 'TP Hit');
        continue;
      }
    } else {
      pnl = (pos.entryPrice - currentPrice) * pos.qty;
      pnlPercent = ((pos.entryPrice - currentPrice) / pos.entryPrice) * 100;

      // Check Stop Loss
      if (currentPrice >= pos.slPrice) {
        closePaperTrade(i, pos.slPrice, 'SL Hit');
        continue;
      }
      // Check Take Profit
      if (currentPrice <= pos.tpPrice) {
        closePaperTrade(i, pos.tpPrice, 'TP Hit');
        continue;
      }
    }

    // --- BREAK EVEN LOGIC (From your MQL5) ---
    if (config.enableBreakEven && !pos.breakEvenSet) {
      const slDistance = Math.abs(pos.entryPrice - pos.slPrice);
      const triggerDistance = slDistance * (config.breakEvenPercent / 100);
      
      let inProfit = (pos.side === 'Buy') ? (currentPrice - pos.entryPrice) : (pos.entryPrice - currentPrice);

      if (inProfit >= triggerDistance) {
        pos.slPrice = pos.entryPrice; // Move SL to Entry
        pos.breakEvenSet = true;
        console.log(`[${now()}] 🛡️ ${pos.symbol} ${pos.side} -> Moved SL to Break-Even!`);
      }
    }
  }
}

function closePaperTrade(index, closePrice, reason) {
  const pos = paperAccount.openPositions[index];
  
  let pnl = 0;
  if (pos.side === 'Buy') {
    pnl = (closePrice - pos.entryPrice) * pos.qty;
  } else {
    pnl = (pos.entryPrice - closePrice) * pos.qty;
  }

  paperAccount.balance += pnl;
  paperAccount.openPositions.splice(index, 1);

  const color = pnl >= 0 ? '🟩 PROFIT' : '🟥 LOSS';
  console.log(`\n[${now()}] 🔴 PAPER TRADE CLOSED: ${pos.symbol} ${pos.side}`);
  console.log(`  Reason: ${reason} | Close Price: $${closePrice}`);
  console.log(`  PnL: $${pnl.toFixed(2)} (${color})`);
  console.log(`  New Balance: $${paperAccount.balance.toFixed(2)}\n`);
}

// --- START THE BOT ---
console.log(`🤖 Uluka Crypto Bot Starting...`);
console.log(`   Mode: PAPER TRADING`);
console.log(`   Symbols: ${config.symbols.join(', ')}`);
console.log(`   Interval: ${config.timeframe}m`);
console.log(`   Scanning every 10 seconds...\n`);

// Run immediately on start
runTick();

// Then loop every 10 seconds (to not spam the Bybit API too hard)
setInterval(runTick, 10000);