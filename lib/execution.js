// lib/execution.js
const db = require('./db');
const tg = require('./telegram');

async function executeLiveTrade(bybit, plan, signal, config) {
  try {
    console.log(`🚀 SENDING LIVE ORDER TO BYBIT: ${plan.side.toUpperCase()} ${plan.symbol}`);
    
    const slDistance = Math.abs(plan.entryPrice - plan.slPrice);
    let emergencySLPrice = plan.side === 'BUY' 
      ? plan.entryPrice - (slDistance * config.stealthEmergencyMultiplier)
      : plan.entryPrice + (slDistance * config.stealthEmergencyMultiplier);

    const emergencySLStr = emergencySLPrice.toFixed(2);
    const tpStr = plan.tpPrice.toFixed(2);

    const order = await bybit.placeOrder({
      category: 'linear', 
      symbol: plan.symbol,
      side: plan.side === 'BUY' ? 'Buy' : 'Sell', 
      orderType: 'Market',
      qty: plan.qty.toString(),
      stopLoss: emergencySLStr,
      takeProfit: tpStr,
      positionIdx: 0 
    });

    if (!order || !order.orderId) throw new Error('Order failed.');

    console.log(`✅ LIVE ORDER PLACED! Order ID: ${order.orderId}`);

    const position = {
      ...plan,
      orderId: order.orderId,
      emergencySl: emergencySLPrice,
      virtualSl: plan.slPrice,
      openTime: new Date().toISOString(),
      status: 'OPEN',
      breakEvenSet: false
    };

    await db.logTradeOpen({ ...plan, votes: signal.buyScore/17, regime: signal.regime, orderId: order.orderId });

    await tg.sendMessage(`🚀 <b>LIVE TRADE OPENED (DEMO)</b>\n\n<b>Pair:</b> ${plan.symbol}\n<b>Side:</b> ${plan.side}\n<b>Qty:</b> ${plan.qty}\n<b>Entry:</b> $${plan.entryPrice}\n<b>TP:</b> $${tpStr}\n<b>SL:</b> $${emergencySLStr}`);

    return position;
  } catch (error) {
    console.error(`❌ LIVE EXECUTION FAILED:`, error.message);
    if (error.response) console.error(error.response);
    return null;
  }
}

module.exports = { executeLiveTrade };
