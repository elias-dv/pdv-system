'use strict';

let _allProducts = [];
let _selectedLotProduct = null;
let _selectedPromotionLot = null;
let _showExpiringDashboard = false;
let _productSearchTerm = '';

window.loadProductsList = async () => {
  const tbody = document.getElementById('productsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="table-loading">Carregando produtos…</td></tr>';
  try {
    _allProducts = await window.api.products.getAll();
    renderProductsTable(_allProducts);
    if (_showExpiringDashboard) await loadExpiringDashboard();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="table-loading" style="color:var(--color-danger)">Erro: ${err.message}</td></tr>`;
  }
};

function renderProductsTable(products) {
  const tbody = document.getElementById('productsTableBody');
  if (!tbody) return;
  const query = normalizeText(_productSearchTerm);
  const visibleProducts = query
    ? products.filter(p =>
      normalizeText(p.name).includes(query) ||
      normalizeText(p.barcode || '').includes(query)
    )
    : products;

  if (!visibleProducts.length) {
    const emptyTitle = query ? 'Nenhum produto encontrado' : 'Nenhum produto cadastrado';
    const emptyHint = query ? 'Tente buscar por outro nome, com ou sem acentos.' : 'Clique em "Novo Produto" para começar';
    tbody.innerHTML = `<tr><td colspan="5" class="table-loading"><div style="display:flex;flex-direction:column;align-items:center;gap:8px"><span>${emptyTitle}</span><span style="font-size:12px;color:var(--color-text-quaternary)">${emptyHint}</span></div></td></tr>`;
    return;
  }

  tbody.innerHTML = visibleProducts.map(p => {
    const stock     = p.current_stock != null ? Number(p.current_stock) : null;
    const stockText = stock === null ? null : formatStockQty(stock, p.unit);
    const expiryDot = renderExpiryDot(p);
    const stockHtml = stock === null
      ? '<span style="color:var(--color-text-quaternary)">—</span>'
      : stock > 10
        ? `<span class="badge badge-green">${stockText} ${escHtml(p.unit||'un')}</span>`
        : stock > 0
          ? `<span class="badge badge-orange">${stockText} ${escHtml(p.unit||'un')}</span>`
          : `<span class="badge badge-red">${stockText} ${escHtml(p.unit||'un')}</span>`;

    return `<tr class="product-row" data-id="${p.id}" title="Clique para gerenciar lotes e validade">
      <td>
        <div style="font-weight:500">${escHtml(p.name)}</div>
        ${p.barcode ? `<div style="font-size:11px;color:var(--color-text-quaternary);font-family:var(--font-mono);margin-top:2px">${escHtml(p.barcode)}</div>` : ''}
      </td>
      <td><span class="badge badge-blue">${escHtml(p.unit||'un')}</span></td>
      <td class="text-right" style="font-weight:700">${formatCurrency(p.price)}</td>
      <td class="text-right"><span class="stock-indicator-wrap">${expiryDot}${stockHtml}</span></td>
      <td class="text-center">
        <div class="table-actions">
          <button class="action-btn lots-btn" data-id="${p.id}" title="Lotes e validade">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </button>
          <button class="action-btn edit-btn" data-id="${p.id}" title="Editar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="action-btn delete delete-btn" data-id="${p.id}" data-name="${escHtml(p.name)}" title="Excluir">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.product-row').forEach(row =>
    row.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      openProductLotsPanel(parseInt(row.dataset.id));
    })
  );
  tbody.querySelectorAll('.lots-btn').forEach(btn =>
    btn.addEventListener('click', () => openProductLotsPanel(parseInt(btn.dataset.id)))
  );
  tbody.querySelectorAll('.edit-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      if (!AppState.isAdmin) { window.requireAdmin(() => openProductModal(parseInt(btn.dataset.id))); return; }
      openProductModal(parseInt(btn.dataset.id));
    })
  );
  tbody.querySelectorAll('.delete-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      if (!AppState.isAdmin) { window.requireAdmin(() => confirmDeleteProduct(parseInt(btn.dataset.id), btn.dataset.name)); return; }
      confirmDeleteProduct(parseInt(btn.dataset.id), btn.dataset.name);
    })
  );
}

function renderExpiryDot(product) {
  if (!product.expiry_status) return '';
  const labels = {
    expired: 'Há lote vencido',
    danger: 'Há lote vencendo em até 7 dias',
    warning: 'Há lote vencendo em até 30 dias',
  };
  const cls = product.expiry_status === 'expired' ? 'danger' : product.expiry_status;
  return `<span class="expiry-dot ${cls}" title="${labels[product.expiry_status] || 'Atenção à validade'}"></span>`;
}

function formatStockQty(value, unit) {
  const n = Number(value) || 0;
  const normalizedUnit = String(unit || '').toLowerCase();
  if (['un','unidade'].includes(normalizedUnit)) return String(Math.round(n));
  return n.toFixed(2);
}

function initProductSearch() {
  document.getElementById('productListSearch')?.addEventListener('input', debounce((e) => {
    _productSearchTerm = e.target.value.trim();
    renderProductsTable(_allProducts);
  }, 200));
  document.getElementById('btnExpiringProducts')?.addEventListener('click', async () => {
    _showExpiringDashboard = !_showExpiringDashboard;
    updateExpiringToggleButton();
    document.getElementById('productsTableWrapper')?.style.setProperty('display', _showExpiringDashboard ? 'none' : 'block');
    document.getElementById('expiryDashboard')?.style.setProperty('display', _showExpiringDashboard ? 'flex' : 'none');
    if (_showExpiringDashboard) await loadExpiringDashboard();
  });
  updateExpiringToggleButton();
}

function updateExpiringToggleButton() {
  const btn = document.getElementById('btnExpiringProducts');
  if (!btn) return;
  btn.classList.toggle('active-soft', _showExpiringDashboard);
  btn.innerHTML = _showExpiringDashboard
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>Produtos`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>Vencimentos Próximos`;
}

function openProductModal(productId = null) {
  const modal = document.getElementById('productModal');
  if (!modal) return;

  ['productId','productName','productPrice','productBarcode'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const unitEl = document.getElementById('productUnit');
  if (unitEl) unitEl.value = 'un';

  document.getElementById('productModalTitle').textContent = productId ? 'Editar Produto' : 'Novo Produto';

  if (productId) {
    const p = _allProducts.find(x => x.id === productId);
    if (p) {
      document.getElementById('productId').value      = p.id;
      document.getElementById('productName').value    = p.name;
      document.getElementById('productPrice').value   = p.price.toFixed(2);
      if (unitEl) unitEl.value = p.unit || 'un';
      document.getElementById('productBarcode').value = p.barcode || '';
    }
  }

  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('productName')?.focus(), 50);
}

function closeProductModal() {
  const modal = document.getElementById('productModal');
  if (modal) modal.style.display = 'none';
}

async function saveProduct() {
  const idVal   = document.getElementById('productId')?.value;
  const name    = document.getElementById('productName')?.value?.trim();
  const price   = parseFloat(document.getElementById('productPrice')?.value);
  const unit    = document.getElementById('productUnit')?.value || 'un';
  const barcode = document.getElementById('productBarcode')?.value?.trim() || null;

  if (!name)          { document.getElementById('productName')?.focus();  toast.warning('Informe o nome.'); return; }
  if (!price || price < 0) { document.getElementById('productPrice')?.focus(); toast.warning('Informe um preço válido.'); return; }

  const btn = document.getElementById('btnSaveProduct');
  btn.disabled = true; btn.textContent = 'Salvando…';
  try {
    await window.api.products.save({ id: idVal ? parseInt(idVal) : undefined, name, price, unit, barcode });
    toast.success(idVal ? 'Produto atualizado!' : 'Produto cadastrado!');
    closeProductModal();
    await window.loadProductsList();
  } catch (err) {
    toast.error('Erro ao salvar: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Salvar Produto';
  }
}

async function confirmDeleteProduct(id, name) {
  const res = await window.api.app.showMessageBox({
    type: 'warning', title: 'Confirmar Exclusão',
    message: `Excluir "${name}"?`,
    detail: 'O produto não aparecerá mais nas buscas. Vendas existentes não são afetadas.',
    buttons: ['Cancelar', 'Excluir'], defaultId: 0, cancelId: 0,
  });
  if (res.response !== 1) return;
  try {
    await window.api.products.delete(id);
    toast.success(`"${name}" excluído.`);
    await window.loadProductsList();
  } catch (err) { toast.error('Erro: ' + err.message); }
}

async function openProductLotsPanel(productId) {
  const panel = document.getElementById('productLotsPanel');
  const backdrop = document.getElementById('productLotsBackdrop');
  if (!panel || !backdrop) return;

  const product = _allProducts.find(p => p.id === productId) || await window.api.products.getById(productId);
  if (!product) { toast.error('Produto não encontrado.'); return; }
  _selectedLotProduct = product;

  document.getElementById('lotProductName').textContent = product.name;
  document.getElementById('lotProductMeta').textContent = `${formatCurrency(product.price)} · ${product.unit || 'un'}`;
  document.getElementById('lotTotalStock').textContent = `${formatStockQty(product.current_stock ?? product.stock ?? 0, product.unit)} ${product.unit || 'un'}`;

  backdrop.style.display = 'block';
  panel.style.display = 'flex';
  requestAnimationFrame(() => panel.classList.add('open'));
  await loadProductLots(product.id);
}

function closeProductLotsPanel() {
  hideProductLotsPanel(false);
}

function hideProductLotsPanel(keepSelection = false, immediate = false) {
  const panel = document.getElementById('productLotsPanel');
  const backdrop = document.getElementById('productLotsBackdrop');
  if (panel) panel.classList.remove('open');
  const finish = () => {
    if (panel) panel.style.display = 'none';
    if (backdrop) backdrop.style.display = 'none';
    if (!keepSelection) _selectedLotProduct = null;
  };
  if (immediate) finish();
  else setTimeout(finish, 180);
}

async function loadProductLots(productId) {
  const list = document.getElementById('productLotsList');
  if (!list) return;
  list.innerHTML = '<div class="lot-empty">Carregando lotes…</div>';
  try {
    const lots = await window.api.productLots.getByProduct(productId);
    renderProductLots(lots);
  } catch (err) {
    list.innerHTML = `<div class="lot-empty" style="color:var(--color-danger)">Erro: ${err.message}</div>`;
  }
}

function renderProductLots(lots) {
  const list = document.getElementById('productLotsList');
  const expiringList = document.getElementById('expiringLotsList');
  if (!list) return;
  const expiringLots = lots.filter(lot => isExpiringSoon(lot.expiry_date));

  if (expiringList) {
    expiringList.innerHTML = expiringLots.length
      ? expiringLots.map(lot => lotRowHtml(lot, true)).join('')
      : '<div class="lot-empty">Nenhum lote vencendo em até 30 dias.</div>';
  }

  if (!lots.length) {
    list.innerHTML = '<div class="lot-empty">Nenhum lote ativo para este produto.</div>';
    return;
  }
  list.innerHTML = lots.map(lot => lotRowHtml(lot, false)).join('');

  document.querySelectorAll('.btn-create-promo').forEach(btn => {
    btn.addEventListener('click', () => {
      const lot = lots.find(l => String(l.id) === String(btn.dataset.id));
      if (lot) openPromotionModal(lot);
    });
  });
  document.querySelectorAll('.btn-clear-promo').forEach(btn => {
    btn.addEventListener('click', () => clearLotPromotion(parseInt(btn.dataset.id)));
  });
}

async function loadExpiringDashboard() {
  const list = document.getElementById('expiryDashboardList');
  if (!list) return;
  list.innerHTML = '<div class="lot-empty">Carregando vencimentos…</div>';
  try {
    const lots = await window.api.productLots.getExpiring(30);
    renderExpiringDashboard(lots);
  } catch (err) {
    list.innerHTML = `<div class="lot-empty" style="color:var(--color-danger)">Erro: ${escHtml(err.message)}</div>`;
  }
}

function renderExpiringDashboard(lots) {
  const list = document.getElementById('expiryDashboardList');
  if (!list) return;
  const rows = (lots || []).filter(lot => {
    const days = daysUntilExpiry(lot.expiry_date);
    return days >= 0 && days <= 30;
  });

  if (!rows.length) {
    list.innerHTML = '<div class="lot-empty">Nenhum lote vence nos próximos 30 dias.</div>';
    return;
  }

  list.innerHTML = rows.map(lot => {
    const days = daysUntilExpiry(lot.expiry_date);
    const tone = days <= 7 ? 'danger' : 'warning';
    const unit = lot.product_unit || 'un';
    const hasPromo = Number(lot.promotion_active) === 1 && lot.promotion_price != null;
    return `
      <div class="expiry-card ${tone}">
        <div class="expiry-card-main">
          <div>
            <strong>${escHtml(lot.product_name)}</strong>
            <span>${lot.lot_number ? escHtml(lot.lot_number) : 'Sem número de lote'} · ${formatStockQty(lot.quantity, unit)} ${escHtml(unit)}</span>
          </div>
          <div class="expiry-card-date">
            <strong>${formatPtDate(lot.expiry_date)}</strong>
            <span>${days === 0 ? 'Vence hoje' : `Faltam ${days} dia${days !== 1 ? 's' : ''}`}</span>
          </div>
        </div>
        <div class="expiry-card-meta">
          <span>${lot.supplier ? escHtml(lot.supplier) : 'Fornecedor não informado'}</span>
          ${hasPromo ? `<span class="promo-pill">${formatCurrency(lot.promotion_price)}</span>` : '<span></span>'}
        </div>
      </div>`;
  }).join('');
}

function lotRowHtml(lot, compactAction) {
  const expiryClass = getExpiryClass(lot.expiry_date);
  const days = daysUntilExpiry(lot.expiry_date);
  const qty = formatStockQty(lot.quantity, _selectedLotProduct?.unit || lot.product_unit);
  const hasPromo = Number(lot.promotion_active) === 1 && lot.promotion_price != null;
  const promoHtml = hasPromo
    ? `<span class="promo-pill">${formatCurrency(lot.promotion_price)}</span>`
    : '';
  const actionHtml = isExpiringSoon(lot.expiry_date)
    ? (hasPromo
      ? `<button class="btn btn-ghost btn-sm btn-clear-promo" data-id="${lot.id}">Remover</button>`
      : `<button class="btn btn-secondary btn-sm btn-create-promo" data-id="${lot.id}">Criar Promoção</button>`)
    : '';

  return `<div class="lot-row ${compactAction ? 'lot-row-focus' : ''}">
      <div>
        <div class="lot-title">${lot.lot_number ? escHtml(lot.lot_number) : 'Sem número de lote'}</div>
        <div class="lot-sub">${lot.supplier ? escHtml(lot.supplier) : 'Fornecedor não informado'}${promoHtml}</div>
      </div>
      <div class="lot-values">
        <span class="lot-qty">${qty} ${escHtml(_selectedLotProduct?.unit || lot.product_unit || 'un')}</span>
        <span class="lot-expiry ${expiryClass}">${lot.expiry_date ? `${formatPtDate(lot.expiry_date)} · ${formatDaysUntil(days)}` : 'Sem validade'}</span>
        ${actionHtml}
      </div>
    </div>`;
}

function daysUntilExpiry(expiry) {
  if (!expiry) return null;
  const today = new Date(todayStr() + 'T00:00:00');
  const date = new Date(expiry + 'T00:00:00');
  return Math.ceil((date - today) / 86400000);
}

function formatDaysUntil(days) {
  if (days == null || !isFinite(days)) return '';
  if (days < 0) return `vencido há ${Math.abs(days)} dia${Math.abs(days) !== 1 ? 's' : ''}`;
  if (days === 0) return 'vence hoje';
  return `faltam ${days} dia${days !== 1 ? 's' : ''}`;
}

function getExpiryClass(expiry) {
  if (!expiry) return '';
  const today = new Date(todayStr() + 'T00:00:00');
  const date = new Date(expiry + 'T00:00:00');
  const days = Math.ceil((date - today) / 86400000);
  if (days < 0 || days <= 7) return 'danger';
  if (days <= 30) return 'warning';
  return '';
}

function isExpiringSoon(expiry) {
  if (!expiry) return false;
  const today = new Date(todayStr() + 'T00:00:00');
  const date = new Date(expiry + 'T00:00:00');
  const days = Math.ceil((date - today) / 86400000);
  return days >= 0 && days <= 30;
}

function openPromotionModal(lot) {
  _selectedPromotionLot = lot;
  const modal = document.getElementById('promotionModal');
  if (!modal) return;
  const product = _selectedLotProduct;
  hideProductLotsPanel(true, true);
  const basePrice = Number(product?.price ?? lot.product_price ?? 0);
  document.getElementById('promotionLotId').value = lot.id;
  document.getElementById('promotionContext').innerHTML = `
    <strong>${escHtml(lot.lot_number || 'Sem lote')}</strong>
    <span>${formatStockQty(lot.quantity, product?.unit || lot.product_unit)} ${escHtml(product?.unit || lot.product_unit || 'un')} · vence em ${lot.expiry_date ? formatPtDate(lot.expiry_date) : '—'} · preço atual ${formatCurrency(basePrice)}</span>`;
  document.getElementById('promotionPriceInput').value = lot.promotion_price != null
    ? Number(lot.promotion_price).toFixed(2)
    : Number(basePrice * 0.7).toFixed(2);
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('promotionPriceInput')?.focus(), 50);
}

function closePromotionModal() {
  const modal = document.getElementById('promotionModal');
  if (modal) modal.style.display = 'none';
  _selectedPromotionLot = null;
}

async function saveLotPromotion() {
  if (!_selectedPromotionLot) return;
  const priceEl = document.getElementById('promotionPriceInput');
  const promotionPrice = parseFloat(priceEl?.value);
  if (!isFinite(promotionPrice) || promotionPrice < 0) {
    priceEl?.focus();
    toast.warning('Informe um preço promocional válido.');
    return;
  }

  const btn = document.getElementById('btnSavePromotion');
  btn.disabled = true; btn.textContent = 'Salvando…';
  try {
    await window.api.productLots.setPromotion({
      lotId: _selectedPromotionLot.id,
      promotionPrice,
    });
    toast.success('Promoção criada para o lote.');
    closePromotionModal();
    await window.loadProductsList();
    if (_selectedLotProduct) await loadProductLots(_selectedLotProduct.id);
  } catch (err) {
    toast.error('Erro ao salvar promoção: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Salvar Promoção';
  }
}

async function clearLotPromotion(lotId) {
  try {
    await window.api.productLots.clearPromotion(lotId);
    toast.success('Promoção removida.');
    await window.loadProductsList();
    if (_selectedLotProduct) await loadProductLots(_selectedLotProduct.id);
  } catch (err) {
    toast.error('Erro ao remover promoção: ' + err.message);
  }
}

function initProducts() {
  document.getElementById('btnNewProduct')?.addEventListener('click', () => {
    if (!AppState.isAdmin) { window.requireAdmin(() => openProductModal()); return; }
    openProductModal();
  });
  document.getElementById('btnCloseProductModal')?.addEventListener('click', closeProductModal);
  document.getElementById('btnCancelProduct')?.addEventListener('click', closeProductModal);
  document.getElementById('btnSaveProduct')?.addEventListener('click', saveProduct);
  document.getElementById('btnCloseLotsPanel')?.addEventListener('click', closeProductLotsPanel);
  document.getElementById('productLotsBackdrop')?.addEventListener('click', closeProductLotsPanel);
  document.getElementById('btnClosePromotionModal')?.addEventListener('click', closePromotionModal);
  document.getElementById('btnCancelPromotion')?.addEventListener('click', closePromotionModal);
  document.getElementById('btnSavePromotion')?.addEventListener('click', saveLotPromotion);
  document.querySelectorAll('.promo-discount-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_selectedPromotionLot) return;
      const basePrice = Number(_selectedLotProduct?.price ?? _selectedPromotionLot.product_price ?? 0);
      const discount = parseFloat(btn.dataset.discount) || 0;
      document.getElementById('promotionPriceInput').value = Number(basePrice * (1 - discount)).toFixed(2);
    });
  });
  document.getElementById('productModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('productModal')) closeProductModal();
  });
  ['productName','productPrice','productBarcode'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') saveProduct();
      if (e.key === 'Escape') closeProductModal();
    });
  });
  initProductSearch();
  console.log('[Products] initialized.');
}

document.addEventListener('DOMContentLoaded', initProducts);
function escHtml(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function formatPtDate(s) { if(!s) return '—'; const [y,m,d]=s.split('-'); return `${d}/${m}/${y}`; }
function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
