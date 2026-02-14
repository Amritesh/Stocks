import numpy as np
import pandas as pd
from hmmlearn.hmm import GaussianHMM
from typing import Dict, Tuple

class RegimeDetector:
    """
    Detects market regimes (Low Vol/Bull, High Vol/Bear, Crisis) using
    Hidden Markov Models on returns and realized volatility.
    """
    def __init__(self, n_components: int = 3, covariance_type: str = "full"):
        self.model = GaussianHMM(
            n_components=n_components, 
            covariance_type=covariance_type, 
            n_iter=100,
            random_state=42
        )
        self.n_components = n_components
        self.state_map = {} # Maps internal state ID to 'Bull', 'Bear', 'Crisis'

    def prepare_features(self, returns: pd.Series) -> np.ndarray:
        """
        Engineers features for HMM:
        1. Log Returns
        2. Realized Volatility (rolling std)
        """
        # Feature 1: Returns (scaled to avoid numerical issues)
        feat_ret = returns.values.reshape(-1, 1) * 100
        
        # Feature 2: Volatility (5-day rolling, scaled)
        vol = returns.rolling(window=5).std().fillna(method='bfill')
        feat_vol = vol.values.reshape(-1, 1) * 100
        
        return np.hstack([feat_ret, feat_vol])

    def fit(self, returns: pd.Series):
        """
        Fits the HMM and interprets the hidden states.
        """
        X = self.prepare_features(returns)
        self.model.fit(X)
        
        # Interpret states based on Volatility (column 1 of means)
        # Sort states by volatility: Low Vol -> Bull, Med Vol -> Bear, High Vol -> Crisis
        # Note: This is a simplification. Often Bull is High Return / Low Vol.
        
        means = self.model.means_
        # Sort indices by volatility (second feature)
        sorted_indices = np.argsort(means[:, 1])
        
        self.state_map = {
            sorted_indices[0]: "Low Vol / Bull",
            sorted_indices[1]: "High Vol / Bear",
            sorted_indices[2]: "Crisis" 
        }
        
        # If n_components > 3, handle mapping appropriately or stick to 3
        if self.n_components > 3:
             for i in range(3, self.n_components):
                 self.state_map[sorted_indices[i]] = f"State {i}"

    def predict_regime(self, returns: pd.Series) -> pd.Series:
        """
        Returns the sequence of regimes for the input data.
        """
        X = self.prepare_features(returns)
        hidden_states = self.model.predict(X)
        
        return pd.Series(
            [self.state_map.get(s, f"State {s}") for s in hidden_states],
            index=returns.index
        )
    
    def get_current_regime_params(self, current_regime_label: str) -> Dict:
        """
        Returns the Mean and Covariance for the specified regime label.
        Used for generating future paths.
        """
        # Reverse map label to ID
        state_id = next((k for k, v in self.state_map.items() if v == current_regime_label), None)
        
        if state_id is None:
            raise ValueError(f"Unknown regime: {current_regime_label}")
            
        mu = self.model.means_[state_id]
        cov = self.model.covars_[state_id]
        
        return {
            'mu_return': mu[0] / 100, # Unscale
            'mu_vol': mu[1] / 100,
            'cov': cov / 10000 # Unscale variance (approx)
        }

    def get_transition_matrix(self) -> np.ndarray:
        return self.model.transmat_
