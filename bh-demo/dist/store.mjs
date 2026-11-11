import { InputError, validateCatalog, normalizeItems, findExact, allocateBh, RULE_VERSION } from './domain.mjs';

export const STORAGE_KEY = 'bh-match-demo.v1';
const LOCK_NAME = 'bh-match-demo.write.v1';

export function readLocal(storage) {
  let raw;
  try { raw = storage.getItem(STORAGE_KEY); }
  catch { throw new InputError('浏览器不允许本地存储。可以查询示例，但无法保存新增记录。'); }
  if (raw === null) return [];
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new InputError('本地记录无法读取。请先导出可读数据，或使用“重置本地记录”。'); }
  if (!data || data.ruleVersion !== RULE_VERSION || !Array.isArray(data.combinations)) {
    throw new InputError('本地记录版本不受支持。请使用“重置本地记录”恢复示例。');
  }
  return data.combinations;
}

export async function createOrReuse({ base, items, storage, locks, now = () => new Date().toISOString() }) {
  if (!locks?.request) throw new InputError('此浏览器不支持安全的本地新增，请使用新版 Chrome 或 Edge。');
  return locks.request(LOCK_NAME, async () => {
    const locals = readLocal(storage);
    const { knownParts, records } = validateCatalog(base, locals);
    const normalized = normalizeItems(items, knownParts);
    const existing = findExact(records, normalized);
    if (existing) return { record: existing, created: false };
    const record = { bh: allocateBh(records), items: normalized, createdAt: now() };
    const next = [...locals, record];
    validateCatalog(base, next);
    try { storage.setItem(STORAGE_KEY, JSON.stringify({ ruleVersion: RULE_VERSION, combinations: next })); }
    catch { throw new InputError('保存失败：浏览器存储空间不足或被禁用，未创建新 BH。'); }
    return { record: { ...record, local: true }, created: true };
  });
}

export async function resetLocal(storage, locks) {
  if (!locks?.request) throw new InputError('此浏览器不支持安全的本地重置。');
  return locks.request(LOCK_NAME, () => {
    try { storage.removeItem(STORAGE_KEY); }
    catch { throw new InputError('无法重置浏览器本地记录。'); }
  });
}
