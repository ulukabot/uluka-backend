// lib/execution.js
const db = require('./db');
const tg = require('./telegram');

// 👈 Helper function restored
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

async function executeLiveTrade(bybit, plan, signal, config) {
  try {
    console.log(`🚀 SENDING LIVE ORDER TO BYBIT: ${plan.side.toUpperCase()} ${plan.symbol}`);
    
    const slDistance = Math.abs(plan.entryPrice - plan.slPrice);
    let emergencySLPrice = plan.side.toUpperCase() === 'BUY' 
      ? plan.entryPrice - (slDistance * config.stealthEmergencyMultiplier)
      : plan.entryPrice + (slDistance * config.stealthEmergencyMultiplier);

    // 👈 Fixed missing tp3Str bug
    const emergencySLStr = (emergencySLPrice || 0).toFixed(2);
    const tp3Str = (plan.tp3Price || 0).toFixed(2);

    const order = await bybit.placeOrder({
      category: 'linear', 
      symbol: plan.symbol,
      side: plan.side.toUpperCase() === 'BUY' ? 'Buy' : 'Sell', 
      orderType: 'Market',
      qty: plan.qty.toString(),
      stopLoss: emergencySLStr,
      takeProfit: tp3Str, // 👈 Now uses the correct variable
      positionIdx: 0 
    });

    if (!order || !order.orderId) throw new Error('Order failed.');

    console.log(`✅ LIVE ORDER PLACED! Order ID: ${order.orderId}`);

    const position = {
      ...plan,
      primaryStrategy: getDominantStrategy(signal),
      orderId: order.orderId,
      emergencySl: emergencySLPrice,
      virtualSl: plan.slPrice,
      openTime: new Date().toISOString(),
      status: 'OPEN',
      breakEvenSet: false,
      tp1Hit: false,
      tp2Hit: false
    };

    // 👈 Fixed missing DB ID saving
    position.dbId = await db.logTradeOpen({ 
      ...plan, 
      votes: signal.buyScore > signal.sellScore ? signal.buyScore/17 : signal.sellScore/17, 
      regime: signal.regime, 
      orderId: order.orderId 
    });

    // 1. Send Private Telegram Alert
    await tg.sendMessage(`🚀 <b>LIVE TRADE OPENED (DEMO)</b>\n\n<b>Pair:</b> ${plan.symbol}\n<b>Side:</b> ${plan.side.toUpperCase()}\n<b>Qty:</b> ${plan.qty}\n<b>Entry:</b> $${plan.entryPrice}\n<b>SL:</b> $${plan.slPrice}\n<b>TP1:</b> $${plan.tp1Price} (50%)\n<b>TP2:</b> $${plan.tp2Price} (30%)\n<b>TP3:</b> $${plan.tp3Price} (20%)`);

    // 2. Send Webhook to Channels
    if (process.env.IS_MASTER === 'true') {
      await tg.sendWebhook({
        type: 'TRADE_SIGNAL',
        source: 'MASTER',
        asset_class: 'CRYPTO',
        action: plan.side.toUpperCase(),
        symbol: plan.symbol,
        strategy: getDominantStrategy(signal),
        session: 'Crypto 24/7',
        confidence: Math.round((signal.buyScore > signal.sellScore ? signal.buyScore : signal.sellScore) / 17 * 16.6),
        entry: plan.entryPrice,
        sl: plan.slPrice,
        tp1: plan.tp1Price, rr1: '1.5',
        tp2: plan.tp2Price, rr2: '3.0',
        tp3: plan.tp3Price, rr3: '4.5',
        lot: plan.qty,
        risk: config.riskPerTradePercent,
        ticket: position.dbId || 'PENDING',
        time: new Date().toISOString().slice(0,16).replace('T',' ')
      });
    }

    return position;
  } catch (error) {
    console.error(`❌ LIVE EXECUTION FAILED:`, error.message);
    if (error.response) console.error(error.response);
    return null;
  }
}

module.exports = { executeLiveTrade };