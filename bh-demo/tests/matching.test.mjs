import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseInput, normalizeItems, canonicalKey, findExact, validateCatalog, MAX_QUANTITY } from '../dist/domain.mjs';
import { createOrReuse, readLocal, resetLocal, STORAGE_KEY } from '../dist/store.mjs';

const base = JSON.parse(await readFile(new URL('../dist/data/sample.json', import.meta.url), 'utf8'));
const { knownParts, records } = validateCatalog(base);
const first = base.combinations[0];

class MemoryStorage {
  data = new Map();
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, value); }
  removeItem(key) { this.data.delete(key); }
}
class SerialLocks {
  tail = Promise.resolve();
  request(name, callback) {
    const result = this.tail.then(callback);
    this.tail = result.catch(() => {});
    return result;
  }
}
const newItems = () => normalizeItems([{ code: 'BZ1200003', quantity: 1 }], knownParts);

test('source sample has 7 unique combinations, 18 master parts, and 26 memberships', () => {
  assert.equal(records.length, 7);
  assert.equal(knownParts.size, 18);
  assert.equal(records.reduce((n, r) => n + r.items.length, 0), 26);
  assert.equal(new Set(records.flatMap(r => r.items.map(i => i.code))).size, 14);
});

test('each original combination matches only its own BH in every cyclic order', () => {
  for (const record of records) {
    for (let i = 0; i < record.items.length; i++) {
      const items = [...record.items.slice(i), ...record.items.slice(0, i)];
      assert.equal(findExact(records, items).bh, record.bh);
      assert.equal(findExact(records, [...items].reverse()).bh, record.bh);
    }
  }
});

test('missing, extra, and quantity-changed inputs never match the original', () => {
  assert.equal(findExact(records, first.items.slice(1)), null);
  assert.equal(findExact(records, [...first.items, { code: 'BZ1200003', quantity: 1 }]), null);
  const changed = first.items.map((i, n) => ({ ...i, quantity: n === 0 ? 2 : i.quantity }));
  assert.equal(findExact(records, changed), null);
});

test('Excel, CSV, Chinese enumeration, CRLF, and bare-code formats agree', () => {
  const expected = canonicalKey(first.items);
  for (const text of [
    first.items.map(i => `${i.code}\t1`).join('\r\n'),
    '\uFEFF零件号,数量\n' + first.items.map(i => `${i.code},1`).join('\n'),
    first.items.map(i => i.code).join('、'),
    first.items.map(i => i.code).join(', '),
    first.items.map(i => `  ${i.code}  `).join('\n\n'),
  ]) assert.equal(canonicalKey(parseInput(text, knownParts).items), expected);
});

test('repeated codes sum quantities instead of silently deduplicating', () => {
  const { items } = parseInput('BZ1100001 2\nBZ1100001 3', knownParts);
  assert.deepEqual(items, [{ code: 'BZ1100001', quantity: 5 }]);
  assert.equal(findExact(records, items), null);
});

test('empty, unknown, altered case, malformed and invalid quantities are rejected', () => {
  for (const input of ['', '  \n', 'BZ9999999', 'bz1100001', 'BZ1100001 0',
    'BZ1100001 -1', 'BZ1100001 1.5', 'BZ1100001 1e2', 'BZ1100001 NaN',
    'BZ1100001 9007199254740992', 'BZ1100001 1 BZ1300006', 'BZ1100001<script>']) {
    assert.throws(() => parseInput(input, knownParts), undefined, input);
  }
  assert.throws(() => normalizeItems([{ code: 'BZ1100001', quantity: MAX_QUANTITY },
    { code: 'BZ1100001', quantity: 1 }], knownParts));
});

test('known combinations are reused without writing local data', async () => {
  const storage = new MemoryStorage();
  const result = await createOrReuse({ base, items: first.items, storage, locks: new SerialLocks() });
  assert.equal(result.created, false);
  assert.equal(result.record.bh, first.bh);
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test('new combination is persisted and a retry reuses it', async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const a = await createOrReuse({ base, items: newItems(), storage, locks });
  const b = await createOrReuse({ base, items: newItems(), storage, locks });
  assert.equal(a.created, true);
  assert.equal(a.record.bh, 'BH1720008');
  assert.equal(b.created, false);
  assert.equal(a.record.bh, b.record.bh);
  assert.equal(readLocal(storage).length, 1);
  assert.equal(findExact(validateCatalog(base, readLocal(storage)).records, newItems()).bh, a.record.bh);
});

test('20 concurrent submissions create exactly one BH under a shared Web Lock', async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const results = await Promise.all(Array.from({ length: 20 }, () =>
    createOrReuse({ base, items: newItems(), storage, locks })));
  assert.equal(results.filter(r => r.created).length, 1);
  assert.equal(new Set(results.map(r => r.record.bh)).size, 1);
  assert.equal(readLocal(storage).length, 1);
});

test('concurrent different combinations receive different BHs', async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const results = await Promise.all([1, 2, 3].map(quantity => createOrReuse({
    base, items: [{ code: 'BZ1200003', quantity }], storage, locks,
  })));
  assert.equal(new Set(results.map(r => r.record.bh)).size, 3);
  assert.equal(validateCatalog(base, readLocal(storage)).records.length, 10);
});

test('corrupted local records block creation and are never silently overwritten', async () => {
  for (const raw of ['broken json', '{}', JSON.stringify({ ruleVersion: 99, combinations: [] }),
    JSON.stringify({ ruleVersion: 1, combinations: [first] }),
    JSON.stringify({ ruleVersion: 1, combinations: [{ bh: 'BH1720008', items: first.items }] })]) {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, raw);
    await assert.rejects(createOrReuse({ base, items: newItems(), storage, locks: new SerialLocks() }));
    assert.equal(storage.getItem(STORAGE_KEY), raw);
  }
});

test('storage failure and lack of Web Locks never report a successful create', async () => {
  const storage = new MemoryStorage();
  await assert.rejects(createOrReuse({ base, items: newItems(), storage, locks: undefined }));
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  await assert.rejects(createOrReuse({ base, items: newItems(), storage, locks: new SerialLocks() }));
  assert.deepEqual(readLocal(storage), []);
});

test('reset removes only demo storage and preserves original sample and unrelated data', async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  storage.setItem('unrelated', 'keep');
  await createOrReuse({ base, items: newItems(), storage, locks });
  await resetLocal(storage, locks);
  assert.deepEqual(readLocal(storage), []);
  assert.equal(validateCatalog(base).records.length, 7);
  assert.equal(storage.getItem('unrelated'), 'keep');
});

test('all static references are relative for repository-path GitHub Pages deployments', async () => {
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /(?:src|href)=["']\/(?!\/)/);
  for (const relative of ['app.mjs', 'styles.css', 'favicon.svg', 'data/sample.json']) {
    assert.ok((await readFile(new URL(`../dist/${relative}`, import.meta.url))).length > 0);
  }
});
