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

// 🛡️ GLOBAL CRASH SHIELD
process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Rejection:', reason.message || reason);
});

function getDominantStrategy(signal) {
  if (signal.signalType === 1) { // BUY
    if (signal.obBuy) return 'OB';
    if (signal.fvgBuy) return 'FVG';
    if (signal.chochBuy) return 'CHoCH';
    if (signal.bosBuy) return 'BOS';
    if (signal.farsightBuy) return 'Farsight';
    if (signal.visionBuy) return 'Vision';
  } else { // SELL
    if (signal.obSell) return 'OB';
    if (signal.fvgSell) return 'FVG';
    if (signal.chochSell) return 'CHoCH';
    if (signal.bosSell) return 'BOS';
    if (signal.farsightSell) return 'Farsight';
    if (signal.visionSell) return 'Vision';
  }
  return 'Unknown';
}

const paperAccount = {
  balance: 10000,
  equity: 10000,
  openPositions: []
};

const now = () => new Date().toISOString().replace('T', ' ').substring(0, 19);
const lastCandleTimes = {};
let consecutiveLosses = 0;
const symbolCooldowns = {};

async function runTick() {
  const bybit = new BybitClient({ 
    apiKey: process.env.BYBIT_API_KEY,
    apiSecret: process.env.BYBIT_API_SECRET,
    testnet: false,
    demo: true 
  });
  
  for (const symbol of config.symbols) {
    try {
      // 🛡️ CHECK COOLDOWN
      if (symbolCooldowns[symbol] && Date.now() < symbolCooldowns[symbol]) {
        continue; 
      }

      const klines = await bybit.getKlines({ symbol, interval: config.timeframe, limit: 100 });
      
      // 👈 SAFETY CHECK 1: If Bybit returns empty data, skip this symbol
      if (!klines || klines.length < 50) {
        console.log(`⏭️ Skipping ${symbol}: Empty kline data from Bybit.`);
        continue;
      }

      const ticker = await bybit.getTicker(symbol);
      
      // 👈 SAFETY CHECK 2: If ticker is null, skip this symbol
      if (!ticker || !ticker.lastPrice) {
        console.log(`⏭️ Skipping ${symbol}: Ticker data unavailable.`);
        continue;
      }

      const currentPrice = parseFloat(ticker.lastPrice);
      
      // 1. Manage Existing Positions
      await manageOpenPositions(symbol, currentPrice, bybit);

      // 2. Candle Close Gate
      const currentCandleTime = parseInt(klines[0][0]); 
      if (lastCandleTimes[symbol] === currentCandleTime) {
          continue; 
      }
      lastCandleTimes[symbol] = currentCandleTime;

      const info = await bybit.getInstrumentsInfo(symbol);
      const tickSize = parseFloat(info.priceFilter.tickSize);
      
      const { closes } = ind.parseKlines(klines);
      const emaFast = ind.calculateEMA(closes, 10);
      const emaSlow = ind.calculateEMA(closes, 45);

      const signal = strat.getScoreSignal(symbol, klines, tickSize, currentPrice, emaFast, emaSlow);

      console.log(`📊 ${symbol} NEW CANDLE | Price: $${currentPrice} | Buy: ${signal.buyScore/17} | Sell: ${signal.sellScore/17} | Regime: ${signal.regime}`);

      // 3. Execute if signal exists
      if (signal.signalType !== 0) {
        const dominantVotes = signal.signalType === 1 ? (signal.buyScore / 17) : (signal.sellScore / 17);
        
        // 🛑 MQL5 RULE: Require at least 2 votes
        if (dominantVotes < 2) {
           console.log(`⏭️ Skipping ${symbol}: Only ${dominantVotes} vote(s). Need at least 2.`);
           continue; 
        }

        // 🧬 CHECK DNA: Block historically terrible setups
        const stratName = getDominantStrategy(signal);
        const dnaStats = await db.getDNAStats(symbol, 'strategy', stratName);
        
        if (dnaStats) {
          const totalTrades = dnaStats.wins + dnaStats.losses;
          const winRate = (dnaStats.wins / totalTrades) * 100;
          
          if (totalTrades >= 5 && winRate < 30) {
            console.log(`🧬 DNA BLOCK: ${symbol} | ${stratName} has a ${winRate.toFixed(1)}% win rate over ${totalTrades} trades. Blocked.`);
            continue; 
          }
        }

        const openPos = paperAccount.openPositions.find(p => p.symbol === symbol);
        
        if (!openPos) {
          // 🛡️ CHECK CONSECUTIVE LOSS GOVERNOR
          if (consecutiveLosses >= config.maxConsecutiveLosses) {
            console.log(`🛑 CAPITAL PROTECTION: ${consecutiveLosses} consecutive losses. Trading halted for the day.`);
            continue; 
          }

          let currentRisk = config.riskPerTradePercent;
          if (config.lossGovernor[consecutiveLosses]) {
             currentRisk = currentRisk * config.lossGovernor[consecutiveLosses];
             console.log(`⚠️ Loss Governor Active: Reduced risk to ${currentRisk}%`);
          }

          const adjustedConfig = { ...config, riskPerTradePercent: currentRisk };
          const plan = tradeEngine.buildTradePlan(symbol, signal, currentPrice, klines, info, paperAccount.balance, adjustedConfig);
          
          if (plan) {
            if (config.paperTrading) {
              await executePaperTrade(plan, signal);
            } else {
              const livePosition = await execution.executeLiveTrade(bybit, plan, signal, config);
              if (livePosition) paperAccount.openPositions.push(livePosition);
            }
          }
        } else {
          // === 2. WE HAVE AN OPEN POSITION ===
          const isOppositeSignal = (openPos.side === 'BUY' && signal.signalType === -1) || (openPos.side === 'SELL' && signal.signalType === 1);
          
          if (isOppositeSignal) {
            const slDist = Math.abs(openPos.entryPrice - openPos.slPrice);
            const currentLossDist = openPos.side === 'BUY' 
                ? (openPos.entryPrice - currentPrice) 
                : (currentPrice - openPos.entryPrice);
            
            if (currentLossDist > (slDist * 0.50)) {
              console.log(`\n🔄 HYBRID FLIP TRIGGERED on ${symbol}:`);
              
              if (!config.paperTrading) {
                try {
                  await bybit.closePosition({ symbol: openPos.symbol, positionSide: openPos.side, qty: openPos.qty });
                } catch (e) {
                  console.error(`❌ Failed to close for flip:`, e.message);
                  continue; 
                }
              }
              
              const idx = paperAccount.openPositions.indexOf(openPos);
              await closePaperTrade(idx, currentPrice, 'Hybrid Flip (Reversal)');
              
              const adjustedConfig = { ...config, riskPerTradePercent: config.riskPerTradePercent };
              const plan = tradeEngine.buildTradePlan(symbol, signal, currentPrice, klines, info, paperAccount.balance, adjustedConfig);
              
              if (plan) {
                if (config.paperTrading) {
                  await executePaperTrade(plan, signal);
                } else {
                  const livePosition = await execution.executeLiveTrade(bybit, plan, signal, config);
                  if (livePosition) paperAccount.openPositions.push(livePosition);
                }
              }
            } else {
              console.log(`⏳ HYBRID SKIP: Keeping ${openPos.side} on ${symbol}. Loss not >50% yet.`);
            }
          }
        }
      }
    } catch (e) {
      console.error(`❌ Error on ${symbol}:`, e.message);
    }
  }
}

async function executePaperTrade(plan, signal) {
  const position = {
    ...plan,
    primaryStrategy: getDominantStrategy(signal),
    openTime: now(),
    status: 'OPEN',
    maxFavorableExcursion: 0,
    breakEvenSet: false,
    tp1Hit: false,
    tp2Hit: false
  };
  
  try {
    position.dbId = await db.logTradeOpen({
      ...plan,
      votes: signal.buyScore > signal.sellScore ? signal.buyScore/17 : signal.sellScore/17,
      regime: signal.regime
    });
  } catch (e) {
    console.error(`❌ DB Save Failed:`, e.message);
  }

  paperAccount.openPositions.push(position);
  
  console.log(`\n[${now()}] 🟢 PAPER TRADE OPENED: ${plan.side.toUpperCase()} ${plan.symbol}`);
  console.log(`  Qty: ${plan.qty} | Entry: $${plan.entryPrice}`);
  console.log(`  SL: $${plan.slPrice} | TP1: $${plan.tp1Price} | TP2: $${plan.tp2Price} | TP3: $${plan.tp3Price}`);
  
  await tg.sendMessage(`🟢 <b>PAPER TRADE OPENED</b>\n\n<b>Pair:</b> ${plan.symbol}\n<b>Side:</b> ${plan.side.toUpperCase()}\n<b>Qty:</b> ${plan.qty}\n<b>Entry:</b> $${plan.entryPrice}`);
}

async function manageOpenPositions(symbol, currentPrice, bybit) {
  for (let i = paperAccount.openPositions.length - 1; i >= 0; i--) {
    let pos = paperAccount.openPositions[i];
    if (pos.symbol !== symbol) continue;

    const activeSl = pos.virtualSl || pos.slPrice;
    
    // 🛑 1. CHECK TP3 (Full close)
    const hitTP3 = (pos.side === 'Buy' && currentPrice >= pos.tp3Price) || (pos.side === 'Sell' && currentPrice <= pos.tp3Price);
    if (hitTP3) {
      if (!config.paperTrading) await bybit.closePosition({ symbol: pos.symbol, positionSide: pos.side, qty: pos.qty });
      await closePaperTrade(i, pos.tp3Price, 'TP3 Hit (Full Close)');
      continue;
    }

    // 🛑 2. CHECK TP2 (Close 30%, move SL to TP1)
    const hitTP2 = (pos.side === 'Buy' && currentPrice >= pos.tp2Price) || (pos.side === 'Sell' && currentPrice <= pos.tp2Price);
    if (hitTP2 && !pos.tp2Hit) {
      pos.tp2Hit = true;
      const closeQty = parseFloat((pos.qty * 0.30).toFixed(4));
      
      if (!config.paperTrading && closeQty > 0) {
        await bybit.closePosition({ symbol: pos.symbol, positionSide: pos.side, qty: closeQty });
        await bybit.setTradingStop({ symbol: pos.symbol, stopLoss: pos.tp1Price });
      }
      
      pos.virtualSl = pos.tp1Price;
      pos.slPrice = pos.tp1Price;
      pos.qty = pos.qty - closeQty;
      
      console.log(`\n[${now()}] ✂️ TP2 HIT: ${pos.symbol} | Closed 30% | SL moved to TP1`);
      await tg.sendMessage(`✂️ <b>TP2 HIT (30%)</b>\n\n<b>Pair:</b> ${pos.symbol}\n<b>Closed:</b> ${closeQty}\n<b>SL Moved to:</b> $${pos.tp1Price}`);
      
      // 👈 WEBHOOK FOR CHANNELS
      if (process.env.IS_MASTER === 'true') {
        await tg.sendWebhook({
          type: 'POSITION_UPDATE',
          source: 'MASTER',
          asset_class: 'CRYPTO',
          symbol: pos.symbol,
          direction: pos.side.toUpperCase(),
          new_sl: pos.tp1Price,
          be_text: 'TP2 Hit (30% Closed) — SL moved to TP1',
          ticket: pos.dbId,
          time: new Date().toISOString().slice(0,16).replace('T',' ')
        });
      }
      continue;
    }

    // 🛑 3. CHECK TP1 (Close 50%, move SL to Breakeven)
    const hitTP1 = (pos.side === 'Buy' && currentPrice >= pos.tp1Price) || (pos.side === 'Sell' && currentPrice <= pos.tp1Price);
    if (hitTP1 && !pos.tp1Hit) {
      pos.tp1Hit = true;
      const closeQty = parseFloat((pos.qty * 0.50).toFixed(4));
      
      if (!config.paperTrading && closeQty > 0) {
        await bybit.closePosition({ symbol: pos.symbol, positionSide: pos.side, qty: closeQty });
        await bybit.setTradingStop({ symbol: pos.symbol, stopLoss: pos.entryPrice });
      }
      
      pos.virtualSl = pos.entryPrice;
      pos.slPrice = pos.entryPrice;
      pos.breakEvenSet = true;
      pos.qty = pos.qty - closeQty;
      
      console.log(`\n[${now()}] ✂️ TP1 HIT: ${pos.symbol} | Closed 50% | SL moved to Entry`);
      await tg.sendMessage(`✂️ <b>TP1 HIT (50%)</b>\n\n<b>Pair:</b> ${pos.symbol}\n<b>Closed:</b> ${closeQty}\n<b>SL Moved to:</b> $${pos.entryPrice}`);
      
      // 👈 WEBHOOK FOR CHANNELS
      if (process.env.IS_MASTER === 'true') {
        await tg.sendWebhook({
          type: 'POSITION_UPDATE',
          source: 'MASTER',
          asset_class: 'CRYPTO',
          symbol: pos.symbol,
          direction: pos.side.toUpperCase(),
          new_sl: pos.entryPrice,
          be_text: 'TP1 Hit (50% Closed) — SL moved to Breakeven',
          ticket: pos.dbId,
          time: new Date().toISOString().slice(0,16).replace('T',' ')
        });
      }
      continue;
    }

    // 🛑 4. CHECK STOP LOSS
    const hitSL = (pos.side === 'Buy' && currentPrice <= activeSl) || (pos.side === 'Sell' && currentPrice >= activeSl);
    if (hitSL) {
      if (!config.paperTrading) await bybit.closePosition({ symbol: pos.symbol, positionSide: pos.side, qty: pos.qty });
      await closePaperTrade(i, activeSl, 'SL Hit');
      continue;
    }
  }
}

async function closePaperTrade(index, closePrice, reason, exactPnl = null) {
  const pos = paperAccount.openPositions[index];
  let pnl = exactPnl;
  
  if (pnl === null) {
    if (pos.side === 'Buy') pnl = (closePrice - pos.entryPrice) * pos.qty;
    else pnl = (pos.entryPrice - closePrice) * pos.qty;
  }

  try {
    await db.logTradeClose(pos.dbId, closePrice, pnl, reason);
  } catch (e) {
    console.error(`❌ DB Close Failed:`, e.message);
  }

  paperAccount.balance += pnl;
  paperAccount.openPositions.splice(index, 1);

  const isWin = pnl >= 0;
  if (isWin) {
    consecutiveLosses = 0; 
  } else {
    consecutiveLosses++;
    symbolCooldowns[pos.symbol] = Date.now() + (config.symbolCooldownMinutes * 60 * 1000);
  }

  if (pos.primaryStrategy && pos.regime) {
    await db.updateDNA(pos.symbol, 'strategy', pos.primaryStrategy, isWin, pnl);
    await db.updateDNA(pos.symbol, 'regime', pos.regime, isWin, pnl);
  }

  console.log(`\n[${now()}] 🔴 TRADE CLOSED: ${pos.symbol} ${pos.side} | PnL: $${pnl.toFixed(2)}`);
  await tg.sendMessage(`🔴 <b>TRADE CLOSED</b>\n\n<b>Pair:</b> ${pos.symbol}\n<b>Reason:</b> ${reason}\n<b>PnL:</b> $${pnl.toFixed(2)}`);
  
  // 👈 WEBHOOK FOR CHANNELS (WIN/LOSS CARD)
  if (process.env.IS_MASTER === 'true') {
    await tg.sendWebhook({
      type: 'TRADE_CLOSE',
      source: 'MASTER',
      asset_class: 'CRYPTO',
      result: isWin ? 'WIN' : 'LOSS',
      symbol: pos.symbol,
      direction: pos.side.toUpperCase(),
      profit: pnl.toFixed(2),
      reason: reason,
      ticket: pos.dbId,
      time: new Date().toISOString().slice(0,16).replace('T',' ')
    });
  }
}

async function syncOpenTrades(bybit) {
  if (!process.env.DATABASE_URL) return;
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const res = await pool.query(`SELECT * FROM crypto_trades WHERE status = 'OPEN'`);
    if (res.rows.length === 0) return;
    for (const trade of res.rows) {
      if (!trade.order_id) continue;
      const closedData = await bybit.getClosedPnl({ symbol: trade.symbol, orderId: trade.order_id });
      if (closedData && closedData.list && closedData.list.length > 0) {
        const pnlData = closedData.list[0];
        await pool.query(
          `UPDATE crypto_trades SET close_price = $1, pnl_usd = $2, status = 'CLOSED', close_reason = $3, closed_at = NOW() WHERE id = $4`,
          [parseFloat(pnlData.avgExitPrice), parseFloat(pnlData.closedPnl), 'Synced on startup', trade.id]
        );
        console.log(`✅ Synced DB Trade #${trade.id} (${trade.symbol}) -> CLOSED`);
      }
    }
  } catch (err) {
    console.error('❌ Sync error:', err.message);
  } finally {
    await pool.end();
  }
}

async function startupTest() {
  console.log(`🤖 Uluka Crypto Bot Starting...`);
  console.log(`   Mode: ${config.paperTrading ? 'PAPER TRADING' : 'LIVE / DEMO EXECUTION'}`); // 👈 This is the dynamic line!
  console.log(`   Symbols: ${config.symbols.join(', ')}`);
  console.log(`   Interval: ${config.timeframe}m`);

  const bybit = new BybitClient({ 
    apiKey: process.env.BYBIT_API_KEY,
    apiSecret: process.env.BYBIT_API_SECRET,
    testnet: false,
    demo: true 
  });

  await syncOpenTrades(bybit);

  if (process.env.TELEGRAM_BOT_TOKEN) {
    await tg.sendMessage('🤖 <b>System Check:</b> Crypto Bot has booted up on Railway!').catch(() => {});
  }
}

async function mainLoop() {
  await runTick(); 
  setTimeout(mainLoop, 15000); 
}

startupTest().then(() => {
  mainLoop();
});
