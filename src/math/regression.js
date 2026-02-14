export function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussianElimination(A, B) {
  const n = B.length;
  for (let i = 0; i < n; i++) {
    let max = i;
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(A[j][i]) > Math.abs(A[max][i])) max = j;
    }
    [A[i], A[max]] = [A[max], A[i]];
    [B[i], B[max]] = [B[max], B[i]];

    for (let j = i + 1; j < n; j++) {
      if (Math.abs(A[i][i]) < 1e-18) continue;
      const factor = A[j][i] / A[i][i];
      B[j] -= factor * B[i];
      for (let k = i; k < n; k++) A[j][k] -= factor * A[i][k];
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = 0;
    for (let j = i + 1; j < n; j++) sum += A[i][j] * x[j];
    if (Math.abs(A[i][i]) < 1e-18) x[i] = 0;
    else x[i] = (B[i] - sum) / A[i][i];
  }
  return x;
}

export function solveRegression(X, Y, degree) {
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

export function predict(x, coeffs) {
  return coeffs.reduce((acc, c, i) => acc + c * Math.pow(x, i), 0);
}
