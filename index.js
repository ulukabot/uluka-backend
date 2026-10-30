// index.js
require('dotenv').config();
const BybitClient = require('./lib/bybit');
const ind = require('./lib/indicators');
const strat = require('./lib/strategies');
const tradeEngine = require('./lib/tradeEngine');
const db = require('./lib/db');
const tg = require('./lib/telegram');
const execution = require('./lib/execution');
const config = require('./config');

process.on('unhandledRejection', (reason) => {
  console.error('🚨 Unhandled Rejection:', reason.message || reason);
});

function getDominantStrategy(signal) {
  if (signal.signalType === 1) { 
    if (signal.obBuy) return 'OB'; if (signal.fvgBuy) return 'FVG';
    if (signal.chochBuy) return 'CHoCH'; if (signal.bosBuy) return 'BOS';
    if (signal.farsightBuy) return 'Farsight'; if (signal.visionBuy) return 'Vision';
  } else { 
    if (signal.obSell) return 'OB'; if (signal.fvgSell) return 'FVG';
    if (signal.chochSell) return 'CHoCH'; if (signal.bosSell) return 'BOS';
    if (signal.farsightSell) return 'Farsight'; if (signal.visionSell) return 'Vision';
  }
  return 'Unknown';
}

const now = () => new Date().toISOString().replace('T', ' ').substring(0, 19);
const lastCandleTimes = {}; // Format: { "ADMIN-01-BTCUSDT": timestamp }
const openPositions = {}; // Format: { "ADMIN-01": [ {symbol, side...} ] }

async function fetchUsers() {
  try {
    const res = await fetch('https://uluka-backend-production.up.railway.app/api/crypto/active-users', {
      headers: { 'x-admin-secret': process.env.ADMIN_SECRET }
    });
    return await res.json();
  } catch (e) {
    console.error('❌ Failed to fetch users from backend:', e.message);
    return [];
  }
}

async function runTick() {
  const users = await fetchUsers();
  if (!users || users.length === 0) return;

  for (const user of users) {
    try {
      const bybit = new BybitClient({ 
        apiKey: user.api_key, 
        apiSecret: user.api_secret, 
        testnet: false, 
        demo: process.env.BYBIT_DEMO === 'true' 
      });

      // 1. Fetch user balance and equity
      const balData = await bybit.getBalance();
      const usdt = balData.list[0]?.coin?.find(c => c.coin === 'USDT');
      const equity = parseFloat(usdt?.equity || 0);

      if (equity <= 0) continue;

      // 2. Business Logic: Tier & Drawdown Guards
      if (equity > user.tier_cap) {
        console.log(`⏭️ Skipping ${user.account_id}: Equity $${equity} exceeds Tier Cap $${user.tier_cap}`);
        continue;
      }
      if (user.peak_equity > 0 && equity < (user.peak_equity * 0.90)) {
        console.log(`⏭️ Skipping ${user.account_id}: Drawdown > 10% from peak ($${user.peak_equity}).`);
        continue;
      }

      // Update peak equity and daily start equity if needed
      let newPeak = user.peak_equity;
      let newDailyStart = user.daily_start_equity;
      let needsUpdate = false;

      if (equity > newPeak) { newPeak = equity; needsUpdate = true; }
      if (newDailyStart === 0) { newDailyStart = equity; needsUpdate = true; }

      if (needsUpdate) {
        await fetch('https://uluka-backend-production.up.railway.app/api/crypto/update-equity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-secret': process.env.ADMIN_SECRET },
          body: JSON.stringify({ account_id: user.account_id, peak: newPeak, daily_start: newDailyStart })
        }).catch(() => {});
      }

      // 3. Process Symbols
      const userSymbols = user.symbols.split(',');
      
      if (!openPositions[user.account_id]) openPositions[user.account_id] = [];

      for (const symbol of userSymbols) {
        const symbolKey = `${user.account_id}-${symbol}`;
        if (lastCandleTimes[symbolKey] === undefined) lastCandleTimes[symbolKey] = 0;

        const klines = await bybit.getKlines({ symbol, interval: config.timeframe, limit: 100 });
        if (!klines || klines.length < 50) continue;

        const ticker = await bybit.getTicker(symbol);
        if (!ticker || !ticker.lastPrice) continue;
        const currentPrice = parseFloat(ticker.lastPrice);

        // Manage Existing Positions for this user
        await manageOpenPositions(user, symbol, currentPrice, bybit);

        // Candle Gate
        const currentCandleTime = parseInt(klines[0][0]); 
        if (lastCandleTimes[symbolKey] === currentCandleTime) continue; 
        lastCandleTimes[symbolKey] = currentCandleTime;

        const info = await bybit.getInstrumentsInfo(symbol);
        if (!info || !info.priceFilter) continue;
        const tickSize = parseFloat(info.priceFilter.tickSize);
        
        const { closes } = ind.parseKlines(klines);
        const emaFast = ind.calculateEMA(closes, 10);
        const emaSlow = ind.calculateEMA(closes, 45);

        const signal = strat.getScoreSignal(symbol, klines, tickSize, currentPrice, emaFast, emaSlow);

        if (signal.signalType !== 0) {
          const dominantVotes = signal.signalType === 1 ? (signal.buyScore / 17) : (signal.sellScore / 17);
          
          if (dominantVotes < 2) {
             console.log(`⏭️ ${user.account_id} | Skipping ${symbol}: Only ${dominantVotes} vote(s).`);
             continue; 
          }

          // Check if we already have an open position for this symbol for this user
          const hasOpen = openPositions[user.account_id].find(p => p.symbol === symbol);
          
          if (!hasOpen) {
            if (openPositions[user.account_id].length >= user.max_positions) continue;

            const adjustedConfig = { ...config, riskPerTradePercent: user.risk_percent };
            const plan = tradeEngine.buildTradePlan(symbol, signal, currentPrice, klines, info, equity, adjustedConfig);
            
            if (plan) {
              const livePos = await execution.executeLiveTrade(bybit, plan, signal, adjustedConfig, user);
              if (livePos) {
                livePos.symbol = symbol;
                livePos.side = plan.side;
                openPositions[user.account_id].push(livePos);
              }
            }
          }
        }
      }
      
      // Rate limit delay between users
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (e) {
      console.error(`❌ Error on user ${user.account_id}:`, e.message);
    }
  }
}

async function manageOpenPositions(user, symbol, currentPrice, bybit) {
  if (!openPositions[user.account_id]) return;
  const positions = openPositions[user.account_id];

  for (let i = positions.length - 1; i >= 0; i--) {
    let pos = positions[i];
    if (pos.symbol !== symbol) continue;

    const activeSl = pos.virtualSl || pos.slPrice;

    const hitTP3 = (pos.side === 'Buy' && currentPrice >= pos.tp3Price) || (pos.side === 'Sell' && currentPrice <= pos.tp3Price);
    if (hitTP3) {
      await bybit.closePosition({ symbol: pos.symbol, positionSide: pos.side, qty: pos.qty });
      await closeTrade(user, i, pos, pos.tp3Price, 'TP3 Hit', bybit);
      continue;
    }

    const hitTP2 = (pos.side === 'Buy' && currentPrice >= pos.tp2Price) || (pos.side === 'Sell' && currentPrice <= pos.tp2Price);
    if (hitTP2 && !pos.tp2Hit) {
      pos.tp2Hit = true;
      const closeQty = parseFloat((pos.qty * 0.30).toFixed(4));
      await bybit.closePosition({ symbol: pos.symbol, positionSide: pos.side, qty: closeQty });
      await bybit.setTradingStop({ symbol: pos.symbol, stopLoss: pos.tp1Price });
      pos.virtualSl = pos.tp1Price;
      pos.slPrice = pos.tp1Price;
      pos.qty -= closeQty;
      console.log(`✂️ ${user.account_id} | TP2 HIT: ${pos.symbol}`);
      continue;
    }

    const hitTP1 = (pos.side === 'Buy' && currentPrice >= pos.tp1Price) || (pos.side === 'Sell' && currentPrice <= pos.tp1Price);
    if (hitTP1 && !pos.tp1Hit) {
      pos.tp1Hit = true;
      const closeQty = parseFloat((pos.qty * 0.50).toFixed(4));
      await bybit.closePosition({ symbol: pos.symbol, positionSide: pos.side, qty: closeQty });
      await bybit.setTradingStop({ symbol: pos.symbol, stopLoss: pos.entryPrice });
      pos.virtualSl = pos.entryPrice;
      pos.slPrice = pos.entryPrice;
      pos.breakEvenSet = true;
      pos.qty -= closeQty;
      console.log(`✂️ ${user.account_id} | TP1 HIT: ${pos.symbol}`);
      continue;
    }

    const hitSL = (pos.side === 'Buy' && currentPrice <= activeSl) || (pos.side === 'Sell' && currentPrice >= activeSl);
    if (hitSL) {
      await bybit.closePosition({ symbol: pos.symbol, positionSide: pos.side, qty: pos.qty });
      await closeTrade(user, i, pos, activeSl, 'SL Hit', bybit);
      continue;
    }
  }
}

async function closeTrade(user, index, pos, closePrice, reason, bybit) {
  let pnl = pos.side === 'Buy' ? (closePrice - pos.entryPrice) * pos.qty : (pos.entryPrice - closePrice) * pos.qty;
  
  await db.logTradeClose(pos.dbId, closePrice, pnl, reason);

  if (user.is_master) {
    await tg.sendWebhook({
      type: 'TRADE_CLOSE', source: 'MASTER', asset_class: 'CRYPTO',
      result: pnl >= 0 ? 'WIN' : 'LOSS', symbol: pos.symbol, direction: pos.side.toUpperCase(),
      profit: pnl.toFixed(2), reason: reason, ticket: pos.dbId, time: new Date().toISOString()
    });
  }
  
  openPositions[user.account_id].splice(index, 1);
}

async function startupTest() {
  console.log(`🤖 Uluka Crypto SaaS Engine Starting...`);
}

async function mainLoop() {
  await runTick(); 
  setTimeout(mainLoop, 15000); 
}

startupTest().then(() => { mainLoop(); });
