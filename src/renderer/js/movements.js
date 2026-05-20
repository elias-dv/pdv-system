'use strict';

let _allMovements = [];
let _editingMovementId = null;
let _movementFilters = {};
let _movementOffset = 0;
let _movementHasMore = false;
const MOVEMENT_PAGE_SIZE = 20;
const AUDIT_EPSILON = 0.0001;

// ─── Load & Render ────────────────────────────────────────────────────────────
window.loadMovements = async (filters = null, append = false) => {
  const tbody = document.getElementById('movementsTableBody');
  if (!tbody) return;

  if (filters) _movementFilters = filters;
  if (!append) {
    _movementOffset = 0;
    tbody.innerHTML = '<tr><td colspan="11" class="table-loading">Carregando…</td></tr>';
  }

  try {
    const result = await window.api.movements.getAll({
      ..._movementFilters,
      limit: MOVEMENT_PAGE_SIZE,
      offset: _movementOffset,
    });
    const items = Array.isArray(result) ? result : (result.items || []);
    _allMovements = append ? _allMovements.concat(items) : items;
    _movementHasMore = Array.isArray(result) ? false : Boolean(result.hasMore);
    _movementOffset = Array.isArray(result) ? _allMovements.length : result.nextOffset;
    renderMovementsTable(_allMovements);
    updateLoadMoreButton();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="11" class="table-loading" style="color:var(--color-danger)">Erro: ${err.message}</td></tr>`;
    updateLoadMoreButton(false);
  }
};

function renderMovementsTable(movements) {
  const tbody = document.getElementById('movementsTableBody');
  if (!tbody) return;

  if (!movements.length) {
    tbody.innerHTML = `<tr><td colspan="11" class="table-loading"><div style="display:flex;flex-direction:column;align-items:center;gap:8px"><span>Nenhuma movimentação encontrada</span></div></td></tr>`;
    return;
  }

  tbody.innerHTML = movements.map(m => {
    const typeHtml = movementTypeBadge(m.type);
    const qtyColor = m.type === 'entry' ? 'var(--color-success)' : m.type === 'exit' ? 'var(--color-danger)' : 'var(--color-text-tertiary)';
    const expiry   = m.expiry_date ? formatPtDate(m.expiry_date) : '—';
    const cost     = m.cost_price != null ? formatCurrency(m.cost_price) : '—';
    const created  = m.created_at ? m.created_at.slice(0, 16) : '—';
    const canEdit = ['manual','lot'].includes(m.source || 'manual') && ['entry','exit'].includes(m.type);

    return `<tr class="movement-row" data-id="${m.id}" title="Clique para ver os detalhes completos">
      <td>${created}</td>
      <td style="font-weight:500">${escHtml(m.product_name)}</td>
      <td>${typeHtml}</td>
      <td><span class="source-pill">${sourceLabel(m.source)}</span></td>
      <td class="text-right" style="font-weight:700;color:${qtyColor}">${Number(m.quantity || 0).toFixed(3).replace(/\.?0+$/,'')}</td>
      <td>${m.lot_number ? escHtml(m.lot_number) : '<span style="color:var(--color-text-quaternary)">—</span>'}</td>
      <td>${expiry}</td>
      <td>${m.supplier ? escHtml(m.supplier) : '<span style="color:var(--color-text-quaternary)">—</span>'}</td>
      <td>${cost}</td>
      <td>${renderMovementDetails(m)}</td>
      <td>
        ${canEdit ? `<div class="table-actions">
          <button class="action-btn mv-edit-btn" data-id="${m.id}" title="Editar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="action-btn delete mv-del-btn" data-id="${m.id}" data-name="${escHtml(m.product_name)}" title="Excluir">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
          </button>
        </div>` : '<span style="color:var(--color-text-quaternary);font-size:12px">—</span>'}
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.movement-row').forEach(row =>
    row.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      openMovementDetails(parseInt(row.dataset.id));
    })
  );
  tbody.querySelectorAll('.mv-edit-btn').forEach(btn =>
    btn.addEventListener('click', () => openMovementModal(parseInt(btn.dataset.id)))
  );
  tbody.querySelectorAll('.mv-del-btn').forEach(btn =>
    btn.addEventListener('click', () => confirmDeleteMovement(parseInt(btn.dataset.id), btn.dataset.name))
  );
}

function updateLoadMoreButton(forceVisible = null) {
  const btn = document.getElementById('btnLoadMoreMovements');
  if (!btn) return;
  const visible = forceVisible === null ? _movementHasMore : forceVisible;
  btn.style.display = visible ? 'inline-flex' : 'none';
  btn.disabled = false;
  btn.textContent = 'Carregar mais';
}

function movementTypeBadge(type) {
  if (type === 'entry') return '<span class="badge badge-green">Entrada</span>';
  if (type === 'exit') return '<span class="badge badge-red">Saída</span>';
  return '<span class="badge badge-blue">Edição</span>';
}

function sourceLabel(source) {
  const labels = {
    manual: 'Manual',
    lot: 'Lote',
    sale: 'Venda',
    sale_cancel: 'Cancelamento',
    product: 'Produto',
    promotion: 'Promoção',
  };
  return labels[source] || 'Sistema';
}

function renderMovementDetails(m) {
  if (m.type === 'edit') return renderAuditDiff(m.before_data, m.after_data, m.notes);
  const after = parseJson(m.after_data, {});
  if (Array.isArray(after.deductions) && after.deductions.length) {
    const lots = after.deductions.map(d => d.lot_number || `#${d.lot_id}`).join(', ');
    return `<span class="audit-note">PEPS: ${escHtml(lots)}</span>`;
  }
  return `<span class="audit-note">${m.notes ? escHtml(m.notes) : '—'}</span>`;
}

function renderAuditDiff(beforeRaw, afterRaw, notes) {
  const before = parseJson(beforeRaw, {});
  const after = parseJson(afterRaw, {});
  if (after.deleted) return '<span class="audit-note">Registro removido</span>';

  const keys = getAuditKeys(before, after, true);
  if (!keys.length) return `<span class="audit-note">${notes ? escHtml(notes) : 'Alteração registrada'}</span>`;

  return `<div class="audit-diff">${keys.slice(0, 4).map(key => `
    <div><strong>${fieldLabel(key)}</strong>: ${formatAuditValue(before?.[key])} → ${formatAuditValue(after?.[key])}</div>
  `).join('')}${keys.length > 4 ? '<div>…</div>' : ''}</div>`;
}

function getAuditKeys(before = {}, after = {}, changedOnly = false) {
  const keys = Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})]));
  if (!changedOnly) return keys;
  return keys.filter(key => !auditValuesEqual(before?.[key], after?.[key]));
}

function auditValuesEqual(a, b) {
  const emptyA = a == null || a === '';
  const emptyB = b == null || b === '';
  if (emptyA && emptyB) return true;

  const na = Number(a);
  const nb = Number(b);
  if (isFinite(na) && isFinite(nb) && a !== '' && b !== '') {
    return Math.abs(na - nb) < AUDIT_EPSILON;
  }

  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function fieldLabel(key) {
  const labels = {
    name: 'Nome',
    price: 'Preço',
    unit: 'Unidade',
    barcode: 'Código',
    active: 'Ativo',
    product_name: 'Produto',
    type: 'Tipo',
    quantity: 'Qtd',
    lot_number: 'Lote',
    expiry_date: 'Validade',
    supplier: 'Fornecedor',
    cost_price: 'Custo',
    notes: 'Obs.',
  };
  return labels[key] || key;
}

function formatAuditValue(value) {
  if (value == null || value === '') return '<span style="color:var(--color-text-quaternary)">vazio</span>';
  if (typeof value === 'number') return escHtml(String(value));
  if (typeof value === 'object') return escHtml(JSON.stringify(value));
  return escHtml(value);
}

function parseJson(value, fallback={}) {
  if (!value) return fallback;
  try { return JSON.parse(value); }
  catch { return fallback; }
}

// ─── Full movement details ───────────────────────────────────────────────────
async function openMovementDetails(id) {
  const modal = document.getElementById('movementDetailsModal');
  const body = document.getElementById('movementDetailsBody');
  if (!modal || !body) return;

  body.innerHTML = '<div class="table-loading">Carregando detalhes…</div>';
  modal.style.display = 'flex';

  try {
    const movement = await window.api.movements.getById(id);
    if (!movement) throw new Error('Movimentação não encontrada.');
    body.innerHTML = renderMovementFullDetails(movement);
  } catch (err) {
    body.innerHTML = `<div class="lot-empty" style="color:var(--color-danger)">Erro: ${escHtml(err.message)}</div>`;
  }
}

function closeMovementDetails() {
  const modal = document.getElementById('movementDetailsModal');
  if (modal) modal.style.display = 'none';
}

function renderMovementFullDetails(m) {
  const before = parseJson(m.before_data, {});
  const after = parseJson(m.after_data, {});
  const details = [
    ['Data/Hora', formatPtDateTime(m.created_at)],
    ['Produto', m.product_name],
    ['Tipo', movementTypeText(m.type)],
    ['Origem', sourceLabel(m.source)],
    ['Quantidade', formatQty(m.quantity)],
    ['Lote', m.lot_number || '—'],
    ['Validade', m.expiry_date ? formatPtDate(m.expiry_date) : '—'],
    ['Fornecedor', m.supplier || '—'],
    ['Custo unit.', m.cost_price != null ? formatCurrency(m.cost_price) : '—'],
  ];

  if (before.stock != null) details.push(['Estoque antes', formatQty(before.stock)]);
  if (after.stock != null) details.push(['Estoque depois', formatQty(after.stock)]);

  return `
    <div class="movement-detail-grid">
      ${details.map(([label, value]) => detailItem(label, value)).join('')}
    </div>
    ${m.notes ? `<section class="movement-detail-section"><h3>Observações</h3><p>${escHtml(m.notes)}</p></section>` : ''}
    ${renderMovementAuditDetails(m, before, after)}
  `;
}

function renderMovementAuditDetails(m, before, after) {
  if (m.type === 'edit') {
    if (after.deleted) {
      return `
        <section class="movement-detail-section">
          <h3>Registro removido</h3>
          ${renderAuditList(getAuditKeys(before, {}, false), before)}
        </section>`;
    }

    const changedKeys = getAuditKeys(before, after, true);
    const allKeys = getAuditKeys(before, after, false);
    return `
      <section class="movement-detail-section">
        <h3>Alterações</h3>
        ${changedKeys.length ? renderAuditChanges(changedKeys, before, after) : '<p>Nenhuma diferença nos campos auditados.</p>'}
      </section>
      ${allKeys.length ? `
        <section class="movement-detail-section">
          <h3>Dados completos</h3>
          <div class="movement-audit-columns">
            <div><h4>Antes</h4>${renderAuditList(allKeys, before)}</div>
            <div><h4>Depois</h4>${renderAuditList(allKeys, after)}</div>
          </div>
        </section>` : ''}
    `;
  }

  const deductions = Array.isArray(after.deductions) ? after.deductions : [];
  if (!deductions.length) return '';

  return `
    <section class="movement-detail-section">
      <h3>Lotes movimentados</h3>
      <div class="movement-deduction-list">
        ${deductions.map(d => `
          <div class="movement-deduction-row">
            <strong>${escHtml(d.lot_number || `#${d.lot_id}`)}</strong>
            <span>Qtd ${formatQty(d.quantity)}</span>
            <span>${d.expiry_date ? formatPtDate(d.expiry_date) : 'Sem validade'}</span>
            <span>Custo ${d.cost_price != null ? formatCurrency(d.cost_price) : '—'}</span>
            ${d.promotion_discount ? `<span>Desc. promo ${formatCurrency(d.promotion_discount)}</span>` : ''}
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function detailItem(label, value) {
  return `<div class="movement-detail-item"><span>${escHtml(label)}</span><strong>${escHtml(value)}</strong></div>`;
}

function renderAuditChanges(keys, before, after) {
  return `<div class="audit-diff audit-diff-full">${keys.map(key => `
    <div><strong>${fieldLabel(key)}</strong>: ${formatAuditValue(before?.[key])} → ${formatAuditValue(after?.[key])}</div>
  `).join('')}</div>`;
}

function renderAuditList(keys, data) {
  return `<div class="movement-audit-list">${keys.map(key => `
    <div><span>${escHtml(fieldLabel(key))}</span><strong>${formatAuditValue(data?.[key])}</strong></div>
  `).join('')}</div>`;
}

function movementTypeText(type) {
  if (type === 'entry') return 'Entrada';
  if (type === 'exit') return 'Saída';
  return 'Edição';
}

// ─── Filter bar ───────────────────────────────────────────────────────────────
function getMovementFilters() {
  return {
    type:        document.getElementById('mvFilterType')?.value || undefined,
    startDate:   document.getElementById('mvFilterStart')?.value || undefined,
    endDate:     document.getElementById('mvFilterEnd')?.value   || undefined,
    productName: document.getElementById('mvFilterProduct')?.value?.trim() || undefined,
  };
}
window.getMovementFilters = getMovementFilters;

function initMovementFilters() {
  document.getElementById('btnApplyMvFilter')?.addEventListener('click', () =>
    window.loadMovements(getMovementFilters())
  );
  document.getElementById('btnClearMvFilter')?.addEventListener('click', () => {
    ['mvFilterType','mvFilterStart','mvFilterEnd','mvFilterProduct'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    window.loadMovements({});
  });
  document.getElementById('btnLoadMoreMovements')?.addEventListener('click', async () => {
    const btn = document.getElementById('btnLoadMoreMovements');
    btn.disabled = true;
    btn.textContent = 'Carregando…';
    await window.loadMovements(null, true);
  });
}

// ─── Modal open/close ─────────────────────────────────────────────────────────
async function openMovementModal(id = null) {
  const modal = document.getElementById('movementModal');
  if (!modal) return;

  _editingMovementId = id;

  ['mvProductSearch','mvLot','mvExpiry','mvSupplier','mvCostPrice','mvNotes'].forEach(fid => {
    const el = document.getElementById(fid);
    if (el) el.value = '';
  });
  const qtyEl  = document.getElementById('mvQty');
  const typeEl = document.getElementById('mvType');
  if (qtyEl)  qtyEl.value  = '';
  if (typeEl) typeEl.value = 'entry';

  document.getElementById('mvProductSearch').dataset.selectedId   = '';
  document.getElementById('mvProductSearch').dataset.selectedName = '';

  document.getElementById('movementModalTitle').textContent = id ? 'Editar Movimentação' : 'Nova Movimentação';

  if (id) {
    try {
      const mv = await window.api.movements.getById(id);
      if (!mv || !['entry','exit'].includes(mv.type) || !['manual','lot'].includes(mv.source || 'manual')) {
        toast.warning('Este registro é automático ou apenas auditoria.');
        _editingMovementId = null;
        return;
      }
      document.getElementById('mvProductSearch').value = mv.product_name;
      document.getElementById('mvProductSearch').dataset.selectedId   = mv.product_id || '';
      document.getElementById('mvProductSearch').dataset.selectedName = mv.product_name;
      if (typeEl) typeEl.value = mv.type || 'entry';
      if (qtyEl)  qtyEl.value  = mv.quantity;
      document.getElementById('mvLot').value       = mv.lot_number  || '';
      document.getElementById('mvExpiry').value    = mv.expiry_date || '';
      document.getElementById('mvSupplier').value  = mv.supplier    || '';
      document.getElementById('mvCostPrice').value = mv.cost_price  != null ? mv.cost_price : '';
      document.getElementById('mvNotes').value     = mv.notes       || '';
    } catch (err) { toast.error('Erro ao carregar movimentação: ' + err.message); return; }
  }

  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('mvProductSearch')?.focus(), 50);
}

function closeMovementModal() {
  const modal = document.getElementById('movementModal');
  if (modal) modal.style.display = 'none';
  _editingMovementId = null;
}

// ─── Product autocomplete inside modal ───────────────────────────────────────
function initMovementProductSearch() {
  const input    = document.getElementById('mvProductSearch');
  const dropdown = document.getElementById('mvAutocomplete');
  if (!input || !dropdown) return;

  const doSearch = debounce(async (query) => {
    if (!query.trim()) { dropdown.style.display = 'none'; return; }
    try {
      const results = await window.api.products.search(query);
      if (!results.length) { dropdown.style.display = 'none'; return; }
      dropdown.innerHTML = results.map(p => `
        <div class="autocomplete-item" data-id="${p.id}" data-name="${escHtml(p.name)}" data-price="${p.price}">
          <span class="autocomplete-item-name">${escHtml(p.name)}</span>
          <span class="autocomplete-item-price">${formatCurrency(p.price)}</span>
        </div>`).join('');
      dropdown.style.display = 'block';
      dropdown.querySelectorAll('.autocomplete-item').forEach(el => {
        el.addEventListener('mousedown', e => {
          e.preventDefault();
          input.value = el.dataset.name;
          input.dataset.selectedId   = el.dataset.id;
          input.dataset.selectedName = el.dataset.name;
          dropdown.style.display = 'none';
          document.getElementById('mvType')?.focus();
        });
      });
    } catch(err) { console.error(err); }
  }, 200);

  input.addEventListener('input', e => {
    input.dataset.selectedId = '';
    input.dataset.selectedName = '';
    doSearch(e.target.value);
  });
  input.addEventListener('blur',  () => setTimeout(() => dropdown.style.display = 'none', 150));
}

// ─── Save movement ────────────────────────────────────────────────────────────
async function saveMovement() {
  const searchEl = document.getElementById('mvProductSearch');
  const typeEl   = document.getElementById('mvType');
  const qtyEl    = document.getElementById('mvQty');

  const productName = searchEl?.value?.trim();
  const productId   = parseInt(searchEl?.dataset.selectedId) || null;
  const type        = typeEl?.value || 'entry';
  const qty         = parseFloat(qtyEl?.value) || 0;

  if (!productName) { searchEl?.focus(); toast.warning('Informe o produto.'); return; }
  if (!productId)   { searchEl?.focus(); toast.warning('Selecione um produto cadastrado.'); return; }
  if (qty <= 0)     { qtyEl?.focus();   toast.warning('Informe a quantidade.'); return; }

  const btn = document.getElementById('btnSaveMovement');
  btn.disabled = true; btn.textContent = 'Salvando…';

  try {
    await window.api.movements.save({
      id:           _editingMovementId || undefined,
      product_id:   productId,
      type,
      quantity:     qty,
      lot_number:   document.getElementById('mvLot')?.value?.trim() || null,
      expiry_date:  document.getElementById('mvExpiry')?.value || null,
      supplier:     document.getElementById('mvSupplier')?.value?.trim() || null,
      cost_price:   parseOptionalNumber(document.getElementById('mvCostPrice')?.value),
      notes:        document.getElementById('mvNotes')?.value?.trim() || null,
    });

    toast.success(_editingMovementId ? 'Movimentação atualizada!' : 'Movimentação registrada!');
    closeMovementModal();
    await window.loadMovements(getMovementFilters());
    if (AppState.currentView === 'products') window.loadProductsList?.();
  } catch (err) {
    toast.error('Erro ao salvar: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Salvar';
  }
}

async function confirmDeleteMovement(id, name) {
  const res = await window.api.app.showMessageBox({
    type: 'warning', title: 'Confirmar Exclusão',
    message: `Excluir movimentação de "${name}"?`,
    detail: 'O estoque será revertido quando possível e a ação ficará registrada na auditoria.',
    buttons: ['Cancelar', 'Excluir'], defaultId: 0, cancelId: 0,
  });
  if (res.response !== 1) return;
  try {
    await window.api.movements.delete(id);
    toast.success('Movimentação excluída.');
    await window.loadMovements(getMovementFilters());
    if (AppState.currentView === 'products') window.loadProductsList?.();
  } catch (err) { toast.error('Erro: ' + err.message); }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
function initMovements() {
  document.getElementById('btnNewMovement')?.addEventListener('click', () => openMovementModal());

  document.getElementById('btnCloseMovementModal')?.addEventListener('click', closeMovementModal);
  document.getElementById('btnCancelMovement')?.addEventListener('click', closeMovementModal);
  document.getElementById('movementModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('movementModal')) closeMovementModal();
  });
  document.getElementById('btnCloseMovementDetailsModal')?.addEventListener('click', closeMovementDetails);
  document.getElementById('btnCloseMovementDetails')?.addEventListener('click', closeMovementDetails);
  document.getElementById('movementDetailsModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('movementDetailsModal')) closeMovementDetails();
  });

  document.getElementById('btnSaveMovement')?.addEventListener('click', saveMovement);

  initMovementFilters();
  initMovementProductSearch();

  const endEl   = document.getElementById('mvFilterEnd');
  const startEl = document.getElementById('mvFilterStart');
  if (endEl)   endEl.value   = todayStr();
  if (startEl) { const d=new Date(); d.setDate(d.getDate()-30); startEl.value=d.toISOString().slice(0,10); }

  console.log('[Movements] initialized.');
}

document.addEventListener('DOMContentLoaded', initMovements);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escHtml(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function formatPtDate(s) { if(!s) return '—'; const [y,m,d]=s.split('-'); return `${d}/${m}/${y}`; }
function formatPtDateTime(s) {
  if (!s) return '—';
  const [date, time=''] = String(s).split(' ');
  return `${formatPtDate(date)} ${time.slice(0,5)}`.trim();
}
function formatQty(v) { return Number(v || 0).toFixed(3).replace(/\.?0+$/,''); }
function parseOptionalNumber(value) {
  if (value == null || String(value).trim() === '') return null;
  const n = parseFloat(value);
  return isFinite(n) ? n : null;
}
