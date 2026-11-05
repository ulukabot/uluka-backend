const ind = require('./indicators');
const session = require('./session');
const { roundToTick, roundToStep } = require('./precision');

function buildTradePlan(symbol, signal, currentPrice, klines, instrumentInfo, accountBalance, config) {
  // ✅ SAFETY CHECK 1: Ensure klines exists and is a valid array
  if (!klines || !Array.isArray(klines) || klines.length === 0) {
    console.error(`❌ [TradeEngine] Aborting plan for ${symbol}: No klines data received.`);
    return null; 
  }

  // ✅ SAFETY CHECK 2: Ensure currentPrice is valid
  if (!currentPrice || isNaN(currentPrice)) {
    console.error(`❌ [TradeEngine] Aborting plan for ${symbol}: Invalid current price (${currentPrice}).`);
    return null;
  }

  const { highs, lows, closes } = ind.parseKlines(klines);
  const atr = ind.calculateATR(highs, lows, closes, config.atrPeriod);
  if (!atr) return null;

  const sessionData = session.getSessionMultiplier();
  const slDistance = (atr * config.riskRatio) * sessionData.mult;

  // ✅ 1. SAFETY LOGIC: Minimum SL Floor (0.2%)
  const minSLPercent = config.minSLPercent || 0.002; 
  const absoluteMinSL = currentPrice * minSLPercent;
  
  let finalSLDistance = slDistance;
  if (slDistance < absoluteMinSL) {
      console.log(`🛡️ SL was too tight (${slDistance.toFixed(4)}). Widened to ${absoluteMinSL.toFixed(4)} to prevent massive lot sizes.`);
      finalSLDistance = absoluteMinSL; 
  }
  
  // Use finalSLDistance for TP calculations as well
  const tp1Dist = finalSLDistance * 1.5;
  const tp2Dist = finalSLDistance * 3.0;
  const tp3Dist = finalSLDistance * 4.5;

  let slPrice, tp1Price, tp2Price, tp3Price;
  if (signal.signalType === 1) { // BUY
    slPrice = currentPrice - finalSLDistance;
    tp1Price = currentPrice + tp1Dist;
    tp2Price = currentPrice + tp2Dist;
    tp3Price = currentPrice + tp3Dist;
  } else { // SELL
    slPrice = currentPrice + finalSLDistance;
    tp1Price = currentPrice - tp1Dist;
    tp2Price = currentPrice - tp2Dist;
    tp3Price = currentPrice - tp3Dist;
  }

  // ✅ 2. The Risk Amount (e.g., $85)
  const riskUSD = accountBalance * (config.riskPerTradePercent / 100);
  
  // Quantity based on risk (Never lose more than $85)
  let qtyRisk = riskUSD / finalSLDistance;

  // ✅ 3. The Margin Amount (Your Logic: Risk Amount × Leverage)
  const assumedLeverage = config.actualLeverage || 10; 
  const maxMarginAllowed = riskUSD; // Max margin locked = the risk amount itself!
  const maxNotionalValue = maxMarginAllowed * assumedLeverage;
  let qtyMargin = maxNotionalValue / currentPrice;

  // ✅ 4. The Final Quantity is the SMALLER of the two
  let qty = Math.min(qtyRisk, qtyMargin);

  if (!instrumentInfo?.lotSizeFilter || !instrumentInfo?.priceFilter) {
    return null;
  }

  const tickSize = parseFloat(instrumentInfo.priceFilter.tickSize);
  const minQty   = parseFloat(instrumentInfo.lotSizeFilter.minOrderQty);
  const qtyStep  = parseFloat(instrumentInfo.lotSizeFilter.qtyStep);
  const maxQty   = parseFloat(instrumentInfo.lotSizeFilter.maxOrderQty);

  let alignedQty = roundToStep(qty, qtyStep);
  if (alignedQty == null) return null;
  if (alignedQty > maxQty) alignedQty = maxQty;
  
  if (alignedQty < minQty) {
      console.log(`⏭️ Skipping ${symbol}: Qty (${alignedQty}) below exchange minimum (${minQty}).`);
      return null;
  }

  // Recalculate actual risk using finalSLDistance
  const actualRiskUSD = alignedQty * finalSLDistance;
  
  if (alignedQty === qtyMargin && qtyMargin < qtyRisk) {
      console.log(`⚠️ Margin Cap: ${symbol} qty capped to ${alignedQty.toFixed(4)} to keep margin under $${riskUSD.toFixed(2)}.`);
  } else if (alignedQty < qtyRisk) {
      console.log(`⚠️ Risk Cap: ${symbol} qty reduced to ${alignedQty.toFixed(4)} to keep risk under $${riskUSD.toFixed(2)}.`);
  }

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
    klines: klines, // ✅ Fixed the map() error
    atr
  };
}

module.exports = { buildTradePlan };
