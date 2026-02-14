import numpy as np
import pandas as pd
from filterpy.kalman import KalmanFilter
from typing import Tuple, Dict

class StateSpaceModel:
    """
    Implements a Local Linear Trend Model using Kalman Filter to extract 
    latent trend (mu) and velocity (beta) from noisy price data.
    """
    def __init__(self, process_noise: float = 1e-4, measurement_noise: float = 1e-3):
        self.kf = KalmanFilter(dim_x=2, dim_z=1)
        
        # State Transition Matrix (F)
        # x_t+1 = F * x_t + w_t
        # [mu_t+1  ] = [1  1] * [mu_t  ] + w_t
        # [beta_t+1]   [0  1]   [beta_t]
        self.kf.F = np.array([[1., 1.],
                              [0., 1.]])
        
        # Measurement Function (H)
        # z_t = H * x_t + v_t
        # Price_t = [1  0] * [mu_t, beta_t] + v_t
        self.kf.H = np.array([[1., 0.]])
        
        # Covariance Matrices
        self.kf.P *= 10.  # Initial uncertainty
        self.kf.R = np.array([[measurement_noise]]) # Measurement noise
        self.kf.Q = np.array([[process_noise, 0.],  # Process noise
                              [0., process_noise]])

    def fit(self, prices: pd.Series) -> pd.DataFrame:
        """
        Fits the Kalman Filter to the price series and returns latent states.
        
        Args:
            prices: A pandas Series of log-prices (or prices).
            
        Returns:
            DataFrame with 'trend', 'velocity', 'residual'
        """
        # Initialize state with first observation
        self.kf.x = np.array([prices.iloc[0], 0.])
        
        trends = []
        velocities = []
        residuals = []
        
        for p in prices:
            self.kf.predict()
            self.kf.update(p)
            
            trends.append(self.kf.x[0])
            velocities.append(self.kf.x[1])
            residuals.append(self.kf.y[0][0]) # Innovation/residual
            
        return pd.DataFrame({
            'trend': trends,
            'velocity': velocities,
            'residual': residuals
        }, index=prices.index)

    def extract_features(self, df: pd.DataFrame) -> Dict[str, float]:
        """
        Returns key metrics from the latest state.
        """
        last_trend = df['trend'].iloc[-1]
        last_velocity = df['velocity'].iloc[-1]
        
        # Calculate recent volatility of residuals
        resid_vol = df['residual'].rolling(window=20).std().iloc[-1]
        
        return {
            'mu': last_trend,
            'beta': last_velocity,
            'sigma_resid': resid_vol
        }
