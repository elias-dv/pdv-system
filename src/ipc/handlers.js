'use strict';

const { ipcMain, app } = require('electron');
const fs           = require('fs');
const path         = require('path');
const bcrypt      = require('bcryptjs');
const { getDb }   = require('../database/db');
const { sendDailyReport, sendTestEmail } = require('../services/emailService');
const { createBackup, getBackupHistory, getBackupDir } = require('../services/backupService');
const { generateSalesHistoryWorkbook, generateSalesHistoryCsv } = require('../services/excelService');
const { getLicenseStatus, activateLicense, clearLicense, requireActiveLicense } = require('../services/licenseService');

const sanitizeStr  = (v, max=500) => String(v??'').trim().slice(0,max);
const sanitizeNum  = (v, def=0)  => { const n=parseFloat(v); return isFinite(n)?n:def; };
const sanitizeInt  = (v, def=0)  => { const n=parseInt(v,10); return isFinite(n)?n:def; };
const sanitizeDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v)?v:null;
const normalizeText = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const PROTECTED_KEYS = new Set(['admin_password_hash','admin_session_key']);
const ENV_ONLY_KEYS  = new Set(['email_host','email_port','email_user','email_secure']);
const MOVEMENT_TYPES = new Set(['entry','exit','edit']);
const EPSILON = 0.0001;
const PUBLIC_IPC_CHANNELS = new Set([
  'license:getStatus',
  'license:activate',
  'app:getVersion',
]);

function ipcHandle(channel, listener) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!PUBLIC_IPC_CHANNELS.has(channel)) requireActiveLicense();
    return await listener(event, ...args);
  });
}

function registerIpcHandlers() {
  registerLicenseHandlers();
  registerProductHandlers();
  registerLotHandlers();
  registerMovementsHandlers();
  registerCashRegisterHandlers();
  registerSaleHandlers();
  registerReportHandlers();
  registerSettingsHandlers();
  registerEmailHandlers();
  registerBackupHandlers();
  registerAuthHandlers();
  console.log('[IPC] All handlers registered.');
}

function registerLicenseHandlers() {
  ipcHandle('license:getStatus', () => getLicenseStatus());
  ipcHandle('license:activate', (_, licenseKey) => activateLicense(licenseKey));
  ipcHandle('license:clear', () => clearLicense());
}

// ─── STOCK / AUDIT HELPERS ───────────────────────────────────────────────────
function jsonOrNull(value) {
  if (value == null) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function parseJson(value, fallback={}) {
  if (!value) return fallback;
  try { return JSON.parse(value); }
  catch { return fallback; }
}

function getProduct(db, id) {
  return db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(sanitizeInt(id));
}

function requireProduct(db, id) {
  const product = getProduct(db, id);
  if (!product) throw new Error('Produto cadastrado não encontrado.');
  return product;
}

function getLotStock(db, productId) {
  return Number(db.prepare(`
    SELECT COALESCE(SUM(quantity),0) AS stock
      FROM product_lots
     WHERE product_id=? AND active=1
  `).get(sanitizeInt(productId))?.stock || 0);
}

function syncProductStock(db, productId) {
  const stock = Math.max(0, Number(getLotStock(db, productId).toFixed(4)));
  db.prepare("UPDATE products SET stock=?,updated_at=datetime('now','localtime') WHERE id=?")
    .run(stock, sanitizeInt(productId));
  return stock;
}

function ensureLegacyLotCoverage(db, product) {
  const productStock = Math.max(0, sanitizeNum(product.stock));
  const lotStock = getLotStock(db, product.id);
  const missing = Number((productStock - lotStock).toFixed(4));
  if (missing <= EPSILON) return;

  db.prepare(`
    INSERT INTO product_lots(
      product_id, lot_number, quantity, initial_quantity, supplier,
      received_at, created_at, updated_at
    ) VALUES(?,?,?,?,?,datetime('now','localtime'),datetime('now','localtime'),datetime('now','localtime'))
  `).run(product.id, 'SALDO-INICIAL', missing, missing, 'Saldo anterior');
}

function recordStockMovement(db, data) {
  const result = db.prepare(`
    INSERT INTO stock_movements(
      product_id, lot_id, product_name, type, quantity, lot_number,
      expiry_date, supplier, cost_price, source, reference_type,
      reference_id, before_data, after_data, notes
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    data.product_id ?? null,
    data.lot_id ?? null,
    sanitizeStr(data.product_name || 'Produto', 300),
    MOVEMENT_TYPES.has(data.type) ? data.type : 'entry',
    sanitizeNum(data.quantity),
    data.lot_number ? sanitizeStr(data.lot_number,100) : null,
    data.expiry_date ? sanitizeDate(data.expiry_date) : null,
    data.supplier ? sanitizeStr(data.supplier,300) : null,
    data.cost_price != null ? sanitizeNum(data.cost_price) : null,
    data.source ? sanitizeStr(data.source,50) : 'manual',
    data.reference_type ? sanitizeStr(data.reference_type,50) : null,
    data.reference_id != null ? sanitizeInt(data.reference_id) : null,
    jsonOrNull(data.before_data),
    jsonOrNull(data.after_data),
    data.notes ? sanitizeStr(data.notes,1000) : null,
  );
  return result.lastInsertRowid;
}

function addStockEntry(db, { product, quantity, lot_number, expiry_date, supplier, cost_price, notes, source='manual', reference_type=null, reference_id=null }) {
  ensureLegacyLotCoverage(db, product);
  const qty = sanitizeNum(quantity);
  if (qty <= 0) throw new Error('Quantidade deve ser maior que zero.');

  const beforeStock = getLotStock(db, product.id);
  const lotResult = db.prepare(`
    INSERT INTO product_lots(
      product_id, lot_number, quantity, initial_quantity, expiry_date,
      supplier, cost_price, received_at, created_at, updated_at
    ) VALUES(?,?,?,?,?,?,?,datetime('now','localtime'),datetime('now','localtime'),datetime('now','localtime'))
  `).run(
    product.id,
    lot_number ? sanitizeStr(lot_number,100) : null,
    qty,
    qty,
    expiry_date ? sanitizeDate(expiry_date) : null,
    supplier ? sanitizeStr(supplier,300) : null,
    cost_price != null ? sanitizeNum(cost_price) : null,
  );

  const lotId = lotResult.lastInsertRowid;
  const afterStock = syncProductStock(db, product.id);
  const movementId = recordStockMovement(db, {
    product_id: product.id,
    lot_id: lotId,
    product_name: product.name,
    type: 'entry',
    quantity: qty,
    lot_number,
    expiry_date,
    supplier,
    cost_price,
    source,
    reference_type,
    reference_id: reference_id ?? (source === 'lot' ? lotId : null),
    before_data: { stock: beforeStock },
    after_data: { stock: afterStock, lot_id: lotId },
    notes,
  });

  return { lotId, movementId, beforeStock, afterStock };
}

function lotEffectivePrice(product, lot) {
  const basePrice = sanitizeNum(product.price);
  const promoPrice = lot.promotion_active && lot.promotion_price != null
    ? sanitizeNum(lot.promotion_price)
    : null;
  return promoPrice != null && promoPrice >= 0 ? promoPrice : basePrice;
}

function buildFifoPlan(db, product, quantity) {
  const qty = sanitizeNum(quantity);
  if (qty <= 0) throw new Error('Quantidade deve ser maior que zero.');

  const freshProduct = db.prepare('SELECT * FROM products WHERE id=?').get(product.id) || product;
  ensureLegacyLotCoverage(db, freshProduct);
  const beforeStock = getLotStock(db, freshProduct.id);
  if (beforeStock + EPSILON < qty) {
    throw new Error(`Estoque insuficiente para "${freshProduct.name}". Disponível: ${beforeStock.toFixed(3)}.`);
  }

  const lots = db.prepare(`
    SELECT *
      FROM product_lots
     WHERE product_id=? AND active=1 AND quantity>0
     ORDER BY
       CASE WHEN expiry_date IS NULL OR expiry_date='' THEN 1 ELSE 0 END ASC,
       expiry_date ASC,
       received_at ASC,
       id ASC
  `).all(freshProduct.id);

  let remaining = qty;
  const deductions = [];
  let lineTotal = 0;
  let costTotal = 0;
  let promotionDiscount = 0;

  for (const lot of lots) {
    if (remaining <= EPSILON) break;
    const take = Math.min(Number(lot.quantity), remaining);
    const unitPrice = lotEffectivePrice(freshProduct, lot);
    const basePrice = sanitizeNum(freshProduct.price);
    const costPrice = lot.cost_price != null ? sanitizeNum(lot.cost_price) : 0;
    const rowTotal = Number((take * unitPrice).toFixed(4));
    const rowCost = Number((take * costPrice).toFixed(4));
    const rowDiscount = Math.max(0, Number((take * (basePrice - unitPrice)).toFixed(4)));

    deductions.push({
      lot_id: lot.id,
      lot_number: lot.lot_number,
      expiry_date: lot.expiry_date,
      cost_price: costPrice,
      unit_price: unitPrice,
      base_price: basePrice,
      promotion_price: lot.promotion_active ? unitPrice : null,
      promotion_discount: rowDiscount,
      quantity: Number(take.toFixed(4)),
    });
    lineTotal = Number((lineTotal + rowTotal).toFixed(4));
    costTotal = Number((costTotal + rowCost).toFixed(4));
    promotionDiscount = Number((promotionDiscount + rowDiscount).toFixed(4));
    remaining = Number((remaining - take).toFixed(4));
  }

  if (remaining > EPSILON) throw new Error('Falha ao consumir lotes: saldo inconsistente.');
  return {
    product: freshProduct,
    quantity: qty,
    beforeStock,
    deductions,
    lineTotal,
    costTotal,
    promotionDiscount,
    weightedUnitPrice: qty > 0 ? Number((lineTotal / qty).toFixed(4)) : 0,
  };
}

function applyFifoPlan(db, plan) {
  const updateLot = db.prepare(`
    UPDATE product_lots
       SET quantity=?,
           active=CASE WHEN ?>? THEN 1 ELSE 0 END,
           updated_at=datetime('now','localtime')
     WHERE id=?
  `);

  for (const d of plan.deductions) {
    const lot = db.prepare('SELECT quantity FROM product_lots WHERE id=?').get(d.lot_id);
    if (!lot || sanitizeNum(lot.quantity) + EPSILON < sanitizeNum(d.quantity)) {
      throw new Error('Saldo de lote insuficiente durante a baixa.');
    }
    const nextQty = Math.max(0, Number((sanitizeNum(lot.quantity) - sanitizeNum(d.quantity)).toFixed(4)));
    updateLot.run(nextQty, nextQty, EPSILON, d.lot_id);
  }

  const afterStock = syncProductStock(db, plan.product.id);
  return { ...plan, afterStock };
}

function consumeLotsFifo(db, product, quantity) {
  const plan = buildFifoPlan(db, product, quantity);
  const applied = applyFifoPlan(db, plan);
  return {
    beforeStock: applied.beforeStock,
    afterStock: applied.afterStock,
    deductions: applied.deductions,
    lineTotal: applied.lineTotal,
    costTotal: applied.costTotal,
    promotionDiscount: applied.promotionDiscount,
    weightedUnitPrice: applied.weightedUnitPrice,
  };
}

function restoreMovementEffect(db, movement) {
  if (!movement?.product_id || !['entry','exit'].includes(movement.type)) return;
  const product = getProduct(db, movement.product_id) ||
    db.prepare('SELECT * FROM products WHERE id=?').get(movement.product_id);
  if (!product) return;

  const qty = sanitizeNum(movement.quantity);
  if (qty <= 0) return;

  if (movement.type === 'entry') {
    if (!movement.lot_id) {
      const stock = Math.max(0, sanitizeNum(product.stock) - qty);
      db.prepare("UPDATE products SET stock=?,updated_at=datetime('now','localtime') WHERE id=?").run(stock, product.id);
      return;
    }

    const lot = db.prepare('SELECT * FROM product_lots WHERE id=?').get(movement.lot_id);
    if (!lot) return;
    if (sanitizeNum(lot.quantity) + EPSILON < qty) {
      throw new Error('Não é possível editar/excluir esta entrada: parte do lote já foi consumida.');
    }
    const nextQty = Math.max(0, Number((sanitizeNum(lot.quantity) - qty).toFixed(4)));
    db.prepare(`
      UPDATE product_lots
         SET quantity=?,
             active=CASE WHEN ?>? THEN 1 ELSE 0 END,
             updated_at=datetime('now','localtime')
       WHERE id=?
    `).run(nextQty, nextQty, EPSILON, lot.id);
    syncProductStock(db, product.id);
    return;
  }

  const afterData = parseJson(movement.after_data, {});
  const deductions = Array.isArray(afterData.deductions) ? afterData.deductions : [];
  if (!deductions.length) {
    db.prepare(`
      INSERT INTO product_lots(
        product_id, lot_number, quantity, initial_quantity, supplier,
        received_at, created_at, updated_at
      ) VALUES(?,?,?,?,?,datetime('now','localtime'),datetime('now','localtime'),datetime('now','localtime'))
    `).run(product.id, 'REPOSICAO', qty, qty, 'Reposição automática');
  } else {
    const restoreLot = db.prepare(`
      UPDATE product_lots
         SET quantity=quantity+?,
             active=1,
             updated_at=datetime('now','localtime')
       WHERE id=?
    `);
    for (const d of deductions) {
      restoreLot.run(sanitizeNum(d.quantity), sanitizeInt(d.lot_id));
    }
  }
  syncProductStock(db, product.id);
}

function movementSnapshot(mv) {
  if (!mv) return null;
  return {
    product_id: mv.product_id,
    product_name: mv.product_name,
    type: mv.type,
    quantity: sanitizeNum(mv.quantity),
    lot_number: mv.lot_number || null,
    expiry_date: mv.expiry_date || null,
    supplier: mv.supplier || null,
    cost_price: mv.cost_price != null ? sanitizeNum(mv.cost_price) : null,
    notes: mv.notes || null,
  };
}

function updateEntryMovementWithDelta(db, old, data) {
  const product = requireProduct(db, data.product_id);
  const oldProductId = sanitizeInt(old.product_id);
  const oldQty = sanitizeNum(old.quantity);
  const newQty = sanitizeNum(data.quantity);
  const delta = Number((newQty - oldQty).toFixed(4));
  const lot = db.prepare('SELECT * FROM product_lots WHERE id=?').get(old.lot_id);
  if (!lot) throw new Error('Lote da entrada original não encontrado.');

  if (delta < 0 && sanitizeNum(lot.quantity) + EPSILON < Math.abs(delta)) {
    throw new Error('Não é possível reduzir esta entrada abaixo da quantidade já consumida.');
  }

  const productChanged = oldProductId !== product.id;
  const beforeStock = getLotStock(db, oldProductId);
  const beforeTargetStock = productChanged ? getLotStock(db, product.id) : beforeStock;
  const nextLotQty = Math.max(0, Number((sanitizeNum(lot.quantity) + delta).toFixed(4)));
  const nextInitialQty = Math.max(0, Number((sanitizeNum(lot.initial_quantity) + delta).toFixed(4)));

  db.prepare(`
    UPDATE product_lots
       SET product_id=?,
           lot_number=?,
           quantity=?,
           initial_quantity=?,
           expiry_date=?,
           supplier=?,
           cost_price=?,
           active=CASE WHEN ?>? THEN 1 ELSE 0 END,
           updated_at=datetime('now','localtime')
     WHERE id=?
  `).run(
    product.id,
    data.lot_number,
    nextLotQty,
    nextInitialQty,
    data.expiry_date,
    data.supplier,
    data.cost_price,
    nextLotQty,
    EPSILON,
    old.lot_id,
  );

  const afterStock = syncProductStock(db, product.id);
  const afterOldStock = productChanged ? syncProductStock(db, oldProductId) : null;
  const beforeData = productChanged
    ? { stock: beforeStock, target_stock: beforeTargetStock }
    : { stock: beforeStock };
  const afterData = productChanged
    ? { stock: afterStock, previous_product_stock: afterOldStock, lot_id: old.lot_id, delta }
    : { stock: afterStock, lot_id: old.lot_id, delta };
  db.prepare(`
    UPDATE stock_movements
       SET product_id=?,
           lot_id=?,
           product_name=?,
           type='entry',
           quantity=?,
           lot_number=?,
           expiry_date=?,
           supplier=?,
           cost_price=?,
           source=?,
           before_data=?,
           after_data=?,
           notes=?
     WHERE id=?
  `).run(
    product.id,
    old.lot_id,
    product.name,
    newQty,
    data.lot_number,
    data.expiry_date,
    data.supplier,
    data.cost_price,
    old.source || 'manual',
    jsonOrNull(beforeData),
    jsonOrNull(afterData),
    data.notes,
    old.id,
  );

  return db.prepare('SELECT * FROM stock_movements WHERE id=?').get(old.id);
}

function applyManualMovement(db, mv) {
  const type = ['entry','exit'].includes(mv.type) ? mv.type : 'entry';
  const qty = sanitizeNum(mv.quantity);
  if (qty <= 0) throw new Error('Quantidade deve ser maior que zero.');
  const product = requireProduct(db, mv.product_id);

  if (type === 'entry') {
    return addStockEntry(db, {
      product,
      quantity: qty,
      lot_number: mv.lot_number,
      expiry_date: mv.expiry_date,
      supplier: mv.supplier,
      cost_price: mv.cost_price,
      notes: mv.notes,
      source: mv.source || 'manual',
    }).movementId;
  }

  const consumption = consumeLotsFifo(db, product, qty);
  return recordStockMovement(db, {
    product_id: product.id,
    product_name: product.name,
    type: 'exit',
    quantity: qty,
    lot_number: mv.lot_number,
    expiry_date: mv.expiry_date,
    supplier: mv.supplier,
    cost_price: mv.cost_price,
    source: mv.source || 'manual',
    before_data: { stock: consumption.beforeStock },
    after_data: { stock: consumption.afterStock, deductions: consumption.deductions },
    notes: mv.notes,
  });
}

function getSessionSummary(db, registerId) {
  const rid = sanitizeInt(registerId);
  const totals = db.prepare(`
    SELECT COALESCE(SUM(total),0) AS total_sales,
      COALESCE(SUM(cost_total),0) AS cost_total,
      COALESCE(SUM(profit),0) AS profit,
      COALESCE(SUM(promotion_discount),0) AS promotion_discount,
      COALESCE(SUM(CASE WHEN payment_method='cash' THEN total END),0) AS total_cash,
      COALESCE(SUM(CASE WHEN payment_method='card' THEN total END),0) AS total_card,
      COALESCE(SUM(CASE WHEN payment_method='pix'  THEN total END),0) AS total_pix,
      COUNT(*) AS transaction_count
    FROM sales WHERE cash_register_id=? AND status='completed'
  `).get(rid);
  const sales = db.prepare(`
    SELECT s.*, cr.cashier_name
      FROM sales s
      LEFT JOIN cash_registers cr ON cr.id=s.cash_register_id
     WHERE s.cash_register_id=? AND s.status='completed'
     ORDER BY s.created_at DESC, s.id DESC
  `).all(rid);
  const items = db.prepare(`
    SELECT si.product_name,SUM(si.quantity) AS quantity,SUM(si.total) AS total
      FROM sale_items si
      JOIN sales s ON s.id=si.sale_id
     WHERE s.cash_register_id=? AND s.status='completed'
     GROUP BY si.product_name
     ORDER BY total DESC
  `).all(rid);
  const itemsByPayment = db.prepare(`
    SELECT si.product_name,
           s.payment_method,
           COALESCE(SUM(si.quantity),0) AS quantity,
           COALESCE(SUM(si.total),0) AS total,
           COUNT(DISTINCT s.id) AS transaction_count
      FROM sale_items si
      JOIN sales s ON s.id=si.sale_id
     WHERE s.cash_register_id=? AND s.status='completed'
     GROUP BY si.product_name, s.payment_method
     ORDER BY si.product_name COLLATE NOCASE ASC, total DESC
  `).all(rid);
  return { totals, sales, items, itemsByPayment };
}

function getSalesHistory(db, filters={}) {
  const params = [];
  const clauses = ['1=1'];
  const startDate = sanitizeDate(filters.startDate);
  const endDate = sanitizeDate(filters.endDate);
  const status = sanitizeStr(filters.status || 'completed', 30);
  const operator = sanitizeStr(filters.operator || '', 100);

  if (startDate) { clauses.push('s.date>=?'); params.push(startDate); }
  if (endDate) { clauses.push('s.date<=?'); params.push(endDate); }
  if (status && status !== 'all') { clauses.push('s.status=?'); params.push(status); }
  if (operator) { clauses.push('cr.cashier_name LIKE ?'); params.push(`%${operator}%`); }

  const sales = db.prepare(`
    SELECT s.*, cr.cashier_name
      FROM sales s
      LEFT JOIN cash_registers cr ON cr.id=s.cash_register_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY s.created_at DESC, s.id DESC
     LIMIT 1000
  `).all(...params);

  const totals = sales.reduce((acc, sale) => {
    const includeInTotals = status === 'all' ? sale.status === 'completed' : true;
    if (includeInTotals) {
      acc.total_sales += sanitizeNum(sale.total);
      acc.cost_total += sanitizeNum(sale.cost_total);
      acc.profit += sanitizeNum(sale.profit);
      acc.promotion_discount += sanitizeNum(sale.promotion_discount);
      if (sale.payment_method === 'cash') acc.total_cash += sanitizeNum(sale.total);
      if (sale.payment_method === 'card') acc.total_card += sanitizeNum(sale.total);
      if (sale.payment_method === 'pix') acc.total_pix += sanitizeNum(sale.total);
      acc.transaction_count += 1;
    }
    return acc;
  }, {
    total_sales: 0,
    cost_total: 0,
    profit: 0,
    promotion_discount: 0,
    total_cash: 0,
    total_card: 0,
    total_pix: 0,
    transaction_count: 0,
  });

  const itemClauses = [...clauses];
  if (status === 'all') itemClauses.push("s.status='completed'");
  const items = startDate && endDate ? db.prepare(`
    SELECT si.product_name,SUM(si.quantity) AS quantity,SUM(si.total) AS total
      FROM sale_items si
      JOIN sales s ON s.id=si.sale_id
      LEFT JOIN cash_registers cr ON cr.id=s.cash_register_id
     WHERE ${itemClauses.join(' AND ')}
     GROUP BY si.product_name
     ORDER BY total DESC
     LIMIT 50
  `).all(...params) : [];
  const itemsByPayment = startDate && endDate ? db.prepare(`
    SELECT si.product_name,
           s.payment_method,
           COALESCE(SUM(si.quantity),0) AS quantity,
           COALESCE(SUM(si.total),0) AS total,
           COUNT(DISTINCT s.id) AS transaction_count
      FROM sale_items si
      JOIN sales s ON s.id=si.sale_id
      LEFT JOIN cash_registers cr ON cr.id=s.cash_register_id
     WHERE ${itemClauses.join(' AND ')}
     GROUP BY si.product_name, s.payment_method
     ORDER BY si.product_name COLLATE NOCASE ASC, total DESC
     LIMIT 250
  `).all(...params) : [];

  return {
    startDate: startDate || null,
    endDate: endDate || null,
    filters: { status, operator },
    totals,
    sales,
    items,
    itemsByPayment,
  };
}

// ─── PRODUCTS ─────────────────────────────────────────────────────────────────
function registerProductHandlers() {
  ipcHandle('products:getAll', () =>
    getDb().prepare(`
      SELECT p.*,
        COALESCE(p.stock,0) AS current_stock,
        (SELECT COUNT(*) FROM product_lots pl WHERE pl.product_id=p.id AND pl.active=1 AND pl.quantity>0) AS lots_count,
        (SELECT COUNT(*) FROM product_lots pl WHERE pl.product_id=p.id AND pl.active=1 AND pl.quantity>0 AND pl.expiry_date IS NOT NULL AND date(pl.expiry_date) <= date('now','localtime','+30 days')) AS expiring_lots_count,
        (SELECT COUNT(*) FROM product_lots pl WHERE pl.product_id=p.id AND pl.active=1 AND pl.quantity>0 AND pl.promotion_active=1) AS promotion_lots_count,
        (SELECT MIN(expiry_date) FROM product_lots pl WHERE pl.product_id=p.id AND pl.active=1 AND pl.quantity>0 AND expiry_date IS NOT NULL) AS next_expiry_date,
        (SELECT pl.promotion_price
           FROM product_lots pl
          WHERE pl.product_id=p.id AND pl.active=1 AND pl.quantity>0 AND pl.promotion_active=1
          ORDER BY
            CASE WHEN pl.expiry_date IS NULL OR pl.expiry_date='' THEN 1 ELSE 0 END ASC,
            pl.expiry_date ASC, pl.received_at ASC, pl.id ASC
          LIMIT 1) AS next_promotion_price,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM product_lots pl
             WHERE pl.product_id=p.id AND pl.active=1 AND pl.quantity>0
               AND pl.expiry_date IS NOT NULL AND date(pl.expiry_date) < date('now','localtime')
          ) THEN 'expired'
          WHEN EXISTS (
            SELECT 1 FROM product_lots pl
             WHERE pl.product_id=p.id AND pl.active=1 AND pl.quantity>0
               AND pl.expiry_date IS NOT NULL AND date(pl.expiry_date) <= date('now','localtime','+7 days')
          ) THEN 'danger'
          WHEN EXISTS (
            SELECT 1 FROM product_lots pl
             WHERE pl.product_id=p.id AND pl.active=1 AND pl.quantity>0
               AND pl.expiry_date IS NOT NULL AND date(pl.expiry_date) <= date('now','localtime','+30 days')
          ) THEN 'warning'
          ELSE NULL
        END AS expiry_status
      FROM products p
      WHERE p.active=1
      ORDER BY p.name ASC
    `).all()
  );

  ipcHandle('products:search', (_, query) => {
    const term = sanitizeStr(query,200);
    const normalizedTerm = normalizeText(term);
    const rows = getDb().prepare(`
      SELECT p.*,
        COALESCE(p.stock,0) AS current_stock,
        (SELECT pl.promotion_price
           FROM product_lots pl
          WHERE pl.product_id=p.id AND pl.active=1 AND pl.quantity>0 AND pl.promotion_active=1
          ORDER BY
            CASE WHEN pl.expiry_date IS NULL OR pl.expiry_date='' THEN 1 ELSE 0 END ASC,
            pl.expiry_date ASC, pl.received_at ASC, pl.id ASC
          LIMIT 1) AS next_promotion_price
        FROM products p
       WHERE p.active=1
       ORDER BY p.name ASC
    `).all();
    return rows
      .filter(p => !normalizedTerm ||
        normalizeText(p.name).includes(normalizedTerm) ||
        normalizeText(p.barcode || '').includes(normalizedTerm)
      )
      .slice(0, 20);
  });

  ipcHandle('products:getById', (_, id) =>
    getDb().prepare('SELECT * FROM products WHERE id=?').get(sanitizeInt(id))
  );

  ipcHandle('products:quotePrice', (_, data={}) => {
    const db = getDb();
    const product = requireProduct(db, data.productId || data.product_id);
    const quantity = sanitizeNum(data.quantity, 1);
    const plan = buildFifoPlan(db, product, quantity);
    return {
      productId: product.id,
      unitPrice: plan.weightedUnitPrice,
      lineTotal: plan.lineTotal,
      basePrice: sanitizeNum(plan.product.price),
      promotionDiscount: plan.promotionDiscount,
      hasPromotion: plan.promotionDiscount > EPSILON,
    };
  });

  ipcHandle('products:save', (_, p) => {
    const db   = getDb();
    const name = sanitizeStr(p.name, 300);
    if (!name) throw new Error('Nome do produto é obrigatório.');
    const price   = sanitizeNum(p.price);
    const unit    = sanitizeStr(p.unit||'un', 20);
    const barcode = p.barcode ? sanitizeStr(p.barcode,100) : null;

    return db.transaction(() => {
      if (p.id) {
        const id = sanitizeInt(p.id);
        const before = db.prepare('SELECT * FROM products WHERE id=?').get(id);
        if (!before) throw new Error('Produto não encontrado.');

        db.prepare(`
          UPDATE products
             SET name=?,price=?,unit=?,barcode=?,updated_at=datetime('now','localtime')
           WHERE id=?
        `).run(name, price, unit, barcode, id);

        const after = db.prepare('SELECT * FROM products WHERE id=?').get(id);
        const beforeData = {};
        const afterData = {};
        for (const key of ['name','price','unit','barcode']) {
          if (String(before[key] ?? '') !== String(after[key] ?? '')) {
            beforeData[key] = before[key] ?? null;
            afterData[key] = after[key] ?? null;
          }
        }
        if (Object.keys(afterData).length) {
          recordStockMovement(db, {
            product_id: id,
            product_name: after.name,
            type: 'edit',
            quantity: 0,
            source: 'product',
            before_data: beforeData,
            after_data: afterData,
            notes: 'Produto editado manualmente.',
          });
        }
        return { id };
      }

      const r = db.prepare(`
        INSERT INTO products(name,price,unit,barcode,stock)
        VALUES(?,?,?,?,0)
      `).run(name,price,unit,barcode);

      recordStockMovement(db, {
        product_id: r.lastInsertRowid,
        product_name: name,
        type: 'edit',
        quantity: 0,
        source: 'product',
        after_data: { name, price, unit, barcode },
        notes: 'Produto cadastrado.',
      });

      return { id: r.lastInsertRowid };
    })();
  });

  ipcHandle('products:delete', (_, id) => {
    const db = getDb();
    return db.transaction(() => {
      const product = db.prepare('SELECT * FROM products WHERE id=?').get(sanitizeInt(id));
      if (!product) throw new Error('Produto não encontrado.');
      db.prepare("UPDATE products SET active=0,updated_at=datetime('now','localtime') WHERE id=?").run(product.id);
      recordStockMovement(db, {
        product_id: product.id,
        product_name: product.name,
        type: 'edit',
        quantity: 0,
        source: 'product',
        before_data: { active: 1 },
        after_data: { active: 0 },
        notes: 'Produto excluído logicamente.',
      });
      return { success: true };
    })();
  });
}

// ─── LOTS ────────────────────────────────────────────────────────────────────
function registerLotHandlers() {
  ipcHandle('productLots:getByProduct', (_, productId) =>
    getDb().prepare(`
      SELECT pl.*, p.name AS product_name, p.price AS product_price, p.unit AS product_unit
        FROM product_lots pl
        JOIN products p ON p.id=pl.product_id
       WHERE pl.product_id=? AND pl.active=1
       ORDER BY
         CASE WHEN pl.expiry_date IS NULL OR pl.expiry_date='' THEN 1 ELSE 0 END ASC,
         pl.expiry_date ASC,
         pl.received_at ASC,
         pl.id ASC
    `).all(sanitizeInt(productId))
  );

  ipcHandle('productLots:getExpiring', (_, days=30) =>
    getDb().prepare(`
      SELECT pl.*, p.name AS product_name, p.price AS product_price, p.unit AS product_unit
        FROM product_lots pl
        JOIN products p ON p.id=pl.product_id
       WHERE p.active=1
         AND pl.active=1
         AND pl.quantity>0
         AND pl.expiry_date IS NOT NULL
         AND date(pl.expiry_date) >= date('now','localtime')
         AND date(pl.expiry_date) <= date('now','localtime', ?)
       ORDER BY pl.expiry_date ASC, p.name ASC, pl.id ASC
       LIMIT 100
    `).all(`+${Math.max(1, Math.min(sanitizeInt(days,30), 365))} days`)
  );

  ipcHandle('productLots:setPromotion', (_, data) => {
    const db = getDb();
    return db.transaction(() => {
      const lotId = sanitizeInt(data.lotId);
      const lot = db.prepare(`
        SELECT pl.*, p.name AS product_name, p.price AS product_price
          FROM product_lots pl
          JOIN products p ON p.id=pl.product_id
         WHERE pl.id=? AND pl.active=1
      `).get(lotId);
      if (!lot) throw new Error('Lote não encontrado.');
      const price = sanitizeNum(data.promotionPrice);
      if (price < 0) throw new Error('Preço promocional inválido.');

      db.prepare(`
        UPDATE product_lots
           SET promotion_price=?,
               promotion_active=1,
               promotion_created_at=datetime('now','localtime'),
               updated_at=datetime('now','localtime')
         WHERE id=?
      `).run(price, lotId);

      recordStockMovement(db, {
        product_id: lot.product_id,
        lot_id: lot.id,
        product_name: lot.product_name,
        type: 'edit',
        quantity: 0,
        lot_number: lot.lot_number,
        expiry_date: lot.expiry_date,
        supplier: lot.supplier,
        cost_price: lot.cost_price,
        source: 'promotion',
        reference_type: 'product_lot',
        reference_id: lot.id,
        before_data: {
          promotion_active: lot.promotion_active,
          promotion_price: lot.promotion_price,
        },
        after_data: {
          promotion_active: 1,
          promotion_price: price,
        },
        notes: 'Promoção criada para lote próximo ao vencimento.',
      });

      return { success: true, lotId, promotionPrice: price };
    })();
  });

  ipcHandle('productLots:clearPromotion', (_, lotIdRaw) => {
    const db = getDb();
    return db.transaction(() => {
      const lotId = sanitizeInt(lotIdRaw);
      const lot = db.prepare(`
        SELECT pl.*, p.name AS product_name
          FROM product_lots pl
          JOIN products p ON p.id=pl.product_id
         WHERE pl.id=?
      `).get(lotId);
      if (!lot) throw new Error('Lote não encontrado.');

      db.prepare(`
        UPDATE product_lots
           SET promotion_price=NULL,
               promotion_active=0,
               promotion_created_at=NULL,
               updated_at=datetime('now','localtime')
         WHERE id=?
      `).run(lotId);

      recordStockMovement(db, {
        product_id: lot.product_id,
        lot_id: lot.id,
        product_name: lot.product_name,
        type: 'edit',
        quantity: 0,
        lot_number: lot.lot_number,
        expiry_date: lot.expiry_date,
        supplier: lot.supplier,
        cost_price: lot.cost_price,
        source: 'promotion',
        reference_type: 'product_lot',
        reference_id: lot.id,
        before_data: {
          promotion_active: lot.promotion_active,
          promotion_price: lot.promotion_price,
        },
        after_data: {
          promotion_active: 0,
          promotion_price: null,
        },
        notes: 'Promoção removida do lote.',
      });

      return { success: true };
    })();
  });

  ipcHandle('productLots:add', (_, data) => {
    const db = getDb();
    return db.transaction(() => {
      const product = requireProduct(db, data.product_id);
      const result = addStockEntry(db, {
        product,
        quantity: sanitizeNum(data.quantity),
        lot_number: data.lot_number ? sanitizeStr(data.lot_number,100) : null,
        expiry_date: data.expiry_date ? sanitizeDate(data.expiry_date) : null,
        supplier: data.supplier ? sanitizeStr(data.supplier,300) : null,
        cost_price: data.cost_price != null ? sanitizeNum(data.cost_price) : null,
        notes: data.notes ? sanitizeStr(data.notes,1000) : 'Entrada via gestão de lotes.',
        source: 'lot',
        reference_type: 'product_lot',
      });
      return { id: result.lotId, movementId: result.movementId, stock: result.afterStock };
    })();
  });
}

// ─── STOCK MOVEMENTS ──────────────────────────────────────────────────────────
function registerMovementsHandlers() {
  ipcHandle('movements:getAll', (_, filters={}) => {
    const params=[], clauses=["NOT (COALESCE(source,'manual')='sale' AND type='exit')"];
    const limit = Math.max(1, Math.min(sanitizeInt(filters.limit,20), 50));
    const offset = Math.max(0, sanitizeInt(filters.offset,0));
    const productNameFilter = normalizeText(filters.productName || '');

    if (filters.productId) { clauses.push('product_id=?'); params.push(sanitizeInt(filters.productId)); }
    if (filters.type && MOVEMENT_TYPES.has(filters.type)) { clauses.push('type=?'); params.push(filters.type); }
    if (filters.startDate && sanitizeDate(filters.startDate)) { clauses.push("date(created_at)>=?"); params.push(filters.startDate); }
    if (filters.endDate   && sanitizeDate(filters.endDate))   { clauses.push("date(created_at)<=?"); params.push(filters.endDate); }
    if (filters.supplier)  { clauses.push('supplier LIKE ?'); params.push(`%${sanitizeStr(filters.supplier,200)}%`); }

    const rows = getDb().prepare(`
      SELECT *
        FROM stock_movements
       WHERE ${clauses.join(' AND ')}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?
    `).all(
      ...params,
      productNameFilter ? 5000 : limit + 1,
      productNameFilter ? 0 : offset
    );

    const filteredRows = productNameFilter
      ? rows.filter(row => normalizeText(row.product_name).includes(productNameFilter))
      : rows;
    const pageRows = productNameFilter
      ? filteredRows.slice(offset, offset + limit + 1)
      : filteredRows;

    return {
      items: pageRows.slice(0, limit),
      hasMore: pageRows.length > limit,
      nextOffset: offset + Math.min(pageRows.length, limit),
    };
  });

  ipcHandle('movements:getById', (_, id) =>
    getDb().prepare('SELECT * FROM stock_movements WHERE id=?').get(sanitizeInt(id))
  );

  ipcHandle('movements:save', (_, mv) => {
    const db = getDb();
    const type = ['entry','exit'].includes(mv.type)?mv.type:'entry';
    const qty  = sanitizeNum(mv.quantity);
    if (qty<=0) throw new Error('Quantidade deve ser maior que zero.');
    if (!mv.product_id) throw new Error('Selecione um produto cadastrado para movimentar estoque.');

    const data = {
      product_id:  sanitizeInt(mv.product_id),
      type,
      quantity: qty,
      lot_number:  mv.lot_number  ? sanitizeStr(mv.lot_number,100)  : null,
      expiry_date: mv.expiry_date ? sanitizeDate(mv.expiry_date)    : null,
      supplier:    mv.supplier    ? sanitizeStr(mv.supplier,300)    : null,
      cost_price:  mv.cost_price != null ? sanitizeNum(mv.cost_price) : null,
      notes:       mv.notes       ? sanitizeStr(mv.notes,1000)      : null,
      source: 'manual',
    };

    return db.transaction(() => {
      if (mv.id) {
        const old = db.prepare('SELECT * FROM stock_movements WHERE id=?').get(sanitizeInt(mv.id));
        if (!old) throw new Error('Movimentação não encontrada.');
        if (!['manual','lot'].includes(old.source || 'manual')) {
          throw new Error('Movimentações automáticas não podem ser editadas manualmente.');
        }
        if (!['entry','exit'].includes(old.type)) {
          throw new Error('Este registro é apenas auditoria e não pode ser editado.');
        }

        const before = movementSnapshot(old);
        if (old.type === 'entry' && data.type === 'entry' && old.lot_id) {
          const afterRow = updateEntryMovementWithDelta(db, old, data);
          recordStockMovement(db, {
            product_id: data.product_id,
            product_name: afterRow.product_name,
            type: 'edit',
            quantity: 0,
            source: 'manual',
            reference_type: 'stock_movement',
            reference_id: afterRow.id,
            before_data: before,
            after_data: movementSnapshot(afterRow),
            notes: 'Entrada editada por delta.',
          });
          return { id: afterRow.id };
        }

        restoreMovementEffect(db, old);
        db.prepare('DELETE FROM stock_movements WHERE id=?').run(old.id);
        const newId = applyManualMovement(db, data);
        const afterRow = db.prepare('SELECT * FROM stock_movements WHERE id=?').get(newId);
        recordStockMovement(db, {
          product_id: data.product_id,
          product_name: afterRow.product_name,
          type: 'edit',
          quantity: 0,
          source: 'manual',
          reference_type: 'stock_movement',
          reference_id: newId,
          before_data: before,
          after_data: movementSnapshot(afterRow),
          notes: 'Movimentação editada manualmente.',
        });
        return { id: newId };
      }

      return { id: applyManualMovement(db, data) };
    })();
  });

  ipcHandle('movements:delete', (_, id) => {
    const db = getDb();
    return db.transaction(() => {
      const old = db.prepare('SELECT * FROM stock_movements WHERE id=?').get(sanitizeInt(id));
      if (!old) throw new Error('Movimentação não encontrada.');
      if (!['manual','lot'].includes(old.source || 'manual')) {
        throw new Error('Movimentações automáticas não podem ser excluídas manualmente.');
      }
      if (!['entry','exit'].includes(old.type)) {
        throw new Error('Este registro é apenas auditoria e não pode ser excluído.');
      }
      const before = movementSnapshot(old);
      restoreMovementEffect(db, old);
      db.prepare('DELETE FROM stock_movements WHERE id=?').run(old.id);
      recordStockMovement(db, {
        product_id: old.product_id,
        product_name: old.product_name,
        type: 'edit',
        quantity: 0,
        source: 'manual',
        reference_type: 'stock_movement',
        reference_id: old.id,
        before_data: before,
        after_data: { deleted: true },
        notes: 'Movimentação excluída manualmente.',
      });
      return { success: true };
    })();
  });
}

// ─── CASH REGISTER ────────────────────────────────────────────────────────────
function registerCashRegisterHandlers() {
  ipcHandle('cashRegister:getStatus', () =>
    getDb().prepare("SELECT * FROM cash_registers WHERE status='open' ORDER BY opened_at DESC LIMIT 1").get() || null
  );

  ipcHandle('cashRegister:open', (_, data) => {
    const db=getDb(), today=new Date().toISOString().slice(0,10);
    db.prepare("UPDATE cash_registers SET status='closed',closed_at=datetime('now','localtime') WHERE status='open' AND date!=?").run(today);
    const existing = db.prepare("SELECT * FROM cash_registers WHERE status='open' AND date=?").get(today);
    if (existing) return existing;
    const r = db.prepare("INSERT INTO cash_registers(opening_balance,cashier_name,date) VALUES(?,?,date('now','localtime'))")
      .run(sanitizeNum(data.openingBalance), sanitizeStr(data.cashierName||'Operador',100));
    return db.prepare('SELECT * FROM cash_registers WHERE id=?').get(r.lastInsertRowid);
  });

  ipcHandle('cashRegister:getSessionSummary', (_, registerId) => {
    const db = getDb();
    const register = db.prepare('SELECT * FROM cash_registers WHERE id=?').get(sanitizeInt(registerId));
    if (!register) throw new Error('Caixa não encontrado.');
    const summary = getSessionSummary(db, register.id);
    return { register, ...summary };
  });

  ipcHandle('cashRegister:close', async (_, data) => {
    const db=getDb(), rid=sanitizeInt(data.registerId);
    const register = db.prepare('SELECT * FROM cash_registers WHERE id=?').get(rid);
    if (!register) throw new Error('Caixa não encontrado.');
    if (register.status !== 'open') throw new Error('Este caixa já está fechado.');

    const closingNotes = sanitizeStr(data.notes||'',1000);
    const { totals, sales, items } = getSessionSummary(db, rid);
    const closingBalance = (register.opening_balance||0) + (totals.total_cash||0);
    db.prepare(`
      UPDATE cash_registers
         SET status='closed',
             closing_balance=?,
             total_sales=?,
             total_cash=?,
             total_card=?,
             total_pix=?,
             transaction_count=?,
             closed_at=datetime('now','localtime'),
             notes=?
       WHERE id=?
    `).run(
      closingBalance,
      totals.total_sales,
      totals.total_cash,
      totals.total_card,
      totals.total_pix,
      totals.transaction_count,
      closingNotes,
      rid,
    );

    const updated = db.prepare('SELECT * FROM cash_registers WHERE id=?').get(rid);
    const reportData = { date:updated.date, totals, register:updated, sales, items, closingNotes };

    let emailResult=null;
    try { emailResult=await sendDailyReport(reportData); }
    catch(err) { emailResult={success:false,error:err.message}; }
    const backupResult = await createBackup('cash_close').catch(err=>({success:false,error:err.message}));
    return { register:updated, reportData, sessionTotals: totals, emailResult, backupResult };
  });

  ipcHandle('cashRegister:getHistory', (_, limit=30) =>
    getDb().prepare('SELECT * FROM cash_registers ORDER BY opened_at DESC LIMIT ?').all(sanitizeInt(limit,30))
  );
}

// ─── SALES ────────────────────────────────────────────────────────────────────
function registerSaleHandlers() {
  ipcHandle('sales:create', (_, sd) => {
    const db=getDb();
    if (!sd.items?.length) throw new Error('Venda sem itens.');
    if (!sd.cashRegisterId) throw new Error('Caixa não aberto.');
    if (!['cash','card','pix'].includes(sd.paymentMethod)) throw new Error('Forma de pagamento inválida.');

    return db.transaction(() => {
      const register = db.prepare("SELECT * FROM cash_registers WHERE id=? AND status='open'").get(sanitizeInt(sd.cashRegisterId));
      if (!register) throw new Error('Caixa não aberto.');

      const normalizedItems = sd.items.map(i => {
        const quantity = sanitizeNum(i.quantity);
        if (quantity <= 0) throw new Error('Item inválido.');

        let product = null;
        let unitPrice = sanitizeNum(i.unitPrice);
        let name = sanitizeStr(i.name,300);
        const productId = i.productId ? sanitizeInt(i.productId) : null;
        if (productId) {
          product = requireProduct(db, productId);
          unitPrice = sanitizeNum(product.price);
          name = product.name;
        }
        if (!name) throw new Error('Item sem nome.');
        if (unitPrice < 0) throw new Error('Preço inválido.');

        if (product) {
          const plan = buildFifoPlan(db, product, quantity);
          return {
            product,
            productId,
            name,
            quantity,
            plan,
            unitPrice: plan.weightedUnitPrice,
            total: plan.lineTotal,
            costTotal: plan.costTotal,
            promotionDiscount: plan.promotionDiscount,
          };
        }

        const total = Number((quantity * unitPrice).toFixed(4));
        return { product, productId, name, quantity, unitPrice, total, costTotal: 0, promotionDiscount: 0 };
      });

      const subtotal = Number(normalizedItems.reduce((s,i) => s + i.total, 0).toFixed(4));
      const discount = Math.max(0, Math.min(sanitizeNum(sd.discount), subtotal));
      const total = Number(Math.max(0, subtotal - discount).toFixed(4));
      const costTotal = Number(normalizedItems.reduce((s,i) => s + (i.costTotal || 0), 0).toFixed(4));
      const promotionDiscount = Number(normalizedItems.reduce((s,i) => s + (i.promotionDiscount || 0), 0).toFixed(4));
      const profit = Number((total - costTotal).toFixed(4));

      const saleRes = db.prepare(`
        INSERT INTO sales(cash_register_id,subtotal,discount,total,cost_total,profit,promotion_discount,payment_method)
        VALUES(?,?,?,?,?,?,?,?)
      `).run(register.id, subtotal, discount, total, costTotal, profit, promotionDiscount, sd.paymentMethod);
      const saleId = saleRes.lastInsertRowid;
      const ins = db.prepare(`
        INSERT INTO sale_items(sale_id,product_id,product_name,quantity,unit_price,cost_total,promotion_discount,total)
        VALUES(?,?,?,?,?,?,?,?)
      `);

      for (const item of normalizedItems) {
        const itemRes = ins.run(
          saleId,
          item.productId,
          item.name,
          item.quantity,
          item.unitPrice,
          item.costTotal || 0,
          item.promotionDiscount || 0,
          item.total,
        );
        if (item.product) {
          const consumption = applyFifoPlan(db, item.plan);
          recordStockMovement(db, {
            product_id: item.product.id,
            product_name: item.product.name,
            type: 'exit',
            quantity: item.quantity,
            source: 'sale',
            reference_type: 'sale',
            reference_id: saleId,
            before_data: { stock: consumption.beforeStock },
            after_data: {
              stock: consumption.afterStock,
              sale_id: saleId,
              sale_item_id: itemRes.lastInsertRowid,
              deductions: consumption.deductions,
              cost_total: item.costTotal || 0,
              promotion_discount: item.promotionDiscount || 0,
            },
            notes: `Baixa automática da venda #${String(saleId).padStart(4,'0')}.`,
          });
        }
      }

      db.prepare(`
        UPDATE cash_registers SET
          total_sales=total_sales+?,
          total_cash=total_cash+CASE WHEN ?='cash' THEN ? ELSE 0 END,
          total_card=total_card+CASE WHEN ?='card' THEN ? ELSE 0 END,
          total_pix=total_pix+CASE WHEN ?='pix' THEN ? ELSE 0 END,
          transaction_count=transaction_count+1
        WHERE id=?
      `).run(total,sd.paymentMethod,total,sd.paymentMethod,total,sd.paymentMethod,total,register.id);

      return { id: saleId, subtotal, discount, total, costTotal, profit, promotionDiscount };
    })();
  });

  ipcHandle('sales:cancel', (_, saleId) => {
    const db=getDb();
    return db.transaction(() => {
      const sale=db.prepare('SELECT * FROM sales WHERE id=?').get(sanitizeInt(saleId));
      if (!sale) throw new Error('Venda não encontrada.');
      if (sale.status === 'cancelled') return { success: true };

      const movements = db.prepare(`
        SELECT * FROM stock_movements
         WHERE source='sale' AND reference_type='sale' AND reference_id=? AND type='exit'
      `).all(sale.id);

      for (const mv of movements) {
        const beforeStock = mv.product_id ? getLotStock(db, mv.product_id) : 0;
        restoreMovementEffect(db, mv);
        const afterStock = mv.product_id ? getLotStock(db, mv.product_id) : 0;
        recordStockMovement(db, {
          product_id: mv.product_id,
          product_name: mv.product_name,
          type: 'entry',
          quantity: mv.quantity,
          source: 'sale_cancel',
          reference_type: 'sale',
          reference_id: sale.id,
          before_data: { stock: beforeStock },
          after_data: { stock: afterStock },
          notes: `Reposição automática pelo cancelamento da venda #${String(sale.id).padStart(4,'0')}.`,
        });
      }

      db.prepare("UPDATE sales SET status='cancelled' WHERE id=?").run(sale.id);
      db.prepare(`
        UPDATE cash_registers SET
          total_sales=MAX(0,total_sales-?),
          total_cash=MAX(0,total_cash-CASE WHEN ?='cash' THEN ? ELSE 0 END),
          total_card=MAX(0,total_card-CASE WHEN ?='card' THEN ? ELSE 0 END),
          total_pix=MAX(0,total_pix-CASE WHEN ?='pix' THEN ? ELSE 0 END),
          transaction_count=MAX(0,transaction_count-1)
        WHERE id=?
      `).run(sale.total,sale.payment_method,sale.total,sale.payment_method,sale.total,sale.payment_method,sale.total,sale.cash_register_id);
      return { success: true };
    })();
  });

  ipcHandle('sales:getItems', (_, saleId) =>
    getDb().prepare('SELECT * FROM sale_items WHERE sale_id=? ORDER BY id ASC').all(sanitizeInt(saleId))
  );
}

// ─── REPORTS ─────────────────────────────────────────────────────────────────
function registerReportHandlers() {
  ipcHandle('reports:daily', (_, date) => {
    const db=getDb(), day=sanitizeDate(date)||new Date().toISOString().slice(0,10);
    const register = db.prepare("SELECT * FROM cash_registers WHERE date=? ORDER BY opened_at DESC LIMIT 1").get(day);
    const totals   = db.prepare(`
      SELECT COALESCE(SUM(total),0) AS total_sales,
        COALESCE(SUM(cost_total),0) AS cost_total,
        COALESCE(SUM(profit),0) AS profit,
        COALESCE(SUM(promotion_discount),0) AS promotion_discount,
        COALESCE(SUM(CASE WHEN payment_method='cash' THEN total END),0) AS total_cash,
        COALESCE(SUM(CASE WHEN payment_method='card' THEN total END),0) AS total_card,
        COALESCE(SUM(CASE WHEN payment_method='pix' THEN total END),0) AS total_pix,
        COUNT(*) AS transaction_count
      FROM sales WHERE date=? AND status='completed'
    `).get(day);
    const sales    = db.prepare(`
      SELECT s.*, cr.cashier_name
        FROM sales s
        LEFT JOIN cash_registers cr ON cr.id=s.cash_register_id
       WHERE s.date=? AND s.status='completed'
       ORDER BY s.created_at DESC, s.id DESC
    `).all(day);
    const items    = db.prepare(`
      SELECT si.product_name,SUM(si.quantity) AS quantity,SUM(si.total) AS total
        FROM sale_items si
        JOIN sales s ON s.id=si.sale_id
       WHERE s.date=? AND s.status='completed'
       GROUP BY si.product_name
       ORDER BY total DESC
    `).all(day);
    const itemsByPayment = db.prepare(`
      SELECT si.product_name,
             s.payment_method,
             COALESCE(SUM(si.quantity),0) AS quantity,
             COALESCE(SUM(si.total),0) AS total,
             COUNT(DISTINCT s.id) AS transaction_count
        FROM sale_items si
        JOIN sales s ON s.id=si.sale_id
       WHERE s.date=? AND s.status='completed'
       GROUP BY si.product_name, s.payment_method
       ORDER BY si.product_name COLLATE NOCASE ASC, total DESC
    `).all(day);
    return { date:day, register, totals, sales, items, itemsByPayment };
  });

  ipcHandle('reports:salesHistory', (_, filters={}) => getSalesHistory(getDb(), filters));

  ipcHandle('reports:exportSales', async (_, filters={}) => {
    const db = getDb();
    const data = getSalesHistory(db, filters);
    const storeName = db.prepare("SELECT value FROM settings WHERE key='store_name'").get()?.value || 'PDV';
    const start = data.startDate || sanitizeDate(filters.startDate) || new Date().toISOString().slice(0,10);
    const end = data.endDate || sanitizeDate(filters.endDate) || start;
    const statusTag = sanitizeStr(filters.status || 'completed', 30).replace(/[^a-z0-9_-]/gi, '') || 'vendas';
    const baseName = `relatorio-vendas-${start}-a-${end}-${statusTag}`;
    const dir = app.getPath('downloads');
    const excelPath = path.join(dir, `${baseName}.xlsx`);
    const csvPath = path.join(dir, `${baseName}.csv`);

    const workbookBuffer = await generateSalesHistoryWorkbook(data, storeName);
    const csv = generateSalesHistoryCsv(data);
    fs.writeFileSync(excelPath, Buffer.from(workbookBuffer));
    fs.writeFileSync(csvPath, '\uFEFF' + csv, 'utf8');
    return { success: true, baseName, excelPath, csvPath };
  });

  ipcHandle('reports:movements', (_, filters={}) => {
    const params=[], clauses=["NOT (COALESCE(source,'manual')='sale' AND type='exit')"];
    if (filters.startDate) { clauses.push("date(created_at)>=?"); params.push(sanitizeDate(filters.startDate)||filters.startDate); }
    if (filters.endDate)   { clauses.push("date(created_at)<=?"); params.push(sanitizeDate(filters.endDate)||filters.endDate); }
    if (filters.type && MOVEMENT_TYPES.has(filters.type)) { clauses.push('type=?'); params.push(filters.type); }
    if (filters.productId) { clauses.push('product_id=?'); params.push(sanitizeInt(filters.productId)); }
    return getDb().prepare(`SELECT * FROM stock_movements WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT 500`).all(...params);
  });

  ipcHandle('reports:range', (_, startDate, endDate) => {
    const sd=sanitizeDate(startDate), ed=sanitizeDate(endDate);
    if (!sd||!ed) throw new Error('Datas inválidas.');
    return getDb().prepare(`
      SELECT date,
        SUM(total) AS total_sales,
        COUNT(*) AS transaction_count,
        AVG(total) AS avg_ticket,
        SUM(CASE WHEN payment_method='cash' THEN total ELSE 0 END) AS total_cash,
        SUM(CASE WHEN payment_method='card' THEN total ELSE 0 END) AS total_card,
        SUM(CASE WHEN payment_method='pix' THEN total ELSE 0 END) AS total_pix
      FROM sales
      WHERE date BETWEEN ? AND ? AND status='completed'
      GROUP BY date
      ORDER BY date DESC
    `).all(sd,ed);
  });
}

// ─── SETTINGS ────────────────────────────────────────────────────────────────
function registerSettingsHandlers() {
  ipcHandle('settings:getAll', () => {
    const rows=getDb().prepare('SELECT key,value FROM settings').all();
    const obj=Object.fromEntries(rows.map(r=>[r.key,r.value]));
    delete obj.admin_password_hash;
    delete obj.admin_session_key;
    obj.email_host_display = process.env.EMAIL_HOST||'(não configurado)';
    obj.email_user_display = process.env.EMAIL_USER||'(não configurado)';
    return obj;
  });

  ipcHandle('settings:get', (_, key) => {
    if (PROTECTED_KEYS.has(String(key))) return null;
    return getDb().prepare('SELECT value FROM settings WHERE key=?').get(String(key))?.value??null;
  });

  ipcHandle('settings:save', (_, key, value) => {
    const k=String(key);
    if (PROTECTED_KEYS.has(k)||ENV_ONLY_KEYS.has(k)) throw new Error(`"${k}" não pode ser alterado pela interface.`);
    getDb().prepare("INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES(?,?,datetime('now','localtime'))").run(k, String(value??''));
    return { success:true };
  });

  ipcHandle('settings:saveMany', (_, obj) => {
    const db=getDb();
    const stmt=db.prepare("INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES(?,?,datetime('now','localtime'))");
    db.transaction((entries) => {
      for (const [k,v] of entries) {
        if (PROTECTED_KEYS.has(k)||ENV_ONLY_KEYS.has(k)) continue;
        stmt.run(String(k), String(v??''));
      }
    })(Object.entries(obj));
    return { success:true };
  });
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function registerAuthHandlers() {
  ipcHandle('auth:hasPassword', () => {
    const hash=getDb().prepare("SELECT value FROM settings WHERE key='admin_password_hash'").get()?.value||'';
    return hash.length>10;
  });

  ipcHandle('auth:setPassword', async (_, { oldPassword, newPassword }) => {
    const db=getDb();
    const hash=db.prepare("SELECT value FROM settings WHERE key='admin_password_hash'").get()?.value||'';
    if (hash.length>10) {
      const ok=await bcrypt.compare(String(oldPassword||''), hash);
      if (!ok) throw new Error('Senha atual incorreta.');
    }
    const pw=String(newPassword||'');
    if (pw.length<4) throw new Error('A nova senha deve ter pelo menos 4 caracteres.');
    const newHash=await bcrypt.hash(pw,10);
    db.prepare("INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES('admin_password_hash',?,datetime('now','localtime'))").run(newHash);
    return { success:true };
  });

  ipcHandle('auth:verify', async (_, password) => {
    const hash=getDb().prepare("SELECT value FROM settings WHERE key='admin_password_hash'").get()?.value||'';
    if (!hash||hash.length<10) return true;
    return await bcrypt.compare(String(password||''), hash);
  });
}

// ─── EMAIL / BACKUP ───────────────────────────────────────────────────────────
function registerEmailHandlers() {
  ipcHandle('email:test',       async ()    => await sendTestEmail());
  ipcHandle('email:sendReport', async (_,r) => await sendDailyReport(r));
}

function registerBackupHandlers() {
  ipcHandle('backup:create',     async () => await createBackup('manual'));
  ipcHandle('backup:getHistory', ()       => getBackupHistory());
  ipcHandle('backup:getDir',     ()       => getBackupDir());
}

module.exports = { registerIpcHandlers };
