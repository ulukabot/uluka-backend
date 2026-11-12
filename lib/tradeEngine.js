const ind = require('./indicators');
const session = require('./session');
const { roundToTick, roundToStep } = require('./precision');

function buildTradePlan(symbol, signal, currentPrice, klines, instrumentInfo, accountBalance, config) {
  const { highs, lows, closes } = ind.parseKlines(klines);
  const atr = ind.calculateATR(highs, lows, closes, config.atrPeriod);
  if (!atr) return null;

  const sessionData = session.getSessionMultiplier();
  
  // 1. Calculate Stop Loss Distance
  let slDistance = (atr * config.riskRatio) * sessionData.mult;

    // 2. SAFETY FLOOR: Dynamic based on user settings
  const userMinSlPercent = Number(config.min_sl_percent !== undefined ? config.min_sl_percent : 1.0);
  const hardFloorPrice = currentPrice * (userMinSlPercent / 100); 

  if (slDistance < hardFloorPrice) {
      console.log(`🛡️ SL FLOOR: ATR SL too tight (${slDistance.toFixed(4)}). Widening to ${userMinSlPercent}% floor (${hardFloorPrice.toFixed(4)}).`);
      slDistance = hardFloorPrice; 
  }

  // 3. R-Multiple Take Profits (Your new logic: 2x, 3.5x, 4.6x)
  const tp1Dist = slDistance * 2.0;
  const tp2Dist = slDistance * 3.5;
  const tp3Dist = slDistance * 4.6;

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

  // 4. Check Exchange Minimums
  const exchangeMinRiskUSD = minQty * slDistance;

  if (riskUSD < exchangeMinRiskUSD) {
      console.log(`🚫 Trade blocked: Desired risk ($${riskUSD.toFixed(2)}) is lower than exchange minimum ($${exchangeMinRiskUSD.toFixed(2)}).`);
      return null;
  }

  // 5. Calculate Lot Size (NO LEVERAGE MULTIPLIER)
  const rawQty = riskUSD / slDistance;
  let alignedQty = Math.floor(rawQty / qtyStep) * qtyStep;
  
  if (alignedQty > maxQty) alignedQty = maxQty;
  if (alignedQty < minQty) alignedQty = minQty; 

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
