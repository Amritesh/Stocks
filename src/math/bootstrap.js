
// Helper for quantile calculation
function quantile(arr, q) {
    const sorted = arr.slice().sort((a, b) => a - b);
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
        return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    } else {
        return sorted[base];
    }
}

// Certainty Equivalent
function certaintyEquivalent(mean, variance, lam) {
    return mean - 0.5 * lam * variance;
}

// Bootstrap paths generator
// returns [paths, horizon] array of prices
function bootstrapPaths(returns, startPrice, horizon, nPaths, seed) {
    // Simple PRNG for reproducibility if needed, or Math.random
    // For bootstrap, we sample from returns.
    // If returns is empty, fallback to simple random walk with 0 drift
    if (!returns || returns.length === 0) {
        // Fallback: standard random walk
        const paths = [];
        for (let i = 0; i < nPaths; i++) {
            const path = new Float64Array(horizon + 1);
            path[0] = startPrice;
            for (let t = 1; t <= horizon; t++) {
                // simple geometric brownian motion approx with 1% vol per step
                const r = (Math.random() - 0.5) * 0.02; 
                path[t] = path[t-1] * (1 + r);
            }
            paths.push(path);
        }
        return paths;
    }

    const paths = [];
    for (let i = 0; i < nPaths; i++) {
        const path = new Float64Array(horizon + 1);
        path[0] = startPrice;
        for (let t = 1; t <= horizon; t++) {
            const r = returns[Math.floor(Math.random() * returns.length)];
            path[t] = path[t-1] * (1 + r);
        }
        paths.push(path);
    }
    return paths;
}

export function runBootstrapAnalysis({ 
    returns, 
    startPrice, 
    currentPrice, 
    horizon, 
    paths, 
    riskAversion, 
    targetPct, 
    drawdownPct, 
    buyPrice,
    elapsedDays
}) {
    // Generate paths starting from buyPrice (to simulate "what if" from entry)
    // But typically for "future" analysis we start from NOW (currentPrice).
    // The Python code bootstraps from buy_px. Let's follow that logic to calculate PnL distribution.
    
    // NOTE: The Python code separates "prices_paths" (bootstrap) from historical.
    // It bootstraps from buy_px for 'horizon' steps.
    
    const simulatedPaths = bootstrapPaths(returns, buyPrice, horizon, paths);
    
    // Extract terminal prices
    const terminalPrices = simulatedPaths.map(p => p[horizon]);
    
    // PnL paths at elapsed time (where we are now) vs buy price
    // If horizon > elapsedDays, we look at that slice.
    // If horizon < elapsedDays, we clamp.
    const effectiveElapsed = Math.min(horizon, elapsedDays);
    const elapsedPrices = simulatedPaths.map(p => p[effectiveElapsed]);
    
    // Calculate Stats
    
    // Terminal PnL distribution
    const terminalPnL = terminalPrices.map(p => (p - buyPrice) / buyPrice);
    
    // Realized return so far
    const realizedRet = (currentPrice - buyPrice) / buyPrice;

    // Prob Target Hit (at end of horizon)
    const probTarget = terminalPnL.filter(r => r >= targetPct).length / paths;
    
    // Prob Drawdown (min price along path < limit)
    let drawdownCount = 0;
    for(let i=0; i<paths; i++) {
        let minP = simulatedPaths[i][0];
        for(let t=1; t<=horizon; t++) {
            if (simulatedPaths[i][t] < minP) minP = simulatedPaths[i][t];
        }
        if ((minP - buyPrice)/buyPrice <= -drawdownPct) drawdownCount++;
    }
    const probDrawdown = drawdownCount / paths;
    
    // VaR 95 (5th percentile of terminal PnL)
    const var95 = quantile(terminalPnL, 0.05);
    
    // ES 95
    const tail = terminalPnL.filter(r => r <= var95);
    const es95 = tail.length > 0 ? tail.reduce((a,b)=>a+b,0)/tail.length : var95;
    
    // Luck Score (percentile of realized return vs simulated distribution at elapsed time)
    // How lucky were we compared to random paths?
    const elapsedPnL = elapsedPrices.map(p => (p - buyPrice) / buyPrice);
    const luckScore = elapsedPnL.filter(r => r < realizedRet).length / paths;

    // CE Analysis
    // Calculate mean and variance of terminal PnL
    const meanPnL = terminalPnL.reduce((a,b)=>a+b,0)/paths;
    const varPnL = terminalPnL.reduce((a,b)=>a + (b-meanPnL)**2, 0) / paths;
    const ceStay = certaintyEquivalent(meanPnL, varPnL, riskAversion);
    const ceSwitch = 0.0; // Benchmark/Cash
    const probCeStayGt = terminalPnL.filter(r => r > ceSwitch).length / paths;

    // Decision Logic
    let decision = "HOLD";
    let decisionText = "Within allowed loss range; odds-balanced.";
    
    if (probDrawdown > 0.5 && realizedRet < -0.1) {
        decision = "EXIT";
        decisionText = "High drawdown likelihood with negative drift; capital preservation favored.";
    } else if (probTarget > 0.55 && probDrawdown < 0.3) {
        decision = "ADD";
        decisionText = "Favorable target probability with contained downside; consider adding.";
    } else if (realizedRet < -0.08 && probTarget < 0.35) {
        decision = "TRIM";
        decisionText = "Weak target odds and negative P/L; trim to reduce exposure.";
    }

    // Suggested Buy Ranges (based on terminal distribution, scaled back?)
    // Python code uses slices at t=20, 60, 120.
    const buyRanges = [];
    const tenors = [20, 60, 120];
    for (const t of tenors) {
        if (t > horizon) continue;
        const pricesAtT = simulatedPaths.map(p => p[t]);
        const low = quantile(pricesAtT, 0.25);
        const high = quantile(pricesAtT, 0.40);
        buyRanges.push({ label: t === 20 ? "Short-term" : t === 60 ? "Medium-term" : "Long-term", tenor: t, low, high });
    }

    return {
        ce: {
            ce_stay: ceStay,
            ce_switch: ceSwitch,
            prob_ce_stay_gt: probCeStayGt,
            delta_ce: ceSwitch - ceStay
        },
        luck_score: luckScore,
        message: "Bootstrap Risk Engine (Browser-based)",
        buy_ranges: buyRanges,
        stats: {
            prob_target: probTarget,
            prob_drawdown: probDrawdown,
            var_95: var95,
            es_95: es95,
            realized_return: realizedRet,
            realized_elapsed: realizedRet, // approximation
            percentile_elapsed: luckScore,
            elapsed_days: elapsedDays,
            current_price: currentPrice
        },
        decision,
        decision_text: decisionText
    };
}
