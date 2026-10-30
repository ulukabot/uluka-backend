// lib/execution.js
const db = require('./db');
const tg = require('./telegram');

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

async function executeLiveTrade(bybit, plan, signal, config, user) {
  try {
    const slDistance = Math.abs(plan.entryPrice - plan.slPrice);
    let emergencySLPrice = plan.side.toUpperCase() === 'BUY' 
      ? plan.entryPrice - (slDistance * config.stealthEmergencyMultiplier)
      : plan.entryPrice + (slDistance * config.stealthEmergencyMultiplier);

    const order = await bybit.placeOrder({
      category: 'linear', symbol: plan.symbol,
      side: plan.side.toUpperCase() === 'BUY' ? 'Buy' : 'Sell', 
      orderType: 'Market', qty: plan.qty.toString(),
      stopLoss: (emergencySLPrice || 0).toFixed(2), takeProfit: (plan.tp3Price || 0).toFixed(2),
      positionIdx: 0 
    });

    if (!order || !order.orderId) throw new Error('Order failed.');

    const position = {
      ...plan, orderId: order.orderId, emergencySl: emergencySLPrice,
      virtualSl: plan.slPrice, openTime: new Date().toISOString(), status: 'OPEN',
      breakEvenSet: false, tp1Hit: false, tp2Hit: false
    };

    position.dbId = await db.logTradeOpen({ ...plan, votes: 2, regime: signal.regime, orderId: order.orderId });

    // Only send alerts if this user is the Master account
    if (user.is_master) {
      await tg.sendMessage(`🚀 <b>ADMIN TRADE OPENED</b>\n\n<b>Pair:</b> ${plan.symbol}\n<b>Side:</b> ${plan.side}`);
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
      // Silent log for regular users
      console.log(`🟢 USER TRADE: ${user.account_id} | ${plan.side} ${plan.symbol}`);
    }

    return position;
  } catch (error) {
    console.error(`❌ EXECUTION FAILED for ${user.account_id}:`, error.message);
    return null;
  }
}

module.exports = { executeLiveTrade };
