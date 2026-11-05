// lib/tradeEngine.js
const ind = require('./indicators');
const session = require('./session');
const { roundToTick, roundToStep } = require('./precision');

function buildTradePlan(symbol, signal, currentPrice, klines, instrumentInfo, accountBalance, config) {
  const { highs, lows, closes } = ind.parseKlines(klines);
  
  const atr = ind.calculateATR(highs, lows, closes, config.atrPeriod);
  if (!atr) return null;

  const sessionData = session.getSessionMultiplier();
  const slDistance = (atr * config.riskRatio) * sessionData.mult;

  // ✅ 1. ULTRA ULTRA SAFETY LOGIC: Minimum SL Floor
  // If the Stop Loss is too tight, the calculated lot size becomes dangerous.
  // We enforce a minimum SL distance of 0.2% of the current price.
  const minSLPercent = config.minSLPercent || 0.002; 
  const absoluteMinSL = currentPrice * minSLPercent;

  if (slDistance < absoluteMinSL) {
      console.log(`⛔ SAFETY BLOCK: SL too tight for ${symbol}. (SL: $${slDistance.toFixed(4)} < Floor: $${absoluteMinSL.toFixed(4)}). Trade skipped to prevent massive lot sizes.`);
      return null;
  }
  
  const tp1Dist = slDistance * 1.5;
  const tp2Dist = slDistance * 3.0;
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

  // ✅ 2. Calculate Quantity based on Risk
  const riskUSD = accountBalance * (config.riskPerTradePercent / 100);
  let qtyRisk = riskUSD / slDistance;

  // ✅ 3. Calculate Quantity based on Margin (Using Leverage)
  const maxMarginAllowed = accountBalance * 0.80; // Max 80% of balance
  const assumedLeverage = config.actualLeverage || 2;
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
  
  // If the final qty is less than the exchange minimum, we cannot trade
  if (alignedQty < minQty) {
      console.log(`⏭️ Skipping ${symbol}: Calculated qty (${alignedQty}) is below exchange minimum (${minQty}).`);
      return null;
  }

  const actualRiskUSD = alignedQty * slDistance;
  
  if (alignedQty === qtyMargin && qtyMargin < qtyRisk) {
      console.log(`⚠️ Margin Cap: ${symbol} qty reduced to ${alignedQty.toFixed(4)} to fit margin budget. Risk is reduced to $${actualRiskUSD.toFixed(2)}.`);
  } else if (alignedQty < qtyRisk) {
      console.log(`⚠️ Risk Cap: ${symbol} qty reduced to ${alignedQty.toFixed(4)} to keep risk under ${config.riskPerTradePercent}% ($${actualRiskUSD.toFixed(2)}).`);
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
    klines: klines,
    atr
  };
}

module.exports = { buildTradePlan };
