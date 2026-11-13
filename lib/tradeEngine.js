const ind = require('./indicators');
const session = require('./session');
const { roundToTick } = require('./precision');

function buildTradePlan(symbol, signal, currentPrice, klines, instrumentInfo, accountBalance, config) {
  const { highs, lows, closes } = ind.parseKlines(klines);
  const atr = ind.calculateATR(highs, lows, closes, config.atrPeriod);
  if (!atr) return null;

  const sessionData = session.getSessionMultiplier();
  
  // 1. Calculate Actual Stop Loss Distance (1.5x ATR)
  let slDistance = (atr * config.riskRatio) * sessionData.mult;

  // 🛑 THE 5% MINIMUM SL FLOOR (SKIP IF TOO TIGHT)
  const minSlDistance = currentPrice * 0.05; // 5% of the coin price
  
  if (slDistance < minSlDistance) {
      console.log(`🚫 Trade blocked: ATR SL ($${slDistance.toFixed(4)}) is tighter than the 5% minimum floor ($${minSlDistance.toFixed(4)}).`);
      return null; // Skip the trade entirely
  }

  // 2. R-Multiple Take Profits (2.0, 3.5, 4.5)
  const tp1Dist = slDistance * 2.0;
  const tp2Dist = slDistance * 3.5;
  const tp3Dist = slDistance * 4.5;

  let slPrice, tp1Price, tp2Price, tp3Price;
  if (signal.signalType === 1) { // BUY
    slPrice = currentPrice - slDistance;
    tp1Price = currentPrice + tp1Dist;
    tp2Price = currentPrice + tp2Dist;
    tp3Price = currentPrice + tp3Dist;
  } else { // SELL
    slPrice = currentPrice + slDistance;
    tp1Price = currentPrice - tp1Dist;
    tp2Price = currentPrice - tp2Dist;
    tp3Price = currentPrice - tp3Dist;
  }

  // 3. Calculate Lot Size (The Exact Forex Math: Risk / SL Distance)
  const riskUSD = accountBalance * (config.riskPerTradePercent / 100);
  
  const tickSize = parseFloat(instrumentInfo.priceFilter.tickSize);
  const minQty   = parseFloat(instrumentInfo.lotSizeFilter.minOrderQty);
  const qtyStep  = parseFloat(instrumentInfo.lotSizeFilter.qtyStep);
  const maxQty   = parseFloat(instrumentInfo.lotSizeFilter.maxOrderQty);

  const rawQty = riskUSD / slDistance;
  let alignedQty = Math.floor(rawQty / qtyStep) * qtyStep;
  
  if (alignedQty > maxQty) alignedQty = maxQty;
  if (alignedQty < minQty) alignedQty = minQty; 

  const actualRiskUSD = alignedQty * slDistance;
  const tradeValueUSD = alignedQty * currentPrice;

  console.log(`📊 Risk Math: SL: $${slDistance.toFixed(4)} | Qty: ${alignedQty.toFixed(4)} | Risk: $${actualRiskUSD.toFixed(2)} | Trade Val: $${tradeValueUSD.toFixed(2)}`);

  return {
    symbol,
    side: signal.signalType === 1 ? 'Buy' : 'Sell',
    qty: alignedQty,
    entryPrice: currentPrice,
    slPrice:  roundToTick(slPrice,  tickSize),
    tp1Price: roundToTick(tp1Price, tickSize),
    tp2Price: roundToTick(tp2Price, tickSize),
    tp3Price: roundToTick(tp3Price, tickSize),
    riskUSD: parseFloat(actualRiskUSD.toFixed(2)),
    klines: klines,
    atr
  };
}

module.exports = { buildTradePlan };
