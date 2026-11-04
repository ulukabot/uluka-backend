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

  // ✅ 1. THE PURE RISK MATH (Exactly like Forex)
  const riskUSD = accountBalance * (config.riskPerTradePercent / 100);
  let qty = riskUSD / slDistance; 

  // ✅ 2. THE LEVERAGE CHECK (Ensuring you have enough margin)
  const assumedLeverage = 10; // 10x leverage
  const notionalValue = qty * currentPrice;
  const requiredMargin = notionalValue / assumedLeverage;

  // We will use a maximum of 80% of your balance as margin
  const maxMarginAllowed = accountBalance * 0.80;

  if (requiredMargin > maxMarginAllowed) {
      // The pure risk lot size is too big for your margin.
      // We cap the lot size so it exactly fits your 80% margin limit.
      const oldQty = qty;
      qty = (maxMarginAllowed * assumedLeverage) / currentPrice;
      
      console.log(`⚠️ Margin Cap: ${symbol} qty reduced from ${oldQty.toFixed(4)} to ${qty.toFixed(4)} to prevent 110007 error.`);
  }

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
  
  // If the aligned qty is less than Bybit's minimum, we cannot trade this
  if (alignedQty < minQty) {
      console.log(`⏭️ Skipping ${symbol}: Calculated qty (${alignedQty}) is below Bybit minimum (${minQty}).`);
      return null;
  }

  const actualRiskUSD = alignedQty * slDistance;

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
    atr
  };
}

module.exports = { buildTradePlan };
