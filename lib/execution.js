// lib/execution.js
const db = require('./db');
const tg = require('./telegram');
const { roundToTick } = require('./precision');

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

async function executeLiveTrade(bybit, plan, signal, config, user) {
  try {
    console.log(`🚀 SENDING LIVE ORDER TO BYBIT: ${plan.side.toUpperCase()} ${plan.symbol}`);

    // Get tick size for correct SL/TP precision
    const info = await bybit.getInstrumentsInfo(plan.symbol);
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

    const order = await bybit.placeOrder({
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

module.exports = { executeLiveTrade };
