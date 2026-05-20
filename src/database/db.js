'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');
const fs = require('fs');

let db = null;

function getDatabasePath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'pdv_database.sqlite');
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initializeDatabase() first.');
  return db;
}

function initializeDatabase() {
  const dbPath = getDatabasePath();
  const userDataPath = path.dirname(dbPath);

  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }

  db = new Database(dbPath, { verbose: process.env.NODE_ENV === 'development' ? console.log : null });

  // Performance tuning
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('cache_size = -8000'); // 8MB cache

  createSchema();
  seedDefaultSettings();

  console.log(`[DB] Initialized at: ${dbPath}`);
  return db;
}

function createSchema() {
  db.exec(`
    -- ===== PRODUTOS =====
    CREATE TABLE IF NOT EXISTS products (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      price       REAL    NOT NULL DEFAULT 0,
      unit        TEXT    NOT NULL DEFAULT 'un',
      barcode     TEXT,
      stock       REAL    NOT NULL DEFAULT 0,
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT    DEFAULT (datetime('now','localtime')),
      updated_at  TEXT    DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_products_name    ON products(name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);

    -- ===== CAIXA (SESSÕES) =====
    CREATE TABLE IF NOT EXISTS cash_registers (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      date             TEXT    NOT NULL DEFAULT (date('now','localtime')),
      opening_balance  REAL    NOT NULL DEFAULT 0,
      closing_balance  REAL,
      total_sales      REAL    NOT NULL DEFAULT 0,
      total_cash       REAL    NOT NULL DEFAULT 0,
      total_card       REAL    NOT NULL DEFAULT 0,
      total_pix        REAL    NOT NULL DEFAULT 0,
      transaction_count INTEGER NOT NULL DEFAULT 0,
      status           TEXT    NOT NULL DEFAULT 'open',
      cashier_name     TEXT,
      opened_at        TEXT    DEFAULT (datetime('now','localtime')),
      closed_at        TEXT,
      notes            TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cash_registers_date   ON cash_registers(date);
    CREATE INDEX IF NOT EXISTS idx_cash_registers_status ON cash_registers(status);

    -- ===== VENDAS =====
    CREATE TABLE IF NOT EXISTS sales (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      cash_register_id INTEGER REFERENCES cash_registers(id),
      date             TEXT    NOT NULL DEFAULT (date('now','localtime')),
      time             TEXT    NOT NULL DEFAULT (time('now','localtime')),
      subtotal         REAL    NOT NULL DEFAULT 0,
      discount         REAL    NOT NULL DEFAULT 0,
      total            REAL    NOT NULL DEFAULT 0,
      cost_total       REAL    NOT NULL DEFAULT 0,
      profit           REAL    NOT NULL DEFAULT 0,
      promotion_discount REAL  NOT NULL DEFAULT 0,
      payment_method   TEXT    NOT NULL DEFAULT 'cash',
      status           TEXT    NOT NULL DEFAULT 'completed',
      notes            TEXT,
      created_at       TEXT    DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_sales_date             ON sales(date);
    CREATE INDEX IF NOT EXISTS idx_sales_cash_register_id ON sales(cash_register_id);

    -- ===== ITENS DA VENDA =====
    CREATE TABLE IF NOT EXISTS sale_items (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id      INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_id   INTEGER REFERENCES products(id),
      product_name TEXT    NOT NULL,
      quantity     REAL    NOT NULL DEFAULT 1,
      unit_price   REAL    NOT NULL DEFAULT 0,
      cost_total   REAL    NOT NULL DEFAULT 0,
      promotion_discount REAL NOT NULL DEFAULT 0,
      total        REAL    NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);

    -- ===== MOVIMENTAÇÕES DE ESTOQUE =====
    CREATE TABLE IF NOT EXISTS stock_movements (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id   INTEGER REFERENCES products(id),
      lot_id       INTEGER REFERENCES product_lots(id),
      product_name TEXT    NOT NULL,
      type         TEXT    NOT NULL DEFAULT 'entry',  -- 'entry' | 'exit' | 'edit'
      quantity     REAL    NOT NULL DEFAULT 0,
      lot_number   TEXT,
      expiry_date  TEXT,
      supplier     TEXT,
      cost_price   REAL,
      source       TEXT    NOT NULL DEFAULT 'manual',
      reference_type TEXT,
      reference_id INTEGER,
      before_data  TEXT,
      after_data   TEXT,
      notes        TEXT,
      created_at   TEXT    DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_date    ON stock_movements(created_at);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_type    ON stock_movements(type);

    -- ===== LOTES / VALIDADES =====
    CREATE TABLE IF NOT EXISTS product_lots (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id       INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      lot_number       TEXT,
      quantity         REAL    NOT NULL DEFAULT 0,
      initial_quantity REAL    NOT NULL DEFAULT 0,
      expiry_date      TEXT,
      supplier         TEXT,
      cost_price       REAL,
      promotion_price  REAL,
      promotion_active INTEGER NOT NULL DEFAULT 0,
      promotion_created_at TEXT,
      received_at      TEXT    DEFAULT (datetime('now','localtime')),
      active           INTEGER NOT NULL DEFAULT 1,
      created_at       TEXT    DEFAULT (datetime('now','localtime')),
      updated_at       TEXT    DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_product_lots_product ON product_lots(product_id);
    CREATE INDEX IF NOT EXISTS idx_product_lots_expiry  ON product_lots(expiry_date);
    CREATE INDEX IF NOT EXISTS idx_product_lots_fifo    ON product_lots(product_id, active, quantity, expiry_date, created_at);
    CREATE INDEX IF NOT EXISTS idx_product_lots_promo   ON product_lots(promotion_active, expiry_date);

    -- ===== CONFIGURAÇÕES (KEY-VALUE) =====
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- ===== LOG DE BACKUPS =====
    CREATE TABLE IF NOT EXISTS backup_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      file_path  TEXT,
      status     TEXT,
      size_bytes INTEGER,
      trigger    TEXT DEFAULT 'auto'
    );
  `);

  runMigrations();
  backfillInventoryLots();
}

function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
}

function addColumnIfMissing(table, column, definition) {
  if (!columnExists(table, column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

function runMigrations() {
  addColumnIfMissing('stock_movements', 'lot_id', 'INTEGER REFERENCES product_lots(id)');
  addColumnIfMissing('stock_movements', 'source', "TEXT NOT NULL DEFAULT 'manual'");
  addColumnIfMissing('stock_movements', 'reference_type', 'TEXT');
  addColumnIfMissing('stock_movements', 'reference_id', 'INTEGER');
  addColumnIfMissing('stock_movements', 'before_data', 'TEXT');
  addColumnIfMissing('stock_movements', 'after_data', 'TEXT');
  addColumnIfMissing('sales', 'cost_total', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('sales', 'profit', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('sales', 'promotion_discount', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('sale_items', 'cost_total', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('sale_items', 'promotion_discount', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('product_lots', 'promotion_price', 'REAL');
  addColumnIfMissing('product_lots', 'promotion_active', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('product_lots', 'promotion_created_at', 'TEXT');

  db.prepare('UPDATE products SET stock=0 WHERE stock IS NULL').run();
}

function backfillInventoryLots() {
  db.exec(`
    UPDATE products
       SET stock = COALESCE((
         SELECT SUM(CASE
           WHEN sm.type='entry' THEN sm.quantity
           WHEN sm.type='exit'  THEN -sm.quantity
           ELSE 0
         END)
         FROM stock_movements sm
         WHERE sm.product_id=products.id
       ), stock, 0)
     WHERE active=1
       AND (
         stock IS NULL
         OR NOT EXISTS (SELECT 1 FROM product_lots pl WHERE pl.product_id=products.id)
       );

    INSERT INTO product_lots (
      product_id, lot_number, quantity, initial_quantity, supplier,
      received_at, created_at, updated_at
    )
    SELECT p.id, 'SALDO-INICIAL', p.stock, p.stock, 'Migração',
           datetime('now','localtime'), datetime('now','localtime'), datetime('now','localtime')
      FROM products p
     WHERE p.active=1
       AND p.stock > 0
       AND NOT EXISTS (SELECT 1 FROM product_lots pl WHERE pl.product_id=p.id);
  `);
}

function seedDefaultSettings() {
  const defaults = [
    ['store_name',        process.env.STORE_NAME    || 'Meu Comércio'],
    ['store_cnpj',        process.env.STORE_CNPJ    || ''],
    ['store_address',     process.env.STORE_ADDRESS || ''],
    ['store_phone',       process.env.STORE_PHONE   || ''],
    ['email_to',          process.env.EMAIL_TO      || ''],
    ['email_user',        process.env.EMAIL_USER    || ''],
    ['email_host',        process.env.EMAIL_HOST    || 'smtp.gmail.com'],
    ['email_port',        process.env.EMAIL_PORT    || '587'],
    ['currency_symbol',   'R$'],
    ['backup_max_files',  process.env.BACKUP_MAX_FILES       || '30'],
    ['backup_schedule',   process.env.BACKUP_SCHEDULE_TIME   || '23:50'],
    ['last_backup_date',  ''],
    ['admin_password_hash', ''],   // empty = no password set yet
    ['admin_session_key',   ''],   // ephemeral session token
  ];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)
  `);

  const insertAll = db.transaction((rows) => {
    for (const [k, v] of rows) insert.run(k, String(v));
  });

  insertAll(defaults);
}

function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    console.log('[DB] Connection closed.');
  }
}

module.exports = { initializeDatabase, getDb, getDatabasePath, closeDatabase };
