export const CONFIG = {
  CHART_THEME: {
    layout: { background: { color: '#0d1117' }, textColor: '#8b949e' },
    grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
    crosshair: { mode: 0 },
    timeScale: { borderColor: '#30363d' },
  }
};

export async function fetchData(ticker) {
  const today = new Date().toISOString().split('T')[0];
  const cacheKey = `stock_data_${ticker}_${today}`;
  
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      console.log(`[Cache] Loading ${ticker} for ${today}`);
      return JSON.parse(cached);
    }
  } catch (e) {
    console.warn("Cache read failed", e);
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5y`;
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    
    const response = await fetch(proxyUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    const json = JSON.parse(data.contents);
    
    if (!json.chart?.result?.[0]) {
      throw new Error(json.chart?.error?.description || "No data");
    }

    const result = json.chart.result[0];
    const timestamps = result.timestamp;
    const indicators = result.indicators.quote[0];

    const ohlcv = timestamps.map((t, i) => ({
      time: new Date(t * 1000).toISOString().split('T')[0],
      open: indicators.open[i] ?? indicators.close[i],
      high: indicators.high[i] ?? indicators.close[i],
      low: indicators.low[i] ?? indicators.close[i],
      close: indicators.close[i],
      volume: indicators.volume[i] ?? 0
    })).filter(d => d.close != null && !isNaN(d.close));

    const finalData = { ohlcv, source: 'Yahoo Finance', lastDate: ohlcv[ohlcv.length - 1].time };
    saveToCache(cacheKey, finalData);
    return finalData;
  } catch (e) {
    return fetchViaProxy2(ticker, cacheKey);
  }
}

async function fetchViaProxy2(ticker, cacheKey) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5y`;
  const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
  
  const response = await fetch(proxyUrl);
  if (!response.ok) throw new Error("Sources exhausted");
  
  const json = await response.json();
  const result = json.chart.result[0];
  const indicators = result.indicators.quote[0];

  const ohlcv = result.timestamp.map((t, i) => ({
    time: new Date(t * 1000).toISOString().split('T')[0],
    open: indicators.open[i],
    high: indicators.high[i],
    low: indicators.low[i],
    close: indicators.close[i],
    volume: indicators.volume[i]
  })).filter(d => d.close != null);

  const finalData = { ohlcv, source: 'Mirror', lastDate: ohlcv[ohlcv.length - 1].time };
  saveToCache(cacheKey, finalData);
  return finalData;
}

function saveToCache(key, data) {
  try {
    // Basic cleanup: remove old keys to avoid filling up localStorage
    const keys = Object.keys(localStorage);
    if (keys.length > 50) {
      keys.filter(k => k.startsWith('stock_data_')).forEach(k => localStorage.removeItem(k));
    }
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.warn("Cache write failed", e);
  }
}


export function calcSigma(ohlcv, mode, manualVol, window) {
  if (mode === 'manual') return manualVol / 100;
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

export function generateFutureDates(startDateStr, days) {
  const dates = [];
  let current = new Date(startDateStr);
  let count = 0;
  while (count <= days) {
    const dayOfWeek = current.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      dates.push(current.toISOString().split('T')[0]);
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  return dates;
}
