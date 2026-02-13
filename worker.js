/**
 * worker.js - LSMC Simulation Worker
 */

self.onmessage = function(e) {
    console.log("Worker: Received message", e.data);
    const params = e.data;
    const { S0, r, q, sigma, horizon, nPaths, seed, costBps, basisDegree, objectiveMode, lambda } = params;

    const dt = 1 / 252;
    const drift = (r - q - 0.5 * sigma * sigma) * dt;
    const vol = sigma * Math.sqrt(dt);
    const cost = costBps / 10000;

    // Pseudo-random generator with seed
    function mulberry32(a) {
        return function() {
            var t = a += 0x6D2B79F5;
            t = Math.imul(t ^ t >>> 15, t | 1);
            t ^= t + Math.imul(t ^ t >>> 7, t | 61);
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        }
    }
    const rand = mulberry32(seed);

    // Box-Muller for normals
    function randn() {
        let u = 0, v = 0;
        while(u === 0) u = rand();
        while(v === 0) v = rand();
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }

    // 1. Path Generation
    const paths = Array.from({ length: nPaths }, () => {
        const p = new Float64Array(horizon + 1);
        p[0] = S0;
        for (let t = 1; t <= horizon; t++) {
            p[t] = p[t - 1] * Math.exp(drift + vol * randn());
        }
        return p;
    });

    // 2. LSMC for Optimal Stopping
    let cashFlows = new Float64Array(nPaths);
    const df = Math.exp(-r * dt);
    
    // Boundary storage
    const boundary = new Float64Array(horizon);
    boundary[horizon - 1] = 0; // Final step sell-all

    // Terminal cash flow
    for(let i=0; i<nPaths; i++) {
        cashFlows[i] = paths[i][horizon] * (1 - cost);
    }

    // Backward Induction
    for (let t = horizon - 1; t >= 1; t--) {
        const X = [];
        const Y = [];
        const itmIndices = [];

        // Scale factor to keep Math.pow(x, degree) stable
        const scale = 1 / S0;

        for (let i = 0; i < nPaths; i++) {
            const spot = paths[i][t];
            // Only use paths that are "In The Money" or relevant for the boundary
            // For a sell boundary, we typically look at paths where selling might be optimal
            // To simplify and ensure stability, we take all paths but keep an eye on ITM
            X.push(spot * scale);
            Y.push(cashFlows[i] * df);
        }

        // Polynomial Regression
        let coeffs;
        try {
            coeffs = solveRegression(X, Y, basisDegree);
        } catch (err) {
            console.error(`Regression failed at t=${t}:`, err);
            coeffs = new Float64Array(basisDegree + 1).fill(0);
        }
        
        let sumS = 0, countS = 0;

        for (let i = 0; i < nPaths; i++) {
            const spot = paths[i][t];
            const immediate = spot * (1 - cost);
            const continuation = predict(spot * scale, coeffs);

            // Objective check
            let shouldStop = false;
            if (objectiveMode === 'max_ev') {
                // Basic LSMC: if immediate exercise > continuation value
                shouldStop = immediate > continuation;
            } else {
                // Mean-Var approx: penalize continuation variance
                shouldStop = immediate > (continuation - lambda * (continuation * 0.02));
            }

            if (shouldStop) {
                cashFlows[i] = immediate;
                sumS += spot;
                countS++;
            } else {
                cashFlows[i] *= df;
            }
        }
        boundary[t] = countS > 0 ? sumS / countS : (boundary[t+1] || S0);
        
        // Safety: If boundary becomes too extreme, cap it
        if (boundary[t] > S0 * 2) boundary[t] = S0 * 2;
        if (boundary[t] < S0 * 0.1) boundary[t] = S0 * 0.1;
    }
    
    // Estimate t=0 boundary (extrapolate or use t=1)
    boundary[0] = boundary[1];

    // 3. Stats & Bands
    const bands = [0.1, 0.5, 0.9].map(qVal => {
        const b = [];
        for(let t=0; t<=horizon; t++) {
            const sorted = paths.map(p => p[t]).sort((a,b) => a-b);
            b.push(sorted[Math.floor(qVal * nPaths)]);
        }
        return b;
    });

    let decision = 'HOLD';
    try {
        const t1Scale = 1 / S0;
        const t1X = paths.map(p => p[1] * t1Scale);
        const t1Y = cashFlows.map(c => c * df);
        const t1Coeffs = solveRegression(t1X, t1Y, basisDegree);
        decision = S0 * (1-cost) >= predict(S0 * t1Scale, t1Coeffs) ? 'SELL' : 'HOLD';
    } catch (e) {
        console.error("Decision calc failed", e);
    }

    self.postMessage({
        boundary: Array.from(boundary),
        decision,
        bands,
        spot: S0
    });
};

function solveRegression(X, Y, degree) {
    const n = X.length;
    const m = degree + 1;
    const A = Array.from({ length: m }, () => new Float64Array(m));
    const B = new Float64Array(m);

    for (let i = 0; i < n; i++) {
        const x = X[i];
        const y = Y[i];
        for (let r = 0; r < m; r++) {
            for (let c = 0; c < m; c++) {
                A[r][c] += Math.pow(x, r + c);
            }
            B[r] += y * Math.pow(x, r);
        }
    }
    return gaussianElimination(A, B);
}

function gaussianElimination(A, B) {
    const n = B.length;
    for (let i = 0; i < n; i++) {
        let max = i;
        for (let j = i + 1; j < n; j++) {
            if (Math.abs(A[j][i]) > Math.abs(A[max][i])) max = j;
        }
        [A[i], A[max]] = [A[max], A[i]];
        [B[i], B[max]] = [B[max], B[i]];

        for (let j = i + 1; j < n; j++) {
            if (Math.abs(A[i][i]) < 1e-18) continue; // Avoid division by zero
            const factor = A[j][i] / A[i][i];
            B[j] -= factor * B[i];
            for (let k = i; k < n; k++) A[j][k] -= factor * A[i][k];
        }
    }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
        let sum = 0;
        for (let j = i + 1; j < n; j++) sum += A[i][j] * x[j];
        if (Math.abs(A[i][i]) < 1e-18) x[i] = 0; // Handle singular matrix
        else x[i] = (B[i] - sum) / A[i][i];
    }
    return x;
}

function predict(x, coeffs) {
    return coeffs.reduce((acc, c, i) => acc + c * Math.pow(x, i), 0);
}
