// lib/tradeEngine.js
const ind = require('./indicators');

function buildTradePlan(symbol, signal, currentPrice, klines, instrumentInfo, accountBalance, config) {
  const { highs, lows, closes } = ind.parseKlines(klines);
  
  // 1. Get ATR and calculate base SL/TP distance
  const atr = ind.calculateATR(highs, lows, closes, config.atrPeriod);
  if (!atr) return null;

  // Adaptive SL Multiplier (matches your MQL5 logic: 0.75 to 1.50)
  // We keep it simple for now, using a 1.0 multiplier (can be expanded later)
  const slDistance = atr * config.riskRatio;
  const tpDistance = slDistance * config.profitRatio;

  // 2. Calculate SL and TP Prices
  let slPrice, tpPrice;
  if (signal.signalType === 1) { // BUY
    slPrice = currentPrice - slDistance;
    tpPrice = currentPrice + tpDistance;
  } else { // SELL
    slPrice = currentPrice + slDistance;
    tpPrice = currentPrice - tpDistance;
  }

  // 3. Calculate Position Size (Qty)
  // Risk $ = Account Balance * Risk % (e.g., 10000 * 0.5% = $50)
  const riskUSD = accountBalance * (config.riskPerTradePercent / 100);
  
  // Qty = Risk USD / SL Distance (in price)
  let qty = riskUSD / slDistance;

  // 4. Format Qty to Bybit's rules (qtyStep and minQty)
  const minQty = parseFloat(instrumentInfo.lotSizeFilter.minOrderQty);
  const qtyStep = parseFloat(instrumentInfo.lotSizeFilter.qtyStep);
  const maxQty = parseFloat(instrumentInfo.lotSizeFilter.maxOrderQty);

  // Round down to the nearest qtyStep
  qty = Math.floor(qty / qtyStep) * qtyStep;

  // If qty is below the exchange minimum, abort the trade
  if (qty < minQty) {
    console.log(`⚠️ Qty ${qty} is below exchange minimum (${minQty}). Trade blocked.`);
    return null;
  }
  if (qty > maxQty) qty = maxQty;

  // Calculate actual risk with rounded Qty
  const actualRiskUSD = qty * slDistance;

  return {
    symbol,
    side: signal.signalType === 1 ? 'Buy' : 'Sell',
    qty: parseFloat(qty.toFixed(4)),
    entryPrice: currentPrice,
    slPrice: parseFloat(slPrice.toFixed(2)),
    tpPrice: parseFloat(tpPrice.toFixed(2)),
    riskUSD: parseFloat(actualRiskUSD.toFixed(2)),
    atr: atr
  };
}

module.exports = {
  buildTradePlan
};