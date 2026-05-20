'use strict';

let _cartItemIndex = 0;
let _finalizingSale = false;

// ─── Cart helpers ─────────────────────────────────────────────────────────────
function cartSubtotal() { return AppState.cart.reduce((s, i) => s + i.total, 0); }
function cartDiscount() {
  const v = parseFloat(document.getElementById('discountInput')?.value) || 0;
  return Math.max(0, Math.min(v, cartSubtotal()));
}
function cartTotal()   { return Math.max(0, cartSubtotal() - cartDiscount()); }
function cartIsEmpty() { return AppState.cart.length === 0; }

// ─── Render cart ──────────────────────────────────────────────────────────────
function renderCart() {
  const itemsEl   = document.getElementById('cartItems');
  const emptyEl   = document.getElementById('cartEmpty');
  const summaryEl = document.getElementById('cartSummary');
  const totalEl   = document.getElementById('cartTotal');
  const subEl     = document.getElementById('cartSubtotal');
  const finBtn    = document.getElementById('btnFinalizeSale');

  document.querySelectorAll('.cart-item').forEach(el => el.remove());

  if (cartIsEmpty()) {
    emptyEl.style.display   = 'flex';
    summaryEl.style.display = 'none';
    if (finBtn) finBtn.disabled = true;
    if (totalEl) totalEl.textContent = formatCurrency(0);
    updateChange(); updateSessionInfo(); return;
  }

  emptyEl.style.display   = 'none';
  summaryEl.style.display = 'block';
  if (finBtn) finBtn.disabled = false;

  const frag = document.createDocumentFragment();
  AppState.cart.forEach(item => frag.appendChild(buildCartRow(item)));
  itemsEl.insertBefore(frag, emptyEl);

  if (subEl)   subEl.textContent   = formatCurrency(cartSubtotal());
  if (totalEl) totalEl.textContent = formatCurrency(cartTotal());
  updateChange(); updateSessionInfo();
}

function buildCartRow(item) {
  const row = document.createElement('div');
  row.className  = 'cart-item';
  row.dataset.key = item._key;

  row.innerHTML = `
    <div class="cart-item-name" title="${escHtml(item.name)}">${escHtml(item.name)}</div>
    <input type="number" class="cart-item-qty-input" value="${item.quantity}" min="0.001" step="0.001">
    <div class="cart-item-uprice">${formatCurrency(item.unitPrice)}</div>
    <div class="cart-item-total">${formatCurrency(item.total)}</div>
    <button class="cart-item-remove" title="Remover">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>`;

  const qtyInput = row.querySelector('.cart-item-qty-input');

  // Use 'change' for blur/enter; also 'input' with debounce for live feedback
  qtyInput.addEventListener('change', async (e) => {
    const qty = parseFloat(e.target.value);
    if (!qty || qty <= 0) { removeFromCart(item._key); return; }
    await updateCartItemQty(item._key, qty);
  });

  row.querySelector('.cart-item-remove').addEventListener('click', () => removeFromCart(item._key));
  return row;
}

// ─── Cart mutations ───────────────────────────────────────────────────────────
function addToCart(name, quantity, unitPrice, productId = null, totalOverride = null) {
  if (!name?.trim() || !quantity || quantity <= 0 || unitPrice < 0) return;
  const lineTotal = totalOverride != null
    ? Number(Number(totalOverride).toFixed(4))
    : parseFloat((quantity * unitPrice).toFixed(4));

  const existing = productId
    ? AppState.cart.find(i => i.productId === productId)
    : AppState.cart.find(i => i.name === name && i.unitPrice === unitPrice);

  if (existing) {
    if (productId && totalOverride != null) {
      existing.quantity  = parseFloat(quantity.toFixed(4));
      existing.unitPrice = unitPrice;
      existing.total     = lineTotal;
    } else {
      existing.quantity = parseFloat((existing.quantity + quantity).toFixed(4));
      existing.total    = parseFloat((existing.quantity * unitPrice).toFixed(4));
    }
  } else {
    AppState.cart.push({
      _key: ++_cartItemIndex, productId,
      name: name.trim(), quantity: parseFloat(quantity.toFixed(4)),
      unitPrice, total: lineTotal,
    });
  }
  renderCart();
}

function removeFromCart(key) {
  AppState.cart = AppState.cart.filter(i => i._key !== key);
  renderCart();
}

async function updateCartItemQty(key, newQty) {
  const item = AppState.cart.find(i => i._key === key);
  if (!item) return;
  const quantity = parseFloat(newQty.toFixed(4));
  if (item.productId) {
    try {
      const quote = await quoteProductPrice(item.productId, quantity, item.unitPrice);
      item.quantity  = quantity;
      item.unitPrice = quote.unitPrice;
      item.total     = quote.lineTotal;
      renderCart();
    } catch (err) {
      toast.error('Erro ao atualizar preço: ' + err.message);
      renderCart();
    }
    return;
  }
  item.quantity = quantity;
  item.total    = parseFloat((item.quantity * item.unitPrice).toFixed(4));
  renderCart();
}

function clearCart() {
  AppState.cart = [];
  _cartItemIndex = 0;
  const d = document.getElementById('discountInput');
  if (d) d.value = '0';
  renderCart();
}

async function quoteProductPrice(productId, quantity, fallbackPrice = 0) {
  if (!productId) {
    const unitPrice = Number(fallbackPrice) || 0;
    return {
      unitPrice,
      lineTotal: Number((quantity * unitPrice).toFixed(4)),
      promotionDiscount: 0,
    };
  }

  const quote = await window.api.products.quotePrice({ productId, quantity });
  const unitPrice = Number(quote.unitPrice ?? fallbackPrice ?? 0);
  return {
    unitPrice,
    lineTotal: Number((quote.lineTotal ?? (quantity * unitPrice)).toFixed(4)),
    promotionDiscount: Number(quote.promotionDiscount || 0),
  };
}

// ─── Product search / autocomplete ───────────────────────────────────────────
function initSearch() {
  const searchInput = document.getElementById('productSearch');
  const dropdown    = document.getElementById('autocompleteDropdown');
  const qtyInput    = document.getElementById('itemQty');
  const priceInput  = document.getElementById('itemPrice');
  if (!searchInput) return;

  const setPriceLocked = (locked) => {
    if (!priceInput) return;
    priceInput.readOnly = locked;
    priceInput.classList.toggle('readonly', locked);
    priceInput.title = locked ? 'Preço protegido pelo cadastro do produto' : '';
  };
  setPriceLocked(false);
  const refreshSelectedPrice = debounce(async () => {
    const productId = parseInt(searchInput.dataset.selectedId);
    if (!productId) return;
    const qty = parseFloat(qtyInput?.value) > 0 ? parseFloat(qtyInput.value) : 1;
    const fallback = parseFloat(searchInput.dataset.basePrice) || parseFloat(priceInput?.value) || 0;
    const quote = await quoteProductPrice(productId, qty, fallback).catch(() => null);
    if (!quote) return;
    priceInput.value = quote.unitPrice.toFixed(2);
    searchInput.dataset.selectedPrice = quote.unitPrice.toFixed(4);
  }, 180);

  const doSearch = debounce(async (query) => {
    if (!query.trim()) { dropdown.style.display = 'none'; return; }
    try {
      const results = await window.api.products.search(query);
      if (!results.length) { dropdown.style.display = 'none'; return; }
      dropdown.innerHTML = results.map(p => {
        const displayPrice = p.next_promotion_price != null ? p.next_promotion_price : p.price;
        const promoLabel = p.next_promotion_price != null ? ' promo' : '';
        return `
        <div class="autocomplete-item" data-id="${p.id}" data-name="${escHtml(p.name)}" data-price="${p.price}">
          <span class="autocomplete-item-name">${highlightMatch(escHtml(p.name), query)}</span>
          <span class="autocomplete-item-price">${formatCurrency(displayPrice)}/${p.unit}${promoLabel}</span>
        </div>`;
      }).join('');
      dropdown.style.display = 'block';
      dropdown.querySelectorAll('.autocomplete-item').forEach(el => {
        el.addEventListener('mousedown', async e => {
          e.preventDefault();
          await selectProduct(parseInt(el.dataset.id), el.dataset.name, parseFloat(el.dataset.price));
        });
      });
    } catch (err) { console.error('Search error:', err); }
  }, 200);

  searchInput.addEventListener('input', e => {
    searchInput.dataset.selectedId = '';
    searchInput.dataset.selectedName = '';
    searchInput.dataset.selectedPrice = '';
    searchInput.dataset.basePrice = '';
    setPriceLocked(false);
    doSearch(e.target.value);
  });
  searchInput.addEventListener('blur',  () => setTimeout(() => dropdown.style.display = 'none', 150));
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = dropdown.querySelector('.autocomplete-item');
      if (first && dropdown.style.display !== 'none') {
        selectProduct(parseInt(first.dataset.id), first.dataset.name, parseFloat(first.dataset.price));
      } else { qtyInput?.focus(); }
    }
    if (e.key === 'Escape') dropdown.style.display = 'none';
  });

  qtyInput?.addEventListener('input', refreshSelectedPrice);
  qtyInput?.addEventListener('keydown',   e => { if (e.key === 'Enter') { (priceInput?.readOnly ? document.getElementById('btnAddItem') : priceInput)?.focus(); e.preventDefault(); } });
  priceInput?.addEventListener('keydown', e => { if (e.key === 'Enter') { handleAddItem(); e.preventDefault(); } });
}

async function selectProduct(id, name, price) {
  const searchEl = document.getElementById('productSearch');
  const priceEl  = document.getElementById('itemPrice');
  const qtyEl    = document.getElementById('itemQty');
  const qty = parseFloat(qtyEl?.value) > 0 ? parseFloat(qtyEl.value) : 1;
  const quote = await quoteProductPrice(id, qty, price).catch(() => null);
  const displayPrice = quote?.unitPrice ?? price;

  searchEl.value = name;
  priceEl.value  = displayPrice.toFixed(2);
  priceEl.readOnly = true;
  priceEl.classList.add('readonly');
  priceEl.title = 'Preço protegido pelo cadastro do produto';
  // BUG FIX: don't reset qty — keep what user typed; default 1 only if empty
  if (!qtyEl.value || parseFloat(qtyEl.value) <= 0) qtyEl.value = '1';

  searchEl.dataset.selectedId   = id;
  searchEl.dataset.selectedName = name;
  searchEl.dataset.selectedPrice = displayPrice.toFixed(4);
  searchEl.dataset.basePrice = price.toFixed(4);
  document.getElementById('autocompleteDropdown').style.display = 'none';
  qtyEl.focus(); qtyEl.select();
}

// ─── Add item handler ─────────────────────────────────────────────────────────
async function handleAddItem() {
  const searchEl = document.getElementById('productSearch');
  const qtyEl    = document.getElementById('itemQty');
  const priceEl  = document.getElementById('itemPrice');

  const name  = searchEl.value.trim();
  const qty   = parseFloat(qtyEl.value)   || 0;
  const productId = parseInt(searchEl.dataset.selectedId) || null;
  let price = productId
    ? (parseFloat(searchEl.dataset.selectedPrice) || parseFloat(priceEl.value) || 0)
    : (parseFloat(priceEl.value) || 0);
  let lineTotal = null;

  if (!name)    { searchEl.focus(); toast.warning('Informe o nome do produto.'); return; }
  if (qty <= 0) { qtyEl.focus();   toast.warning('Quantidade deve ser maior que zero.'); return; }
  if (price<0)  { priceEl.focus(); toast.warning('Preço inválido.'); return; }
  if (price===0 && !confirm('Adicionar item com preço R$ 0,00?')) return;

  if (productId) {
    const existing = AppState.cart.find(i => i.productId === productId);
    const targetQty = parseFloat(((existing?.quantity || 0) + qty).toFixed(4));
    try {
      const quote = await quoteProductPrice(productId, targetQty, parseFloat(searchEl.dataset.basePrice) || price);
      price = quote.unitPrice;
      lineTotal = quote.lineTotal;
      addToCart(name, targetQty, price, productId, lineTotal);
    } catch (err) {
      toast.error('Erro ao calcular preço: ' + err.message);
      return;
    }
  } else {
    addToCart(name, qty, price, productId);
  }

  searchEl.value = ''; searchEl.dataset.selectedId = ''; searchEl.dataset.selectedName = '';
  searchEl.dataset.selectedPrice = '';
  searchEl.dataset.basePrice = '';
  qtyEl.value = '1'; priceEl.value = '';
  priceEl.readOnly = false;
  priceEl.classList.remove('readonly');
  priceEl.title = '';
  searchEl.focus();
}

// ─── Quick products ───────────────────────────────────────────────────────────
async function loadQuickProducts() {
  const grid = document.getElementById('quickGrid');
  if (!grid) return;
  try {
    const products = await window.api.products.getAll();
    if (!products.length) {
      grid.innerHTML = `<p style="color:var(--color-text-quaternary);font-size:12px;grid-column:span 2;text-align:center">Cadastre produtos para atalhos rápidos</p>`;
      return;
    }
    grid.innerHTML = products.slice(0, 10).map(p => {
      const displayPrice = p.next_promotion_price != null ? p.next_promotion_price : p.price;
      return `
      <button class="quick-btn" data-id="${p.id}" data-name="${escHtml(p.name)}" data-price="${p.price}">
        <span class="quick-btn-name">${escHtml(p.name)}</span>
        <span class="quick-btn-price">${formatCurrency(displayPrice)}</span>
      </button>`;
    }).join('');
    grid.querySelectorAll('.quick-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const qty = parseFloat(document.getElementById('itemQty')?.value) || 1;
        const productId = parseInt(btn.dataset.id);
        const existing = AppState.cart.find(i => i.productId === productId);
        const targetQty = parseFloat(((existing?.quantity || 0) + qty).toFixed(4));
        try {
          const quote = await quoteProductPrice(productId, targetQty, parseFloat(btn.dataset.price));
          addToCart(btn.dataset.name, targetQty, quote.unitPrice, productId, quote.lineTotal);
          toast.success(`${btn.dataset.name} adicionado!`, 1500);
        } catch (err) {
          toast.error('Erro ao calcular preço: ' + err.message);
        }
      });
    });
  } catch (err) { console.error('loadQuickProducts:', err); }
}
window.loadQuickProducts = loadQuickProducts;

// ─── Payment methods ──────────────────────────────────────────────────────────
function initPaymentMethods() {
  document.querySelectorAll('.payment-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.payment-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      AppState.paymentMethod = btn.dataset.method;
      const cc = document.getElementById('changeCalc');
      if (cc) cc.style.display = AppState.paymentMethod === 'cash' ? 'flex' : 'none';
    });
  });
  document.getElementById('cashReceived')?.addEventListener('input', updateChange);
}

function updateChange() {
  const received = parseFloat(document.getElementById('cashReceived')?.value) || 0;
  const total    = cartTotal();
  const change   = received - total;
  const el       = document.getElementById('changeValue');
  if (!el) return;
  el.textContent = formatCurrency(Math.max(0, change));
  el.style.color = change >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
}

function initDiscount() {
  document.getElementById('discountInput')?.addEventListener('input', () => {
    if (document.getElementById('cartTotal'))
      document.getElementById('cartTotal').textContent = formatCurrency(cartTotal());
    if (document.getElementById('cartSubtotal'))
      document.getElementById('cartSubtotal').textContent = formatCurrency(cartSubtotal());
    updateChange();
  });
}

// ─── Finalize sale ────────────────────────────────────────────────────────────
async function finalizeSale() {
  if (_finalizingSale) return;
  if (cartIsEmpty()) return;
  if (!AppState.cashRegister) { toast.error('Caixa não aberto.'); return; }

  const total  = cartTotal();
  const method = AppState.paymentMethod;

  if (method === 'cash') {
    const received = parseFloat(document.getElementById('cashReceived')?.value) || 0;
    if (received > 0 && received < total) {
      toast.error('Valor recebido menor que o total.'); return;
    }
  }

  _finalizingSale = true;
  const paymentConfirmation = await window.api.app.showMessageBox({
    type: 'question',
    title: 'Confirmar pagamento',
    message: `O pagamento de ${formatCurrency(total)} foi realizado?`,
    detail: 'Confirme somente depois que dinheiro, cartão ou PIX estiverem aprovados.',
    buttons: ['Voltar', 'Pagamento realizado'],
    defaultId: 1,
    cancelId: 0,
  });
  if (paymentConfirmation.response !== 1) {
    _finalizingSale = false;
    return;
  }

  const btn = document.getElementById('btnFinalizeSale');
  btn.disabled = true;
  btn.innerHTML = '<span>Processando…</span>';

  try {
    const result = await window.api.sales.create({
      cashRegisterId: AppState.cashRegister.id,
      subtotal: cartSubtotal(), discount: cartDiscount(), total,
      paymentMethod: method,
      items: AppState.cart.map(i => ({ productId: i.productId, name: i.name, quantity: i.quantity, unitPrice: i.unitPrice, total: i.total })),
    });
    const promoMsg = result.promotionDiscount > 0 ? ` · promoção ${formatCurrency(result.promotionDiscount)}` : '';
    toast.success(`Venda #${String(result.id).padStart(4,'0')} — ${formatCurrency(result.total ?? total)}${promoMsg}`);
    clearCart();
    const cr = document.getElementById('cashReceived');
    if (cr) cr.value = '';
    updateChange();
    await window.refreshCashStatus();
    await loadQuickProducts();
    if (AppState.currentView === 'products') await window.loadProductsList?.();
  } catch (err) {
    toast.error('Erro: ' + err.message);
  } finally {
    _finalizingSale = false;
    btn.disabled = false;
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Finalizar Venda`;
  }
}

// ─── Session info ─────────────────────────────────────────────────────────────
function updateSessionInfo() {
  const el  = document.getElementById('sessionInfo');
  const reg = AppState.cashRegister;
  if (!el) return;
  if (!reg) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="session-row"><span>Caixa aberto</span><strong>${(reg.opened_at||'').slice(11,16)||'—'}</strong></div>
    <div class="session-row"><span>Transações</span><strong>${reg.transaction_count||0}</strong></div>
    <div class="session-row"><span>Total da sessão</span><strong>${formatCurrency(reg.total_sales||0)}</strong></div>
    <div class="session-row"><span>Operador</span><strong>${reg.cashier_name||'Operador'}</strong></div>`;
}

// ─── Cash open/close UI ───────────────────────────────────────────────────────
async function handleOpenCash() {
  const balanceEl = document.getElementById('openingBalanceInput');
  const balance     = parseCurrencyInput(balanceEl?.value);
  const cashierName = document.getElementById('cashierNameInput')?.value?.trim() || 'Operador';
  const btn = document.getElementById('btnOpenCash');
  btn.disabled = true;
  btn.textContent = 'Abrindo…';
  try {
    const register = await window.api.cashRegister.open({ openingBalance: balance, cashierName });
    AppState.cashRegister = register;
    toast.success(`Caixa aberto com saldo de ${formatCurrency(balance)}`);
    await window.refreshCashStatus();
  } catch (err) {
    toast.error('Erro ao abrir caixa: ' + err.message);
    // BUG FIX: always reset button on error
    btn.disabled = false;
    btn.textContent = 'Abrir Caixa';
  }
}

window.onCashStatusChanged = (register) => {
  const closedState   = document.getElementById('cashClosedState');
  const activeState   = document.getElementById('pdvActive');
  const headerActions = document.getElementById('pdvHeaderActions');

  if (register) {
    if (closedState) closedState.style.display = 'none';
    if (activeState) activeState.style.display = 'grid';
    if (headerActions) {
      headerActions.innerHTML = `
        <div style="font-size:13px;color:var(--color-text-tertiary)">
          Saldo inicial: <strong style="color:var(--color-text-primary)">${formatCurrency(register.opening_balance||0)}</strong>
        </div>
        <button class="btn btn-danger btn-sm" id="btnHeaderCloseCash">Fechar Caixa</button>`;
      document.getElementById('btnHeaderCloseCash')?.addEventListener('click', () => {
        window.openCloseCashModal?.();
      });
    }
    loadQuickProducts();
    updateSessionInfo();
  } else {
    if (closedState) closedState.style.display = 'flex';
    if (activeState) activeState.style.display = 'none';
    if (headerActions) headerActions.innerHTML = '';
    clearCart();

    // BUG FIX: reset open-cash button so it's never stuck on "Abrindo…"
    const openBtn = document.getElementById('btnOpenCash');
    if (openBtn) {
      openBtn.disabled    = false;
      openBtn.textContent = 'Abrir Caixa';
    }
    const balanceEl = document.getElementById('openingBalanceInput');
    const cashierEl = document.getElementById('cashierNameInput');
    if (balanceEl) balanceEl.value = '0,00';
    if (cashierEl) cashierEl.value = '';
  }
};

// ─── Init ─────────────────────────────────────────────────────────────────────
window.initPDV = () => {
  const openingBalanceEl = document.getElementById('openingBalanceInput');
  if (openingBalanceEl) {
    openingBalanceEl.value = formatCurrencyDigits(openingBalanceEl.value);
    openingBalanceEl.addEventListener('input', e => {
      e.target.value = formatCurrencyDigits(e.target.value);
    });
    openingBalanceEl.addEventListener('focus', e => e.target.select());
  }
  document.getElementById('btnOpenCash')?.addEventListener('click', handleOpenCash);
  document.getElementById('openingBalanceInput')?.addEventListener('keydown', e => { if(e.key==='Enter') document.getElementById('cashierNameInput')?.focus(); });
  document.getElementById('cashierNameInput')?.addEventListener('keydown', e => { if(e.key==='Enter') handleOpenCash(); });
  document.getElementById('btnAddItem')?.addEventListener('click', handleAddItem);
  document.getElementById('btnClearCart')?.addEventListener('click', () => { if(!cartIsEmpty()){ clearCart(); toast.info('Carrinho limpo.'); } });
  document.getElementById('btnFinalizeSale')?.addEventListener('click', finalizeSale);
  initPaymentMethods();
  initSearch();
  initDiscount();
  renderCart();
  console.log('[PDV] initialized.');
};

function escHtml(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function highlightMatch(text, q) { const r=new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi'); return text.replace(r,'<strong style="color:var(--color-primary)">$1</strong>'); }
function formatCurrencyDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const cents = parseInt(digits || '0', 10);
  const amount = cents / 100;
  return amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function parseCurrencyInput(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return (parseInt(digits || '0', 10) || 0) / 100;
}
