export function DecisionBoundaryTab({ ce, message, stats, decision, decisionText, buyRanges }) {
  if (!ce) return <div className="text-slate-500">Run analysis to view decision boundary.</div>;
  return (
    <div className="space-y-4">
      <div className="text-xs text-slate-400">{message || 'Bootstrap CE vs cash/benchmark'}</div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="bg-slate-900 border border-white/5 rounded-xl p-4">
          <div className="text-slate-500 text-xs">CE Stay</div>
          <div className="text-white text-lg font-bold">{ce.ce_stay.toFixed(4)}</div>
        </div>
        <div className="bg-slate-900 border border-white/5 rounded-xl p-4">
          <div className="text-slate-500 text-xs">CE Switch</div>
          <div className="text-white text-lg font-bold">{ce.ce_switch.toFixed(4)}</div>
        </div>
      </div>
      <div className="text-slate-300 text-sm">Prob(CE_stay &gt; CE_switch): {(ce.prob_ce_stay_gt * 100).toFixed(1)}%</div>
      <div className="text-slate-400 text-xs">Delta CE: {ce.delta_ce.toFixed(4)}</div>

      {stats && (
        <div className="grid grid-cols-2 gap-3 text-xs">
          <StatCard label="Prob Hit Target" value={(stats.prob_target * 100).toFixed(1) + '%'} />
          <StatCard label="Prob Drawdown" value={(stats.prob_drawdown * 100).toFixed(1) + '%'} tone="warn" />
          <StatCard label="VaR 95%" value={(stats.var_95 * 100).toFixed(1) + '%'} tone="warn" />
          <StatCard label="ES 95%" value={(stats.es_95 * 100).toFixed(1) + '%'} tone="warn" />
          <StatCard label="Realized P/L" value={(stats.realized_return * 100).toFixed(1) + '%'} tone={stats.realized_return >= 0 ? 'good' : 'warn'} />
          <StatCard label="Elapsed P/L" value={(stats.realized_elapsed * 100).toFixed(1) + '%'} />
          <StatCard label="Elapsed Percentile" value={(stats.percentile_elapsed * 100).toFixed(1) + '%'} />
          <StatCard label="Elapsed Days" value={stats.elapsed_days} />
          <StatCard label="Spot" value={stats.current_price.toFixed(2)} />
        </div>
      )}

      {decision && (
        <div className={`p-4 rounded-xl border text-sm ${decision === 'EXIT' ? 'border-rose-500/40 bg-rose-500/5 text-rose-100' : decision === 'ADD' ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-100' : decision === 'TRIM' ? 'border-amber-500/40 bg-amber-500/5 text-amber-100' : 'border-slate-700 bg-slate-900 text-slate-200'}`}>
          <div className="text-[11px] uppercase tracking-widest font-black text-slate-400">Decision</div>
          <div className="text-lg font-black">{decision}</div>
          <div className="text-xs text-slate-300 mt-1">{decisionText}</div>
        </div>
      )}

      {buyRanges && buyRanges.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-widest font-black text-slate-400">Suggested Buy Ranges</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            {buyRanges.map((br) => (
              <div key={br.label} className="border border-white/5 rounded-lg p-3 bg-slate-900">
                <div className="text-slate-400 text-[11px] font-black uppercase">{br.label} · {br.tenor}d</div>
                <div className="text-white font-mono text-sm">{br.low.toFixed(2)} — {br.high.toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, tone }) {
  const toneClass = tone === 'warn' ? 'text-amber-300' : tone === 'good' ? 'text-emerald-300' : 'text-white';
  return (
    <div className="bg-slate-900 border border-white/5 rounded-xl p-3 flex flex-col gap-1">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 font-black">{label}</div>
      <div className={`text-sm font-bold ${toneClass}`}>{value}</div>
    </div>
  );
}
