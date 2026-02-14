from datetime import date
from typing import Tuple

import numpy as np
import pandas as pd

from server.schemas import (
    RunRequest,
    RunResponse,
    BandPoint,
    CEComparison,
    HealthMetrics,
    BuyRange,
    RiskStats,
)
from server.services.data_provider.yahoo import YahooPriceProvider
from server.services.features import compute_returns
from server.services.generative.engine import GenerativeEngine


def certainty_equivalent(mean: float, var: float, lam: float) -> float:
    return mean - 0.5 * lam * var


def extract_elapsed(prices_df: pd.DataFrame, buy_date: date, horizon: int):
    try:
        buy_idx = prices_df.index[prices_df["date"] == buy_date][0]
    except IndexError:
        buy_idx = len(prices_df) - 1
    days_elapsed = max(1, len(prices_df) - buy_idx - 1)
    realized_window = prices_df.iloc[buy_idx:buy_idx + days_elapsed + 1]
    return buy_idx, days_elapsed, realized_window


async def run_pipeline(req: RunRequest) -> RunResponse:
    provider = YahooPriceProvider()
    prices_df = await provider.fetch_prices(req.ticker)
    prices_df = prices_df.sort_values("date").reset_index(drop=True)

    # 1. Initialize and Calibrate Generative Engine
    # Note: We fit on the full history to establish the "current regime" for forward projections.
    # The ex-ante analysis inside run_ex_ante_analysis handles the "past data only" requirement separately.
    gen_engine = GenerativeEngine(n_paths=req.paths, horizon=req.horizon)
    
    # 2. Get Data for Engine
    prices_series = prices_df.set_index('date')['close']
    
    # 3. Determine Buy Price/Date
    try:
        buy_px = float(prices_df.loc[prices_df["date"] == req.buy_date, "close"].iloc[0])
    except IndexError:
        buy_px = float(prices_df["close"].iloc[-1])
    
    spot = float(prices_df["close"].iloc[-1])
    
    # 4. Run "Luck vs Skill" Analysis (Ex-Ante)
    # This simulates from buy_date to NOW to see how lucky we were.
    ex_ante_results = gen_engine.run_ex_ante_analysis(
        full_history=prices_series,
        buy_date=req.buy_date,
        buy_price=buy_px,
        current_price=spot
    )
    
    # If ex-ante failed (too recent), provide fallbacks
    luck_score_val = ex_ante_results.get("luck_score", 0.5)
    decision = ex_ante_results.get("verdict", "HOLD")
    regime_label = str(ex_ante_results.get("regime", "Unknown"))
    
    # 5. Run Forward Simulation (Future Outlook)
    # Used for "Cone" visualization
    gen_engine.fit(prices_series) # Ensure fitted to latest
    forward_paths = gen_engine.generate_paths(start_price=spot, n_days=req.horizon)
    
    # 6. Generate Bands for Chart
    bands: list[BandPoint] = []
    step = max(1, req.horizon // 20)
    for h in range(1, req.horizon + 1, step):
        idx = min(h - 1, forward_paths.shape[1] - 1)
        dist = forward_paths[:, idx]
        bands.append(
            BandPoint(
                date=prices_df["date"].iloc[-1], # Placeholder, frontend maps indices to dates
                p10=float(np.quantile(dist, 0.1)),
                p50=float(np.quantile(dist, 0.5)),
                p90=float(np.quantile(dist, 0.9)),
            )
        )
        
    # 7. Construct Response
    # CE comparison is now part of the Generative Engine's verdict logic,
    # but we populate the schema for backward compatibility / frontend display.
    ce = CEComparison(
        ce_stay=float(ex_ante_results.get("ce_hold", 0)),
        ce_switch=float(ex_ante_results.get("ce_sell", 0)),
        prob_ce_stay_gt=0.5, # Placeholder
        delta_ce=float(ex_ante_results.get("ce_hold", 0)) - float(ex_ante_results.get("ce_sell", 0)),
    )
    
    stats = RiskStats(
        prob_target=0.5, # Placeholder or calc from forward_paths
        prob_drawdown=0.5, # Placeholder or calc from forward_paths
        var_95=0.0,
        es_95=0.0,
        realized_return=(spot - buy_px) / buy_px,
        realized_elapsed=0.0,
        percentile_elapsed=luck_score_val, # Use luck score here
        elapsed_days=0,
        current_price=spot,
    )
    
    return RunResponse(
        bands=bands,
        betas=[0.0],
        regimes=[1.0], # Can map regime string to int if needed
        luck_score=luck_score_val,
        ce=ce,
        health=HealthMetrics(coverage=0.9, log_lik=0.0, residual_break_prob=0.0),
        buy_ranges=[], # Can populate using forward_paths if needed
        stats=stats,
        decision=decision,
        decision_text=f"Market Regime: {regime_label}. Luck Score: {(luck_score_val*100):.1f}%.",
        message="Generative Market Model v1",
    )
