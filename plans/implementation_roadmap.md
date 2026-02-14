# Implementation Roadmap

## Phase 1: Python Backend Core (Day 1-2)
**Goal:** Establish the new `GenerativeMarketModel` engine.

1.  **Dependencies:** Add `filterpy`, `hmmlearn`, `scipy` to `server/requirements.txt`.
2.  **State Space Model (`server/services/generative/ssm.py`):**
    *   Implement `KalmanFilter` class to extract Latent Trend ($\mu_t$) and Volatility ($\sigma_t$).
    *   Implement "Event Impulse" detection (outliers in residuals).
3.  **Regime Switching (`server/services/generative/regime.py`):**
    *   Implement `RegimeDetector` using `hmmlearn`.
    *   Define 3 states: Low Vol/Bull, High Vol/Bear, Crisis.
4.  **Generative Engine (`server/services/generative/engine.py`):**
    *   Create `generate_paths()` that uses the current Regime + SSM state to project forward.
    *   Implement "Ex-Ante" simulation (rewinding to `buy_date`).
5.  **API Integration (`server/services/engine.py`):**
    *   Replace the old `bootstrap_paths` logic with the new `GenerativeEngine`.
    *   Calculate `LuckScore` (Realized vs. Ex-Ante Dist).
    *   Calculate `Verdict` (Optimal Stopping logic).

## Phase 2: React Frontend Visualization (Day 3)
**Goal:** Visualize the "Cone" and "Verdict".

1.  **API Client (`src/api/client.js`):**
    *   Ensure `runModel` correctly calls the Python backend (currently it mocks or uses local JS). *Correction: We must ensure the frontend actually calls the Python API.*
2.  **Visualization Components:**
    *   **`GenerativeChart.jsx`:** A new Recharts/D3 component.
        *   Layer 1: Historical Price (Solid Line).
        *   Layer 2: "The Cone" (Shaded Area starting from `buy_date`).
        *   Layer 3: "Regime Background" (Color-coded vertical bands: Green=Bull, Red=Bear).
3.  **Verdict Card (`src/components/Verdict.jsx`):**
    *   Display the "Simple English" conclusion.
    *   "Luck Gauge": A linear meter showing where the user sits in the distribution.

## Phase 3: Integration & Tuning (Day 4)
**Goal:** Connect the dots and refine the math.

1.  **Calibration:** Tune the HMM transition matrices so they don't flip-flop too often.
2.  **Testing:** Run against known "Lucky" (e.g., NVDA 2023) and "Unlucky" (e.g., PYPL 2022) scenarios to verify the Verdict makes sense.
3.  **Cleanup:** Remove old `monteCarlo.js` and `bootstrap.js` if fully superseded.

## Phase 4: Final Polish
1.  **UI Polish:** Add tooltips explaining "Regime" and "Luck".
2.  **Performance:** Ensure the Python backend responds within <3 seconds (caching HMM training if needed).
