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

  // ✅ 2. DIRECT RISK MATH (Bybit Linear)
  const riskUSD = accountBalance * (config.riskPerTradePercent / 100);
  
  // Get broker specs
  const tickSize = parseFloat(instrumentInfo.priceFilter.tickSize);
  const minQty   = parseFloat(instrumentInfo.lotSizeFilter.minOrderQty);
  const qtyStep  = parseFloat(instrumentInfo.lotSizeFilter.qtyStep);
  const maxQty   = parseFloat(instrumentInfo.lotSizeFilter.maxOrderQty);

  // For Linear USDT, cost per 1.0 lot is exactly the SL distance
  const rawQty = riskUSD / slDistance;

  // ✅ 3. Normalize to Bybit rules
  let alignedQty = Math.floor(rawQty / qtyStep) * qtyStep;
  if (alignedQty > maxQty) alignedQty = maxQty;
  
  // ✅ 4. Minimum Dollar Risk Check
  const actualRiskUSD = alignedQty * slDistance;
  const minDollarRisk = config.minDollarRisk || 5.0; 
  
  if (actualRiskUSD < minDollarRisk) {
      console.log(`🚫 Trade blocked: Dollar risk too low ($${actualRiskUSD.toFixed(2)} < $${minDollarRisk}). Qty: ${alignedQty}`);
      return null;
  }

  if (alignedQty < minQty) {
      console.log(`⏭️ Skipping ${symbol}: Calculated qty (${alignedQty}) below exchange minimum (${minQty}).`);
      return null;
  }

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
