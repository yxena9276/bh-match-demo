export const MAX_CLOUD_NODES = 80;

export function quantityVector(items) {
  const vector = new Map();
  for (const { code, quantity } of items) vector.set(code, (vector.get(code) || 0) + quantity);
  return vector;
}

export function vectorSimilarity(a, b, metric = 'quantity') {
  let intersection = 0;
  let union = 0;
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const x = metric === 'parts' ? Number(a.has(key)) : (a.get(key) || 0);
    const y = metric === 'parts' ? Number(b.has(key)) : (b.get(key) || 0);
    intersection += Math.min(x, y);
    union += Math.max(x, y);
  }
  return union ? intersection / union : 1;
}

export function compareItems(a, b) {
  const x = quantityVector(a);
  const y = quantityVector(b);
  const rows = [...new Set([...x.keys(), ...y.keys()])].sort().map(code => {
    const left = x.get(code) || 0;
    const right = y.get(code) || 0;
    return { code, left, right, kind: !left ? 'right' : !right ? 'left' : left === right ? 'same' : 'quantity' };
  });
  return {
    rows,
    shared: rows.filter(row => row.left && row.right).length,
    onlyLeft: rows.filter(row => row.kind === 'left').length,
    onlyRight: rows.filter(row => row.kind === 'right').length,
    quantityChanges: rows.filter(row => row.kind === 'quantity').length,
    exact: rows.every(row => row.kind === 'same'),
    quantityScore: vectorSimilarity(x, y, 'quantity'),
    partsScore: vectorSimilarity(x, y, 'parts'),
  };
}

// Classical multidimensional scaling: eigendecompose the double-centered
// squared dissimilarities. Coordinates are an approximation, never a score.
export function classicalMds(distances) {
  const n = distances.length;
  if (!n) return [];
  if (n === 1) return [{ x: 0, y: 0 }];
  const squared = distances.map(row => row.map(value => value * value));
  const means = squared.map(row => row.reduce((sum, value) => sum + value, 0) / n);
  const mean = means.reduce((sum, value) => sum + value, 0) / n;
  const a = squared.map((row, i) => row.map((value, j) => -0.5 * (value - means[i] - means[j] + mean)));
  const eigenvectors = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => Number(i === j)));
  for (let sweep = 0; sweep < 40; sweep++) {
    let largest = 0;
    for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
      const apq = a[p][q];
      largest = Math.max(largest, Math.abs(apq));
      if (Math.abs(apq) < 1e-12) continue;
      const tau = (a[q][q] - a[p][p]) / (2 * apq);
      const t = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
      const c = 1 / Math.sqrt(1 + t * t);
      const s = t * c;
      const app = a[p][p];
      const aqq = a[q][q];
      for (let k = 0; k < n; k++) {
        if (k !== p && k !== q) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = a[p][k] = c * akp - s * akq;
          a[k][q] = a[q][k] = s * akp + c * akq;
        }
        const vkp = eigenvectors[k][p];
        const vkq = eigenvectors[k][q];
        eigenvectors[k][p] = c * vkp - s * vkq;
        eigenvectors[k][q] = s * vkp + c * vkq;
      }
      a[p][p] = app - t * apq;
      a[q][q] = aqq + t * apq;
      a[p][q] = a[q][p] = 0;
    }
    if (largest < 1e-10) break;
  }
  const axes = Array.from({ length: n }, (_, i) => ({ index: i, value: a[i][i] }))
    .sort((x, y) => y.value - x.value).slice(0, 2);
  const columns = axes.map(axis => {
    if (axis.value < 1e-12) return Array(n).fill(0);
    const values = eigenvectors.map(row => row[axis.index] * Math.sqrt(axis.value));
    const greatest = values.reduce((best, value, i) => Math.abs(value) > Math.abs(values[best]) ? i : best, 0);
    return values.map(value => value * (values[greatest] < 0 ? -1 : 1));
  });
  return Array.from({ length: n }, (_, i) => ({ x: columns[0]?.[i] || 0, y: columns[1]?.[i] || 0 }));
}

export function computeCloud(records, { anchorBh, metric = 'quantity', limit = MAX_CLOUD_NODES } = {}) {
  if (!['quantity', 'parts'].includes(metric)) throw new Error('Unknown similarity metric');
  if (!records.length) return { anchorBh: null, nodes: [], edges: [], nearest: [], total: 0, metric };
  const sorted = [...records].sort((a, b) => a.bh < b.bh ? -1 : a.bh > b.bh ? 1 : 0);
  const vectors = new Map(sorted.map(record => [record.bh, quantityVector(record.items)]));
  const anchor = sorted.find(record => record.bh === anchorBh) || sorted.find(record => record.bh === 'BH1720004') || sorted[0];
  const nearest = sorted.filter(record => record !== anchor).map(record => ({
    bh: record.bh, score: vectorSimilarity(vectors.get(anchor.bh), vectors.get(record.bh), metric),
  })).sort((a, b) => b.score - a.score || (a.bh < b.bh ? -1 : a.bh > b.bh ? 1 : 0));
  const cap = Math.min(MAX_CLOUD_NODES, Math.max(2, Math.floor(limit) || MAX_CLOUD_NODES));
  const shownIds = new Set([anchor.bh, ...nearest.slice(0, cap - 1).map(record => record.bh)]);
  const shown = sorted.filter(record => shownIds.has(record.bh));
  const distances = shown.map(() => Array(shown.length).fill(0));
  const edges = [];
  for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
    const score = vectorSimilarity(vectors.get(shown[i].bh), vectors.get(shown[j].bh), metric);
    distances[i][j] = distances[j][i] = 1 - score;
    if (score > 0) edges.push({ a: shown[i].bh, b: shown[j].bh, score });
  }
  const coordinates = classicalMds(distances);
  return {
    anchorBh: anchor.bh, metric, total: records.length,
    nodes: shown.map((record, i) => ({ bh: record.bh, local: Boolean(record.local),
      kinds: record.items.length, ...coordinates[i] })),
    edges: edges.sort((a, b) => b.score - a.score), nearest: nearest.slice(0, 5),
  };
}
