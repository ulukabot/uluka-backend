require('dotenv').config();
const { executeLiveTrade } = require('./lib/execution');

async function test() {
  console.log('🧪 Running manual execution test...');
  console.log(`[DEBUG] IS_MASTER in .env is: '${process.env.IS_MASTER}'`);

  const mockBybit = {
    placeOrder: async (params) => {
      console.log('✅ [MOCK BYBIT] Order placed:', params.symbol, params.side);
      return { orderId: 'MANUAL-TEST-' + Date.now() };
    }
  };

  const plan = {
    symbol: 'BTCUSDT',
    side: 'BUY',
    qty: 0.05,
    entryPrice: 81000,
    slPrice: 80500,
    tp1Price: 81500,
    tp2Price: 82000,
    tp3Price: 82500,
    riskUSD: 25
  };

  const signal = {
    signalType: 1,
    buyScore: 34,
    sellScore: 0,
    obBuy: true
  };

  const config = {
    stealthEmergencyMultiplier: 2.5,
    riskPerTradePercent: 0.5
  };

  await executeLiveTrade(mockBybit, plan, signal, config);
  
  console.log('🧪 Manual test complete.');
}

test();