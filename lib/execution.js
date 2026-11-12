// lib/execution.js
const { ExchangeAdapter } = require('./exchangeAdapter');
const db = require('./db');
const tg = require('./telegram');
const { roundToTick } = require('./precision');
const { buildTradePlan } = require('./tradeEngine'); 

const RAILWAY_URL = 'https://uluka-backend-production.up.railway.app';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'default-secret-change-me';

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

// ─── EXECUTE SINGLE TRADE ───
async function executeLiveTrade(exchange, plan, signal, config, user) {
  try {
    // ✅ 1. CHECK LIMITS (Per Symbol & Global Total)
    try {
        const client = exchange.client || exchange; 
        const posRes = await client.getPositionInfo({ settleCoin: 'USDT' });
        const allList = posRes?.list || posRes?.result?.list || [];
        const activePositions = allList.filter(p => parseFloat(p.size) > 0);

        const totalOpen = activePositions.length;
        const symbolOpen = activePositions.filter(p => p.symbol === plan.symbol).length;

        const maxPerSymbol = config.maxTradesPerSymbol || 1; 
        const maxTotal = config.maxTotalTrades || 4;

        if (symbolOpen >= maxPerSymbol) {
            console.log(`⏭️ SKIPPING ${plan.symbol}: Max trades per symbol reached (${symbolOpen}/${maxPerSymbol}).`);
            return null;
        }
        if (totalOpen >= maxTotal) {
            console.log(`⏭️ SKIPPING ${plan.symbol}: Max total trades reached (${totalOpen}/${maxTotal}).`);
            return null;
        }
    } catch (posError) {
        console.error(`⚠️ Could not verify trade limits for ${plan.symbol}:`, posError.message);
    }

    // ✅ 2. CALCULATE BLOCKED CAPITAL & DETECT MARGIN MODE
    const client = exchange.client || exchange;
    const currentLeverage = Number(config.leverage || 10);
    const currentPrice = plan.entryPrice || plan.currentPrice || 1; 
    const positionValue = plan.qty * currentPrice;
    const marginRequired = positionValue / currentLeverage;

    console.log(`💰 Capital Check: Position: $${positionValue.toFixed(2)} | Leverage: ${currentLeverage}x | Blocked Margin: $${marginRequired.toFixed(2)}`);

    let activeMarginMode = 'REGULAR'; // Default to Cross

    // 🔥 1. ASK BYBIT FOR THE ACTUAL MARGIN MODE
    try {
        const acctRes = await client.getAccountInfo(); 
        activeMarginMode = acctRes?.result?.marginMode || acctRes?.marginMode || 'REGULAR';
        console.log(`⚙️ Bybit Margin Mode Detected: ${activeMarginMode === 'REGULAR' ? 'CROSS' : 'ISOLATED'}`);
    } catch (e) {
        console.log(`⚠️ Could not detect margin mode from Bybit, defaulting to CROSS: ${e.message}`);
    }

    // 🔥 2. CALCULATE BALANCE BASED ON THE DETECTED MODE
    try {
        const balData = await client.getBalance();
        const account = balData?.result?.list?.[0] || balData?.list?.[0] || balData;
        let availableBal = 0;

        if (account) {
            if (activeMarginMode === 'REGULAR') {
                // If CROSS: Use Total Equity of all coins
                availableBal = parseFloat(account.totalEquity || account.totalMarginBalance || 0);
                if (availableBal === 0 && account.coin) {
                     for (const c of account.coin) availableBal += parseFloat(c.usdValue || c.equity || 0);
                }
            } else {
                // If ISOLATED: Use only the specific coin's available balance
                const usdt = account.coin?.find(c => c.coin === 'USDT');
                availableBal = usdt ? parseFloat(usdt.availableToWithdraw || usdt.walletBalance || 0) : parseFloat(account.totalAvailableBalance || 0);
            }

            if (availableBal === 0) {
                 availableBal = parseFloat(account.totalAvailableBalance || 0);
            }
        }
        
        console.log(`🏦 Available Balance (${activeMarginMode} mode): $${availableBal.toFixed(2)}`);

        if (availableBal < marginRequired) {
            console.log(`⏭️ SKIPPING ${plan.symbol}: Not enough Available Balance ($${availableBal.toFixed(2)} < Required $${marginRequired.toFixed(2)}).`);
            return null; 
        }
    } catch (e) {
        console.log(`⚠️ Could not verify Available Balance: ${e.message}`);
    }

    // ✅ 3. PREPARE ORDER PARAMETERS (safeQty, SL, TP)
    console.log(`🚀 SENDING LIVE ORDER TO EXCHANGE: ${plan.side.toUpperCase()} ${plan.symbol}`);

    const info = await exchange.getInstrumentsInfo(plan.symbol);
    const tickSize = parseFloat(info?.priceFilter?.tickSize ?? '0');
    const qtyStep = parseFloat(info.lotSizeFilter.qtyStep);
    
    if (!Number.isFinite(tickSize) || tickSize <= 0) {
      throw new Error(`Invalid tickSize for ${plan.symbol}`);
    }

    // ✅ FORCE EXACT RISK ON BYBIT
    const sl = roundToTick(plan.slPrice, tickSize);
    const tp = roundToTick(plan.tp3Price, tickSize);

    if (sl == null || tp == null || sl <= 0 || tp <= 0) {
      throw new Error(`Invalid SL/TP for ${plan.symbol}: sl=${plan.slPrice} tp=${plan.tp3Price} tick=${tickSize}`);
    }

    // ✅ CALCULATE SAFEQTY (This was missing!)
    let safeQty = Math.floor(plan.qty / qtyStep) * qtyStep;
    const stepStr = qtyStep.toString();
    const decimals = stepStr.includes('.') ? stepStr.split('.')[1].length : 0;
    safeQty = Number(safeQty.toFixed(decimals));

    if (safeQty <= 0) {
        console.log(`⏭️ SKIPPING: Qty rounded to 0 based on Bybit step size (${qtyStep}).`);
        return null;
    }

    // 🛑 PRE-FLIGHT CHECK: Bybit Minimum Notional Value
    const minNotional = 5.0; 
    const orderValue = safeQty * currentPrice;

    if (orderValue < minNotional) {
        console.log(`⏭️ SKIPPING: Order value $${orderValue.toFixed(2)} is below Bybit minimum $${minNotional}.`);
        return null; 
    }

    // ✅ 4. FORCE LEVERAGE USING THE DETECTED MODE
    try {
        const lev = (config.leverage || 10).toString(); 
        await client.setLeverage({
            category: 'linear',
            symbol: plan.symbol,
            buyLeverage: lev,
            sellLeverage: lev,
            marginMode: activeMarginMode // 🔥 Uses the exact mode Bybit reported
        });
        console.log(`✅ Leverage set to ${lev}x (Mode: ${activeMarginMode})`);
    } catch (e) {
        // Ignore if already set
    }

    // ==========================================
    // 5. Place the Order (With Retry Buffer)
    // ==========================================
    let retries = 3;
    let order = null;

    while (retries > 0 && !order) {
        try {
            order = await exchange.placeOrder({
                category: 'linear', 
                symbol: plan.symbol,
                side: plan.side.toUpperCase() === 'BUY' ? 'Buy' : 'Sell',
                orderType: 'Market', 
                qty: safeQty.toString(), 
                stopLoss: sl.toString(), 
                takeProfit: tp.toString(),
                positionIdx: 0,
            });
            if (order && order.orderId) break; // Success!
        } catch (err) {
            // 🛑 If it's a margin error (110007) or invalid qty, don't retry. Just fail.
            if (err.retCode === 110007 || (err.message && err.message.includes('110007'))) {
                throw err; 
            }
            
            console.log(`⚠️ Order failed (Attempt ${4 - retries}/3). Retrying in 2s... Error: ${err.message}`);
            retries--;
            if (retries === 0) throw err;
            
            // Wait 2 seconds before trying again (Trade Buffer)
            await new Promise(resolve => setTimeout(resolve, 2000)); 
        }
    }

    if (!order || !order.orderId) throw new Error('Order failed after retries. No orderId returned.');

    console.log(`✅ LIVE ORDER PLACED! Order ID: ${order.orderId} | Qty: ${safeQty} | Risk: $${plan.riskUSD}`);

    const position = {
      ...plan, orderId: order.orderId, emergencySl: sl,
      virtualSl: plan.slPrice, openTime: new Date().toISOString(), status: 'OPEN',
      breakEvenSet: false, tp1Hit: false, tp2Hit: false
    };

    position.dbId = await db.logTradeOpen({
      ...plan,
      votes: 2,
      regime: signal.regime,
      orderId: order.orderId,
      accountId: user.account_id,
      isMaster: user.is_master === true
    });

    if (user.is_master) {
      if (process.env.IS_MASTER === 'true') {
        await tg.sendWebhook({
          type: 'TRADE_SIGNAL', source: 'MASTER', asset_class: 'CRYPTO',
          action: plan.side.toUpperCase(), symbol: plan.symbol, strategy: getDominantStrategy(signal),
          session: 'Crypto 24/7', confidence: 75, entry: plan.entryPrice, sl: plan.slPrice,
          tp1: plan.tp1Price, rr1: '2.0', tp2: plan.tp2Price, rr2: '3.5', tp3: plan.tp3Price, rr3: '4.5',
          lot: safeQty, risk: config.riskPerTradePercent, ticket: position.dbId, time: new Date().toISOString()
        });
      }
    } else {
      console.log(`🟢 ULUKA ULTIMA USER TRADE: ${user.account_id} | ${plan.side} ${plan.symbol}`);
    }

    return position;
  } catch (error) {
    console.error(`❌ EXECUTION FAILED for ${user.account_id}:`, error.message);
    if (error.retCode) console.error(`   retCode ${error.retCode}: ${error.retMsg}`);
    return null;
  }
}

// ─── 🆕 COPY TRADING ENGINE ───
async function copyTradeToClients(masterPlan, signal, masterConfig, instrumentInfo) {
    console.log(`📋 Starting Copy Trade Distribution for ${masterPlan.symbol}...`);
    
    try {
        const res = await fetch(`${RAILWAY_URL}/api/crypto/active-users`, {
            headers: { 'x-admin-secret': ADMIN_SECRET }
        });
        const clients = await res.json();
        
        if (!Array.isArray(clients) || clients.length === 0) {
            return console.log("No active clients to copy.");
        }

        for (const client of clients) {
            try {
                // 1. Status Check
                if (client.status !== 'ACTIVE' || (client.expiry_date && new Date(client.expiry_date) < new Date())) {
                    console.log(`⏩ Skipped ${client.account_id}: Status is ${client.status} or Expired`);
                    continue;
                }

                // 2. Asset Selection Check
                if (client.symbols) {
                    const allowedSymbols = client.symbols.split(',').map(s => s.trim());
                    if (!allowedSymbols.includes(masterPlan.symbol)) {
                        console.log(`⏩ Skipped ${client.account_id}: ${masterPlan.symbol} not in their selected list (${client.symbols})`);
                        continue;
                    }
                }

                // 3. API Key Decryption (BYPASS FOR MASTER)
                let apiKey, apiSecret;

                if (client.is_master) {
                    apiKey = process.env.BYBIT_API_KEY;
                    apiSecret = process.env.BYBIT_API_SECRET;
                    console.log(`👑 Processing Master Account (${client.account_id})...`);
                } else {
                    const valRes = await fetch(`${RAILWAY_URL}/api/crypto/validate`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ account_id: client.account_id, licence_key: client.licence_key })
                    });
                    const valData = await valRes.json();
                    if (!valData.valid) {
                        console.log(`⏩ Skipped ${client.account_id}: Validation failed (${valData.reason})`);
                        continue;
                    }
                    apiKey = valData.api_key;
                    apiSecret = valData.api_secret;
                }

                // 4. Balance Check
                const clientBalance = parseFloat(client.current_balance || 0);
                if (clientBalance <= 0) {
                    console.log(`⏩ Skipped ${client.account_id}: Database Balance is $0`);
                    continue;
                }

                // 5. Create Exchange Adapter FIRST (to fetch leverage)
                const exchange = new ExchangeAdapter(
                    client.exchange_name || 'bybit', 
                    { apiKey: apiKey, apiSecret: apiSecret }
                );

                // ✅ FETCH REAL LEVERAGE FROM BYBIT
                const actualLeverage = await (exchange.client || exchange).getLeverage(masterPlan.symbol);

                // 6. Recalculate Plan for Client
                const clientConfig = {
                    ...masterConfig,
                    riskPerTradePercent: parseFloat(client.risk_percent || 1.0),
                    maxTradesPerSymbol: client.max_trades_per_symbol || 1,
                    maxTotalTrades: client.max_total_trades || 4,
                    actualLeverage: actualLeverage,
                    min_sl_percent: parseFloat(client.min_sl_percent || 1.0),
                  marginMode: client.margin_mode || 'ISOLATED'
                };
                
                const clientPlan = buildTradePlan(
                    masterPlan.symbol, 
                    signal, 
                    masterPlan.entryPrice, 
                    masterPlan.klines, 
                    instrumentInfo, 
                    clientBalance, 
                    clientConfig
                );

                if (!clientPlan) {
                    console.log(`⏩ Skipped ${client.account_id}: Plan calculation failed (qty below exchange minimum)`);
                    continue;
                }

                // 7. Execute
                await executeLiveTrade(
                    exchange, 
                    clientPlan, 
                    signal, 
                    clientConfig, 
                    { account_id: client.account_id, is_master: client.is_master === true }
                );

            } catch (err) {
                console.error(`❌ Failed to copy to ${client.account_id}:`, err.message);
            }
        } // Closes the `for` loop
    } catch (err) { // Closes the main `try` block
        console.error(`❌ Copy Trade Engine Error:`, err.message);
    }
}

module.exports = { executeLiveTrade, copyTradeToClients };
