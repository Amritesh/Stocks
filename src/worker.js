import { generatePaths, runLSMC } from './math/monteCarlo.js';
import { runBootstrapAnalysis } from './math/bootstrap.js';

self.onmessage = (e) => {
  const { type } = e.data;

  // Handle bootstrap analysis request
  if (type === 'bootstrap') {
    try {
      const result = runBootstrapAnalysis(e.data.payload);
      self.postMessage({ type: 'bootstrap_result', result });
    } catch (err) {
      console.error('Worker bootstrap failed', err);
      self.postMessage({ error: err?.message || 'Bootstrap error' });
    }
    return;
  }

  // Handle standard LSMC simulation
  const { S0, r, q, sigma, horizon, nPaths, seed, costBps, basisDegree, objectiveMode, lambda } = e.data;

  try {
  // Ensure horizon is an integer
  const horizonInt = Math.floor(horizon);
  
  const { paths, dt } = generatePaths({ S0, r, q, sigma, horizon: horizonInt, nPaths, seed });
  const result = runLSMC({
    S0,
      paths,
      dt,
      r,
      costBps,
      basisDegree,
      objectiveMode,
      lambda,
      horizon: horizonInt,
    });

    self.postMessage({
      type: 'lsmc_result',
      boundary: Array.from(result.boundary),
      decision: result.decision,
      bands: result.bands,
      spot: result.spot,
      rebalancingPoints: result.rebalancingPoints,
    });
  } catch (err) {
    console.error('Worker simulation failed', err);
    self.postMessage({ error: err?.message || 'Simulation error' });
  }
};
