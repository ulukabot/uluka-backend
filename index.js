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

// 🧠 HELPER: IDENTIFY DOMINANT STRATEGY
function getDominantStrategy(signal) {
  if (signal.signalType === 1) { 
    if (signal.obBuy) return 'OB'; 
    if (signal.fvgBuy) return 'FVG';
    if (signal.chochBuy) return 'CHoCH'; 
    if (signal.bosBuy) return 'BOS';
    if (signal.farsightBuy) return 'Farsight'; 
    if (signal.visionBuy) return 'Vision';
  } else { 
    if (signal.obSell) return 'OB'; 
    if (signal.fvgSell) return 'FVG';
    if (signal.chochSell) return 'CHoCH'; 
    if (signal.bosSell) return 'BOS';
    if (signal.farsightSell) return 'Farsight'; 
    if (signal.visionSell) return 'Vision';
  }
  return 'Unknown';
}

// 🕒 TIME HELPER
const now = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

// 📊 GLOBAL STATE TRACKERS
const lastCandleTimes = {};       
const openPositions = {};         
const consecutiveLosses = {};     
const symbolCooldowns = {};       

// 📡 FETCH USERS FROM FOREX BACKEND
async function fetchUsers() {
  try {
    const res = await fetch('https://uluka-backend-production.up.railway.app/api/crypto/active-users', {
      headers: { 'x-admin-secret': process.env.ADMIN_SECRET }
    });
    
    if (!res.ok) {
      console.error(`❌ Backend rejected request. HTTP Status: ${res.status}. Check your ADMIN_SECRET!`);
      return [];
    }

    const data = await res.json();
    if (!Array.isArray(data)) {
      console.error('❌ Backend returned an error instead of an array:', data);
      return [];
    }
    return data;
  } catch (e) {
    console.error('❌ Failed to fetch users from backend:', e.message);
    return [];
  }
}

// 🔄 SYNC OPEN TRADES ON STARTUP
async function syncOpenTrades() {
  if (!process.env.DATABASE_URL) return;
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  
  try {
    const res = await pool.query(`SELECT * FROM crypto_trades WHERE status = 'OPEN'`);
    if (!res?.rows || res.rows.length === 0) return;
    
    console.log(`🔄 Syncing ${res.rows.length} OPEN trades with Bybit...`);

    for (const trade of res.rows) {
      if (!trade.order_id) continue;
      
      const bybit = new BybitClient({ 
        apiKey: process.env.BYBIT_API_KEY, 
        apiSecret: process.env.BYBIT_API_SECRET, 
        testnet: false, 
        demo: process.env.BYBIT_DEMO === 'true' 
      });

      const closedData = await bybit.getClosedPnl({ symbol: trade.symbol, orderId: trade.order_id });
      
      if (closedData?.list && closedData.list.length > 0) {
        const pnlData = closedData.list[0];
        const closePrice = parseFloat(pnlData.avgExitPrice);
        const pnl = parseFloat(pnlData.closedPnl);
        
        let reason = 'Closed on Exchange';
        if (pnlData.orderType === 'TakeProfit') reason = 'TP Hit';
        else if (pnlData.orderType === 'StopLoss') reason = 'SL Hit';
        else if (pnlData.orderType === 'Market') reason = 'Market Closed';

        await pool.query(
          `UPDATE crypto_trades SET close_price = $1, pnl_usd = $2, status = 'CLOSED', close_reason = $3, closed_at = NOW() WHERE id = $4`,
          [closePrice, pnl, reason, trade.id]
        );
        console.log(`✅ Synced DB Trade #${trade.id} (${trade.symbol}) -> CLOSED with PnL $${pnl}`);

        // 👈 SEND MISSING WEBHOOK FOR OFFLINE CLOSES
        if (process.env.IS_MASTER === 'true') {
          await tg.sendWebhook({ 
            type: 'TRADE_CLOSE', 
            source: 'MASTER', 
            asset_class: 'CRYPTO', 
            result: pnl >= 0 ? 'WIN' : 'LOSS', 
            symbol: trade.symbol, 
            direction: trade.side.toUpperCase(), 
            profit: pnl.toFixed(2), 
            reason: reason, 
            ticket: trade.id, 
            time: now() 
          });
        }
      }
    }
  } catch (err) {
    console.error('❌ Sync error:', err.message);
  } finally {
    await pool.end();
  }
}

// 🔄 MAIN TICK LOOP
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
      
      if (!consecutiveLosses[user.account_id]) {
        consecutiveLosses[user.account_id] = 0;
      }

      // 🛡️ SAFE BALANCE FETCH
      let balData;
      try {
        balData = await bybit.getBalance();
      } catch (e) {
        console.log(`⏭️ Skipping ${user.account_id}: Bybit API error (Balance)`);
        continue;
      }
      
      if (!balData || !balData.list || !Array.isArray(balData.list) || balData.list.length === 0) {
        console.log(`⏭️ Skipping ${user.account_id}: Empty balance list from Bybit.`);
        continue;
      }

      const usdt = balData.list[0]?.coin?.find(c => c.coin === 'USDT');
      const equity = parseFloat(usdt?.equity || 0);
      
      if (equity <= 0) continue;

      // 🛡️ TIER CAP GUARD
      if (equity > user.tier_cap) {
        console.log(`⏭️ Skipping ${user.account_id}: Equity $${equity} exceeds Tier Cap $${user.tier_cap}`);
        continue; 
      }
      
      // 🛡️ GUARDIAN ANGEL DD GUARD
      if (user.peak_equity > 0 && equity < (user.peak_equity * 0.90)) { 
        if (user.is_master) {
          await tg.sendMessage(`🚨 <b>ULUKA ULTIMA - GUARDIAN ANGEL</b> 🦉\n\nAccount: ${user.account_id}\nDrawdown limit hit (>10%).\nEquity: $${equity}\nPeak: $${user.peak_equity}\nTrading halted for this account.`);
        }
        continue; 
      }

      // UPDATE PEAK EQUITY TO BACKEND
      if (equity > user.peak_equity || user.daily_start_equity === 0) {
        await fetch('https://uluka-backend-production.up.railway.app/api/crypto/update-equity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-secret': process.env.ADMIN_SECRET },
          body: JSON.stringify({ account_id: user.account_id, peak: Math.max(equity, user.peak_equity), daily_start: equity })
        }).catch(() => {});
      }

      const userSymbols = (user.symbols || 'BTCUSDT,ETHUSDT').split(',');
      
      if (!openPositions[user.account_id]) {
        openPositions[user.account_id] = [];
      }

      for (const symbol of userSymbols) {
        const symbolKey = `${user.account_id}-${symbol}`;
        
        // 🛡️ COOLDOWN CHECK
        if (symbolCooldowns[symbolKey] && Date.now() < symbolCooldowns[symbolKey]) {
          continue;
        }
        
        if (lastCandleTimes[symbolKey] === undefined) {
          lastCandleTimes[symbolKey] = 0;
        }

        // 🛡️ SAFE KLINES FETCH
        let klines;
        try {
          klines = await bybit.getKlines({ symbol, interval: config.timeframe, limit: 100 });
        } catch (e) { 
          continue; 
        }
        
        if (!klines || !Array.isArray(klines) || klines.length < 50) {
          continue;
        }
        if (!klines[0] || !klines[0][0]) {
          continue;
        }

        // 🛡️ SAFE TICKER FETCH
        let ticker;
        try {
          ticker = await bybit.getTicker(symbol);
        } catch (e) { 
          continue; 
        }
        
        if (!ticker || !ticker.lastPrice) {
          continue;
        }
        
        const currentPrice = parseFloat(ticker.lastPrice);

        // MANAGE EXISTING OPEN POSITIONS
        await manageOpenPositions(user, symbol, currentPrice, bybit);

        // CANDLE CLOSE GATE
        const currentCandleTime = parseInt(klines[0][0]); 
        if (lastCandleTimes[symbolKey] === currentCandleTime) {
          continue; 
        }
        lastCandleTimes[symbolKey] = currentCandleTime;

        // 🛡️ SAFE INSTRUMENT INFO FETCH
        let info;
        try {
          info = await bybit.getInstrumentsInfo(symbol);
        } catch (e) { 
          continue; 
        }

        if (!info || !info.priceFilter) {
          continue;
        }
        
        const tickSize = parseFloat(info.priceFilter.tickSize);
        
        const { closes } = ind.parseKlines(klines);
        const signal = strat.getScoreSignal(symbol, klines, tickSize, currentPrice, ind.calculateEMA(closes, 10), ind.calculateEMA(closes, 45));

        if (signal.signalType !== 0) {
          const dominantVotes = signal.signalType === 1 ? (signal.buyScore / 17) : (signal.sellScore / 17);
          
          if (dominantVotes < 2) {
            continue;
          }

          // 🧬 DNA BLOCKING
          const stratName = getDominantStrategy(signal);
          const dnaStats = await db.getDNAStats(symbol, 'strategy', stratName);
          
          if (dnaStats) {
            const total = dnaStats.wins + dnaStats.losses;
            const winRate = (dnaStats.wins / total) * 100;
            if (total >= 5 && winRate < 30) {
              console.log(`🧬 DNA BLOCK: ${user.account_id} | ${symbol} ${stratName} has a ${winRate.toFixed(1)}% win rate.`);
              continue;
            }
          }

          const openPos = openPositions[user.account_id].find(p => p.symbol === symbol);
          
          if (!openPos) {
            // 🛡️ LOSS GOVERNOR CHECK (FIXED TYPO)
            if (consecutiveLosses[user.account_id] >= config.maxConsecutiveLosses) {
              console.log(`🛑 CAPITAL PROTECTION: ${user.account_id} halted due to consecutive losses.`);
              continue;
            }
            
            let currentRisk = user.risk_percent;
            if (config.consecutiveLossGovernor[consecutiveLosses[user.account_id]]) { // 👈 FIXED TYPO
              currentRisk *= config.consecutiveLossGovernor[consecutiveLosses[user.account_id]];
              console.log(`⚠️ Loss Governor Active for ${user.account_id}: Reduced risk to ${currentRisk}%`);
            }

            const adjustedConfig = { ...config, riskPerTradePercent: currentRisk };
            const plan = tradeEngine.buildTradePlan(symbol, signal, currentPrice, klines, info, equity, adjustedConfig);
            
            if (plan) {
              const livePos = await execution.executeLiveTrade(bybit, plan, signal, adjustedConfig, user);
              if (livePos) {
                livePos.symbol = symbol; 
                livePos.side = plan.side; 
                livePos.regime = signal.regime;
                livePos.primaryStrategy = stratName;
                openPositions[user.account_id].push(livePos);
              }
            }
          } else {
            // 🔄 HYBRID FLIP LOGIC
            const isOpp = (openPos.side === 'BUY' && signal.signalType === -1) || (openPos.side === 'SELL' && signal.signalType === 1);
            
            if (isOpp) {
              const slDist = Math.abs(openPos.entryPrice - openPos.slPrice);
              const lossDist = openPos.side === 'BUY' ? (openPos.entryPrice - currentPrice) : (currentPrice - openPos.entryPrice);
              
              if (lossDist > (slDist * 0.50)) {
                console.log(`\n🔄 HYBRID FLIP TRIGGERED for ${user.account_id} on ${symbol}`);
                await bybit.closePosition({ symbol: openPos.symbol, positionSide: openPos.side, qty: openPos.qty });
                const idx = openPositions[user.account_id].indexOf(openPos);
                await closeTrade(user, idx, openPos, currentPrice, 'Hybrid Flip (Reversal)', bybit);
                
                const plan = tradeEngine.buildTradePlan(symbol, signal, currentPrice, klines, info, equity, { ...config, riskPerTradePercent: user.risk_percent });
                if (plan) {
                  const livePos = await execution.executeLiveTrade(bybit, plan, signal, { ...config, riskPerTradePercent: user.risk_percent }, user);
                  if (livePos) { 
                    livePos.symbol = symbol; 
                    livePos.side = plan.side; 
                    livePos.regime = signal.regime;
                    livePos.primaryStrategy = stratName; 
                    openPositions[user.account_id].push(livePos); 
                  }
                }
              }
            }
          }
        }
      }
      
      // 1-SECOND DELAY BETWEEN USERS
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (e) { 
      console.error(`❌ Error on ${user.account_id}:`, e.message); 
    }
  }
}

// 🛡️ POSITION MANAGEMENT (TPs, Breakeven, SL)
async function manageOpenPositions(user, symbol, currentPrice, bybit) {
  if (!openPositions[user.account_id]) return;
  const positions = openPositions[user.account_id];
  
  for (let i = positions.length - 1; i >= 0; i--) {
    let pos = positions[i];
    if (pos.symbol !== symbol) continue;
    
    const activeSl = pos.virtualSl || pos.slPrice;

    // 🛑 1. CHECK TP3 (Full close)
    if ((pos.side === 'Buy' && currentPrice >= pos.tp3Price) || (pos.side === 'Sell' && currentPrice <= pos.tp3Price)) {
      await bybit.closePosition({ symbol: pos.symbol, positionSide: pos.side, qty: pos.qty });
      await closeTrade(user, i, pos, pos.tp3Price, 'TP3 Hit (Full Close)', bybit); 
      continue;
    }

    // 🛑 2. CHECK TP2 (Close 30%, move SL to TP1)
    if ((pos.side === 'Buy' && currentPrice >= pos.tp2Price) || (pos.side === 'Sell' && currentPrice <= pos.tp2Price)) {
      if (!pos.tp2Hit) {
        pos.tp2Hit = true;
        const closeQty = parseFloat((pos.qty * 0.30).toFixed(4));
        
        await bybit.closePosition({ symbol: pos.symbol, positionSide: pos.side, qty: closeQty });
        await bybit.setTradingStop({ symbol: pos.symbol, stopLoss: pos.tp1Price });
        
        pos.virtualSl = pos.tp1Price; 
        pos.slPrice = pos.tp1Price; 
        pos.qty -= closeQty;
        
        console.log(`\n[${now()}] ✂️ TP2 HIT: ${user.account_id} | ${symbol} | Closed 30% | SL moved to TP1`);
        
        if (user.is_master && process.env.IS_MASTER === 'true') {
          await tg.sendWebhook({ 
            type: 'POSITION_UPDATE', source: 'MASTER', asset_class: 'CRYPTO', 
            symbol: pos.symbol, direction: pos.side.toUpperCase(), new_sl: pos.tp1Price, 
            entry: pos.entryPrice, open_pnl: '30% Closed', // 👈 ADDED MISSING FIELDS
            be_text: 'Uluka Ultima: TP2 Hit (30% Closed) — SL moved to TP1', ticket: pos.dbId, time: now() 
          });
        } 
        continue;
      }
    }

    // 🛑 3. CHECK TP1 (Close 50%, move SL to Breakeven)
    if ((pos.side === 'Buy' && currentPrice >= pos.tp1Price) || (pos.side === 'Sell' && currentPrice <= pos.tp1Price)) {
      if (!pos.tp1Hit) {
        pos.tp1Hit = true;
        const closeQty = parseFloat((pos.qty * 0.50).toFixed(4));
        
        await bybit.closePosition({ symbol: pos.symbol, positionSide: pos.side, qty: closeQty });
        await bybit.setTradingStop({ symbol: pos.symbol, stopLoss: pos.entryPrice });
        
        pos.virtualSl = pos.entryPrice; 
        pos.slPrice = pos.entryPrice; 
        pos.qty -= closeQty;
        
        console.log(`\n[${now()}] ✂️ TP1 HIT: ${user.account_id} | ${symbol} | Closed 50% | SL moved to Entry`);
        
        if (user.is_master && process.env.IS_MASTER === 'true') {
          await tg.sendWebhook({ 
            type: 'POSITION_UPDATE', source: 'MASTER', asset_class: 'CRYPTO', 
            symbol: pos.symbol, direction: pos.side.toUpperCase(), new_sl: pos.entryPrice, 
            entry: pos.entryPrice, open_pnl: '50% Closed', // 👈 ADDED MISSING FIELDS
            be_text: 'Uluka Ultima: TP1 Hit (50% Closed) — SL moved to Breakeven', ticket: pos.dbId, time: now() 
          });
        } 
        continue;
      }
    }

    // 🛑 4. CHECK STOP LOSS
    if ((pos.side === 'Buy' && currentPrice <= activeSl) || (pos.side === 'Sell' && currentPrice >= activeSl)) {
      await bybit.closePosition({ symbol: pos.symbol, positionSide: pos.side, qty: pos.qty });
      await closeTrade(user, i, pos, activeSl, 'SL Hit', bybit); 
      continue;
    }
  }
}

// 📝 CLOSE TRADE & UPDATE METRICS
async function closeTrade(user, index, pos, closePrice, reason, bybit) {
  let pnl = pos.side === 'Buy' ? (closePrice - pos.entryPrice) * pos.qty : (pos.entryPrice - closePrice) * pos.qty;
  
  await db.logTradeClose(pos.dbId, closePrice, pnl, reason);

  if (pnl >= 0) {
    consecutiveLosses[user.account_id] = 0;
  } else {
    consecutiveLosses[user.account_id]++;
    symbolCooldowns[`${user.account_id}-${pos.symbol}`] = Date.now() + (config.symbolCooldownMinutes * 60 * 1000);
  }

  if (pos.primaryStrategy && pos.regime) {
    await db.updateDNA(pos.symbol, 'strategy', pos.primaryStrategy, pnl >= 0, pnl);
    await db.updateDNA(pos.symbol, 'regime', pos.regime, pnl >= 0, pnl);
  }

  console.log(`\n[${now()}] 🔴 TRADE CLOSED: ${user.account_id} | ${pos.symbol} | PnL: $${pnl.toFixed(2)}`);

  if (user.is_master && process.env.IS_MASTER === 'true') {
    await tg.sendWebhook({ 
      type: 'TRADE_CLOSE', source: 'MASTER', asset_class: 'CRYPTO', 
      result: pnl >= 0 ? 'WIN' : 'LOSS', symbol: pos.symbol, direction: pos.side.toUpperCase(), 
      profit: pnl.toFixed(2), reason: reason, ticket: pos.dbId, time: now() 
    });
  }
  
  openPositions[user.account_id].splice(index, 1);
}

// 🚀 STARTUP & MAIN LOOP
async function startupTest() {
  console.log(`[VERSION 3.0] 🦉 Uluka Ultima - Crypto Engine Starting...`);
  
  if (process.env.TELEGRAM_BOT_TOKEN) {
    await tg.sendMessage('🦉 <b>System Check:</b> Uluka Ultima has booted up on Railway!').catch(() => {});
  }

  await syncOpenTrades();
}

async function mainLoop() { 
  await runTick(); 
  setTimeout(mainLoop, 15000); 
}

startupTest().then(() => {
  mainLoop();
});
