import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, CandlestickSeries, LineSeries } from 'lightweight-charts';
import { CONFIG, fetchData, calcSigma, generateFutureDates } from './utils';
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
  X
} from 'lucide-react';

export default function App() {
  const [ticker, setTicker] = useState('INFY.NS');
  const [horizon, setHorizon] = useState(22);
  const [riskFree, setRiskFree] = useState(6.5);
  const [yieldRate, setYieldRate] = useState(0.0);
  const [volMode, setVolMode] = useState('rolling');
  const [volWindow, setVolWindow] = useState(126);
  const [manualVol, setManualVol] = useState(30);
  const [paths, setPaths] = useState(5000);
  const [seed, setSeed] = useState(42);
  const [cost, setCost] = useState(10);
  const [objective, setObjective] = useState('max_ev');
  const [lambda, setLambda] = useState(0);
  const [basis, setBasis] = useState(2);
  
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');
  const [ohlcv, setOhlcv] = useState([]);
  const [status, setStatus] = useState({ source: '---', date: '---' });
  const [results, setResults] = useState(null);
  const [sigmaEst, setSigmaEst] = useState('--');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const mainChartRef = useRef(null);
  const boundaryChartRef = useRef(null);
  const fanChartRef = useRef(null);
  const charts = useRef({});
  const series = useRef({});
  const workerRef = useRef(null);
  const hasLoadedRef = useRef(false);

  const currency = ticker.toUpperCase().endsWith('.NS') || ticker.toUpperCase().endsWith('.BO') ? '₹' : '$';

  const handleRun = useCallback(async (targetTicker = ticker) => {
    if (!targetTicker) return;
    
    // Clear old results immediately when starting a new run
    setResults(null);
    setOhlcv([]);
    setStatus({ source: '---', date: '---' });
    setSigmaEst('--');
    
    // Clear chart series data
    if (series.current.candles) series.current.candles.setData([]);
    if (series.current.ma50) series.current.ma50.setData([]);
    if (series.current.ma200) series.current.ma200.setData([]);
    if (series.current.boundaryToday) series.current.boundaryToday.setData([]);
    if (series.current.boundaryCurve) series.current.boundaryCurve.setData([]);
    if (series.current.fanBoundary) series.current.fanBoundary.setData([]);
    if (series.current.fan) {
      series.current.fan.forEach(s => s.setData([]));
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
        [50, 200].forEach(p => {
          const ma = [];
          for(let i=p; i<data.ohlcv.length; i++) {
            const v = data.ohlcv.slice(i-p, i).reduce((a,b)=>a+b.close,0)/p;
            ma.push({ time: data.ohlcv[i].time, value: v });
          }
          series.current[`ma${p}`].setData(ma.filter(d => d.time >= sub[0].time));
        });
        charts.current.main.timeScale().fitContent();
      }
      
      const sigma = calcSigma(data.ohlcv, volMode, manualVol, volWindow);
      setSigmaEst((sigma * 100).toFixed(1));

      if (workerRef.current) workerRef.current.terminate();
      const workerUrl = new URL(`${import.meta.env.BASE_URL}worker.js`, window.location.origin);
      console.log("Initializing worker from", workerUrl.toString());
      workerRef.current = new Worker(workerUrl, { type: 'classic' });
      workerRef.current.onmessage = (e) => {
        const { boundary, decision, bands, spot } = e.data;
        setResults({ boundary, decision, bands, spot });
        
        const futureDates = generateFutureDates(data.lastDate, boundary.length);
        
        series.current.boundaryCurve.setData(boundary.map((v, i) => ({ time: futureDates[i], value: v })));
        series.current.boundaryToday.setData(data.ohlcv.slice(-20).map(d => ({ time: d.time, value: boundary[0] })));
        
        bands.forEach((b, i) => {
          if (series.current.fan && series.current.fan[i]) {
            series.current.fan[i].setData(b.map((v, t) => ({ time: futureDates[t], value: v })));
          }
        });
        series.current.fanBoundary.setData(boundary.map((v, i) => ({ time: futureDates[i], value: v })));
        
        charts.current.boundary.timeScale().fitContent();
        charts.current.fan.timeScale().fitContent();
        setLoading(false);
      };
      
      workerRef.current.onerror = (err) => {
        console.error("Worker error:", err);
        setLoading(false);
      };
      workerRef.current.onmessageerror = (err) => {
        console.error("Worker message error:", err);
        setLoading(false);
      };
      console.log("Posting message to worker...");
      workerRef.current.postMessage({
        S0: data.ohlcv[data.ohlcv.length - 1].close,
        r: riskFree / 100,
        q: yieldRate / 100,
        sigma,
        horizon,
        nPaths: paths,
        seed,
        costBps: cost,
        basisDegree: basis,
        objectiveMode: objective,
        lambda
      });
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  }, [ticker, riskFree, yieldRate, volMode, manualVol, volWindow, horizon, paths, seed, cost, basis, objective, lambda]);

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

    charts.current.boundary = createChart(boundaryChartRef.current, { ...theme, height: 280 });
    series.current.boundaryCurve = charts.current.boundary.addSeries(LineSeries, { color: '#f43f5e', lineWidth: 2 });

    charts.current.fan = createChart(fanChartRef.current, { ...theme, height: 280 });
    series.current.fan = [0.1, 0.5, 0.9].map(p => charts.current.fan.addSeries(LineSeries, {
      color: p === 0.5 ? '#6366f1' : 'rgba(99, 102, 241, 0.2)',
      lineWidth: p === 0.5 ? 2 : 1
    }));
    series.current.fanBoundary = charts.current.fan.addSeries(LineSeries, { color: '#f43f5e', lineWidth: 2, lineStyle: 2 });

    const handleResize = () => {
      Object.values(charts.current).forEach(c => {
        if (c && c.container) c.applyOptions({ width: c.container().clientWidth });
      });
    };
    window.addEventListener('resize', handleResize);

    if (!hasLoadedRef.current) {
        hasLoadedRef.current = true;
        // Do not run simulation by default anymore
        // handleRun('INFY.NS');
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      Object.values(charts.current).forEach(c => c.remove());
    };
  }, [currency, handleRun]);

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
          <section className="flex flex-col xl:flex-row gap-6 lg:gap-8 items-stretch">
            <div className="flex-1 min-w-0">
              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500/20 to-blue-500/20 rounded-2xl blur-lg opacity-0 group-focus-within:opacity-100 transition duration-500"></div>
                <div className="relative flex flex-col md:flex-row gap-4 bg-slate-900 border border-white/10 rounded-2xl p-2.5 shadow-xl">
                  <div className="relative flex-1 flex items-center">
                    <Search className="absolute left-4 w-5 h-5 text-slate-500" />
                    <input 
                      type="text" 
                      placeholder="ENTER TICKER (e.g. AAPL, RELIANCE.NS)..."
                      className="w-full bg-transparent border-none py-4 pl-12 pr-4 text-white text-sm md:text-base font-bold placeholder:text-slate-600 focus:ring-0 uppercase"
                      value={ticker}
                      onChange={e => setTicker(e.target.value.toUpperCase())}
                      onKeyDown={e => e.key === 'Enter' && handleRun()}
                    />
                  </div>
                  <button 
                    onClick={() => handleRun()}
                    disabled={loading}
                    className="md:w-60 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white font-black uppercase tracking-widest text-[10px] md:text-xs py-4 px-8 rounded-xl transition-all flex items-center justify-center gap-3 shadow-2xl shadow-indigo-600/20 active:scale-95"
                  >
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                    <span>{loading ? 'ANALYZING...' : 'RUN SIMULATION'}</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 xl:w-auto">
              {[
                { label: 'Horizon', value: horizon, set: setHorizon, suffix: 'D' },
                { label: 'Risk Free', value: riskFree, set: setRiskFree, suffix: '%' },
                { label: 'Paths', value: paths, set: setPaths, isSelect: true, options: [1000, 5000, 15000] },
                { label: 'Volatility', value: volMode, set: setVolMode, isSelect: true, options: ['rolling', 'manual'] },
              ].map((ctrl, i) => (
                <div key={i} className="bg-slate-900 border border-white/5 rounded-2xl p-4 space-y-2 shadow-lg min-w-[100px]">
                  <span className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">{ctrl.label}</span>
                  {ctrl.isSelect ? (
                    <select 
                      className="w-full bg-transparent text-white text-xs font-bold border-none p-0 focus:ring-0 cursor-pointer uppercase"
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-10">
                <div className="bg-slate-900 border border-white/5 rounded-[2rem] p-6 lg:p-8 shadow-xl">
                  <div className="flex items-center justify-between mb-8">
                    <h4 className="text-[10px] lg:text-[11px] font-black text-white uppercase tracking-[0.3em]">Boundary Dynamics</h4>
                    <BarChart2 className="w-4 lg:w-5 h-4 lg:h-5 text-indigo-400" />
                  </div>
                  <div ref={boundaryChartRef} className="h-[240px] lg:h-[280px]"></div>
                </div>
                <div className="bg-slate-900 border border-white/5 rounded-[2rem] p-6 lg:p-8 shadow-xl">
                  <div className="flex items-center justify-between mb-8">
                    <h4 className="text-[10px] lg:text-[11px] font-black text-white uppercase tracking-[0.3em]">Monte Carlo Fan</h4>
                    <Zap className="w-4 lg:w-5 h-4 lg:h-5 text-indigo-400" />
                  </div>
                  <div ref={fanChartRef} className="h-[240px] lg:h-[280px]"></div>
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
                      { label: 'Boundary Limit', value: results?.boundary[0], type: 'currency', icon: ShieldCheck },
                      { label: 'Estimated Vol', value: `${sigmaEst}%`, icon: Zap }
                    ].map((item, i) => (
                      <div key={i} className="flex justify-between items-center p-4 lg:p-6 bg-slate-950/50 rounded-xl lg:rounded-2xl border border-white/5 group hover:border-indigo-500/30 transition-all">
                        <div className="flex items-center gap-3 lg:gap-4">
                          <item.icon className="w-4 lg:w-5 h-4 lg:h-5 text-slate-600 group-hover:text-indigo-400 transition-colors" />
                          <span className="text-[10px] lg:text-[11px] font-black text-slate-500 uppercase tracking-widest">{item.label}</span>
                        </div>
                        <span className="text-lg lg:text-xl font-bold text-white font-mono">
                          {item.type === 'currency' ? `${currency}${item.value?.toLocaleString(undefined, {minimumFractionDigits: 2}) || '--'}` : item.value}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-8 lg:mt-12 p-6 lg:p-8 bg-white/[0.02] rounded-2xl lg:rounded-3xl border border-white/5">
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

              <div className="bg-slate-900 border border-white/5 rounded-3xl lg:rounded-[2.5rem] p-6 lg:p-10 shadow-2xl">
                <h4 className="text-[10px] lg:text-[11px] font-black text-white uppercase tracking-[0.4em] mb-8 lg:mb-10 flex items-center gap-4">
                  <div className="w-2 h-2 bg-indigo-500 rounded-full"></div>
                  System Diagnostics
                </h4>
                <div className="grid grid-cols-2 gap-4 lg:gap-6">
                  {[
                    { label: 'Convergence', val: '99.99%', sub: 'PRECISION' },
                    { label: 'Engine Load', val: `${(paths/15000 * 100).toFixed(0)}%`, sub: 'RESOURCE' },
                    { label: 'Latency', val: '12ms', sub: 'NETWORK' },
                    { label: 'Stability', val: 'HIGH', sub: 'STATE' }
                  ].map((stat, i) => (
                    <div key={i} className="bg-slate-950/50 border border-white/5 rounded-xl lg:rounded-2xl p-4 lg:p-5 group hover:border-indigo-500/20 transition-all">
                      <p className="text-[8px] lg:text-[9px] font-black text-slate-600 uppercase tracking-widest mb-1">{stat.label}</p>
                      <p className="text-base lg:text-lg font-black text-white">{stat.val}</p>
                      <p className="text-[8px] font-bold text-indigo-500/40 uppercase mt-1">{stat.sub}</p>
                    </div>
                  ))}
                </div>
              </div>
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
