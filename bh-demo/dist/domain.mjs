export const RULE_VERSION = 1;
export const MAX_QUANTITY = 1_000_000_000;
export const MAX_ROWS = 2_000;

export class InputError extends Error {}

export function normalizeItems(items, knownParts) {
  if (!Array.isArray(items) || !items.length) throw new InputError('请先输入零件清单。');
  if (items.length > MAX_ROWS) throw new InputError(`演示版单次最多支持 ${MAX_ROWS} 行。`);
  const totals = new Map();
  for (const item of items) {
    if (!item || typeof item.code !== 'string') throw new InputError('零件号格式有误。');
    const code = item.code.trim();
    if (!knownParts.has(code)) throw new InputError(`未知零件号：${code || '（空）'}。请使用示例零件库中的编号。`);
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 || item.quantity > MAX_QUANTITY) {
      throw new InputError(`${code} 的数量必须是 1 至 ${MAX_QUANTITY} 之间的整数。`);
    }
    const quantity = (totals.get(code) || 0) + item.quantity;
    if (quantity > MAX_QUANTITY) throw new InputError(`${code} 合并后的数量超出上限。`);
    totals.set(code, quantity);
  }
  return [...totals].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([code, quantity]) => ({ code, quantity }));
}

export function parseInput(text, knownParts) {
  if (typeof text !== 'string' || text.length > 200_000) throw new InputError('输入过长，请缩小清单。');
  const items = [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line) continue;
    const tokens = line.split(/[\s,，、;；]+/u).filter(Boolean);
    if (items.length === 0 && /^(零件号|零件编号|BC|BZ|code)$/i.test(tokens[0]) &&
        tokens.length <= 2 && (!tokens[1] || /^(数量|quantity|qty)$/i.test(tokens[1]))) continue;
    if (tokens.length === 2 && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(tokens[1])) {
      if (!/^\d+$/.test(tokens[1])) throw new InputError(`第 ${index + 1} 行：数量请填写正整数。`);
      items.push({ code: tokens[0], quantity: Number(tokens[1]) });
    } else {
      if (tokens.some(token => /^[+-]?(?:\d|\.\d)/.test(token))) {
        throw new InputError(`第 ${index + 1} 行格式有误；带数量时请每行填写“零件号 数量”。`);
      }
      items.push(...tokens.map(code => ({ code, quantity: 1 })));
    }
    if (items.length > MAX_ROWS) throw new InputError(`演示版单次最多支持 ${MAX_ROWS} 行。`);
  }
  return { items: normalizeItems(items, knownParts), originalRows: items.length };
}

export function canonicalKey(items) {
  return JSON.stringify([...items].sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : 0)
    .map(({ code, quantity }) => [code, quantity]));
}

export function findExact(records, items) {
  const key = canonicalKey(items);
  return records.find(record => canonicalKey(record.items) === key) || null;
}

export function validateCatalog(base, locals = []) {
  if (!base || base.schemaVersion !== 1 || !Array.isArray(base.parts) || !base.parts.length ||
      base.parts.some(p => typeof p !== 'string' || !/^BZ\d+$/.test(p)) ||
      new Set(base.parts).size !== base.parts.length || !Array.isArray(base.combinations)) {
    throw new InputError('示例数据结构不正确。');
  }
  if (!Array.isArray(locals) || locals.length > 10_000) throw new InputError('本地记录格式有误。');
  const knownParts = new Set(base.parts);
  const ids = new Set();
  const keys = new Set();
  const records = [...base.combinations, ...locals].map((record, index) => {
    if (!record || typeof record.bh !== 'string' || !/^BH\d+$/.test(record.bh) ||
        !Number.isSafeInteger(Number(record.bh.slice(2))) || ids.has(record.bh)) {
      throw new InputError('数据中存在无效或重复的 BH。');
    }
    const items = normalizeItems(record.items, knownParts);
    const key = canonicalKey(items);
    if (keys.has(key)) throw new InputError('数据中存在重复的完整组合。');
    ids.add(record.bh);
    keys.add(key);
    return { bh: record.bh, items, local: index >= base.combinations.length,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : null };
  });
  return { knownParts, records };
}

export function allocateBh(records) {
  const last = records.reduce((max, r) => Math.max(max, Number(r.bh.slice(2))), 0);
  if (!Number.isSafeInteger(last + 1)) throw new InputError('BH 编号已超出演示版支持范围。');
  return `BH${last + 1}`;
}

export function formatItems(items) {
  return items.map(item => `${item.code}\t${item.quantity}`).join('\n');
}
