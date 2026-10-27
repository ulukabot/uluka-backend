// lib/indicators.js
// Mathematically accurate replicas of the MQL5 indicator logic.

function calculateSMA(values, period) {
  if (values.length < period) return null;
  const sum = values.slice(0, period).reduce((a, b) => a + b, 0);
  return sum / period;
}

function calculateStdDev(values, period) {
  const sma = calculateSMA(values, period);
  if (sma === null) return null;
  const variance = values.slice(0, period).reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
  return Math.sqrt(variance);
}

function calculateEMA(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  // Start with SMA for the first EMA value
  let ema = calculateSMA(values, period);
  // values are newest-first, so we iterate backwards from oldest to newest for EMA calculation
  for (let i = values.length - period - 1; i >= 0; i--) {
    ema = (values[i] * k) + (ema * (1 - k));
  }
  return ema;
}

// ATR (Average True Range)
function calculateATR(highs, lows, closes, period = 14) {
  if (highs.length < period + 1) return null;
  
  const trs = [];
  // Calculate True Range for the last `period` candles
  for (let i = 0; i < period; i++) {
    const high = highs[i];
    const low = lows[i];
    const prevClose = closes[i + 1];
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }
  
  // Return the simple average of the TRs
  const sum = trs.reduce((a, b) => a + b, 0);
  return sum / period;
}

// Bollinger Bands
function calculateBollingerBands(closes, period = 20, multiplier = 2.0) {
  const sma = calculateSMA(closes, period);
  const stdDev = calculateStdDev(closes, period);
  if (sma === null || stdDev === null) return null;
  
  return {
    upper: sma + (stdDev * multiplier),
    middle: sma,
    lower: sma - (stdDev * multiplier)
  };
}

// ADX (Average Directional Index)
function calculateADX(highs, lows, closes, period = 14) {
  if (highs.length < period * 2) return null;

  let trs = [], plusDMs = [], minusDMs = [];

  for (let i = 0; i < period * 2; i++) {
    const high = highs[i];
    const low = lows[i];
    const prevHigh = highs[i + 1];
    const prevLow = lows[i + 1];
    const prevClose = closes[i + 1];

    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);

    const upMove = high - prevHigh;
    const downMove = prevLow - low;

    const plusDM = (upMove > downMove && upMove > 0) ? upMove : 0;
    const minusDM = (downMove > upMove && downMove > 0) ? downMove : 0;

    plusDMs.push(plusDM);
    minusDMs.push(minusDM);
  }

  // Smooth them (simplified Wilder's smoothing)
  const smoothTR = trs.slice(0, period).reduce((a, b) => a + b, 0);
  const smoothPlusDM = plusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  const smoothMinusDM = minusDMs.slice(0, period).reduce((a, b) => a + b, 0);

  const plusDI = (smoothPlusDM / smoothTR) * 100;
  const minusDI = (smoothMinusDM / smoothTR) * 100;
  const dx = (Math.abs(plusDI - minusDI) / (plusDI + minusDI)) * 100;

  return { adx: dx, plusDI, minusDI }; 
}

// VWAP (Volume Weighted Average Price)
function calculateVWAP(highs, lows, closes, volumes, period = 50) {
  if (highs.length < period) return null;
  let cumulativeTPV = 0;
  let cumulativeVol = 0;
  
  for (let i = 0; i < period; i++) {
    const typicalPrice = (highs[i] + lows[i] + closes[i]) / 3;
    const volume = volumes[i];
    if (volume > 0) {
      cumulativeTPV += typicalPrice * volume;
      cumulativeVol += volume;
    }
  }
  
  return cumulativeVol > 0 ? (cumulativeTPV / cumulativeVol) : null;
}

// Helper to parse Bybit klines array into clean arrays
// Bybit returns newest-first: [startTime, open, high, low, close, volume, turnover]
function parseKlines(klines) {
  return {
    opens: klines.map(k => parseFloat(k[1])),
    highs: klines.map(k => parseFloat(k[2])),
    lows: klines.map(k => parseFloat(k[3])),
    closes: klines.map(k => parseFloat(k[4])),
    volumes: klines.map(k => parseFloat(k[5])),
  };
}

module.exports = {
  calculateSMA,
  calculateEMA,
  calculateATR,
  calculateBollingerBands,
  calculateADX,
  calculateVWAP,
  parseKlines
}