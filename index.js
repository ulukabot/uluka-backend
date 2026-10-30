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
const lastCandleTimes = {}; 
const openPositions = {}; 
const consecutiveLosses = {}; 
const symbolCooldowns = {};   

async function fetchUsers() {
  try {
    const res = await fetch('https://uluka-backend-production.up.railway.app/api/crypto/active-users', {
      headers: { 'x-admin-secret': process.env.ADMIN_SECRET }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('❌ Failed to fetch users:', e.message);
    return [];
  }
}

async function runTick() {
  const users = await fetchUsers();
  if (!users || users.length === 0) return;

  for (const user of users) {
    try {
      const bybit = new BybitClient({ apiKey: user.api_key, apiSecret: user.api_secret, testnet: false, demo: process.env.BYBIT_DEMO === 'true' });
      if (!consecutiveLosses[user.account_id]) consecutiveLosses[user.account_id] = 0;

      const balData = await bybit.getBalance();
      const usdt = balData.list[0]?.coin?.find(c => c.coin === 'USDT');
      const equity = parseFloat(usdt?.equity || 0);
      if (equity <= 0) continue;

      // 🛡️ TIER & GUARDIAN ANGEL (DD) GUARDS
      if (equity > user.tier_cap) { 
        continue; 
      }
      
      if (user.peak_equity > 0 && equity < (user.peak_equity * 0.90)) { 
        // 🚨 GUARDIAN ANGEL PRIVATE ALERT (Only sent once if master)
        if (user.is_master) {
          await tg.sendMessage(`🚨 <b>GUARDIAN ANGEL</b>\n\nAccount: ${user.account_id}\nDrawdown limit hit (>10%).\nEquity: $${equity}\nPeak: $${user.peak_equity}\nTrading halted.`);
        }
        continue; 
      }

      // Update equity if new peak
      if (equity > user.peak_equity || user.daily_start_equity === 0) {
        await fetch('https://uluka-backend-production.up.railway.app/api/crypto/update-equity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-secret': process.env.ADMIN_SECRET },
          body: JSON.stringify({ account_id: user.account_id, peak: Math.max(equity, user.peak_equity), daily_start: equity })
        }).catch(() => {});
      }

      const userSymbols = user.symbols.split(',');
      if (!openPositions[user.account_id]) openPositions[user.account_id] = [];

      for (const symbol of userSymbols) {
        const symbolKey = `${user.account_id}-${symbol}`;
        if (symbolCooldowns[symbolKey] && Date.now() < symbolCooldowns[symbolKey]) continue;
        if (lastCandleTimes[symbolKey] === undefined) lastCandleTimes[symbolKey] = 0;

        const klines = await bybit.getKlines({ symbol, interval: config.timeframe, limit: 100 });
        if (!klines || klines.length < 50) continue;

        const ticker = await bybit.getTicker(symbol);
        if (!ticker || !ticker.lastPrice) continue;
        const currentPrice = parseFloat(ticker.lastPrice);

        await manageOpenPositions(user, symbol, currentPrice, bybit);

        const currentCandleTime = parseInt(klines[0][0]); 
        if (lastCandleTimes[symbolKey] === currentCandleTime) continue; 
        lastCandleTimes[symbolKey] = currentCandleTime;

        const info = await bybit.getInstrumentsInfo(symbol);
        if (!info || !info.priceFilter) continue;
        const tickSize = parseFloat(info.priceFilter.tickSize);
        
        const { closes } = ind.parseKlines(klines);
        const signal = strat.getScoreSignal(symbol, klines, tickSize, currentPrice, ind.calculateEMA(closes, 10), ind.calculateEMA(closes, 45));

        if (signal.signalType !== 0) {
          const dominantVotes = signal.signalType === 1 ? (signal.buyScore / 17) : (signal.sellScore / 17);
          if (dominantVotes < 2) continue;

          // 🧬 DNA BLOCKING
          const stratName = getDominantStrategy(signal);
          const dnaStats = await db.getDNAStats(symbol, 'strategy', stratName);
          if (dnaStats) {
            const total = dnaStats.wins + dnaStats.losses;
            const winRate = (dnaStats.wins / total) * 100;
            if (total >= 5 && winRate < 30) {
              continue;
            }
          }

          const openPos = openPositions[user.account_id].find(p => p.symbol === symbol);
          
          if (!openPos) {
            // 🛡️ LOSS GOVERNOR
            if (consecutiveLosses[user.account_id] >= config.maxConsecutiveLosses) continue;
            let currentRisk = user.risk_percent;
            if (config.lossGovernor[consecutiveLosses[user.account_id]]) currentRisk *= config.lossGovernor[consecutiveLosses[user.account_id]];

            const adjustedConfig = { ...config, riskPerTradePercent: currentRisk };
            const plan = tradeEngine.buildTradePlan(symbol, signal, currentPrice, klines, info, equity, adjustedConfig);
            if (plan) {
              const livePos = await execution.executeLiveTrade(bybit, plan, signal, adjustedConfig, user);
              if (livePos) {
                livePos.symbol = symbol; livePos.side = plan.side; livePos.regime = signal.regime;
                livePos.primaryStrategy = stratName;
                openPositions[user.account_id].push(livePos);
              }
            }
          } else {
            // 🔄 HYBRID FLIP
            const isOpp = (openPos.side === 'BUY' && signal.signalType === -1) || (openPos.side === 'SELL' && signal.signalType === 1);
            if (isOpp) {
              const slDist = Math.abs(openPos.entryPrice - openPos.slPrice);
              const lossDist = openPos.side === 'BUY' ? (openPos.entryPrice - currentPrice) : (currentPrice - openPos.entryPrice);
              
              if (lossDist > (slDist * 0.50)) {
                await bybit.closePosition({ symbol: openPos.symbol, positionSide: openPos.side, qty: openPos.qty });
                const idx = openPositions[user.account_id].indexOf(openPos);
                await closeTrade(user, idx, openPos, currentPrice, 'Hybrid Flip', bybit);
                
                const plan = tradeEngine.buildTradePlan(symbol, signal, currentPrice, klines, info, equity, { ...config, riskPerTradePercent: user.risk_percent });
                if (plan) {
                  const livePos = await execution.executeLiveTrade(bybit, plan, signal, { ...config, riskPerTradePercent: user.risk_percent }, user);
                  if (livePos) { livePos.symbol = symbol; livePos.side = plan.side; livePos.primaryStrategy = stratName; openPositions[user.account_id].push(livePos); }
                }
              }
            }
          }
        }
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (e) { console.error(`❌ Error on ${user.account_id}:`, e.message); }
  }
}

async function manageOpenPositions(user, symbol, currentPrice, bybit) {
  if (!openPositions[user.account_id]) return;
  const positions = openPositions[user.account_id];
  for (let i = positions.length - 1; i >= 0; i--) {
    let pos = positions[i];
    if (pos.symbol !== symbol) continue;
    const activeSl = pos.virtualSl || pos.slPrice;

    if ((pos.side === 'Buy' && currentPrice >= pos.tp3Price) || (pos.side === 'Sell' && currentPrice <= pos.tp3Price)) {
      await bybit.closePosition({ symbol: pos.symbol, positionSide: pos.side, qty: pos.qty });
      await closeTrade(user, i, pos, pos.tp3Price, 'TP3 Hit', bybit); continue;
    }

    if ((pos.side === 'Buy' && currentPrice >= pos.tp2Price) || (pos.side === 'Sell' && currentPrice <= pos.tp2Price)) {
      if (!pos.tp2Hit) {
        pos.tp2Hit = true;
        const closeQty = parseFloat((pos.qty * 0.30).toFixed(4));
        await bybit.closePosition({ symbol: pos.symbol, positionSide: pos.side, qty: closeQty });
        await bybit.setTradingStop({ symbol: pos.symbol, stopLoss: pos.tp1Price });
        pos.virtualSl = pos.tp1Price; pos.slPrice = pos.tp1Price; pos.qty -= closeQty;
        
        if (user.is_master && process.env.IS_MASTER === 'true') {
          await tg.sendWebhook({ 
            type: 'POSITION_UPDATE', source: 'MASTER', asset_class: 'CRYPTO', 
            symbol: pos.symbol, direction: pos.side.toUpperCase(), new_sl: pos.tp1Price, 
            be_text: 'TP2 Hit (30% Closed) — SL moved to TP1', ticket: pos.dbId, 
            time: new Date().toISOString() 
          });
        } continue;
      }
    }

    if ((pos.side === 'Buy' && currentPrice >= pos.tp1Price) || (pos.side === 'Sell' && currentPrice <= pos.tp1Price)) {
      if (!pos.tp1Hit) {
        pos.tp1Hit = true;
        const closeQty = parseFloat((pos.qty * 0.50).toFixed(4));
        await bybit.closePosition({ symbol: pos.symbol, positionSide: pos.side, qty: closeQty });
        await bybit.setTradingStop({ symbol: pos.symbol, stopLoss: pos.entryPrice });
        pos.virtualSl = pos.entryPrice; pos.slPrice = pos.entryPrice; pos.qty -= closeQty;
        
        if (user.is_master && process.env.IS_MASTER === 'true') {
          await tg.sendWebhook({ 
            type: 'POSITION_UPDATE', source: 'MASTER', asset_class: 'CRYPTO', 
            symbol: pos.symbol, direction: pos.side.toUpperCase(), new_sl: pos.entryPrice, 
            be_text: 'TP1 Hit (50% Closed) — SL moved to Breakeven', ticket: pos.dbId, 
            time: new Date().toISOString() 
          });
        } continue;
      }
    }

    if ((pos.side === 'Buy' && currentPrice <= activeSl) || (pos.side === 'Sell' && currentPrice >= activeSl)) {
      await bybit.closePosition({ symbol: pos.symbol, positionSide: pos.side, qty: pos.qty });
      await closeTrade(user, i, pos, activeSl, 'SL Hit', bybit); continue;
    }
  }
}

async function closeTrade(user, index, pos, closePrice, reason, bybit) {
  let pnl = pos.side === 'Buy' ? (closePrice - pos.entryPrice) * pos.qty : (pos.entryPrice - closePrice) * pos.qty;
  await db.logTradeClose(pos.dbId, closePrice, pnl, reason);

  if (pnl >= 0) consecutiveLosses[user.account_id] = 0;
  else {
    consecutiveLosses[user.account_id]++;
    symbolCooldowns[`${user.account_id}-${pos.symbol}`] = Date.now() + (config.symbolCooldownMinutes * 60 * 1000);
  }

  if (pos.primaryStrategy && pos.regime) {
    await db.updateDNA(pos.symbol, 'strategy', pos.primaryStrategy, pnl >= 0, pnl);
    await db.updateDNA(pos.symbol, 'regime', pos.regime, pnl >= 0, pnl);
  }

  if (user.is_master && process.env.IS_MASTER === 'true') {
    await tg.sendWebhook({ 
      type: 'TRADE_CLOSE', source: 'MASTER', asset_class: 'CRYPTO', 
      result: pnl >= 0 ? 'WIN' : 'LOSS', symbol: pos.symbol, direction: pos.side.toUpperCase(), 
      profit: pnl.toFixed(2), reason: reason, ticket: pos.dbId, time: new Date().toISOString() 
    });
  }
  
  openPositions[user.account_id].splice(index, 1);
}

async function mainLoop() { 
  await runTick(); 
  setTimeout(mainLoop, 15000); 
}

console.log(`🤖 Uluka Crypto SaaS Engine Starting...`);
mainLoop();
