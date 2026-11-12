// index.js

require('dotenv').config();

// 🔥 ADD THESE TWO LINES TO FIX THE 'pool is not defined' ERROR
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
// 🔥 END

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
const ddAlertSent = {};

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
// 🔄 MAIN TICK LOOP (Copy-Trading Architecture)
async function runTick() {
  const users = await fetchUsers();
  if (!users || users.length === 0) return;

  // 1. Identify the Master Account
  const masterUser = users.find(u => u.is_master);
  if (!masterUser) {
    console.log('❌ No Master user found. Cannot scan or trade.');
    return;
  }

  // 2. Get symbols from Master's configuration
  const masterSymbols = (masterUser.symbols || 'BTCUSDT,ETHUSDT')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(s => /USDT$/.test(s));
  if (masterSymbols.length === 0) masterSymbols.push('BTCUSDT', 'ETHUSDT');

  // 3. Create a Master instance for Market Data Fetching
  const masterBybit = new BybitClient({ 
    apiKey: masterUser.api_key, 
    apiSecret: masterUser.api_secret, 
    testnet: false, 
    demo: process.env.BYBIT_DEMO === 'true' 
  });

  // 4. Loop through each symbol ONCE
  for (const symbol of masterSymbols) {
    const symbolKey = `MASTER-${symbol}`;

    // --- A. Fetch Market Data (ONCE per symbol) ---
    let klines, ticker, info;
    try {
      klines = await masterBybit.getKlines({ symbol, interval: config.timeframe, limit: 100 });
      ticker = await masterBybit.getTicker(symbol);
      info = await masterBybit.getInstrumentsInfo(symbol);
    } catch (e) { 
      continue; 
    }

    if (!klines || !Array.isArray(klines) || klines.length < 50 || !ticker || !ticker.lastPrice || !info) continue;

    const currentPrice = parseFloat(ticker.lastPrice);
    const tickSize = parseFloat(info.priceFilter.tickSize);
    let qtyStep = 0.001, minOrderQty = 0.001;
    if (info.lotSizeFilter) {
        qtyStep = parseFloat(info.lotSizeFilter.qtyStep);
        minOrderQty = parseFloat(info.lotSizeFilter.minOrderQty);
    }

    // --- B. Manage Positions for ALL users ---
    for (const user of users) {
      if (!openPositions[user.account_id]) openPositions[user.account_id] = [];
      
      const userBybit = new BybitClient({ 
        apiKey: user.api_key, apiSecret: user.api_secret, 
        testnet: false, demo: process.env.BYBIT_DEMO === 'true' 
      });
      
      await manageOpenPositions(user, symbol, currentPrice, userBybit, qtyStep, minOrderQty);
      await new Promise(r => setTimeout(r, 100)); // Small buffer to prevent rate limits
    }

    // --- C. Master Scan for New Entries ---
    const currentCandleTime = parseInt(klines[0][0]);
    if (lastCandleTimes[symbolKey] === currentCandleTime) continue;
    lastCandleTimes[symbolKey] = currentCandleTime;

    // Calculate signal ONCE on the Master
    const { closes } = ind.parseKlines(klines);
    const signal = strat.getScoreSignal(symbol, klines, tickSize, currentPrice, ind.calculateEMA(closes, 10), ind.calculateEMA(closes, 45));

    if (signal.signalType === 0) continue;

    const rawScore = signal.signalType === 1 ? signal.buyScore : signal.sellScore;
    const confidence = Math.min(100, Math.round((rawScore / 17) * 100));
    
    if (confidence < 60) {
      console.log(`⏭️ [SKIP] ${symbol} | Confidence: ${confidence}% (${rawScore}/17)`);
      continue;
    }

    console.log(`✅ [SIGNAL CONFIRMED] ${symbol} | Confidence: ${confidence}% | Distributing to clients...`);

    // Check News
    if (process.env.ENABLE_NEWS_FILTER !== 'false') {
      try {
        const newsRes = await fetch('https://uluka-backend-production.up.railway.app/api/test-news');
        const newsData = await newsRes.json();
        if (newsData.high_news_blocked || newsData.medium_news_blocked) {
          console.log(`📰 NEWS BLOCK: Skipping ${symbol}`);
          continue;
        }
      } catch (e) {}
    }

    // Master DB Limit Check
    const dbCheck = await pool.query(
        `SELECT id FROM crypto_trades WHERE account_id = $1 AND symbol = $2 AND status = 'OPEN' LIMIT 1`,
        [masterUser.account_id, symbol]
    );
    if (dbCheck.rows.length > 0) {
        console.log(`⏭️ Master already has an open ${symbol} trade. Skipping.`);
        continue;
    }

        // Build Master Plan
    try {
        const balData = await masterBybit.getBalance();
        
                       // ✅ FOREX LOGIC: Read exactly the Wallet Balance, ignoring locked margin
        let equity = 0;
        if (balData && balData.list && balData.list.length > 0) {
            const usdt = balData.list[0]?.coin?.find(c => c.coin === 'USDT');
            if (usdt && parseFloat(usdt.walletBalance) > 0) {
                equity = parseFloat(usdt.walletBalance);
            } else {
                equity = parseFloat(balData.list[0]?.totalEquity || 0);
            }
        } else if (balData) {
            equity = parseFloat(balData.walletBalance || balData.totalEquity || 0);
        }

        if (equity <= 0) {
            console.log(`⏭️ Skipping ${symbol}: Master account balance is $0.`);
            continue; // Skips this symbol and moves to the next
        }

        const masterPlan = tradeEngine.buildTradePlan(symbol, signal, currentPrice, klines, info, equity, config);

        if (masterPlan) {
            // 🔥 THIS IS THE MAGIC: Send to Copy Engine to distribute to Master + Clients
            await execution.copyTradeToClients(masterPlan, signal, config, info);
        }
    } catch (e) {
        console.error(`❌ Error building master plan:`, e.message);
    }

    await new Promise(r => setTimeout(r, 1000)); // 1-second delay between symbols
  }
}

// 🛡️ POSITION MANAGEMENT (New 2.0R, 3.5R, 4.5R Logic + Forex Adaptive Trailing)
async function manageOpenPositions(user, symbol, currentPrice, bybit, qtyStep = 0.001, minOrderQty = 0.001) {
  if (!openPositions[user.account_id]) return;
  const positions = openPositions[user.account_id];
  
  for (let i = positions.length - 1; i >= 0; i--) {
    let pos = positions[i];
    if (pos.symbol !== symbol) continue;
    
    let activeSl = pos.virtualSl || pos.slPrice;
    const closeSide = pos.side.toUpperCase() === 'BUY' ? 'Sell' : 'Buy';
    const isBuy = pos.side.toUpperCase() === 'BUY';

    // Calculate 1R distance based on original TP1 (which is 2.0R)
    const rDistance = Math.abs(pos.tp1Price - pos.entryPrice) / 2.0;

    try {
      // ==========================================
      // 1. 🛡️ BREAKEVEN SHIELD (Triggers at 1.0R)
      // ==========================================
      if (!pos.breakEvenSet) {
          const triggerPrice = isBuy ? (pos.entryPrice + (rDistance * 1.0)) : (pos.entryPrice - (rDistance * 1.0));
          const hasHitTrigger = isBuy ? (currentPrice >= triggerPrice) : (currentPrice <= triggerPrice);
          
          if (hasHitTrigger) {
              // Move SL to Breakeven + 10% profit (0.2R)
              const newSl = isBuy ? (pos.entryPrice + (rDistance * 0.2)) : (pos.entryPrice - (rDistance * 0.2));
              
              try {
                  await bybit.setTradingStop({ category: 'linear', symbol: pos.symbol, stopLoss: newSl.toString(), positionIdx: 0 });
                  pos.slPrice = newSl;
                  pos.virtualSl = newSl;
                  pos.breakEvenSet = true;
                  console.log(`\n[${now()}] 🛡️ BE HIT: ${pos.symbol} | SL moved to +0.2R ($${newSl.toFixed(4)})`);
                  
                  if (user.is_master && process.env.IS_MASTER === 'true') {
                      await tg.sendWebhook({ 
                          type: 'POSITION_UPDATE', source: 'MASTER', asset_class: 'CRYPTO', 
                          symbol: pos.symbol, direction: pos.side.toUpperCase(), new_sl: newSl, 
                          entry: pos.entryPrice, open_pnl: 'Risk-Free', 
                          be_text: 'Uluka Ultima: Trade is now Risk-Free (SL moved to +0.2R)', ticket: pos.dbId, time: now() 
                      });
                  }
              } catch (e) {
                  console.error(`❌ Failed to set BE for ${pos.symbol}:`, e.message);
              }
          }
      }

      // ==========================================
      // 2. 📈 ADAPTIVE TRAILING (Forex Logic)
      // ==========================================
      if (pos.breakEvenSet) {
          // Forex Start Distance: 75% of SL distance
          const startD = rDistance * 0.75;
          const profit = isBuy ? (currentPrice - pos.entryPrice) : (pos.entryPrice - currentPrice);

          if (profit >= startD) {
              // Dynamic Multiplier based on profit ratio (from Forex file)
              const profitRatio = profit / startD;
              let dynamicMultiplier = 1.0;
              
              if (profitRatio < 2.0) dynamicMultiplier = 0.8;
              else if (profitRatio < 4.0) dynamicMultiplier = 1.0;
              else dynamicMultiplier = 1.5;

              // Calculate trail distance using the ATR passed from tradeEngine
              const atrValue = pos.atr || (pos.entryPrice * 0.01); // Fallback to 1% if ATR missing
              let trailDist = atrValue * dynamicMultiplier;
              
              // Ensure minimum trailing distance (e.g., 0.1% of price)
              const minStop = currentPrice * 0.001;
              trailDist = Math.max(trailDist, minStop * 2);

              let proposedNewSl = isBuy ? (currentPrice - trailDist) : (currentPrice + trailDist);
              proposedNewSl = parseFloat(proposedNewSl.toFixed(4));

              // Monotonic guard: Only move SL in our favor
              const shouldUpdateSl = isBuy ? (proposedNewSl > pos.slPrice) : (proposedNewSl < pos.slPrice);

              if (shouldUpdateSl) {
                  try {
                      await bybit.setTradingStop({ category: 'linear', symbol: pos.symbol, stopLoss: proposedNewSl.toString(), positionIdx: 0 });
                      pos.slPrice = proposedNewSl;
                      pos.virtualSl = proposedNewSl;
                      console.log(`\n[${now()}] 📈 TRAILING SL: ${pos.symbol} moved to ${proposedNewSl.toFixed(4)} (Mult: ${dynamicMultiplier})`);
                  } catch (e) {
                      console.error(`❌ Failed to trail SL for ${pos.symbol}:`, e.message);
                  }
              }
          }
      }

      // ==========================================
      // 3. 🛑 CHECK TP3 (4.5R) - Full Close
      // ==========================================
      if ((isBuy && currentPrice >= pos.tp3Price) || (!isBuy && currentPrice <= pos.tp3Price)) {
        await bybit.placeOrder({ category: 'linear', symbol: pos.symbol, side: closeSide, orderType: 'Market', qty: pos.qty.toString(), reduceOnly: true, positionIdx: 0 });
        await closeTrade(user, i, pos, pos.tp3Price, 'TP3 Hit (Full Close)', bybit); 
        continue;
      }

      // ==========================================
      // 4. 🛑 CHECK TP2 (3.5R) - Close 60% of remaining
      // ==========================================
      if ((isBuy && currentPrice >= pos.tp2Price) || (!isBuy && currentPrice <= pos.tp2Price)) {
        if (!pos.tp2Hit) {
          pos.tp2Hit = true;
          
          let rawQty = pos.qty * 0.60; // 60% of remaining
          let closeQty = Math.floor(rawQty / qtyStep) * qtyStep;
          closeQty = parseFloat(closeQty.toFixed(4));

          if (closeQty < minOrderQty) closeQty = pos.qty;

          await bybit.placeOrder({ category: 'linear', symbol: pos.symbol, side: closeSide, orderType: 'Market', qty: closeQty.toString(), reduceOnly: true, positionIdx: 0 });
          
          if (closeQty < pos.qty) {
              // Move SL to TP1 price (Lock in profit)
              await bybit.setTradingStop({ category: 'linear', symbol: pos.symbol, stopLoss: pos.tp1Price, positionIdx: 0 });
              pos.virtualSl = pos.tp1Price; 
              pos.slPrice = pos.tp1Price; 
              pos.qty = parseFloat((pos.qty - closeQty).toFixed(4));
              console.log(`\n[${now()}] ✂️ TP2 HIT: ${user.account_id} | ${symbol} | Closed 60% | SL moved to TP1`);
          } else {
              await closeTrade(user, i, pos, pos.tp2Price, 'TP2 Hit (Full Close)', bybit);
          }
          continue;
        }
      }

      // ==========================================
      // 5. 🛑 CHECK TP1 (2.0R) - Close 50%
      // ==========================================
      if ((isBuy && currentPrice >= pos.tp1Price) || (!isBuy && currentPrice <= pos.tp1Price)) {
        if (!pos.tp1Hit) {
          pos.tp1Hit = true;
          
          let rawQty = pos.qty * 0.50; // 50% of position
          let closeQty = Math.floor(rawQty / qtyStep) * qtyStep;
          closeQty = parseFloat(closeQty.toFixed(4));

          if (closeQty < minOrderQty) closeQty = pos.qty;

          await bybit.placeOrder({ category: 'linear', symbol: pos.symbol, side: closeSide, orderType: 'Market', qty: closeQty.toString(), reduceOnly: true, positionIdx: 0 });
          
          if (closeQty < pos.qty) {
              // Move SL to Breakeven + 10% profit (0.2R)
              const lockSl = isBuy ? (pos.entryPrice + (rDistance * 0.2)) : (pos.entryPrice - (rDistance * 0.2));
              await bybit.setTradingStop({ category: 'linear', symbol: pos.symbol, stopLoss: lockSl, positionIdx: 0 });
              pos.virtualSl = lockSl; 
              pos.slPrice = lockSl; 
              pos.qty = parseFloat((pos.qty - closeQty).toFixed(4));
              console.log(`\n[${now()}] ✂️ TP1 HIT: ${user.account_id} | ${symbol} | Closed 50% | SL moved to +0.2R`);
          } else {
              await closeTrade(user, i, pos, pos.tp1Price, 'TP1 Hit (Full Close)', bybit);
          }
          continue;
        }
      }

      // ==========================================
      // 6. 🛑 CHECK STOP LOSS (Hard Stop)
      // ==========================================
      if ((isBuy && currentPrice <= activeSl) || (!isBuy && currentPrice >= activeSl)) {
        await bybit.placeOrder({ category: 'linear', symbol: pos.symbol, side: closeSide, orderType: 'Market', qty: pos.qty.toString(), reduceOnly: true, positionIdx: 0 });
        await closeTrade(user, i, pos, activeSl, 'SL Hit', bybit); 
        continue;
      }

    } catch (error) {
      // 🚨 Catch the 110017 ghost trade error
      const errMsg = error.message || '';
      if (error.retCode === 110017 || errMsg.includes('110017')) {
        console.log(`\n[${now()}] ⚠️ Bybit says position is zero for ${pos.symbol}. Removing ghost trade.`);
        openPositions[user.account_id].splice(i, 1);
      } else {
        console.error(`\n[${now()}] ❌ Error managing position ${pos.symbol}:`, error.message);
      }
    }
  }
}

// 📝 CLOSE TRADE & UPDATE METRICS
async function closeTrade(user, index, pos, closePrice, reason, bybit) {
  let pnl = pos.side === 'Buy' ? (closePrice - pos.entryPrice) * pos.qty : (pos.entryPrice - closePrice) * pos.qty;
  
  // ✅ Update local DB (if you have a local db for the bot)
  await db.logTradeClose(pos.dbId, closePrice, pnl, reason);

  // ✅ NEW: If this is a client (not master), send the close to the backend
  if (!user.is_master) {
      try {
          const RAILWAY_URL = 'https://uluka-backend-production.up.railway.app';
          const response = await fetch(`${RAILWAY_URL}/api/crypto/close-trade`, {
              method: 'POST',
              headers: { 
                  'Content-Type': 'application/json',
                  'x-admin-secret': process.env.ADMIN_SECRET // Ensure this is in your .env
              },
              body: JSON.stringify({
                  account_id: user.account_id,
                  master_ticket: pos.dbId, // Links back to the master trade ID
                  exit_price: closePrice,
                  pnl_usd: parseFloat(pnl.toFixed(2))
              })
          });
          
          if (response.ok) {
              console.log(`📡 Reported CLOSED trade to backend for ${user.account_id} | PnL: $${pnl.toFixed(2)}`);
          } else {
              console.error(`❌ Backend rejected close sync for ${user.account_id}`);
          }
      } catch (err) {
          console.error(`❌ Failed to report close to backend:`, err.message);
      }
  }

  // ✅ Your existing logic (cooldowns, DNA, etc)
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

   // ✅ Calculate % return based on account balance
  const accountBalance = user.current_balance || 8500; // Fallback to 8500 if missing
  const profitPercent = (pnl / accountBalance) * 100;
  const pnlPercentStr = (profitPercent >= 0 ? '+' : '') + profitPercent.toFixed(2) + '%';

  // ✅ If Master, send telegram webhook
  if (user.is_master && process.env.IS_MASTER === 'true') {
    await tg.sendWebhook({ 
      type: 'TRADE_CLOSE', source: 'MASTER', asset_class: 'CRYPTO', 
      result: pnl >= 0 ? 'WIN' : 'LOSS', symbol: pos.symbol, direction: pos.side.toUpperCase(), 
      profit: pnl.toFixed(2), 
      profit_percent: pnlPercentStr, // ✅ ADD THIS LINE
      reason: reason, ticket: pos.dbId, time: now() 
    });
  }
  
  // ✅ Remove from memory
  openPositions[user.account_id].splice(index, 1);
}
// 📊 LIQUIDITY CHECK FUNCTION (Inline)
async function checkLiquidity(bybit, symbol, tradeSide, currentPrice) {
  try {
    const res = await fetch(`${bybit.baseUrl}/v5/market/orderbook?category=linear&symbol=${symbol}&limit=50`);
    const json = await res.json();
    if (!json.result || !json.result.b || !json.result.a) return true;
    
    const bids = json.result.b; 
    const asks = json.result.a;
    let bidVol = 0;
    let askVol = 0;
    const range = currentPrice * 0.005;
    
    bids.forEach(b => { if (parseFloat(b[0]) > currentPrice - range) bidVol += parseFloat(b[1]); });
    asks.forEach(a => { if (parseFloat(a[0]) < currentPrice + range) askVol += parseFloat(a[1]); });
    
    if (bidVol === 0 || askVol === 0) return true;
    
    const imbalance = bidVol / (bidVol + askVol);
    console.log(`📊 Liquidity ${symbol}: Imbalance ${(imbalance * 100).toFixed(1)}%`);
    
    if (tradeSide === 'BUY' && imbalance < 0.40) return false;
    if (tradeSide === 'SELL' && imbalance > 0.60) return false;
    
    return true; 
  } catch (e) {
    return true;
  }
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

// 3. Heartbeat (Every 5 minutes to keep Railway awake)
setInterval(() => {
  console.log(`💓 [HEARTBEAT] ${new Date().toISOString()} - Crypto bot is alive and monitoring market.`);
}, 1000 * 60 * 5); 
