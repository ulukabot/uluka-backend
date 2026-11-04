// lib/execution.js
const { ExchangeAdapter } = require('./exchangeAdapter');
const db = require('./db');
const tg = require('./telegram');
const { roundToTick } = require('./precision');
const { buildTradePlan } = require('./tradeEngine'); 

// ✅ FIX 1: Uncommented the import. 
// (Make sure this path matches where BybitClient actually lives in your project)
const { BybitClient } = require('./bybit'); 

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

// ─── EXECUTE SINGLE TRADE (Existing) ───
async function executeLiveTrade(exchange, plan, signal, config, user) {
  try {
    // ✅ 1. FIXED LIMIT CHECK (No destructuring errors)
    try {
        // Bypass the adapter to prevent null destructuring crash
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

    // ✅ 2. REAL-TIME FREE MARGIN CHECK (Fixes 110007)
    try {
        const client = exchange.client || exchange;
        const balRes = await client.getBalance();
        const accountInfo = balRes?.result?.list?.[0] || balRes?.list?.[0];
        
        if (accountInfo && accountInfo.coin) {
            // Find USDT balance
            const usdtData = accountInfo.coin.find(c => c.coin === 'USDT');
            if (usdtData) {
                const freeMargin = parseFloat(usdtData.availableToWithdraw || usdtData.walletBalance || 0);
                
                // We will only use a maximum of 80% of the free margin for this trade
                const maxMarginAllowed = freeMargin * 0.80; 
                const assumedLeverage = 10; // 10x leverage
                const maxNotionalValue = maxMarginAllowed * assumedLeverage;
                
                const requiredNotional = plan.qty * plan.entryPrice;

                if (requiredNotional > maxNotionalValue) {
                    const oldQty = plan.qty;
                    // Reduce qty to fit the remaining free margin
                    plan.qty = maxNotionalValue / plan.entryPrice;
                    console.log(`⚠️ Live Margin Cap: ${plan.symbol} qty reduced from ${oldQty.toFixed(4)} to ${plan.qty.toFixed(4)} to fit available balance ($${freeMargin.toFixed(2)}).`);
                }
            }
        }
    } catch (balError) {
        console.error(`⚠️ Could not fetch live balance for margin check:`, balError.message);
    }

    // ✅ 3. Proceed with placing the order
    console.log(`🚀 SENDING LIVE ORDER TO EXCHANGE: ${plan.side.toUpperCase()} ${plan.symbol}`);

    const info = await exchange.getInstrumentsInfo(plan.symbol);
    const tickSize = parseFloat(info?.priceFilter?.tickSize ?? '0');
    if (!Number.isFinite(tickSize) || tickSize <= 0) {
      throw new Error(`Invalid tickSize for ${plan.symbol}`);
    }

    const slDistance = Math.abs(plan.entryPrice - plan.slPrice);
    const emergencySLPrice = plan.side.toUpperCase() === 'BUY'
      ? plan.entryPrice - (slDistance * config.stealthEmergencyMultiplier)
      : plan.entryPrice + (slDistance * config.stealthEmergencyMultiplier);

    const sl = roundToTick(emergencySLPrice, tickSize);
    const tp = roundToTick(plan.tp3Price, tickSize);

    if (sl == null || tp == null || sl <= 0 || tp <= 0) {
      throw new Error(`Invalid SL/TP for ${plan.symbol}: sl=${emergencySLPrice} tp=${plan.tp3Price} tick=${tickSize}`);
    }

    // Make sure quantity respects Bybit's step size after reduction
    const qtyStep = parseFloat(info.lotSizeFilter.qtyStep);
    plan.qty = Math.floor(plan.qty / qtyStep) * qtyStep;

    const order = await exchange.placeOrder({
      category: 'linear', symbol: plan.symbol,
      side: plan.side.toUpperCase() === 'BUY' ? 'Buy' : 'Sell',
      orderType: 'Market', qty: plan.qty.toString(),
      stopLoss: sl.toString(), takeProfit: tp.toString(),
      positionIdx: 0
    });

    if (!order || !order.orderId) throw new Error('Order failed. No orderId returned.');

    console.log(`✅ LIVE ORDER PLACED! Order ID: ${order.orderId}`);

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
          tp1: plan.tp1Price, rr1: '1.5', tp2: plan.tp2Price, rr2: '3.0', tp3: plan.tp3Price, rr3: '4.5',
          lot: plan.qty, risk: config.riskPerTradePercent, ticket: position.dbId, time: new Date().toISOString()
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

// ─── 🆕 STEP 3: COPY TRADING ENGINE ───
async function copyTradeToClients(masterPlan, signal, masterConfig, instrumentInfo) {
    console.log(`📋 Starting Copy Trade Distribution for ${masterPlan.symbol}...`);
    
    try {
        // 1. Fetch clients from backend
        const res = await fetch(`${RAILWAY_URL}/api/crypto/active-users`, {
            headers: { 'x-admin-secret': ADMIN_SECRET }
        });
        const clients = await res.json();
        
        if (!Array.isArray(clients) || clients.length === 0) {
            return console.log("No active clients to copy.");
        }

        // 2. Loop through each client
        for (const client of clients) {
            try {
                // License check
                if (client.status !== 'ACTIVE' || (client.expiry_date && new Date(client.expiry_date) < new Date())) {
                    continue;
                }

                // Decrypt API Keys
                const valRes = await fetch(`${RAILWAY_URL}/api/crypto/validate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ account_id: client.account_id, licence_key: client.licence_key })
                });
                const valData = await valRes.json();
                if (!valData.valid) continue;

                // 3. Calculate Client's specific Qty based on THEIR balance and risk
                const clientBalance = parseFloat(client.current_balance || 0);
                if (clientBalance <= 0) continue;

                const clientConfig = {
                    ...masterConfig,
                    riskPerTradePercent: parseFloat(client.risk_percent || 1.0)
                };

                // Reuse your existing math engine!
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
                    console.log(`⏩ Skipping ${client.account_id} - Plan calculation failed (qty too small).`);
                    continue;
                }

                // 4. Execute the trade on the client's account
                // ✅ FIX 2: Using the exact BybitClient format from your index.js
                const clientBybit = new BybitClient({ 
                    apiKey: valData.api_key, 
                    apiSecret: valData.api_secret, 
                    testnet: false, 
                    demo: process.env.BYBIT_DEMO === 'true' 
                });
                
                await executeLiveTrade(
                    clientBybit, 
                    clientPlan, 
                    signal, 
                    clientConfig, 
                    { account_id: client.account_id, is_master: false }
                );

            } catch (err) {
                console.error(`❌ Failed to copy to ${client.account_id}:`, err.message);
            }
        }
    } catch (err) {
        console.error(`❌ Copy engine error:`, err.message);
    }
}

module.exports = { executeLiveTrade, copyTradeToClients };
