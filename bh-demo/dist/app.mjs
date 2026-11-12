import { parseInput, findExact, validateCatalog, formatItems } from './domain.mjs';
import { readLocal, createOrReuse, resetLocal, STORAGE_KEY } from './store.mjs';
import { mountCloud } from './cloud-ui.mjs';

const $ = id => document.getElementById(id);
const input = $('parts-input');
let base;
let records = [];
let knownParts;
let storage;
let persistenceError = '';
let busy = false;
let ready = false;
let toastTimer;
const initialResult = $('result').firstElementChild.cloneNode(true);
const cloud = mountCloud($('similarity-cloud'), { onUse: record => {
  if (!ready || busy) return;
  load(record);
  match();
  $('main').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
} });

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function notify(message) {
  clearTimeout(toastTimer);
  $('global-status').textContent = message;
  $('global-status').hidden = false;
  toastTimer = setTimeout(() => { $('global-status').hidden = true; }, 5500);
}

function error(message = '') {
  $('input-error').textContent = message;
  $('input-error').hidden = !message;
  input.setAttribute('aria-invalid', String(Boolean(message)));
}

function setBusy(value) {
  busy = value;
  cloud.setBusy(value);
  for (const id of ['parts-input', 'match', 'clear-input', 'load-sample', 'export', 'library-search']) {
    $(id).disabled = !ready || value;
  }
  $('reset').disabled = !ready || value || !storage || !navigator.locks?.request;
  document.querySelectorAll('.use-combination').forEach(button => { button.disabled = value; });
  $('match').textContent = value ? '正在处理…' : '查找对应 BH →';
}

function refresh() {
  let locals = [];
  persistenceError = '';
  try {
    if (!storage) throw new Error('浏览器不允许本地存储。可以查询示例，但无法保存新增记录。');
    locals = readLocal(storage);
    validateCatalog(base, locals);
  } catch (e) {
    persistenceError = e.message;
    locals = [];
  }
  ({ records, knownParts } = validateCatalog(base, locals));
  $('stat-combinations').textContent = records.length;
  $('stat-parts').textContent = base.parts.length;
  $('stat-local').textContent = locals.length;
  $('library-count').textContent = records.length;
  renderLibrary();
  cloud.setRecords(records);
}

function renderLibrary() {
  const filter = $('library-search').value.trim().toLowerCase();
  const filtered = records.filter(r => r.bh.toLowerCase().includes(filter) ||
    r.items.some(item => item.code.toLowerCase().includes(filter)));
  const body = $('library-body');
  body.replaceChildren();
  if (!filtered.length) {
    const row = element('tr');
    const cell = element('td', '没有符合搜索条件的组合。', 'table-empty');
    cell.colSpan = 5;
    row.append(cell);
    body.append(row);
  }
  for (const record of filtered) {
    const row = element('tr');
    row.append(element('td', record.bh));
    const itemsCell = element('td');
    const chips = element('div', undefined, 'part-chips');
    for (const item of record.items) chips.append(element('span', `${item.code} ×${item.quantity}`, 'part-chip'));
    itemsCell.append(chips);
    row.append(itemsCell);
    row.append(element('td', `${record.items.length} / ${record.items.reduce((n, i) => n + i.quantity, 0)}`));
    const sourceCell = element('td');
    sourceCell.append(element('span', record.local ? '本地新增' : '原始示例', `source-badge${record.local ? ' local' : ''}`));
    row.append(sourceCell);
    const actionCell = element('td');
    const button = element('button', '使用此清单 ↗', 'text-button use-combination');
    button.setAttribute('aria-label', `使用 ${record.bh} 的零件清单`);
    button.disabled = busy;
    button.addEventListener('click', () => {
      load(record);
      match();
      $('main').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
    actionCell.append(button);
    row.append(actionCell);
    body.append(row);
  }
  $('library-summary').textContent = filter ? `找到 ${filtered.length} 个组合 / 共 ${records.length} 个` :
    `${base.combinations.length} 个原始示例 · ${records.filter(r => r.local).length} 个本地新增`;
}

function invalidate() {
  error();
  $('result-badge').textContent = input.value.trim() ? '等待匹配' : '等待输入';
  $('result-badge').className = 'neutral-badge';
  $('result').replaceChildren(initialResult.cloneNode(true));
}

function load(record) {
  input.value = formatItems(record.items);
  invalidate();
}

function renderResult(items, record, created = false) {
  const found = Boolean(record);
  $('result-badge').textContent = found ? created ? '已创建' : '完全匹配' : '未找到匹配';
  $('result-badge').className = found ? 'success-badge' : 'pending-badge';
  const view = element('div', undefined, 'matched-view');
  view.append(element('p', found ? created ? '新的组合代号' : '对应的组合代号' : '当前清单没有完全一致的 BH', 'result-label'));
  const top = element('div', undefined, 'result-top');
  top.append(element('h3', found ? record.bh : '可以创建新组合', found ? 'bh-code' : 'bh-code no-match-code'));
  if (found) {
    const copy = element('button', '复制 BH', 'copy-button');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(record.bh); notify(`已复制 ${record.bh}`); }
      catch { notify('无法访问剪贴板，请选中 BH 代号后手动复制。'); }
    });
    top.append(copy);
  }
  view.append(top);
  view.append(element('p', found ? '零件号与数量全部一致，输入顺序不影响结果。' :
    '请核对下面的完整清单，确认后保存到当前浏览器。', 'match-subtitle'));
  const summary = element('div', undefined, 'result-summary');
  const kinds = element('span');
  kinds.append(element('strong', items.length), document.createTextNode(' 种零件'));
  const total = element('span');
  total.append(element('strong', items.reduce((n, i) => n + i.quantity, 0)), document.createTextNode(' 总数量'));
  summary.append(kinds, total);
  view.append(summary);
  const details = element('div', undefined, 'result-details');
  const table = element('table');
  table.append(element('caption', '本次查询整理后的零件号及数量', 'sr-only'));
  const tableBody = element('tbody');
  for (const item of items) {
    const row = element('tr');
    row.append(element('td', item.code), element('td', `× ${item.quantity}`));
    tableBody.append(row);
  }
  table.append(tableBody);
  details.append(table);
  view.append(details);
  if (!found) {
    const create = element('button', '创建新 BH →', 'button primary create-button');
    create.id = 'create';
    const unavailable = persistenceError || (!navigator.locks?.request ? '请使用支持 Web Locks 的新版 Chrome 或 Edge 保存本地新增记录。' : '');
    create.disabled = Boolean(unavailable);
    create.addEventListener('click', () => createCombination(items));
    view.append(create);
    view.append(element('p', unavailable || '仅保存到当前浏览器，不会写入 GitHub 或同步给其他访问者。', 'result-bottom'));
  } else {
    view.append(element('p', record.local ? '本地新增组合 · 仅在当前浏览器中可用' : '原始脱敏示例 · 所有访问者均可查询', 'result-bottom'));
  }
  $('result').replaceChildren(view);
}

function match() {
  if (!ready || busy) return;
  error();
  try {
    refresh();
    const { items } = parseInput(input.value, knownParts);
    renderResult(items, findExact(records, items));
  } catch (e) { invalidate(); error(e.message); }
}

async function createCombination(items) {
  if (busy) return;
  setBusy(true);
  const button = $('create');
  if (button) { button.disabled = true; button.textContent = '正在保存…'; }
  try {
    const result = await createOrReuse({ base, items, storage, locks: navigator.locks });
    refresh();
    renderResult(items, result.record, result.created);
    notify(result.created ? `已创建 ${result.record.bh}，保存在当前浏览器。` : `相同组合已存在，已复用 ${result.record.bh}。`);
  } catch (e) {
    refresh();
    renderResult(items, findExact(records, items));
    error(e.message);
  } finally { setBusy(false); }
}

function exportData() {
  try {
    refresh();
    if (persistenceError) { error(`导出已停止：${persistenceError}`); return; }
    const quote = value => `"${String(value).replaceAll('"', '""')}"`;
    const rows = [['BH', '零件号', '数量', '来源'], ...records.flatMap(r =>
      r.items.map(i => [r.bh, i.code, i.quantity, r.local ? '本地新增' : '原始示例']))];
    const csv = '\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = element('a');
    anchor.href = url;
    anchor.download = `BH-组合库-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    notify('已导出当前浏览器中的组合数据。');
  } catch (e) { error(`导出失败：${e.message}`); }
}

$('match').addEventListener('click', match);
$('load-sample').addEventListener('click', () => { load(base.combinations[0]); input.focus(); });
$('clear-input').addEventListener('click', () => { input.value = ''; invalidate(); input.focus(); });
input.addEventListener('input', invalidate);
input.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); match(); } });
$('library-search').addEventListener('input', renderLibrary);
$('export').addEventListener('click', exportData);
$('reset').addEventListener('click', () => { if (!busy) $('reset-dialog').showModal(); });
$('reset-dialog').addEventListener('close', async () => {
  if ($('reset-dialog').returnValue !== 'reset') return;
  setBusy(true);
  try { await resetLocal(storage, navigator.locks); refresh(); invalidate(); notify('已重置本地新增记录，原始示例已保留。'); }
  catch (e) { error(e.message); }
  finally { setBusy(false); }
});
window.addEventListener('storage', event => {
  if ((event.key === STORAGE_KEY || event.key === null) && ready && !busy) {
    refresh(); invalidate(); notify('其他标签页更新了本地组合，请重新匹配。');
  }
});

try {
  const response = await fetch(new URL('./data/sample.json', import.meta.url));
  if (!response.ok) throw new Error(`无法加载示例数据（${response.status}）。`);
  base = await response.json();
  validateCatalog(base);
  try { storage = window.localStorage; } catch { storage = null; }
  refresh();
  ready = true;
  setBusy(false);
  load(base.combinations[0]);
  if (persistenceError) error(persistenceError);
} catch (e) {
  error(`页面初始化失败：${e.message} 请通过 HTTP 预览地址或 GitHub Pages 打开，不要直接双击 HTML 文件。`);
  $('library-summary').textContent = '加载失败';
  $('library-body').replaceChildren();
  const row = element('tr');
  const cell = element('td', '示例数据加载失败，请刷新页面后重试。', 'table-empty');
  cell.colSpan = 5;
  row.append(cell);
  $('library-body').append(row);
}
