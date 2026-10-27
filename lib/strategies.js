// lib/strategies.js
const ind = require('./indicators');

// --- 1. MARKET REGIME DETECTION ---
function detectMarketRegime(highs, lows, closes, adxData, bbData) {
  if (!adxData || !bbData) return 'RANGING';
  
  const adxVal = adxData.adx;
  const bbWidth = (bbData.upper - bbData.lower) / bbData.middle * 100;
  
  if (adxVal > 25) return 'TRENDING';
  if (adxVal < 15 && bbWidth < 0.3) return 'LOW_VOL';
  return 'RANGING';
}

// --- 2. ORDER BLOCK ---
function getNearestOrderBlock(highs, lows, opens, closes, currentPrice, type) {
  const ob = { valid: false, top: 0, bottom: 0 };
  
  for (let i = 3; i < 25; i++) {
    if (type === 'BUY') {
      const isBearish = closes[i] < opens[i];
      const nextBullish = (closes[i-1] > opens[i-1] && closes[i-2] > opens[i-2]);
      const strongImpulse = (closes[i-1] - opens[i-1]) > (highs[i] - lows[i]) * 0.5;

      if (isBearish && nextBullish && strongImpulse) {
        const obTop = Math.max(opens[i], closes[i]);
        const obBottom = Math.min(opens[i], closes[i]);
        
        if (currentPrice > obBottom && currentPrice < obTop * 1.002) {
          return { valid: true, top: obTop, bottom: obBottom };
        }
      }
    } else {
      const isBullish = closes[i] > opens[i];
      const nextBearish = (closes[i-1] < opens[i-1] && closes[i-2] < opens[i-2]);
      const strongImpulse = (opens[i-1] - closes[i-1]) > (highs[i] - lows[i]) * 0.5;

      if (isBullish && nextBearish && strongImpulse) {
        const obTop = Math.max(opens[i], closes[i]);
        const obBottom = Math.min(opens[i], closes[i]);
        
        if (currentPrice < obTop && currentPrice > obBottom * 0.998) {
          return { valid: true, top: obTop, bottom: obBottom };
        }
      }
    }
  }
  return ob;
}

// --- 3. FAIR VALUE GAP (FVG) ---
function getNearestFVG(highs, lows, currentPrice, tickSize, type) {
  const fvg = { valid: false, top: 0, bottom: 0 };
  const minGapSize = tickSize * 50; // Minimum 50 points gap

  for (let i = 2; i < 25; i++) {
    if (type === 'BUY') {
      const gapBottom = highs[i+1];
      const gapTop = lows[i-1];
      
      if (gapTop > gapBottom && (gapTop - gapBottom) >= minGapSize) {
        if (currentPrice >= gapBottom && currentPrice <= gapTop) {
          return { valid: true, top: gapTop, bottom: gapBottom };
        }
      }
    } else {
      const gapTop = lows[i+1];
      const gapBottom = highs[i-1];

      if (gapTop > gapBottom && (gapTop - gapBottom) >= minGapSize) {
        if (currentPrice >= gapBottom && currentPrice <= gapTop) {
          return { valid: true, top: gapTop, bottom: gapBottom };
        }
      }
    }
  }
  return fvg;
}

// --- 4. BREAK OF STRUCTURE (BOS) ---
function isBOSPresent(highs, lows, closes, type) {
  let prevSwingHigh = 0;
  let prevSwingLow = 9999999;

  for (let i = 5; i < 20; i++) {
    if (highs[i] > highs[i+1] && highs[i] > highs[i+2] && highs[i] > highs[i-1] && highs[i] > highs[i-2]) {
      if (highs[i] > prevSwingHigh) prevSwingHigh = highs[i];
    }
    if (lows[i] < lows[i+1] && lows[i] < lows[i+2] && lows[i] < lows[i-1] && lows[i] < lows[i-2]) {
      if (lows[i] < prevSwingLow) prevSwingLow = lows[i];
    }
  }

  if (type === 'BUY' && prevSwingHigh > 0) return closes[1] > prevSwingHigh;
  if (type === 'SELL' && prevSwingLow < 9999999) return closes[1] < prevSwingLow;
  return false;
}

// --- 5. CHoCH (Change of Character) ---
function isCHoCHPresent(highs, lows, closes, type) {
  let bullCount = 0, bearCount = 0;
  let lastHigh = highs[35], lastLow = lows[35];

  for (let i = 34; i >= 10; i--) {
    if (highs[i] > lastHigh) { bullCount++; lastHigh = highs[i]; }
    if (lows[i] < lastLow) { bearCount++; lastLow = lows[i]; }
  }

  if (type === 'BUY' && bearCount > bullCount) {
    let recentSwingHigh = 0;
    for (let i = 5; i < 20; i++) if (highs[i] > recentSwingHigh) recentSwingHigh = highs[i];
    return recentSwingHigh > 0 && closes[1] > recentSwingHigh;
  }
  
  if (type === 'SELL' && bullCount > bearCount) {
    let recentSwingLow = 9999999;
    for (let i = 5; i < 20; i++) if (lows[i] < recentSwingLow) recentSwingLow = lows[i];
    return recentSwingLow < 9999999 && closes[1] < recentSwingLow;
  }
  return false;
}

// --- 6. THE MAIN SIGNAL ENGINE ---
function getScoreSignal(symbol, klines, tickSize, currentPrice, emaFast, emaSlow) {
  // Parse klines (newest first)
  const { opens, highs, lows, closes, volumes } = ind.parseKlines(klines);

  // Calculate base indicators
  const adxData = ind.calculateADX(highs, lows, closes, 14);
  const bbData = ind.calculateBollingerBands(closes, 20, 2.0);
  const regime = detectMarketRegime(highs, lows, closes, adxData, bbData);

  let result = {
    buyScore: 0,
    sellScore: 0,
    signalType: 0,
    regime: regime,
    obBuy: false, obSell: false,
    fvgBuy: false, fvgSell: false,
    bosBuy: false, bosSell: false,
    chochBuy: false, chochSell: false,
    farsightBuy: false, farsightSell: false,
    visionBuy: false, visionSell: false
  };

  const WEIGHT = 17; // 6 strategies * 17 = 102 max score

  // 1. Order Block
  const obBuy = getNearestOrderBlock(highs, lows, opens, closes, currentPrice, 'BUY');
  const obSell = getNearestOrderBlock(highs, lows, opens, closes, currentPrice, 'SELL');
  if (obBuy.valid) { result.buyScore += WEIGHT; result.obBuy = true; }
  if (obSell.valid) { result.sellScore += WEIGHT; result.obSell = true; }

  // 2. FVG
  const fvgBuy = getNearestFVG(highs, lows, currentPrice, tickSize, 'BUY');
  const fvgSell = getNearestFVG(highs, lows, currentPrice, tickSize, 'SELL');
  if (fvgBuy.valid) { result.buyScore += WEIGHT; result.fvgBuy = true; }
  if (fvgSell.valid) { result.sellScore += WEIGHT; result.fvgSell = true; }

  // 3. BOS & CHoCH
  if (isCHoCHPresent(highs, lows, closes, 'BUY')) { result.buyScore += WEIGHT; result.chochBuy = true; }
  if (isCHoCHPresent(highs, lows, closes, 'SELL')) { result.sellScore += WEIGHT; result.chochSell = true; }
  
  if (isBOSPresent(highs, lows, closes, 'BUY') && regime === 'TRENDING') { result.buyScore += WEIGHT; result.bosBuy = true; }
  if (isBOSPresent(highs, lows, closes, 'SELL') && regime === 'TRENDING') { result.sellScore += WEIGHT; result.bosSell = true; }

  // 4. Farsight (Trend following)
  if (regime === 'TRENDING' && emaFast && emaSlow) {
    if (emaFast > emaSlow) { result.buyScore += WEIGHT; result.farsightBuy = true; }
    if (emaFast < emaSlow) { result.sellScore += WEIGHT; result.farsightSell = true; }
  }

  // 5. Close Vision (Mean reversion)
  if (regime === 'RANGING' && bbData) {
    // Bid <= lower band and previous candle was below
    if (currentPrice <= bbData.lower && closes[1] <= bbData.lower) {
      result.buyScore += WEIGHT; result.visionBuy = true;
    }
    if (currentPrice >= bbData.upper && closes[1] >= bbData.upper) {
      result.sellScore += WEIGHT; result.visionSell = true;
    }
  }

  // Determine final direction
  if (result.buyScore > result.sellScore) result.signalType = 1; // BUY
  else if (result.sellScore > result.buyScore) result.signalType = -1; // SELL
  else result.signalType = 0; // TIE

  return result;
}

module.exports = {
  getScoreSignal,
  detectMarketRegime
};