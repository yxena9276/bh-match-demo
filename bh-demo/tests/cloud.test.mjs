import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { quantityVector, vectorSimilarity, compareItems, classicalMds, computeCloud, MAX_CLOUD_NODES } from '../dist/cloud-math.mjs';

const base = JSON.parse(await readFile(new URL('../dist/data/sample.json', import.meta.url), 'utf8'));
const get = bh => base.combinations.find(record => record.bh === bh);

test('quantity vectors sum repeated parts and retain absolute counts', () => {
  const a = quantityVector([{ code: 'A', quantity: 1 }, { code: 'A', quantity: 2 }]);
  assert.equal(a.get('A'), 3);
  assert.equal(vectorSimilarity(a, new Map([['A', 6]])), 0.5);
  assert.equal(vectorSimilarity(a, new Map([['A', 6]]), 'parts'), 1);
});

test('sample scores are symmetric and match independently calculated overlaps', () => {
  const a = quantityVector(get('BH1720004').items);
  const b = quantityVector(get('BH1720007').items);
  const c = quantityVector(get('BH1720006').items);
  assert.equal(vectorSimilarity(a, b), 3 / 6);
  assert.equal(vectorSimilarity(b, c), 2 / 8);
  assert.equal(vectorSimilarity(a, c), 1 / 6);
  assert.equal(vectorSimilarity(a, b), vectorSimilarity(b, a));
  assert.equal(vectorSimilarity(a, a), 1);
  assert.equal(vectorSimilarity(a, new Map([['OTHER', 1]])), 0);
});

test('comparison separates shared, quantity changes, and unique parts', () => {
  const a = [{ code: 'A', quantity: 3 }, { code: 'B', quantity: 1 }, { code: 'C', quantity: 2 }];
  const b = [{ code: 'A', quantity: 2 }, { code: 'B', quantity: 1 }, { code: 'D', quantity: 4 }];
  const result = compareItems(a, b);
  assert.equal(result.shared, 2);
  assert.equal(result.onlyLeft, 1);
  assert.equal(result.onlyRight, 1);
  assert.equal(result.quantityChanges, 1);
  assert.equal(result.quantityScore, 3 / 10);
  assert.equal(result.partsScore, 2 / 4);
  assert.equal(result.exact, false);
  assert.equal(compareItems(a, [...a].reverse()).exact, true);
});

test('MDS reconstructs the pairwise distances of a known 2D triangle', () => {
  const distances = [[0, 3, 4], [3, 0, 5], [4, 5, 0]];
  const nodes = classicalMds(distances);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    assert.ok(Math.abs(Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y) - distances[i][j]) < 1e-7);
  }
});

test('MDS handles empty, singleton, and fully overlapping vectors', () => {
  assert.deepEqual(classicalMds([]), []);
  assert.deepEqual(classicalMds([[0]]), [{ x: 0, y: 0 }]);
  assert.ok(classicalMds([[0, 0], [0, 0]]).every(node => Number.isFinite(node.x) && Number.isFinite(node.y)));
});

test('the point cloud is deterministic and independent of input row order', () => {
  const a = computeCloud(base.combinations, { anchorBh: 'BH1720004' });
  const b = computeCloud([...base.combinations].reverse(), { anchorBh: 'BH1720004' });
  assert.deepEqual(a, b);
  assert.equal(a.nearest[0].bh, 'BH1720007');
  assert.equal(a.nearest[0].score, 0.5);
  assert.equal(a.nodes.length, 7);
  assert.ok(a.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y)));
});

test('changing the focus does not move a fully displayed sample cloud', () => {
  const a = computeCloud(base.combinations, { anchorBh: 'BH1720004' });
  const b = computeCloud(base.combinations, { anchorBh: 'BH1720001' });
  assert.deepEqual(a.nodes, b.nodes);
  assert.deepEqual(a.edges, b.edges);
});

test('new records join the cloud and deleted focus falls back safely', () => {
  const added = { bh: 'BH1720008', local: true, items: [{ code: 'BZ1200003', quantity: 1 }] };
  assert.equal(computeCloud([...base.combinations, added], { anchorBh: added.bh }).anchorBh, added.bh);
  assert.equal(computeCloud([...base.combinations, added]).nodes.find(node => node.bh === added.bh).local, true);
  assert.equal(computeCloud(base.combinations, { anchorBh: added.bh }).anchorBh, 'BH1720004');
});

test('large inputs are limited to nearby nodes and always include the focus', () => {
  const records = Array.from({ length: MAX_CLOUD_NODES + 30 }, (_, i) => ({
    bh: `BH${1000000 + i}`, items: [{ code: i === 100 ? 'UNIQUE' : 'SHARED', quantity: i + 1 }],
  }));
  const result = computeCloud(records, { anchorBh: 'BH1000100', limit: 8 });
  assert.equal(result.total, records.length);
  assert.equal(result.nodes.length, 8);
  assert.ok(result.nodes.some(node => node.bh === 'BH1000100'));
  assert.ok(result.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y)));
});

test('similarity mode changes quantity-scaled records without declaring exact equality', () => {
  const a = [{ code: 'A', quantity: 1 }, { code: 'B', quantity: 2 }];
  const b = [{ code: 'A', quantity: 2 }, { code: 'B', quantity: 4 }];
  assert.equal(compareItems(a, b).partsScore, 1);
  assert.equal(compareItems(a, b).quantityScore, 0.5);
  assert.equal(compareItems(a, b).exact, false);
});

test('point-cloud UI controls and local asset references exist in the page', async () => {
  const page = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const ui = await readFile(new URL('../dist/cloud-ui.mjs', import.meta.url), 'utf8');
  const ids = [...page.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, id] of ui.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(id), `Missing control: ${id}`);
  for (const [, asset] of page.matchAll(/(?:src|href)="\.\/([^"]+)"/g)) {
    assert.ok((await readFile(new URL('../dist/' + asset, import.meta.url))).length > 0, asset);
  }
});
