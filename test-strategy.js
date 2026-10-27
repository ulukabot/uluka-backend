// test-strategy.js
require('dotenv').config();
const BybitClient = require('./lib/bybit');
const ind = require('./lib/indicators');
const strat = require('./lib/strategies');
const tradeEngine = require('./lib/tradeEngine');
const config = require('./config');

async function main() {
  const bybit = new BybitClient({ testnet: true }); 
  const simulatedBalance = 10000; // Fake $10k balance for Paper Trading
  
  for (const symbol of config.symbols) {
    console.log(`\n═══════════════════════════════════════════════`);
    console.log(` ANALYZING: ${symbol}`);
    console.log(`═══════════════════════════════════════════════`);

    try {
      // 1. Get data
      const klines = await bybit.getKlines({ symbol, interval: config.timeframe, limit: 100 });
      const ticker = await bybit.getTicker(symbol);
      const info = await bybit.getInstrumentsInfo(symbol);
      
      const currentPrice = parseFloat(ticker.lastPrice);
      const tickSize = parseFloat(info.priceFilter.tickSize);

      // 2. Get indicator arrays
      const { closes } = ind.parseKlines(klines);
      const emaFast = ind.calculateEMA(closes, 10);
      const emaSlow = ind.calculateEMA(closes, 45);

      // 3. Run the strategy engine
      const signal = strat.getScoreSignal(symbol, klines, tickSize, currentPrice, emaFast, emaSlow);

      // 4. Print Results
      console.log(`Price: $${currentPrice} | Regime: ${signal.regime}`);
      console.log(`BUY Votes:  ${signal.buyScore / 17} | SELL Votes: ${signal.sellScore / 17}`);
      
      if (signal.signalType === 1) {
        console.log(`🔥 SIGNAL: BUY`);
      } else if (signal.signalType === -1) {
        console.log(`🔥 SIGNAL: SELL`);
      } else {
        console.log(`⏳ SIGNAL: NONE (Tie or No votes)`);
      }

      // 5. Build Trade Plan (if a signal exists)
      if (signal.signalType !== 0) {
        console.log(`\n--- 🛡️ RISK CALCULATION ---`);
        const plan = tradeEngine.buildTradePlan(
          symbol, 
          signal, 
          currentPrice, 
          klines, 
          info, 
          simulatedBalance, 
          config
        );

        if (plan) {
          console.log(`Side:       ${plan.side}`);
          console.log(`Qty:        ${plan.qty}`);
          console.log(`Entry:      $${plan.entryPrice}`);
          console.log(`Stop Loss:  $${plan.slPrice}`);
          console.log(`Take Profit:$${plan.tpPrice}`);
          console.log(`Risk:       $${plan.riskUSD} (0.5% of balance)`);
        } else {
          console.log(`Trade rejected by risk engine (likely too small).`);
        }
      }

    } catch (e) {
      console.error(`❌ Failed to analyze ${symbol}:`, e.message);
    }
  }
}

main();