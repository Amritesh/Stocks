export function calcSigma(ohlcv, mode, manualVolPct, window) {
  if (mode === 'manual') return manualVolPct / 100;
  const sub = ohlcv.slice(-window - 1);
  const rets = [];
  for (let i = 1; i < sub.length; i++) {
    if (sub[i].close && sub[i - 1].close) {
      rets.push(Math.log(sub[i].close / sub[i - 1].close));
    }
  }
  if (rets.length < 2) return 0.25;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance * 252);
}
