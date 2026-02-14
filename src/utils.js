export const CONFIG = {
  CHART_THEME: {
    layout: { background: { color: '#0d1117' }, textColor: '#8b949e' },
    grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
    crosshair: { mode: 0 },
    timeScale: { borderColor: '#30363d' },
  }
};

export async function searchTicker(query) {
  if (!query || query.length < 2) return [];
  
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=5&newsCount=0`;
    // Use corsproxy.io as the primary to avoid CORS
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
    
    const response = await fetch(proxyUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const json = await response.json();
    return (json.quotes || []).map(q => ({
      symbol: q.symbol,
      shortname: q.shortname || q.longname || q.symbol,
      exchDisp: q.exchDisp,
      typeDisp: q.typeDisp
    }));
  } catch (e) {
    console.warn("Ticker search failed", e);
    return [];
  }
}

export async function fetchData(ticker) {
  const today = new Date().toISOString().split('T')[0];
  const cacheKey = `stock_data_${ticker}_${today}`;
  
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      // Basic validation of cached data
      const parsed = JSON.parse(cached);
      if (parsed && Array.isArray(parsed.ohlcv) && parsed.ohlcv.length > 0) {
          console.log(`[Cache] Loading ${ticker} for ${today}`);
          return parsed;
      }
    }
  } catch (e) {
    console.warn("Cache read failed", e);
  }

  try {
    // interval=1d&range=5y matches the original requirement
    // Added includeAdjustedClose=true just in case, though usually default
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5y&events=div`;
    // Use corsproxy.io as the primary to avoid QUIC errors on allorigins
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
    
    const response = await fetch(proxyUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const json = await response.json();
    
    if (!json.chart?.result?.[0]) {
      throw new Error(json.chart?.error?.description || "No data");
    }

    const result = json.chart.result[0];
    const timestamps = result.timestamp;
    const indicators = result.indicators.quote[0];
    const events = result.events?.dividends; // "events": { "dividends": { ... } }

    if (!timestamps || !indicators) {
        throw new Error("Invalid data structure from API");
    }

    const ohlcv = timestamps.map((t, i) => ({
      time: new Date(t * 1000).toISOString().split('T')[0],
      open: indicators.open[i] ?? indicators.close[i],
      high: indicators.high[i] ?? indicators.close[i],
      low: indicators.low[i] ?? indicators.close[i],
      close: indicators.close[i],
      volume: indicators.volume[i] ?? 0
    })).filter(d => d.close != null && !isNaN(d.close));

    const dividends = [];
    if (events) {
      Object.values(events).forEach(d => {
        if (d && d.date && d.amount) {
            dividends.push({
            time: new Date(d.date * 1000).toISOString().split('T')[0],
            value: d.amount
            });
        }
      });
      dividends.sort((a, b) => new Date(a.time) - new Date(b.time));
    }

    const finalData = { ohlcv, dividends, source: 'Yahoo Finance', lastDate: ohlcv[ohlcv.length - 1].time };
    saveToCache(cacheKey, finalData);
    return finalData;
  } catch (e) {
    console.warn(`Primary proxy failed for ${ticker}, trying fallback...`, e);
    // You can define a fallback here if you want, e.g. fetchViaProxy2
    // For now, re-throwing or returning a fallback function call
    return fetchViaProxy2(ticker, cacheKey);
  }
}

async function fetchViaProxy2(ticker, cacheKey) {
  try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5y&events=div`;
      // Fallback to allorigins if corsproxy fails
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}&timestamp=${Date.now()}`;
      
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error("Sources exhausted");
      
      const data = await response.json();
      if (!data.contents) throw new Error("No content from proxy");

      const json = JSON.parse(data.contents);
      if (!json.chart?.result?.[0]) throw new Error("Invalid data structure");

      const result = json.chart.result[0];
      const indicators = result.indicators.quote[0];
      const events = result.events?.dividends;

      const ohlcv = result.timestamp.map((t, i) => ({
        time: new Date(t * 1000).toISOString().split('T')[0],
        open: indicators.open[i],
        high: indicators.high[i],
        low: indicators.low[i],
        close: indicators.close[i],
        volume: indicators.volume[i]
      })).filter(d => d.close != null);

      const dividends = [];
      if (events) {
        Object.values(events).forEach(d => {
           if (d && d.date && d.amount) {
            dividends.push({
                time: new Date(d.date * 1000).toISOString().split('T')[0],
                value: d.amount
            });
           }
        });
        dividends.sort((a, b) => new Date(a.time) - new Date(b.time));
      }

      const finalData = { ohlcv, dividends, source: 'Mirror', lastDate: ohlcv[ohlcv.length - 1].time };
      saveToCache(cacheKey, finalData);
      return finalData;
  } catch (e) {
      console.error("All proxies failed", e);
      throw new Error("Failed to fetch market data");
  }
}

function saveToCache(key, data) {
  try {
    const keys = Object.keys(localStorage);
    // Cleanup old cache if too large
    if (keys.length > 50) {
        // Filter for our keys
        const ourKeys = keys.filter(k => k.startsWith('stock_data_'));
        // Just remove the first few found to make space
        for(let i=0; i<Math.min(10, ourKeys.length); i++) {
            localStorage.removeItem(ourKeys[i]);
        }
    }
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.warn("Cache write failed", e);
  }
}


// calcSigma moved to src/math/volatility.js

export function generateFutureDates(startDateStr, days) {
  const dates = [];
  let current = new Date(startDateStr);
  // Initial increment to start from the *next* day
  current.setDate(current.getDate() + 1);
  
  let count = 0;
  // Safety break to prevent infinite loops
  let safety = 0;
  
  while (count < days && safety < days * 3) {
    const dayOfWeek = current.getDay();
    // 0 = Sunday, 6 = Saturday
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      dates.push(current.toISOString().split('T')[0]);
      count++;
    }
    current.setDate(current.getDate() + 1);
    safety++;
  }
  return dates;
}
