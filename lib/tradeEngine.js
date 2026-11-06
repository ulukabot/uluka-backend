const ind = require('./indicators');
const session = require('./session');
const { roundToTick, roundToStep } = require('./precision');

function buildTradePlan(symbol, signal, currentPrice, klines, instrumentInfo, accountBalance, config) {
  const { highs, lows, closes } = ind.parseKlines(klines);
  const atr = ind.calculateATR(highs, lows, closes, config.atrPeriod);
  if (!atr) return null;

  const sessionData = session.getSessionMultiplier();
  const slDistance = (atr * config.riskRatio) * sessionData.mult;

  // ✅ 1. FOREX LOGIC: Minimum SL Floor
  let minSLPrice = atr * (config.riskRatio / 3.0);
  const hardFloorPrice = currentPrice * 0.001; 
  if (minSLPrice < hardFloorPrice) minSLPrice = hardFloorPrice;

  if (slDistance < minSLPrice) {
      console.log(`🚫 SAFETY BLOCK: SL too tight for ${symbol} (${slDistance.toFixed(4)} < floor ${minSLPrice.toFixed(4)}). Trade skipped.`);
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

  const riskUSD = accountBalance * (config.riskPerTradePercent / 100);
  
  // Get broker specs
  const tickSize = parseFloat(instrumentInfo.priceFilter.tickSize);
  const minQty   = parseFloat(instrumentInfo.lotSizeFilter.minOrderQty);
  const qtyStep  = parseFloat(instrumentInfo.lotSizeFilter.qtyStep);
  const maxQty   = parseFloat(instrumentInfo.lotSizeFilter.maxOrderQty);

  // ✅ 2. YOUR LOGIC: Calculate the exact Minimum Risk for this trade
  // If I am forced to buy the minimum lot, what is my risk in dollars?
  const exchangeMinRiskUSD = minQty * slDistance;

  // If the user's requested risk is LESS than the exchange minimum risk, we must block it.
  if (riskUSD < exchangeMinRiskUSD) {
      console.log(`🚫 Trade blocked: Desired risk ($${riskUSD.toFixed(2)}) is lower than exchange minimum ($${exchangeMinRiskUSD.toFixed(2)}).`);
      return null;
  }

  // ✅ 3. Calculate Lot Size
  const rawQty = riskUSD / slDistance;
  let alignedQty = Math.floor(rawQty / qtyStep) * qtyStep;
  
  if (alignedQty > maxQty) alignedQty = maxQty;
  if (alignedQty < minQty) alignedQty = minQty; // Safety fallback

  const actualRiskUSD = alignedQty * slDistance;

  console.log(`📊 Risk Math: SL: $${slDistance.toFixed(4)} | Qty: ${alignedQty.toFixed(4)} | Risk: $${actualRiskUSD.toFixed(2)}`);

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
