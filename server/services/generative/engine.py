import numpy as np
import pandas as pd
from scipy.stats import norm
from typing import List, Dict, Tuple, Optional

# Import our new components
from server.services.generative.ssm import StateSpaceModel
from server.services.generative.regime import RegimeDetector

class GenerativeEngine:
    """
    Orchestrates the Generative Market Model.
    1. Fits SSM to get latent trend/vol.
    2. Fits HMM to detect regimes.
    3. Simulates future paths (or ex-ante past paths) using Regime-Switching Random Walk.
    """
    def __init__(self, n_paths: int = 1000, horizon: int = 252):
        self.n_paths = n_paths
        self.horizon = horizon
        self.ssm = StateSpaceModel()
        self.regime_detector = RegimeDetector()
        
    def fit(self, prices: pd.Series):
        """
        Calibrates the engine to the provided price history.
        """
        # 1. Kalman Filter for Latent State
        log_prices = np.log(prices)
        self.ssm_states = self.ssm.fit(log_prices)
        
        # 2. HMM for Regimes
        returns = prices.pct_change().dropna()
        self.regime_detector.fit(returns)
        self.current_regime = self.regime_detector.predict_regime(returns).iloc[-1]
        
        # Store for simulation
        self.last_price = prices.iloc[-1]
        self.last_trend = self.ssm_states['trend'].iloc[-1]
        self.last_velocity = self.ssm_states['velocity'].iloc[-1]
        self.resid_std = self.ssm_states['residual'].std()

    def generate_paths(self, start_price: float, n_days: int, regime_override: str = None) -> np.ndarray:
        """
        Generates N_PATHS x N_DAYS price matrix.
        Uses a simplified Regime-Switching Geometric Brownian Motion.
        """
        # Get params for current regime (or override)
        # Note: In a full implementation, we'd simulate regime transitions day-by-day.
        # For v1, we'll assume the starting regime persists or slowly decays to mean.
        
        # Simplified: Use the SSM's last velocity as the 'drift' center, 
        # but modulated by the Regime's volatility character.
        
        # Base Drift (from Kalman)
        mu = self.last_velocity 
        
        # Volatility (from Regime + Residuals)
        # We blend the regime's vol with the recent residual vol
        # For now, let's use the recent residual vol scaled by a regime factor
        regime_factor = 1.0
        if "High Vol" in str(self.current_regime): regime_factor = 1.5
        elif "Crisis" in str(self.current_regime): regime_factor = 3.0
        
        sigma = self.resid_std * regime_factor
        
        dt = 1/252
        
        # Vectorized Simulation
        # dS/S = mu*dt + sigma*dW
        # S_t = S_0 * exp( (mu - 0.5*sigma^2)*t + sigma*W_t )
        
        # Random shocks
        Z = np.random.normal(0, 1, size=(self.n_paths, n_days))
        
        # Cumulative returns
        drift_term = (mu - 0.5 * sigma**2) * dt
        diffusion_term = sigma * np.sqrt(dt) * Z
        
        log_ret = drift_term + diffusion_term
        cum_log_ret = np.cumsum(log_ret, axis=1)
        
        paths = start_price * np.exp(cum_log_ret)
        
        # Insert start price at t=0
        paths = np.hstack([np.full((self.n_paths, 1), start_price), paths])
        
        return paths

    def run_ex_ante_analysis(self, full_history: pd.Series, buy_date: str, buy_price: float, current_price: float) -> Dict:
        """
        The "Luck vs Skill" Engine.
        1. Rewinds to `buy_date`.
        2. Fits model on data UP TO `buy_date`.
        3. Simulates forward to Today.
        4. Compares Actual Path vs Simulated Cone.
        """
        # Slice data
        history_pre_buy = full_history[full_history.index <= buy_date]
        if len(history_pre_buy) < 252:
            return {"error": "Not enough history before buy date to calibrate."}
        
        # Fit on past data ONLY (No lookahead bias)
        self.fit(history_pre_buy)
        
        # Days elapsed
        days_elapsed = (pd.to_datetime(full_history.index[-1]) - pd.to_datetime(buy_date)).days
        trading_days_elapsed = len(full_history[full_history.index > buy_date])
        
        if trading_days_elapsed < 1:
            return {"status": "Too soon to tell"}

        # Simulate
        paths = self.generate_paths(start_price=buy_price, n_days=trading_days_elapsed)
        final_sim_prices = paths[:, -1]
        
        # Calculate Luck Score (Percentile)
        # 0.99 = You did better than 99% of paths (Very Lucky/Skilled)
        # 0.01 = You did worse than 99% of paths (Very Unlucky)
        luck_score = (final_sim_prices < current_price).mean()
        
        # Calculate Verdict (Certainty Equivalent)
        # Utility U(W) = E[W] - lambda * Var[W]
        # Compare Holding (Simulated Future) vs Selling (Cash Now)
        
        # Project forward from TODAY (for "Stay vs Go" decision)
        # We need to re-fit to TODAY's data for the forward projection
        self.fit(full_history) # Now fit full history
        forward_paths = self.generate_paths(start_price=current_price, n_days=60) # 3 month view
        final_forward_prices = forward_paths[:, -1]
        
        expected_wealth = np.mean(final_forward_prices)
        risk_wealth = np.std(final_forward_prices)
        
        # Risk Aversion (lambda). 0.5 is moderate.
        risk_aversion = 0.5 
        
        # Certainty Equivalent of Holding
        ce_hold = expected_wealth - (risk_aversion * risk_wealth)
        
        # Certainty Equivalent of Selling (Risk Free Cash)
        # Assume 5% risk free rate annually
        rf_daily = 0.05 / 252
        ce_sell = current_price * (1 + rf_daily * 60)
        
        verdict = "HOLD" if ce_hold > ce_sell else "SELL"
        
        return {
            "luck_score": luck_score,
            "verdict": verdict,
            "ce_hold": ce_hold,
            "ce_sell": ce_sell,
            "regime": self.current_regime,
            "paths": paths.tolist()[:50] # Send first 50 paths for viz
        }
