function roundToTick(price, tickSize) {
  if (!Number.isFinite(price) || !Number.isFinite(tickSize) || tickSize <= 0) return null;
  const d = Math.max(0, Math.round(-Math.log10(tickSize)));
  return Number((Math.round(price / tickSize) * tickSize).toFixed(d));
}

function roundToStep(qty, step) {
  if (!Number.isFinite(qty) || !Number.isFinite(step) || step <= 0) return null;
  const d = Math.max(0, Math.round(-Math.log10(step)));
  return Number((Math.floor(qty / step) * step).toFixed(d));
}

module.exports = { roundToTick, roundToStep };
