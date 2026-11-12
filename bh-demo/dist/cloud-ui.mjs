import { computeCloud, compareItems } from './cloud-math.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const percent = score => score === 1 ? '100%' : `${Math.min(99.9, score * 100).toFixed(1).replace(/\.0$/, '')}%`;
function html(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function svg(tag, attributes = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

export function mountCloud(root, { onUse }) {
  const $ = id => root.querySelector(`#${id}`);
  const chart = $('cloud-svg');
  const viewport = svg('g');
  chart.append(viewport);
  let records = [];
  let byId = new Map();
  let signature = '';
  let data = null;
  let anchorBh = 'BH1720004';
  let compareBh = null;
  let metric = 'quantity';
  let threshold = 0.2;
  let busy = false;
  let requestId = 0;
  let worker;
  let zoom = 1;
  let pan = { x: 0, y: 0 };
  let drag = null;
  let width = 600;
  let height = 400;

  function status(message, isError = false) {
    $('cloud-status').textContent = message;
    $('cloud-status').classList.toggle('cloud-error', isError);
  }
  function setBusy(value) {
    busy = value;
    for (const id of ['cloud-focus', 'cloud-metric', 'cloud-use']) $(id).disabled = !records.length || busy;
    $('cloud-compare').disabled = records.length < 2 || busy;
    root.querySelectorAll('.cloud-neighbour').forEach(button => { button.disabled = busy; });
  }
  function applyTransform() { viewport.setAttribute('transform', `translate(${pan.x} ${pan.y}) scale(${zoom})`); }
  function fit() { zoom = 1; pan = { x: 0, y: 0 }; applyTransform(); }

  function accept(message) {
    if (message.id !== requestId) return;
    root.setAttribute('aria-busy', 'false');
    if (message.error) { status(`点云计算失败：${message.error}。精确匹配仍可继续使用。`, true); return; }
    data = message.result;
    anchorBh = data.anchorBh;
    $('cloud-focus').value = anchorBh;
    if (!byId.has(compareBh) || compareBh === anchorBh) compareBh = data.nearest[0]?.bh || null;
    status(data.nodes.length < data.total ? `显示焦点及其最近组合 ${data.nodes.length} / ${data.total}` : `${data.total} 个 BH · 二维相似布局`);
    fit();
    renderDetails();
    renderChart();
  }
  function calculate() {
    if (!records.length) return;
    root.setAttribute('aria-busy', 'true');
    status('正在计算相似度与二维位置…');
    const message = { id: ++requestId, records, options: { anchorBh, metric } };
    if (worker) worker.postMessage(message);
    else setTimeout(() => {
      if (message.id !== requestId) return;
      try { accept({ id: message.id, result: computeCloud(message.records, message.options) }); }
      catch (error) { accept({ id: message.id, error: error.message }); }
    }, 0);
  }
  try {
    if (typeof Worker !== 'undefined') {
      worker = new Worker(new URL('./cloud-worker.mjs', import.meta.url), { type: 'module' });
      worker.onmessage = event => accept(event.data);
      worker.onerror = () => { worker.terminate(); worker = null; calculate(); };
    }
  } catch { worker = null; }

  function selectAnchor(bh) {
    if (busy || !byId.has(bh) || bh === anchorBh) return;
    anchorBh = bh;
    compareBh = null;
    calculate();
  }
  function selectComparison(bh) {
    if (busy || !byId.has(bh) || bh === anchorBh) return;
    compareBh = bh;
    renderDetails();
    renderChart();
  }
  function renderDetails() {
    const anchor = byId.get(anchorBh);
    if (!anchor) return;
    $('cloud-anchor-name').textContent = anchorBh;
    $('cloud-anchor-meta').textContent = `${anchor.items.length} 种零件 · ${anchor.local ? '本地新增' : '原始示例'}`;
    const neighbours = $('cloud-neighbours');
    neighbours.replaceChildren();
    for (const item of data.nearest.slice(0, 3)) {
      const button = html('button', undefined, `cloud-neighbour${item.bh === compareBh ? ' is-compared' : ''}`);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(item.bh === compareBh));
      button.setAttribute('aria-label', `对比 ${anchorBh} 与 ${item.bh}，相似度 ${percent(item.score)}`);
      button.append(html('span', item.bh), html('strong', percent(item.score)));
      button.disabled = busy;
      button.addEventListener('click', () => selectComparison(item.bh));
      neighbours.append(button);
    }
    const select = $('cloud-compare');
    select.replaceChildren();
    for (const record of records) if (record.bh !== anchorBh) {
      const option = html('option', record.bh);
      option.value = record.bh;
      select.append(option);
    }
    select.disabled = records.length < 2 || busy;
    if (compareBh) select.value = compareBh;
    const body = $('cloud-diff-body');
    body.replaceChildren();
    const target = byId.get(compareBh);
    if (!target) {
      $('cloud-score').textContent = '—';
      $('cloud-diff-summary').textContent = '添加另一套组合后，即可查看相似度及零件差异。';
      $('cloud-left-label').textContent = '焦点';
      $('cloud-right-label').textContent = '对比';
      return;
    }
    const result = compareItems(anchor.items, target.items);
    $('cloud-score').textContent = percent(metric === 'quantity' ? result.quantityScore : result.partsScore);
    $('cloud-score-label').textContent = metric === 'quantity' ? '数量加权 Jaccard' : '零件种类 Jaccard';
    $('cloud-diff-summary').textContent = `共同 ${result.shared} 种 · 焦点独有 ${result.onlyLeft} 种 · 对比独有 ${result.onlyRight} 种 · 数量不同 ${result.quantityChanges} 种`;
    $('cloud-left-label').textContent = anchorBh;
    $('cloud-right-label').textContent = target.bh;
    for (const row of result.rows) {
      const tr = html('tr', undefined, `cloud-diff-${row.kind}`);
      const label = { same: '同种同量', quantity: '数量不同', left: '焦点独有', right: '对比独有' }[row.kind];
      tr.append(html('td', row.code), html('td', row.left || '—'), html('td', row.right || '—'), html('td', label));
      body.append(tr);
    }
  }

  function renderChart() {
    if (!data) return;
    const focusedBh = chart.contains(document.activeElement) ? document.activeElement?.dataset?.cloudBh : null;
    viewport.replaceChildren();
    chart.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const coordinates = data.nodes;
    if (!coordinates.length) return;
    const xs = coordinates.map(node => node.x);
    const ys = coordinates.map(node => node.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const scale = Math.min((width - 145) / Math.max(maxX - minX, 0.2), (height - 100) / Math.max(maxY - minY, 0.2));
    const placed = [];
    const positions = new Map(coordinates.map(node => {
      let x = width / 2 + (node.x - (minX + maxX) / 2) * scale;
      let y = height / 2 - (node.y - (minY + maxY) / 2) * scale;
      const origin = { x, y };
      for (let i = 0; i < 60 && placed.some(p => Math.hypot(p.x - x, p.y - y) < 21); i++) {
        const angle = i * 2.4;
        const radius = 5 + Math.sqrt(i + 1) * 5;
        x = Math.max(27, Math.min(width - 27, origin.x + Math.cos(angle) * radius));
        y = Math.max(35, Math.min(height - 35, origin.y + Math.sin(angle) * radius));
      }
      const point = { x, y };
      placed.push(point);
      return [node.bh, point];
    }));
    const edges = data.edges.filter(edge => edge.score > 0 && edge.score + 1e-12 >= threshold);
    const highlighted = edges.filter(edge => edge.a === anchorBh || edge.b === anchorBh);
    const drawn = [...highlighted, ...edges.filter(edge => !highlighted.includes(edge))].slice(0, 300);
    for (const edge of drawn) {
      const a = positions.get(edge.a), b = positions.get(edge.b);
      const active = edge.a === anchorBh || edge.b === anchorBh;
      const compared = active && (edge.a === compareBh || edge.b === compareBh);
      viewport.append(svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        class: `cloud-edge${active ? ' cloud-edge-active' : ''}${compared ? ' cloud-edge-compared' : ''}`,
        'stroke-width': active ? 1 + edge.score * 3 : 0.7 + edge.score,
      }));
    }
    for (const edge of highlighted.slice(0, 3)) {
      const a = positions.get(edge.a), b = positions.get(edge.b);
      viewport.append(svg('text', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 7,
        class: 'cloud-edge-label', 'text-anchor': 'middle' }, percent(edge.score)));
    }
    const labelBoxes = [];
    const sortedLabels = [...coordinates].sort((a, b) => Number(b.bh === anchorBh || b.bh === compareBh) - Number(a.bh === anchorBh || a.bh === compareBh));
    for (const node of coordinates) {
      const p = positions.get(node.bh);
      const selected = node.bh === anchorBh;
      const compared = node.bh === compareBh;
      const group = svg('g', { class: `cloud-node${node.local ? ' cloud-node-local' : ''}${selected ? ' cloud-node-selected' : ''}${compared ? ' cloud-node-compared' : ''}`,
        'data-cloud-bh': node.bh, role: 'button', tabindex: 0,
        'aria-label': `${node.bh}，${node.kinds} 种零件${selected ? '，当前焦点' : '，设为焦点'}`,
        'aria-pressed': String(selected),
      });
      group.append(svg('title', {}, `${node.bh} · ${node.kinds} 种零件 · ${node.local ? '本地新增' : '原始示例'}`));
      group.append(svg('circle', { cx: p.x, cy: p.y, r: 18, class: 'cloud-node-hit' }));
      if (selected || compared) group.append(svg('circle', { cx: p.x, cy: p.y, r: selected ? 18 : 15, class: 'cloud-node-ring' }));
      group.append(svg('circle', { cx: p.x, cy: p.y, r: selected ? 9 : 7, class: 'cloud-node-dot' }));
      viewport.append(group);
    }
    for (const node of sortedLabels) {
      if (coordinates.length > 15 && node.bh !== anchorBh && node.bh !== compareBh) continue;
      const p = positions.get(node.bh);
      const labelWidth = node.bh.length * 7.1 + 8;
      const candidates = [
        { x: p.x + 15, y: p.y - 3 }, { x: p.x - labelWidth - 15, y: p.y - 3 },
        { x: p.x - labelWidth / 2, y: p.y - 24 }, { x: p.x - labelWidth / 2, y: p.y + 26 },
      ];
      const overlaps = box => labelBoxes.some(other => box.x < other.x + other.w && box.x + box.w > other.x && box.y < other.y + other.h && box.y + box.h > other.y);
      const good = candidates.find(pos => pos.x > 7 && pos.x + labelWidth < width - 7 && pos.y > 20 && pos.y < height - 12 && !overlaps({ x: pos.x, y: pos.y - 12, w: labelWidth, h: 17 }));
      if (!good && node.bh !== anchorBh && node.bh !== compareBh) continue;
      const position = good || { x: Math.max(8, Math.min(width - labelWidth - 8, p.x + 15)), y: Math.max(22, p.y - 20) };
      labelBoxes.push({ x: position.x, y: position.y - 12, w: labelWidth, h: 17 });
      viewport.append(svg('text', { x: position.x, y: position.y, class: `cloud-node-label${node.bh === anchorBh ? ' cloud-label-selected' : ''}` }, node.bh));
    }
    $('cloud-link-count').textContent = `${drawn.length} 条相似连线${edges.length > drawn.length ? '（已限制显示）' : ''}`;
    applyTransform();
    if (focusedBh) viewport.querySelector(`[data-cloud-bh="${focusedBh}"]`)?.focus({ preventScroll: true });
  }

  $('cloud-focus').addEventListener('change', event => selectAnchor(event.target.value));
  $('cloud-compare').addEventListener('change', event => selectComparison(event.target.value));
  $('cloud-metric').addEventListener('change', event => { metric = event.target.value; calculate(); });
  $('cloud-threshold').addEventListener('input', event => {
    threshold = Number(event.target.value) / 100;
    $('cloud-threshold-value').textContent = `${event.target.value}%`;
    renderChart();
  });
  $('cloud-use').addEventListener('click', () => { if (!busy && byId.has(anchorBh)) onUse(byId.get(anchorBh)); });
  $('cloud-fit').addEventListener('click', fit);
  function zoomBy(factor) {
    const next = Math.max(0.6, Math.min(4, zoom * factor));
    const ratio = next / zoom;
    pan = { x: width / 2 - (width / 2 - pan.x) * ratio, y: height / 2 - (height / 2 - pan.y) * ratio };
    zoom = next; applyTransform();
  }
  $('cloud-zoom-in').addEventListener('click', () => zoomBy(1.2));
  $('cloud-zoom-out').addEventListener('click', () => zoomBy(1 / 1.2));
  chart.addEventListener('click', event => {
    const node = event.target.closest('[data-cloud-bh]');
    if (node) selectAnchor(node.dataset.cloudBh);
  });
  chart.addEventListener('keydown', event => {
    const node = event.target.closest('[data-cloud-bh]');
    if (node && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); selectAnchor(node.dataset.cloudBh); }
  });
  chart.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('[data-cloud-bh]')) return;
    if (event.pointerType === 'touch') return;
    drag = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    chart.setPointerCapture(event.pointerId);
    chart.classList.add('is-panning');
  });
  chart.addEventListener('pointermove', event => {
    if (!drag) return;
    const bounds = chart.getBoundingClientRect();
    pan = { x: drag.panX + (event.clientX - drag.x) * width / bounds.width,
      y: drag.panY + (event.clientY - drag.y) * height / bounds.height };
    applyTransform();
  });
  const endDrag = () => { drag = null; chart.classList.remove('is-panning'); };
  chart.addEventListener('pointerup', endDrag);
  chart.addEventListener('pointercancel', endDrag);
  chart.addEventListener('lostpointercapture', endDrag);
  const resize = () => {
    width = Math.max(240, $('cloud-chart').getBoundingClientRect().width);
    height = width < 420 ? 350 : 410;
    chart.setAttribute('height', height);
    fit(); renderChart();
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe($('cloud-chart'));
  else window.addEventListener('resize', resize);
  resize();

  return {
    setBusy,
    setRecords(next) {
      const nextSignature = JSON.stringify(next.map(record => [record.bh, record.items, record.local]));
      records = next;
      byId = new Map(records.map(record => [record.bh, record]));
      if (nextSignature === signature) return;
      signature = nextSignature;
      const select = $('cloud-focus');
      select.replaceChildren();
      for (const record of records) {
        const option = html('option', `${record.bh}${record.local ? ' · 本地' : ''}`);
        option.value = record.bh;
        select.append(option);
      }
      setBusy(busy);
      calculate();
    },
  };
}
