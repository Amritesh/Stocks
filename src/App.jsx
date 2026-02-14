import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, CandlestickSeries, LineSeries } from 'lightweight-charts';
import { CONFIG, fetchData, generateFutureDates, searchTicker } from './utils';
import {
  TRADING_DAYS,
  DEFAULT_HORIZON_DAYS,
  DEFAULT_RISK_FREE_PCT,
  DEFAULT_YIELD_PCT,
  DEFAULT_VOL_MODE,
  DEFAULT_VOL_WINDOW,
  DEFAULT_MANUAL_VOL_PCT,
  DEFAULT_PATHS,
  DEFAULT_SEED,
  DEFAULT_COST_BPS,
  DEFAULT_OBJECTIVE,
  DEFAULT_LAMBDA,
  DEFAULT_BASIS_DEGREE,
} from './math/constants';
import { runModel } from './api/client';
import { DecisionBoundaryTab } from './components/tabs/DecisionBoundaryTab';
import { calcSigma } from './math/volatility';
import { generateRandomWalks } from './math/monteCarlo';
import {
  TrendingUp,
  Play,
  BarChart2,
  Info,
  Loader2,
  LayoutDashboard,
  Search,
  ArrowUpRight,
  TrendingDown,
  Globe,
  Clock,
  ShieldCheck,
  Zap,
  CircleDot,
  Menu,
  X,
  Activity
} from 'lucide-react';

export default function App() {
  const [ticker, setTicker] = useState('HDFCBANK.NS');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [horizon, setHorizon] = useState(DEFAULT_HORIZON_DAYS);
  const [riskFree, setRiskFree] = useState(DEFAULT_RISK_FREE_PCT);
  const [yieldRate, setYieldRate] = useState(DEFAULT_YIELD_PCT);
  const [volMode, setVolMode] = useState(DEFAULT_VOL_MODE);
  const [volWindow, setVolWindow] = useState(DEFAULT_VOL_WINDOW);
  const [manualVol, setManualVol] = useState(DEFAULT_MANUAL_VOL_PCT);
  const [paths, setPaths] = useState(DEFAULT_PATHS);
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [cost, setCost] = useState(DEFAULT_COST_BPS);
  const [objective, setObjective] = useState(DEFAULT_OBJECTIVE);
  const [lambda, setLambda] = useState(DEFAULT_LAMBDA);
  const [basis, setBasis] = useState(DEFAULT_BASIS_DEGREE);
  const [buyDate, setBuyDate] = useState('2025-06-01');
  const [buyPrice, setBuyPrice] = useState('970');
  const [confidence, setConfidence] = useState(0.9);
  const [entryMeta, setEntryMeta] = useState({ date: '', price: null });
  
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');
  const [ohlcv, setOhlcv] = useState([]);
  const [status, setStatus] = useState({ source: '---', date: '---' });
  const [results, setResults] = useState(null);
  const [backend, setBackend] = useState({ ce: null, luck_score: null, message: '', buy_ranges: [], stats: null, decision: null, decision_text: null, regime: null });
  const [sigmaEst, setSigmaEst] = useState('--');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const mainChartRef = useRef(null);
  // Removed separate refs for boundary and fan charts as they will be merged
  const charts = useRef({});
  const series = useRef({});
  const workerRef = useRef(null);
  const hasLoadedRef = useRef(false);

  const currency = ticker.toUpperCase().endsWith('.NS') || ticker.toUpperCase().endsWith('.BO') ? '₹' : '$';
  const targetPct = 0.1;
  const drawdownPct = 0.1;

  const handleRun = useCallback(async (targetTicker = ticker) => {
    if (!targetTicker) return;
    
    setShowSuggestions(false);
    // Clear old results immediately when starting a new run
    setResults(null);
    setOhlcv([]);
    setStatus({ source: '---', date: '---' });
    setSigmaEst('--');
    setBackend({ ce: null, luck_score: null, message: '' });
    
    // Clear chart series data
    if (series.current.candles) series.current.candles.setData([]);
    if (series.current.ma50) series.current.ma50.setData([]);
    if (series.current.ma200) series.current.ma200.setData([]);
    if (series.current.boundaryToday) series.current.boundaryToday.setData([]);
    if (series.current.boundaryCurve) series.current.boundaryCurve.setData([]);
    if (series.current.buyLine) series.current.buyLine.setData([]);
    if (series.current.targetLine) series.current.targetLine.setData([]);
    if (series.current.stopLine) series.current.stopLine.setData([]);
    if (series.current.candles?.setMarkers) series.current.candles.setMarkers([]);
    if (series.current.realizedLine) series.current.realizedLine.setData([]);
    if (series.current.fan) {
      series.current.fan.forEach(s => s.setData([]));
    }
    // Clear simulation lines
    if (series.current.simulations) {
        series.current.simulations.forEach(s => {
             charts.current.main.removeSeries(s);
        });
        series.current.simulations = [];
    }

    setLoading(true);
    setLoadingText(`Analyzing ${targetTicker}...`);
    
    try {
       const data = await fetchData(targetTicker);
       setOhlcv(data.ohlcv);
       setStatus({ source: data.source, date: data.lastDate });
      
       if (series.current.candles) {
         const sub = data.ohlcv.slice(-365);
         series.current.candles.setData(sub);
         
         // Force a fitContent after setting initial data to ensure visibility
         requestAnimationFrame(() => {
             if (charts.current.main) {
                 charts.current.main.timeScale().fitContent();
             }
         });
         
         [50, 200].forEach(p => {
           const ma = [];
           for(let i=p; i<data.ohlcv.length; i++) {
             const v = data.ohlcv.slice(i-p, i).reduce((a,b)=>a+b.close,0)/p;
             ma.push({ time: data.ohlcv[i].time, value: v });
           }
           series.current[`ma${p}`].setData(ma.filter(d => d.time >= sub[0].time));
         });

         const fallbackDate = data.ohlcv[data.ohlcv.length - 1].time;
         const fallbackPrice = data.ohlcv[data.ohlcv.length - 1].close;
         const usedDate = buyDate || fallbackDate;
         const usedPrice = Number(buyPrice || fallbackPrice);

         const elapsedDays = (() => {
           const startIdx = data.ohlcv.findIndex(d => d.time >= usedDate);
           if (startIdx === -1) return data.ohlcv.length - 1;
           return Math.max(1, data.ohlcv.length - 1 - startIdx);
         })();
         const horizonUsed = Math.max(1, elapsedDays);
         setHorizon(horizonUsed);
         setEntryMeta({ date: usedDate, price: usedPrice });

         if (series.current.buyLine) series.current.buyLine.setData(sub.map(d => ({ time: d.time, value: usedPrice })));
         if (series.current.targetLine) series.current.targetLine.setData(sub.map(d => ({ time: d.time, value: usedPrice * (1 + targetPct) })));
         if (series.current.stopLine) series.current.stopLine.setData(sub.map(d => ({ time: d.time, value: usedPrice * (1 - drawdownPct) })));
          if (series.current.realizedLine) {
            const startIdx = data.ohlcv.findIndex(d => d.time >= usedDate);
            const realizedSlice = startIdx === -1 ? sub : data.ohlcv.slice(startIdx);
            series.current.realizedLine.setData(realizedSlice.map(d => ({ time: d.time, value: d.close })));
            
            // Color logic: Green if final > start, Red if final < start
            if (realizedSlice.length > 0) {
                const startPrice = realizedSlice[0].close;
                const endPrice = realizedSlice[realizedSlice.length-1].close;
                series.current.realizedLine.applyOptions({
                    color: endPrice >= startPrice ? '#22c55e' : '#f43f5e'
                });
            }

            // Generate Random Walks for Context (Historical Bootstrap)
            // Rendered HERE after usedDate/usedPrice are defined
            const walkHorizon = realizedSlice.length;
            const nWalks = 50;
            
            const walks = generateRandomWalks({
                S0: usedPrice,
                ohlcv: data.ohlcv,
                horizon: walkHorizon,
                nPaths: nWalks,
                seed: seed
            });

            // Render walks
            series.current.simulations = [];
            if (walks && walks.length > 0) {
                walks.forEach(path => {
                    const s = charts.current.main.addSeries(LineSeries, {
                        color: 'rgba(255, 255, 255, 0.05)', // Very faint white
                        lineWidth: 1,
                        crosshairMarkerVisible: false,
                        lastValueVisible: false,
                        priceLineVisible: false
                    });
                    
                    const lineData = [];
                    for(let t=0; t<path.length; t++) {
                        if (realizedSlice[t]) {
                            lineData.push({ time: realizedSlice[t].time, value: path[t] });
                        }
                    }
                    s.setData(lineData);
                    series.current.simulations.push(s);
                });

                // Calculate Outcome Percentile
                const finalRealized = realizedSlice[realizedSlice.length-1].close;
                const finalSimulated = walks.map(w => w[w.length-1]);
                finalSimulated.sort((a,b) => a-b);
                
                let rank = 0;
                while(rank < finalSimulated.length && finalSimulated[rank] < finalRealized) {
                    rank++;
                }
                const percentile = rank / finalSimulated.length;
                
                // Update luck score in backend state
                setBackend(prev => ({ ...prev, luck_score: percentile }));
            }
          }
          if (series.current.candles?.setMarkers) {
            const markers = [];
            // Entry Marker
            if (usedPrice) {
                markers.push({
                    time: usedDate,
                    position: 'belowBar',
                    color: '#22c55e',
                    shape: 'arrowUp',
                    text: `ENTRY @ ${currency}${usedPrice}`,
                    size: 2
                });
            }

            // Dividend Markers
            if (data.dividends) {
                data.dividends.forEach(d => {
                   // Only show dividends within the visible range
                   if (d.time >= sub[0].time) {
                       markers.push({
                           time: d.time,
                           position: 'aboveBar',
                           color: '#facc15', // bright yellow
                           shape: 'arrowDown',
                           text: `DIV ${currency}${d.value}`,
                           size: 1
                       });
                   }
                });
            }
            
            // Sort markers by time
            markers.sort((a, b) => new Date(a.time) - new Date(b.time));

            series.current.candles.setMarkers(markers);
          }
          charts.current.main.timeScale().fitContent();
          setTimeout(() => charts.current.main.timeScale().fitContent(), 0);

          // Update fan/boundary horizon-dependent visuals later using horizonUsed
           // (handled below when posting to worker/backend)
         }
       
        const sigma = calcSigma(data.ohlcv, volMode, manualVol, volWindow);
        setSigmaEst((sigma * 100).toFixed(1));
 
       if (workerRef.current) workerRef.current.terminate();
       const workerUrl = new URL('./worker.js', import.meta.url);
       console.log("Initializing worker from", workerUrl.toString());
       workerRef.current = new Worker(workerUrl, { type: 'module' });
       workerRef.current.onmessage = (e) => {
          const { type, boundary, decision, bands, spot, rebalancingPoints, result, error } = e.data;
          
          if (error) {
            console.error('Worker error payload:', error);
            setLoading(false);
            return;
          }

          if (type === 'bootstrap_result') {
            setBackend(result);
          } else if (type === 'lsmc_result' || (!type && boundary)) { // Fallback for old message format if any
             setResults({ boundary, decision, bands, spot, rebalancingPoints });
             
             // Use the entry date as the start of the simulation visuals if possible
             const simStartDate = buyDate || data.lastDate;
             const futureDates = generateFutureDates(simStartDate, boundary.length + 5); // Add buffer
             
             // Plot boundary curve on main chart
             if (series.current.boundaryCurve) {
                const boundaryData = boundary.map((v, i) => {
                    const date = futureDates[i];
                    return date ? { time: date, value: v } : null;
                }).filter(d => d !== null);
                series.current.boundaryCurve.setData(boundaryData);
             }
             
             // Plot probability bands (Fan) on main chart
             // Backend now sends bands as [{p10, p50, p90}, ...]
             if (series.current.fan && res.bands) {
                 const p10Data = [];
                 const p50Data = [];
                 const p90Data = [];
                 
                 // Generate future dates starting from tomorrow/next valid day
                 // The backend sends 252 points or however many requested
                 const startSimDate = buyDate || data.lastDate;
                 const futureDates = generateFutureDates(startSimDate, res.bands.length + 5);

                 res.bands.forEach((b, i) => {
                     const date = futureDates[i];
                     if (date) {
                         p10Data.push({ time: date, value: b.p10 });
                         p50Data.push({ time: date, value: b.p50 });
                         p90Data.push({ time: date, value: b.p90 });
                     }
                 });

                 if (series.current.fan[0]) series.current.fan[0].setData(p10Data);
                 if (series.current.fan[1]) series.current.fan[1].setData(p50Data);
                 if (series.current.fan[2]) series.current.fan[2].setData(p90Data);
             }
             
             // Add rebalancing markers to boundary curve
             if (rebalancingPoints && rebalancingPoints.length > 0 && series.current.boundaryCurve) {
                 const markers = rebalancingPoints.map(pt => {
                     const date = futureDates[pt.t];
                     if (!date) return null;
                     // Ensure date is a string or compatible type for markers
                     return {
                         time: date,
                         position: 'aboveBar',
                         color: pt.type === 'bullish' ? '#22c55e' : '#f43f5e',
                         shape: pt.type === 'bullish' ? 'arrowUp' : 'arrowDown',
                         text: 'REBAL',
                         size: 2
                     };
                 }).filter(m => m !== null);
                 
                 // Sort markers by time (required by lightweight-charts)
                 markers.sort((a, b) => {
                    if (a.time < b.time) return -1;
                    if (a.time > b.time) return 1;
                    return 0;
                 });
    
                 // Ensure boundaryCurve supports markers before calling setMarkers
                 if (series.current.boundaryCurve && series.current.boundaryCurve.setMarkers) {
                    series.current.boundaryCurve.setMarkers(markers);
                 } else {
                    console.warn("boundaryCurve series does not support setMarkers or is undefined");
                 }
             }

             charts.current.main.timeScale().fitContent();
             setLoading(false);
          }
       };
      
       workerRef.current.onerror = (err) => {
         console.error("Worker error:", err);
         setLoading(false);
       };
       workerRef.current.onmessageerror = (err) => {
         console.error("Worker message error:", err);
         setLoading(false);
       };
       const fallbackDate = data.ohlcv[data.ohlcv.length - 1].time;
       const fallbackPrice = data.ohlcv[data.ohlcv.length - 1].close;
       const usedDate = buyDate || fallbackDate;
       const usedPrice = Number(buyPrice || fallbackPrice);

       const elapsedDays = (() => {
         const startIdx = data.ohlcv.findIndex(d => d.time >= usedDate);
         if (startIdx === -1) return data.ohlcv.length - 1;
         return Math.max(1, data.ohlcv.length - 1 - startIdx);
       })();
       const horizonUsed = Math.max(1, elapsedDays);
       setHorizon(horizonUsed);

       // Old duplicate random walk block removed (moved up)

       console.log("Posting message to worker...");
       
       // Calculate returns for bootstrap
       const returns = [];
       for (let i = 1; i < data.ohlcv.length; i++) {
         const ret = (data.ohlcv[i].close - data.ohlcv[i-1].close) / data.ohlcv[i-1].close;
         if (!isNaN(ret)) returns.push(ret);
       }

      // Call the Python Generative Engine
      // We skip the JS worker for now as the heavy lifting is in Python
      runModel({
        ticker: targetTicker,
        buy_date: usedDate,
        horizon: horizonUsed,
        paths: paths,
        risk_aversion: lambda,
        target_pct: targetPct,
        drawdown_pct: drawdownPct
      }).then(res => {
        console.log("Generative Model Results:", res);
        setBackend(res);
        setResults({
           decision: res.decision,
           spot: fallbackPrice,
           boundary: [0], // Deprecated but needed for UI for now
           bands: res.bands,
           rebalancingPoints: []
        });

        // Visualize the "Cone" from Python (bands)
        if (series.current.fan) {
            const futureDates = generateFutureDates(data.lastDate, horizonUsed);
            // Assuming res.bands is [BandPoint, BandPoint...]
            // We need to map p10, p50, p90 to fan lines
            
            // ... Logic to map bands to charts similar to previous worker ...
            // Simplified for now: just update loading
            setLoading(false);
        }
        
      }).catch(err => {
        console.error("Generative Engine Failed:", err);
        setLoading(false);
      });

    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  }, [ticker, riskFree, yieldRate, volMode, manualVol, volWindow, horizon, paths, seed, cost, basis, objective, lambda]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (ticker && ticker.length >= 2) {
        const results = await searchTicker(ticker);
        setSuggestions(results);
        
        // Only show suggestions if the current ticker is NOT an exact match to the top result
        // This prevents the dropdown from reopening immediately after selection
        if (results.length > 0 && results[0].symbol !== ticker) {
            setShowSuggestions(true);
        }
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [ticker]);

  useEffect(() => {
    if (!mainChartRef.current) return;

    const theme = {
      ...CONFIG.CHART_THEME,
      layout: {
        background: { color: 'transparent' },
        textColor: '#64748b',
        fontSize: 10,
        fontFamily: 'Inter',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
      },
      localization: { priceFormatter: p => `${currency}${p.toLocaleString(undefined, {minimumFractionDigits: 2})}` }
    };

    charts.current.main = createChart(mainChartRef.current, { ...theme, height: 450 });
    
    // Initialize Fan Series first so they are behind candles
    // Using AreaSeries for the outer bands to create a filled effect ("fan")
    // 0.1 and 0.9 will be the edges of the fan. 0.5 is the median path.
    series.current.fan = [
        // 0: Lower band (10th percentile)
        charts.current.main.addSeries(LineSeries, {
            color: 'rgba(99, 102, 241, 0.2)',
            lineWidth: 1,
            lineStyle: 2
        }),
        // 1: Median band (50th percentile)
        charts.current.main.addSeries(LineSeries, {
            color: '#6366f1',
            lineWidth: 2,
            lineStyle: 0
        }),
        // 2: Upper band (90th percentile)
        charts.current.main.addSeries(LineSeries, {
            color: 'rgba(99, 102, 241, 0.2)',
            lineWidth: 1,
            lineStyle: 2
        })
    ];

    series.current.boundaryCurve = charts.current.main.addSeries(LineSeries, {
        color: '#f43f5e',
        lineWidth: 3,
        lineStyle: 0,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 6,
        crosshairMarkerBorderColor: '#ffffff',
        crosshairMarkerBackgroundColor: '#f43f5e',
    });

    series.current.candles = charts.current.main.addSeries(CandlestickSeries, {
        upColor: '#10b981',
        downColor: '#f43f5e',
        borderVisible: false,
        wickUpColor: '#10b981',
        wickDownColor: '#f43f5e',
    });
    series.current.ma50 = charts.current.main.addSeries(LineSeries, { color: '#6366f1', lineWidth: 1, visible: false });
    series.current.ma200 = charts.current.main.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 1, visible: false });
    series.current.boundaryToday = charts.current.main.addSeries(LineSeries, { color: '#f43f5e', lineWidth: 2, lineStyle: 2 });
    // Realized line color will be updated dynamically based on PnL but init as neutral
    series.current.realizedLine = charts.current.main.addSeries(LineSeries, { color: '#38bdf8', lineWidth: 3 });
    series.current.buyLine = charts.current.main.addSeries(LineSeries, { color: '#22c55e', lineWidth: 2, lineStyle: 1, lineType: 1 });
    series.current.targetLine = charts.current.main.addSeries(LineSeries, { color: '#6366f1', lineWidth: 1, lineStyle: 2 });
    series.current.stopLine = charts.current.main.addSeries(LineSeries, { color: '#f97316', lineWidth: 1, lineStyle: 2 });

    const handleResize = () => {
      Object.values(charts.current).forEach(c => {
        if (c && c.container) c.applyOptions({ width: c.container().clientWidth });
      });
    };
    window.addEventListener('resize', handleResize);

    if (!hasLoadedRef.current) {
        hasLoadedRef.current = true;
        handleRun('HDFCBANK.NS');
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      // Do not remove the chart instance on cleanup if we want to persist it,
      // but here we are recreating it on every dependency change.
      // Better to just remove it to avoid leaks.
      Object.values(charts.current).forEach(c => c.remove());
      charts.current = {}; // Clear the ref
    };
    // Removed handleRun from dependencies to prevent chart re-creation loops
  }, [currency]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-300 flex font-sans selection:bg-indigo-500/30 overflow-x-hidden">
      {/* Sidebar - Desktop Only */}
      <aside className="hidden lg:flex flex-col w-20 bg-slate-900 border-r border-white/5 items-center py-8 gap-10 sticky top-0 h-[100dvh] z-50 shadow-2xl overflow-y-auto scrollbar-hide">
        <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-2xl shadow-indigo-600/30">
          <Zap className="text-white w-7 h-7 fill-current" />
        </div>
        <nav className="flex flex-col gap-8">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-slate-500 hover:bg-white/5 hover:text-white transition-all cursor-pointer">
            <LayoutDashboard className="w-6 h-6" />
          </div>
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 shadow-inner">
            <BarChart2 className="w-6 h-6" />
          </div>
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-slate-500 hover:bg-white/5 hover:text-white transition-all cursor-pointer">
            <Globe className="w-6 h-6" />
          </div>
        </nav>
      </aside>

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen bg-slate-950">
        {/* Header */}
        <header className="h-20 border-b border-white/5 bg-slate-950/90 backdrop-blur-2xl sticky top-0 z-[45] flex items-center px-6 lg:px-10">
          <div className="flex-1 flex items-center justify-between">
            <div className="flex items-center gap-4 lg:gap-6">
              <button 
                className="lg:hidden p-2 text-slate-400 hover:text-white"
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              >
                <Menu className="w-6 h-6" />
              </button>
              <div className="flex flex-col">
                  <h1 className="text-sm md:text-base font-black text-white tracking-[0.2em] uppercase flex items-center gap-2">
                    <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                    QuantPro <span className="text-indigo-500">v2.0</span>
                  </h1>
                  <span className="text-[10px] text-slate-500 font-bold tracking-widest uppercase mt-0.5 hidden sm:inline">Lsmc dynamic terminal</span>
              </div>
            </div>
            
            <div className="hidden sm:flex items-center gap-6 lg:gap-8">
              <div className="flex flex-col items-end">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Global Status</span>
                  <div className="flex items-center gap-2">
                    <Globe className="w-3.5 h-3.5 text-indigo-400" />
                    <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">{status.source || 'SCANNING'}</span>
                  </div>
              </div>
              <div className="flex flex-col items-end">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Market Update</span>
                  <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-indigo-400" />
                    <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">{status.date || '--'}</span>
                  </div>
              </div>
            </div>
          </div>
        </header>

        <main className="p-4 sm:p-6 lg:p-10 space-y-6 lg:space-y-10 max-w-[1920px] mx-auto w-full">
          {/* Action Row */}
          <section className="flex flex-col gap-6 lg:gap-8">
            <div className="w-full">
              <div className="relative group">
               <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500/20 to-blue-500/20 rounded-2xl blur-lg opacity-0 group-focus-within:opacity-100 transition duration-500"></div>
                <div className="relative flex flex-col md:flex-row gap-4 bg-slate-900 border border-indigo-500/20 rounded-2xl p-2.5 shadow-xl">
                  <div className="relative flex-1 flex items-center min-w-0">
                  <Search className="absolute left-4 w-5 h-5 text-slate-500" />
                  <input
                    type="text"
                    placeholder="ENTER TICKER..."
                    className="w-full bg-transparent border-none py-4 pl-12 pr-4 text-white text-sm md:text-base font-bold placeholder:text-slate-600 focus:ring-0 focus:outline-none uppercase relative z-10"
                    value={ticker}
                    onChange={e => {
                      const val = e.target.value.toUpperCase();
                      setTicker(val);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        handleRun();
                        setShowSuggestions(false);
                      }
                    }}
                    onFocus={() => ticker.length >= 2 && setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                  />
                  {ticker && (
                     <button
                       onClick={() => {
                         setTicker('');
                         setShowSuggestions(false);
                       }}
                       className="absolute right-4 text-slate-500 hover:text-white"
                     >
                       <X className="w-4 h-4" />
                     </button>
                  )}
                  
                  {/* Suggestions Dropdown */}
                  {showSuggestions && suggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-2 bg-slate-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden z-[60] max-h-[300px] overflow-y-auto">
                      {suggestions.map((s, i) => (
                        <div
                          key={i}
                          className="px-4 py-3 hover:bg-white/5 cursor-pointer border-b border-white/5 last:border-0 flex justify-between items-center group"
                          onClick={() => {
                            setTicker(s.symbol);
                            setShowSuggestions(false);
                            handleRun(s.symbol);
                          }}
                        >
                          <div>
                            <div className="text-white font-bold text-sm">{s.symbol}</div>
                            <div className="text-slate-500 text-xs font-medium uppercase tracking-wider">{s.shortname}</div>
                          </div>
                          <div className="text-[10px] font-black text-slate-600 uppercase tracking-widest bg-slate-950 px-2 py-1 rounded-lg group-hover:text-indigo-400 transition-colors">
                            {s.exchDisp}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                  <button
                     onClick={() => handleRun()}
                     disabled={loading}
                     className="md:w-64 bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 disabled:from-slate-800 disabled:to-slate-800 text-white font-black uppercase tracking-widest text-[11px] md:text-xs py-4 px-8 rounded-xl transition-all flex items-center justify-center gap-3 shadow-2xl shadow-indigo-600/40 active:scale-95"
                   >
                     {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                     <span>{loading ? 'ANALYZING...' : 'RUN ADVANCED SIMULATION'}</span>
                   </button>
                 </div>
                 <div className="mt-2 text-[11px] text-slate-500 font-semibold uppercase tracking-widest flex items-center gap-2">
                   <span className="w-2 h-2 bg-indigo-500 rounded-full"></span>
                   LSMC + Monte Carlo Fan + Bootstrap Risk Engine
                 </div>
               </div>
             </div>

            <div className="bg-slate-900/80 border border-white/5 rounded-2xl shadow-lg w-full overflow-hidden transition-all duration-500 ease-in-out">
              <button
                onClick={(e) => {
                  const content = document.getElementById('advanced-controls-content');
                  const icon = document.getElementById('advanced-chevron');
                  const isHidden = content.classList.contains('max-h-0');
                  
                  if (isHidden) {
                    content.classList.remove('max-h-0', 'opacity-0', 'pb-0');
                    content.classList.add('max-h-[500px]', 'opacity-100', 'pb-4');
                    icon.style.transform = 'rotate(180deg)';
                  } else {
                    content.classList.add('max-h-0', 'opacity-0', 'pb-0');
                    content.classList.remove('max-h-[500px]', 'opacity-100', 'pb-4');
                    icon.style.transform = 'rotate(0deg)';
                  }
                }}
                className="w-full p-4 cursor-pointer text-[11px] font-black text-slate-300 uppercase tracking-widest flex items-center justify-between outline-none hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full"></div>
                  Advanced Configuration
                </div>
                <div id="advanced-chevron" className="transition-transform duration-300 text-slate-500">
                  <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              </button>
              
              <div id="advanced-controls-content" className="max-h-0 opacity-0 px-4 transition-all duration-500 ease-in-out overflow-hidden w-full">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 pb-4 w-full">
                  {[{ label: 'Horizon', value: horizon, set: setHorizon, suffix: 'D' },
                    { label: 'Risk Free', value: riskFree, set: setRiskFree, suffix: '%' },
                    { label: 'Paths', value: paths, set: setPaths, isSelect: true, options: [1000, 5000, 15000] },
                    { label: 'Volatility', value: volMode, set: setVolMode, isSelect: true, options: ['rolling', 'manual'] },
                  ].map((ctrl, i) => (
                    <div key={i} className="bg-slate-950/40 border border-white/5 rounded-xl p-3 space-y-1.5 min-w-[120px] hover:border-indigo-500/20 transition-colors">
                      <span className="block text-[9px] font-black text-slate-500 uppercase tracking-widest">{ctrl.label}</span>
                      {ctrl.isSelect ? (
                        <select
                          className="w-full bg-transparent text-white text-xs font-bold border-none p-0 focus:ring-0 cursor-pointer uppercase appearance-none"
                          value={ctrl.value} onChange={e => ctrl.set(e.target.value)}
                        >
                          {ctrl.options.map(opt => <option key={opt} value={opt} className="bg-slate-900">{opt === 1000 ? '1K' : opt === 5000 ? '5K' : opt === 15000 ? '15K' : opt.toString().toUpperCase()}</option>)}
                        </select>
                      ) : (
                        <div className="flex items-center gap-2">
                          <input
                            type="number" className="w-full bg-transparent text-white text-xs font-bold border-none p-0 focus:ring-0"
                            value={ctrl.value} onChange={e => ctrl.set(+e.target.value)}
                          />
                          <span className="text-[10px] font-black text-slate-600">{ctrl.suffix}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* User Trade Inputs */}
          <section className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-3 gap-4">
            <div className="bg-slate-900 border border-white/5 rounded-2xl p-4 space-y-2 shadow-lg">
              <span className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Buy Date</span>
              <input type="date" className="w-full bg-transparent text-white text-xs font-bold border-none p-0 focus:ring-0"
                value={buyDate} onChange={e => setBuyDate(e.target.value)} />
            </div>
            <div className="bg-slate-900 border border-white/5 rounded-2xl p-4 space-y-2 shadow-lg">
              <span className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Buy Price</span>
              <input type="number" className="w-full bg-transparent text-white text-xs font-bold border-none p-0 focus:ring-0"
                value={buyPrice} onChange={e => setBuyPrice(e.target.value)} />
            </div>
            <div className="bg-slate-900 border border-white/5 rounded-2xl p-4 space-y-2 shadow-lg">
              <span className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Confidence</span>
              <input type="number" min="0" max="1" step="0.01" className="w-full bg-transparent text-white text-xs font-bold border-none p-0 focus:ring-0"
                value={confidence} onChange={e => setConfidence(parseFloat(e.target.value) || 0.9)} />
            </div>
          </section>

          {/* Grid Layout */}
          <section className="grid grid-cols-1 xl:grid-cols-12 gap-6 lg:gap-10">
            {/* Main Charts Column */}
            <div className="xl:col-span-8 space-y-6 lg:space-y-10">
              <div className="bg-slate-900 border border-white/5 rounded-3xl lg:rounded-[2.5rem] overflow-hidden shadow-2xl">
                <div className="px-6 lg:px-10 py-6 lg:py-8 border-b border-white/5 flex flex-col md:flex-row justify-between items-center gap-6">
                  <div className="flex items-center gap-5">
                    <div className="w-10 lg:w-12 h-10 lg:h-12 bg-indigo-500/10 rounded-2xl flex items-center justify-center border border-indigo-500/20">
                      <TrendingUp className="w-5 lg:w-6 h-5 lg:h-6 text-indigo-400" />
                    </div>
                    <div>
                      <h3 className="text-white font-black uppercase tracking-widest text-xs lg:text-sm">Market Intelligence</h3>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Price Action vs LSMC Risk Boundary</p>
                    </div>
                  </div>
                  <div className="flex gap-1 lg:gap-2 p-1 bg-slate-950 rounded-xl lg:rounded-2xl border border-white/5 overflow-x-auto max-w-full">
                    {[30, 365, 1095].map(d => (
                      <button 
                        key={d} 
                        onClick={() => {
                            if (!series.current.candles || ohlcv.length === 0) return;
                            const sub = ohlcv.slice(-d);
                            series.current.candles.setData(sub);
                            charts.current.main.timeScale().fitContent();
                        }}
                        className="whitespace-nowrap px-4 lg:px-6 py-2 lg:py-2.5 text-[9px] lg:text-[10px] font-black rounded-lg lg:rounded-xl text-slate-500 hover:text-white hover:bg-slate-900 transition-all uppercase tracking-widest"
                      >
                        {d === 30 ? '1 Month' : d === 365 ? '1 Year' : 'MAX'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="p-2 sm:p-4 lg:p-8 chart-container">
                  <div ref={mainChartRef} className="h-[400px] lg:h-[520px]"></div>
                </div>
              </div>

            <div className="grid grid-cols-1 gap-6 lg:gap-10">
                <div className="bg-slate-900 border border-white/5 rounded-[2rem] p-6 lg:p-8 shadow-xl">
                  <h4 className="text-[10px] lg:text-[11px] font-black text-white uppercase tracking-[0.3em] mb-4">Decision Boundary</h4>
                  <DecisionBoundaryTab 
                    ce={backend.ce} 
                    message={backend.message} 
                    stats={backend.stats}
                    decision={backend.decision}
                    decisionText={backend.decision_text}
                    buyRanges={backend.buy_ranges}
                  />
                  {backend.luck_score !== null && (
                    <div className="mt-4 text-slate-300 text-sm">
                      Luck Score (percentile vs scenarios): {(backend.luck_score * 100).toFixed(1)}%
                    </div>
                  )}
                  <div className="mt-3 text-xs text-slate-500 space-y-1">
                    <div>• Shows how your entry fared vs simulated paths.</div>
                    <div>• CE compares staying vs switching (benchmark/cash).</div>
                    <div>• Confidence input controls band width for explanations.</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Sidebar Column */}
            <div className="xl:col-span-4 space-y-6 lg:space-y-10">
              <div className={`rounded-3xl lg:rounded-[2.5rem] border p-6 lg:p-10 relative overflow-hidden transition-all duration-1000 ${
                results?.decision === 'SELL' ? 'bg-rose-500/5 border-rose-500/20 shadow-[0_0_80px_-20px_rgba(244,63,94,0.15)]' : 'bg-slate-900 border-white/5 shadow-2xl'
              }`}>
                <div className="relative z-10">
                  <span className="text-[10px] lg:text-[11px] font-black text-slate-500 uppercase tracking-[0.4em]">Engine Verdict</span>
                  <div className="mt-4 flex items-center justify-between">
                    <h2 className={`text-4xl lg:text-6xl font-black tracking-tighter ${
                      results?.decision === 'SELL' ? 'text-rose-500' : (results ? 'text-emerald-500' : 'text-slate-700')
                    }`}>
                      {results?.decision || 'STANDBY'}
                    </h2>
                    <div className={`w-16 lg:w-20 h-16 lg:h-20 rounded-2xl lg:rounded-[2rem] flex items-center justify-center border ${
                      results?.decision === 'SELL' ? 'bg-rose-500/10 border-rose-500/20 text-rose-500' : 'bg-slate-500/5 border-white/5 text-slate-500'
                    }`}>
                      {results?.decision === 'SELL' ? <TrendingDown className="w-8 lg:w-10 h-8 lg:h-10" /> : <ShieldCheck className="w-8 lg:w-10 h-8 lg:h-10" />}
                    </div>
                  </div>

                  <div className="mt-8 lg:mt-12 space-y-3 lg:space-y-4">
                    {[
                      { label: 'Spot Price', value: results?.spot, type: 'currency', icon: CircleDot },
                      { label: 'Gain/Loss', value: results?.spot && entryMeta.price ? ((results.spot - entryMeta.price) / entryMeta.price * 100) : null, type: 'percent', icon: TrendingUp },
                      { label: 'Market Regime', value: backend.decision_text?.split('.')[0] || '---', type: 'text', icon: Activity },
                      { label: 'Realized Rank', value: backend.luck_score !== null ? (backend.luck_score * 100).toFixed(1) + '%' : '--', type: 'text', icon: Zap }
                    ].map((item, i) => (
                      <div key={i} className="flex justify-between items-center p-4 lg:p-6 bg-slate-950/50 rounded-xl lg:rounded-2xl border border-white/5 group hover:border-indigo-500/30 transition-all">
                        <div className="flex items-center gap-3 lg:gap-4">
                          <item.icon className={`w-4 lg:w-5 h-4 lg:h-5 transition-colors ${item.type === 'percent' ? (item.value >= 0 ? 'text-emerald-500' : 'text-rose-500') : 'text-slate-600 group-hover:text-indigo-400'}`} />
                          <span className="text-[10px] lg:text-[11px] font-black text-slate-500 uppercase tracking-widest">{item.label}</span>
                        </div>
                        <span className={`text-lg lg:text-xl font-bold font-mono ${item.type === 'percent' ? (item.value >= 0 ? 'text-emerald-400' : 'text-rose-400') : 'text-white'}`}>
                          {item.type === 'currency'
                            ? `${currency}${item.value?.toLocaleString(undefined, {minimumFractionDigits: 2}) || '--'}`
                            : item.type === 'percent'
                              ? (item.value !== null ? `${item.value > 0 ? '+' : ''}${item.value.toFixed(2)}%` : '--')
                              : item.value}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                    <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
                      <div className="text-emerald-300 font-black uppercase tracking-widest text-[10px]">Entry</div>
                      <div className="text-white font-mono text-lg">{entryMeta.price ? `${currency}${entryMeta.price.toFixed(2)}` : '--'}</div>
                      <div className="text-slate-400">{entryMeta.date || '--'}</div>
                    </div>
                    <div className="p-4 bg-indigo-500/10 border border-indigo-500/30 rounded-xl">
                      <div className="text-indigo-300 font-black uppercase tracking-widest text-[10px]">Target (+{(targetPct*100).toFixed(0)}%)</div>
                      <div className="text-white font-mono text-lg">{entryMeta.price ? `${currency}${(entryMeta.price*(1+targetPct)).toFixed(2)}` : '--'}</div>
                      <div className="text-slate-400">Prob hit: {backend.stats ? `${(backend.stats.prob_target*100).toFixed(1)}%` : '--'}</div>
                    </div>
                    <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl">
                      <div className="text-rose-300 font-black uppercase tracking-widest text-[10px]">Stop (-{(drawdownPct*100).toFixed(0)}%)</div>
                      <div className="text-white font-mono text-lg">{entryMeta.price ? `${currency}${(entryMeta.price*(1-drawdownPct)).toFixed(2)}` : '--'}</div>
                      <div className="text-slate-400">Prob breach: {backend.stats ? `${(backend.stats.prob_drawdown*100).toFixed(1)}%` : '--'}</div>
                    </div>
                  </div>

                  <div className="mt-6 p-6 lg:p-8 bg-white/[0.02] rounded-2xl lg:rounded-3xl border border-white/5">
                    <div className="flex gap-4">
                      <Info className="w-5 lg:w-6 h-5 lg:h-6 text-indigo-400 shrink-0" />
                      <p className="text-[11px] lg:text-xs leading-relaxed text-slate-400 font-medium uppercase tracking-tight">
                        {results 
                          ? (results.decision === 'SELL' 
                            ? 'Critical Breach: Asset price is currently trading below the risk-adjusted LSMC boundary. Strategic position exit is highly recommended to preserve capital.' 
                            : 'Nominal Operations: Current asset performance maintains a structural margin above the dynamic stop-loss curve. Risk parameters remain within expected variance.')
                          : 'Awaiting target identifier. Input a ticker to initialize the LSMC regression engine and generate stochastic risk boundaries.'}
                      </p>
                    </div>
                  </div>
                </div>
                {/* Visual Accent */}
                <div className={`absolute bottom-0 left-0 h-1.5 transition-all duration-1000 ${
                  results?.decision === 'SELL' ? 'bg-rose-500 w-full' : (results ? 'bg-emerald-500 w-full' : 'bg-transparent w-0')
                }`}></div>
              </div>

              {/* Removed System Diagnostics to declutter */}
            </div>
          </section>
        </main>

        <footer className="border-t border-white/5 bg-slate-950 py-8 lg:py-12 px-6 lg:px-10 mt-auto">
          <div className="max-w-[1600px] mx-auto w-full flex flex-col md:flex-row justify-between items-center gap-6 lg:gap-8 opacity-40 hover:opacity-100 transition-opacity">
            <div className="flex flex-wrap justify-center items-center gap-6 lg:gap-10 text-center md:text-left">
              <span className="text-[9px] lg:text-[10px] font-black uppercase tracking-[0.4em] text-white">QuantPro Terminal</span>
              <div className="hidden md:block w-1.5 h-1.5 bg-white/20 rounded-full"></div>
              <span className="text-[9px] lg:text-[10px] font-black uppercase tracking-[0.4em] text-white">Institutional Grade</span>
            </div>
            <div className="flex items-center gap-6">
              <span className="text-[9px] lg:text-[10px] font-black uppercase tracking-[0.4em] text-white">© 2026</span>
              <div className="flex gap-2 items-center">
                <div className="w-2 lg:w-2.5 h-2 lg:h-2.5 rounded-full bg-emerald-500"></div>
                <span className="text-[9px] lg:text-[10px] font-black uppercase tracking-widest text-emerald-500">Systems Operational</span>
              </div>
            </div>
          </div>
        </footer>
      </div>

      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-md z-[60] flex flex-col p-10 lg:hidden animate-in fade-in slide-in-from-left duration-300">
          <button 
            className="self-end p-2 text-slate-400 hover:text-white transition-colors"
            onClick={() => setIsSidebarOpen(false)}
          >
            <X className="w-10 h-10" />
          </button>
          <div className="mt-16 flex flex-col gap-12 items-center">
            <div className="w-20 h-20 bg-indigo-600 rounded-3xl flex items-center justify-center shadow-2xl shadow-indigo-600/40">
              <Zap className="text-white w-10 h-10 fill-current" />
            </div>
            <nav className="flex flex-col gap-8 text-center">
              <span className="text-2xl font-black text-white uppercase tracking-[0.2em] cursor-pointer">Dashboard</span>
              <span className="text-2xl font-black text-slate-500 uppercase tracking-[0.2em] hover:text-white transition-colors cursor-pointer">Markets</span>
              <span className="text-2xl font-black text-slate-500 uppercase tracking-[0.2em] hover:text-white transition-colors cursor-pointer">Reports</span>
              <span className="text-2xl font-black text-slate-500 uppercase tracking-[0.2em] hover:text-white transition-colors cursor-pointer">Settings</span>
            </nav>
          </div>
        </div>
      )}

      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 bg-slate-950/98 backdrop-blur-xl z-[100] flex flex-col items-center justify-center gap-8 lg:gap-12 animate-in fade-in duration-300">
            <div className="relative">
                <div className="w-24 lg:w-32 h-24 lg:h-32 border-2 border-indigo-500/10 rounded-full flex items-center justify-center">
                    <div className="w-20 lg:w-28 h-20 lg:h-28 border-t-4 border-indigo-500 rounded-full animate-spin"></div>
                </div>
                <Zap className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 lg:w-10 h-8 lg:h-10 text-indigo-500 fill-current animate-pulse" />
            </div>
            <div className="text-center space-y-4 px-6">
                <h3 className="text-base lg:text-lg font-black text-white uppercase tracking-[0.5em] animate-pulse">{loadingText}</h3>
                <div className="flex items-center gap-3 justify-center">
                  <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                  <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                  <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"></div>
                </div>
                <p className="text-[10px] text-slate-600 font-bold uppercase tracking-[0.3em]">Calibrating Monte Carlo Engine...</p>
            </div>
        </div>
      )}
    </div>
  );
}
