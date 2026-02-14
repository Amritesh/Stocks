import { TRADING_DAYS, FAN_QUANTILES } from './constants.js';
import { mulberry32, solveRegression, predict } from './regression.js';

export function generatePaths({ S0, r, q, sigma, horizon, nPaths, seed }) {
  const dt = 1 / TRADING_DAYS;
  const drift = (r - q - 0.5 * sigma * sigma) * dt;
  const vol = sigma * Math.sqrt(dt);
  const rand = mulberry32(seed);

  // Box-Muller transform for normal distribution
  function randn() {
      let u = 0, v = 0;
      while(u === 0) u = rand(); // Converting [0,1) to (0,1)
      while(v === 0) v = rand();
      return Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
  }

  const paths = new Array(nPaths);
  for (let i = 0; i < nPaths; i++) {
    const p = new Float64Array(horizon + 1);
    p[0] = S0;
    for (let t = 1; t <= horizon; t++) {
        // Standard Geometric Brownian Motion
        const Z = randn();
        p[t] = p[t - 1] * Math.exp(drift + vol * Z);
    }
    paths[i] = p;
  }
  return { paths, dt };
}

// New function: Historical Bootstrap Random Walks
// Instead of synthetic GBM, we sample actual price paths of length 'horizon'
// from the asset's own history and rebase them to S0.
export function generateRandomWalks({ S0, ohlcv, horizon, nPaths, seed }) {
    if (!ohlcv || ohlcv.length < horizon + 10) {
        // Not enough history, fallback to synthetic or return empty
        return [];
    }

    const rand = mulberry32(seed);
    const paths = [];
    const maxStartIdx = ohlcv.length - horizon - 1;

    // Ensure we don't try to sample more unique paths than exist
    const availablePaths = maxStartIdx;
    const actualN = Math.min(nPaths, availablePaths);

    for (let i = 0; i < actualN; i++) {
        // Random starting point in history
        const startIdx = Math.floor(rand() * maxStartIdx);
        
        // Extract historical path
        const historicalSlice = ohlcv.slice(startIdx, startIdx + horizon);
        
        // Rebase to S0
        // NewPrice[t] = HistoricalPrice[t] * (S0 / HistoricalPrice[0])
        const historicalStartPrice = historicalSlice[0].close;
        const scale = S0 / historicalStartPrice;
        
        const p = new Float64Array(horizon);
        for(let t=0; t<horizon; t++) {
            p[t] = historicalSlice[t].close * scale;
        }
        paths.push(p);
    }
    
    return paths;
}

export function runLSMC({
  S0,
  paths,
  dt,
  r,
  costBps,
  basisDegree,
  objectiveMode,
  lambda,
  horizon,
}) {
  const cost = costBps / 10000;
  // Use Float64Array for performance
  let cashFlows = new Float64Array(paths.length);
  const df = Math.exp(-r * dt);
  
  // Boundary array
  const boundary = new Float64Array(horizon + 1);
  // Rebalancing points (indices where momentum shifts might occur)
  const rebalancingPoints = [];

  // Initialize cashFlows at maturity
  for (let i = 0; i < paths.length; i++) {
    // Terminal payoff (assuming just liquidation value minus cost)
    cashFlows[i] = paths[i][horizon] * (1 - cost);
  }

  // Backward induction
  for (let t = horizon - 1; t >= 1; t--) {
    const X = [];
    const Y = [];
    const scale = 1 / S0; // Normalize inputs for regression stability

    // Collect in-the-money paths or all paths?
    // For general stock modeling, we use all paths to find the continuation value surface.
    for (let i = 0; i < paths.length; i++) {
      const spot = paths[i][t];
      X.push(spot * scale);
      Y.push(cashFlows[i] * df); // Discounted future cashflow
    }

    let coeffs;
    try {
      coeffs = solveRegression(X, Y, basisDegree);
    } catch (err) {
      console.error(`Regression failed at t=${t}:`, err);
      coeffs = new Float64Array(basisDegree + 1).fill(0);
    }

    let sumBoundary = 0;
    let countBoundary = 0;

    // Update cashflows and determine boundary
    for (let i = 0; i < paths.length; i++) {
      const spot = paths[i][t];
      const immediate = spot * (1 - cost); // Exercise value now
      const continuation = predict(spot * scale, coeffs); // Expected continuation value

      let shouldStop = false;
      if (objectiveMode === 'max_ev') {
        shouldStop = immediate > continuation;
      } else {
        // Risk-aversion penalty (lambda)
        shouldStop = immediate > continuation - lambda * continuation * 0.02;
      }

      if (shouldStop) {
        cashFlows[i] = immediate;
        
        // Accumulate for boundary estimation
        sumBoundary += spot;
        countBoundary++;
      } else {
        cashFlows[i] *= df;
      }
    }

    // Determine boundary for this time step
    if (countBoundary > 0) {
        boundary[t] = sumBoundary / countBoundary;
    } else {
        // If no paths stopped, use next valid boundary from the future (t+1)
        // If t+1 is 0 (end of array not filled yet), default to a safe fallback
        boundary[t] = boundary[t + 1] || S0 * 0.8;
    }
    
    // Smoothing / Clamping
    if (boundary[t] > S0 * 3) boundary[t] = S0 * 3;
    if (boundary[t] < S0 * 0.1) boundary[t] = S0 * 0.1;

    // Detect Momentum Rebalancing Points
    // We define a rebalancing point if the boundary shifts significantly, 
    // implying a change in risk regime or optimal policy structure.
    if (t < horizon - 1) {
        // Calculate previous valid boundary point to compare against
        const prevBoundary = boundary[t+1] > 0 ? boundary[t+1] : boundary[t];
        const rateOfChange = (boundary[t] - prevBoundary) / prevBoundary;
        
        // Sensitivity threshold: 2% shift in boundary structure
        if (Math.abs(rateOfChange) > 0.02) { 
            rebalancingPoints.push({ 
                t, 
                price: boundary[t], 
                type: rateOfChange > 0 ? 'bullish' : 'bearish' 
            });
        }
    }
  }

  // Extrapolate t=0 boundary from t=1
  boundary[0] = boundary[1];
  
  // Fill the end if needed (though loop goes down to 1)
  // Ensure the terminal boundary doesn't drop to 0 or a very low default if not set
  // Also perform a forward fill for any other gaps (just in case)
  for(let t=1; t<=horizon; t++) {
      if (!boundary[t] && boundary[t-1]) {
          boundary[t] = boundary[t-1];
      }
  }

  // Calculate Fan Quantiles
  const bands = FAN_QUANTILES.map((qVal) => {
    const b = new Float64Array(horizon + 1);
    for (let t = 0; t <= horizon; t++) {
      // Collect all prices at time t
      const pricesAtT = new Float64Array(paths.length);
      for(let i=0; i<paths.length; i++) pricesAtT[i] = paths[i][t];
      pricesAtT.sort();
      b[t] = pricesAtT[Math.floor(qVal * (paths.length - 1))];
    }
    return b;
  });

  // Decision Logic for t=0 (Current Moment)
  // This logic is flawed if we only rely on LSMC for European-style decisions or if continuation value is noisy.
  // Instead, we should check if the current Spot Price is significantly BELOW the calculated boundary at t=0.
  // The boundary represents the "critical price" below which it's optimal to stop (sell).
  
  let decision = 'HOLD';
  // Use the smoothed/extrapolated boundary at t=0
  const boundary0 = boundary[0];

  if (S0 < boundary0) {
      decision = 'SELL';
  }

  return { boundary, bands, decision, spot: S0, rebalancingPoints };
}
