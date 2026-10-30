// lib/tradeEngine.js
const ind = require('./indicators');
const session = require('./session');

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

  const riskUSD = accountBalance * (config.riskPerTradePercent / 100);
  let qty = riskUSD / slDistance;

  if (!instrumentInfo || !instrumentInfo.lotSizeFilter) {
    return null;
  }

  const minQty = parseFloat(instrumentInfo.lotSizeFilter.minOrderQty);
  const qtyStep = parseFloat(instrumentInfo.lotSizeFilter.qtyStep);
  const maxQty = parseFloat(instrumentInfo.lotSizeFilter.maxOrderQty);

  qty = Math.floor(qty / qtyStep) * qtyStep;

  if (qty < minQty) return null;
  if (qty > maxQty) qty = maxQty;

  const actualRiskUSD = qty * slDistance;

  return {
    symbol,
    side: signal.signalType === 1 ? 'Buy' : 'Sell',
    qty: parseFloat(qty.toFixed(4)),
    entryPrice: currentPrice,
    slPrice: parseFloat(slPrice.toFixed(2)),
    tp1Price: parseFloat(tp1Price.toFixed(2)),
    tp2Price: parseFloat(tp2Price.toFixed(2)),
    tp3Price: parseFloat(tp3Price.toFixed(2)),
    riskUSD: parseFloat(actualRiskUSD.toFixed(2)),
    atr: atr
  };
}

module.exports = { buildTradePlan };
