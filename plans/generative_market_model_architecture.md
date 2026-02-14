# Generative Market Model Architecture

## 1. Core Philosophy: "Deep Math, Simple Verdict"

The system will transition from a simple geometric Brownian motion (GBM) simulation to a **Generative Market Model (GMM)**. This model treats the market not as a random walk, but as a complex system with "hidden states" (Regimes) and "drivers" (Factors).

The goal is to answer three questions for the user:
1.  **The Past (Luck vs. Skill):** "Was my result due to a good decision or just market noise?"
2.  **The Present (Regime):** "Is the market currently behaving normally, or is it broken?"
3.  **The Future (Optimal Stopping):** "Does the math say I should hold or fold?"

## 2. Mathematical Components

### A. State-Space Model (The "Engine")
Instead of assuming a constant drift and volatility, we model the stock price $P_t$ as an observation of a hidden state vector $x_t$.

*   **Latent State ($x_t$):**
    *   $\mu_t$: Instantaneous drift (growth potential).
    *   $\sigma_t$: Instantaneous volatility (risk).
    *   $m_t$: Momentum/Sentiment factor.
*   **Observation ($y_t$):**
    *   Log-returns of the stock.

We will use a **Kalman Filter** (or Particle Filter for non-linearities) to estimate the *true* current state of the stock from noisy price data. This gives us a "denoised" view of the trend.

### B. Regime Switching (The "Context")
Markets have different "modes" (e.g., Bull, Bear, Chop, Crisis). A simple drift model fails when the mode changes.
*   **Model:** Hidden Markov Model (HMM) with 2-3 states.
    *   *State 0:* Low Volatility, Positive Trend (Bull).
    *   *State 1:* High Volatility, Negative Trend (Bear/Correction).
    *   *State 2:* Extreme Volatility (Crisis).
*   **Output:** `P(Regime = Bull | Data)`. This contextualizes the "Risk" metric. A 2% drop in a Bull market is a "dip"; in a Bear market, it's a "crash".

### C. Factor Field & Event Impulses (The "Drivers")
Stocks don't move in a vacuum.
*   **Factor Field:** A vector of market-wide influences (S&P 500, Sector Index, VIX).
*   **Event Impulses:** Discrete jumps modeled as Poisson processes (earnings shocks, news).
*   **Integration:** The Generative Model will simulate future paths by evolving the *factors* first, then generating the stock price conditional on those factors.

### D. "Luck vs. Skill" Scoring (The "Judge")
This is the user's requested comparison.
*   **Ex-Ante Simulation:** We "rewind" to the investment date $t_0$ and run 10,000 simulations forward to today $t_{now}$ using *only* information available at $t_0$.
*   **The Cone of Expectation:** This generates a probability cone.
*   **The Verdict:**
    *   *Lucky:* Realized return > 90th percentile of Ex-Ante simulations. (Market gave you a gift).
    *   *Unlucky:* Realized return < 10th percentile. (Thesis might be right, but timing was wrong).
    *   *Skilled:* Realized return matches the "Bull Regime" conditional expectation.

### E. Optimal Stopping (The "Decision")
When to sell?
*   **Certainty Equivalent (CE):** $CE = E[Return] - \lambda \cdot Var[Return]$.
*   **Logic:**
    1.  Calculate $CE_{stay}$ (Value of holding for $k$ more days).
    2.  Calculate $CE_{leave}$ (Value of selling now = Cash).
    3.  If $CE_{leave} > CE_{stay}$, the "math says move out."

## 3. Implementation Plan

### Backend (Python)
*   **New Dependencies:** `filterpy` (Kalman), `hmmlearn` (Regimes).
*   **Service Structure:**
    *   `GenerativeEngine`: Main class orchestration.
    *   `StateSpaceModel`: Handles Kalman Filtering.
    *   `RegimeDetector`: Handles HMM logic.
*   **API Update:** `run_pipeline` will return a simplified `Verdict` object alongside the detailed `Simulations`.

### Frontend (React)
*   **Visualization:**
    *   "The Cone": A shaded region showing where the price *should* have been.
    *   "The Path": The actual price line cutting through the cone.
    *   "The Gauge": A simple Luck/Skill meter.
*   **Verdict Card:** A plain English summary (as requested).
    *   *Header:* "Stay" or "Move Out".
    *   *Subtext:* "You are currently **Unlucky**. The stock is performing in the bottom 5% of expected outcomes, but the regime has shifted to **Bullish**. Math suggests holding."

## 4. Simplified User Output Example

> **Verdict: HOLD**
>
> **Analysis:**
> *   **Expectation:** When you bought, we expected a return between -5% and +12% by now.
> *   **Reality:** You are down -8%.
> *   **Luck Score:** **Unlucky** (Bottom 10% outcome).
> *   **Forward Look:** The market regime just switched to **Low Volatility**. The math estimates a 65% chance of recovery in the next 20 days.
