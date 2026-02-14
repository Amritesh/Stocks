importScripts('math/constants.js', 'math/regression.js', 'math/monteCarlo.js');

// Expose namespaces because importScripts in workers does not auto-attach exports
self.mathMonteCarlo = self.mathMonteCarlo || self;

self.onmessage = function (e) {
  const params = e.data;
  const { S0, r, q, sigma, horizon, nPaths, seed, costBps, basisDegree, objectiveMode, lambda } = params;

  try {
    const { paths, dt } = self.mathMonteCarlo.generatePaths({ S0, r, q, sigma, horizon, nPaths, seed });
    const result = self.mathMonteCarlo.runLSMC({
      S0,
      paths,
      dt,
      r,
      costBps,
      basisDegree,
      objectiveMode,
      lambda,
      horizon,
    });

    self.postMessage({
      boundary: Array.from(result.boundary),
      decision: result.decision,
      bands: result.bands,
      spot: result.spot,
    });
  } catch (err) {
    console.error('Worker simulation failed', err);
    self.postMessage({ error: err?.message || 'Simulation error' });
  }
};
