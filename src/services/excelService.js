'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ExcelJS = require('exceljs');
const { getDb } = require('../database/db');

const C = {
  ink: '1D1D1F',
  muted: '6E6E73',
  faint: 'F5F5F7',
  alt: 'FBFBFD',
  header: 'E5E5EA',
  border: 'D2D2D7',
  white: 'FFFFFF',
  blue: '007AFF',
  blueDark: '0B3A66',
  blueLight: 'E8F2FF',
  green: '34C759',
  greenLight: 'E8F8EE',
  red: 'FF3B30',
  redLight: 'FFE9E8',
  orange: 'FF9F0A',
  orangeLight: 'FFF5E6',
  track: 'EEF0F4',
};

const FONT = { name: 'Aptos', size: 10, color: { argb: `FF${C.ink}` } };
const MONEY_FMT = '"R$" #,##0.00;[Red]-"R$" #,##0.00';

async function generateReportWorkbook(reportData, storeName) {
  const today = reportData.date || todayStr();
  let payload = null;
  try {
    payload = buildDailyWorkbookPayload(reportData, storeName, today);
    return await generateChartedWorkbook('daily', payload);
  } catch (err) {
    console.warn('[EXCEL] Gerador com graficos indisponivel, usando fallback ExcelJS:', err.message);
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'PDV Sistema';
  wb.company = storeName;
  wb.created = new Date();
  wb.modified = new Date();

  buildTodaySheet(wb, reportData, storeName);
  buildPeriodSheet(wb, 'Ultimos 7 dias', subtractDays(today, 6), today, storeName, payload?.periods?.[0]);
  buildPeriodSheet(wb, 'Ultimos 30 dias', subtractDays(today, 29), today, storeName, payload?.periods?.[1]);

  return wb.xlsx.writeBuffer();
}

async function generateSalesHistoryWorkbook(reportData, storeName) {
  try {
    return await generateChartedWorkbook('sales_history', buildSalesHistoryWorkbookPayload(reportData, storeName));
  } catch (err) {
    console.warn('[EXCEL] Gerador com graficos indisponivel, usando fallback ExcelJS:', err.message);
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'PDV Sistema';
  wb.company = storeName;
  wb.created = new Date();
  wb.modified = new Date();

  buildSalesSummarySheet(wb, reportData, storeName);
  buildProductPaymentSheet(wb, reportData, storeName);
  buildProductSummarySheet(wb, reportData, storeName);

  return wb.xlsx.writeBuffer();
}

function generateSalesHistoryCsv(reportData) {
  const totals = reportData.totals || {};
  const rows = [[
    'Periodo',
    'Gerado em',
    'Produto',
    'Forma de pagamento',
    'Quantidade vendida',
    'Receita',
    'Participacao no total',
    'Transacoes',
  ]];

  const productRows = productPaymentItems(reportData);
  if (productRows.length) {
    productRows.forEach(item => rows.push([
      periodText(reportData),
      new Date().toLocaleString('pt-BR'),
      item.product_name || '',
      paymentLabel(item.payment_method),
      quantityCsv(item.quantity),
      decimalCsv(item.total),
      percentCsv(item.total, totals.total_sales),
      item.transaction_count || '',
    ]));
  } else {
    rows.push([periodText(reportData), new Date().toLocaleString('pt-BR'), 'Sem produtos vendidos', '', '', '', '', '']);
  }
  return rows.map(row => row.map(csvCell).join(';')).join('\n');
}

function buildDailyWorkbookPayload(reportData, storeName, today) {
  const periods = [
    loadPeriodData('Ultimos 7 dias', subtractDays(today, 6), today),
    loadPeriodData('Ultimos 30 dias', subtractDays(today, 29), today),
  ].map(period => ({ ...period, storeName }));

  return {
    storeName,
    generatedAt: new Date().toISOString(),
    report: reportData,
    periods,
  };
}

function buildSalesHistoryWorkbookPayload(reportData, storeName) {
  return {
    storeName,
    generatedAt: new Date().toISOString(),
    report: reportData,
    dailyRows: buildDailyRowsFromSales(reportData.sales || [], reportData.filters?.status || 'completed'),
  };
}

async function generateChartedWorkbook(kind, payload) {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pdv-report-'));
  const outputPath = path.join(tmpDir, `${kind}.xlsx`);
  const input = JSON.stringify(payload);
  let lastError = null;

  try {
    for (const candidate of reportBuilderCandidates()) {
      try {
        await runReportBuilder(candidate.command, [...candidate.args, kind, outputPath], input);
        return await fs.promises.readFile(outputPath);
      } catch (err) {
        lastError = err;
      }
    }
  } finally {
    fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  throw lastError || new Error('Gerador de XLSX com graficos indisponivel.');
}

function resolvePythonBuilderPath() {
  const scriptPath = path.join(__dirname, 'reportWorkbookBuilder.py');
  if (scriptPath.includes(`${path.sep}app.asar${path.sep}`)) {
    const unpackedPath = scriptPath.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
    if (fs.existsSync(unpackedPath)) return unpackedPath;
  }
  return scriptPath;
}

function reportBuilderCandidates() {
  const bundled = bundledReportBuilderPaths().map(command => ({ command, args: [] }));
  const scriptPath = resolvePythonBuilderPath();
  const python = pythonCandidates().map(candidate => ({
    command: candidate.command,
    args: [...candidate.args, scriptPath],
  }));
  return [...bundled, ...python];
}

function bundledReportBuilderPaths() {
  const exeName = process.platform === 'win32' ? 'reportWorkbookBuilder.exe' : 'reportWorkbookBuilder';
  const platformArch = `${process.platform}-${process.arch}`;
  const roots = [
    process.resourcesPath ? path.join(process.resourcesPath, 'report-workbook-builder') : null,
    path.join(path.resolve(__dirname, '..', '..'), 'build', 'report-workbook-builder'),
  ].filter(Boolean);
  const relPaths = [
    path.join(platformArch, 'reportWorkbookBuilder', exeName),
    path.join(process.platform, 'reportWorkbookBuilder', exeName),
    path.join('reportWorkbookBuilder', exeName),
  ];
  const seen = new Set();

  return roots
    .flatMap(root => relPaths.map(rel => path.join(root, rel)))
    .filter(candidate => {
      if (seen.has(candidate) || !fs.existsSync(candidate)) return false;
      seen.add(candidate);
      return true;
    });
}

function pythonCandidates() {
  const configured = process.env.PDV_REPORT_PYTHON || process.env.PYTHON;
  if (configured) return [{ command: configured, args: [] }];

  const localVenvPython = path.join(
    path.resolve(__dirname, '..', '..'),
    '.venv-report-charts',
    process.platform === 'win32' ? 'Scripts' : 'bin',
    process.platform === 'win32' ? 'python.exe' : 'python',
  );

  const localCandidates = fs.existsSync(localVenvPython)
    ? [{ command: localVenvPython, args: [] }]
    : [];

  if (process.platform === 'win32') {
    return [
      ...localCandidates,
      { command: 'py', args: ['-3'] },
      { command: 'python', args: [] },
      { command: 'python3', args: [] },
    ];
  }
  return [
    ...localCandidates,
    { command: 'python3', args: [] },
    { command: 'python', args: [] },
  ];
}

function runReportBuilder(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let done = false;

    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(new Error('Tempo limite ao gerar XLSX com graficos.'));
    }, 30000);

    child.stdout.on('data', chunk => { stdout += chunk.toString().slice(0, 4000); });
    child.stderr.on('data', chunk => { stderr += chunk.toString().slice(0, 4000); });
    child.on('error', err => finish(err));
    child.on('close', code => {
      if (code === 0) return finish();
      const detail = stderr || stdout || `processo finalizou com codigo ${code}`;
      return finish(new Error(detail.trim()));
    });
    child.stdin.end(input);
  });
}

function loadPeriodData(label, startDate, endDate) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT date,
           COALESCE(SUM(total),0) AS total_sales,
           COALESCE(SUM(cost_total),0) AS cost_total,
           COALESCE(SUM(profit),0) AS profit,
           COUNT(*) AS transactions,
           COALESCE(AVG(total),0) AS avg_ticket,
           COALESCE(SUM(CASE WHEN payment_method='cash' THEN total ELSE 0 END),0) AS cash,
           COALESCE(SUM(CASE WHEN payment_method='card' THEN total ELSE 0 END),0) AS card,
           COALESCE(SUM(CASE WHEN payment_method='pix' THEN total ELSE 0 END),0) AS pix
      FROM sales
     WHERE date BETWEEN ? AND ? AND status='completed'
     GROUP BY date
     ORDER BY date ASC
  `).all(startDate, endDate);

  const totals = rows.reduce((acc, row) => {
    acc.total_sales += row.total_sales || 0;
    acc.cost_total += row.cost_total || 0;
    acc.profit += row.profit || 0;
    acc.transactions += row.transactions || 0;
    acc.cash += row.cash || 0;
    acc.card += row.card || 0;
    acc.pix += row.pix || 0;
    return acc;
  }, { total_sales: 0, cost_total: 0, profit: 0, transactions: 0, cash: 0, card: 0, pix: 0 });

  const topProducts = db.prepare(`
    SELECT si.product_name,
           COALESCE(SUM(si.quantity),0) AS quantity,
           COALESCE(SUM(si.total),0) AS total
      FROM sale_items si
      JOIN sales s ON s.id=si.sale_id
     WHERE s.date BETWEEN ? AND ? AND s.status='completed'
     GROUP BY si.product_name
     ORDER BY total DESC
     LIMIT 20
  `).all(startDate, endDate);
  const itemsByPayment = db.prepare(`
    SELECT si.product_name,
           s.payment_method,
           COALESCE(SUM(si.quantity),0) AS quantity,
           COALESCE(SUM(si.total),0) AS total,
           COUNT(DISTINCT s.id) AS transaction_count
      FROM sale_items si
      JOIN sales s ON s.id=si.sale_id
     WHERE s.date BETWEEN ? AND ? AND s.status='completed'
     GROUP BY si.product_name, s.payment_method
     ORDER BY si.product_name COLLATE NOCASE ASC, total DESC
     LIMIT 250
  `).all(startDate, endDate);

  return { label, startDate, endDate, rows, totals, topProducts, itemsByPayment };
}

function buildDailyRowsFromSales(sales, status='completed') {
  const map = new Map();
  (sales || []).forEach(sale => {
    const include = status === 'all' ? sale.status === 'completed' : true;
    if (!include) return;
    const date = sale.date || '';
    if (!date) return;
    const day = map.get(date) || {
      date,
      total_sales: 0,
      cost_total: 0,
      profit: 0,
      transactions: 0,
      cash: 0,
      card: 0,
      pix: 0,
    };
    const total = Number(sale.total || 0);
    day.total_sales += total;
    day.cost_total += Number(sale.cost_total || 0);
    day.profit += Number(sale.profit || 0);
    day.transactions += 1;
    if (sale.payment_method === 'cash') day.cash += total;
    if (sale.payment_method === 'card') day.card += total;
    if (sale.payment_method === 'pix') day.pix += total;
    map.set(date, day);
  });

  return [...map.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(day => ({
      ...day,
      avg_ticket: day.transactions > 0 ? day.total_sales / day.transactions : 0,
    }));
}

function productPaymentItems(data) {
  const rows = data?.itemsByPayment?.length
    ? data.itemsByPayment
    : (data?.items || []).map(item => ({ ...item, payment_method: '', transaction_count: '' }));
  return rows
    .map(item => ({
      product_name: item.product_name || '',
      payment_method: item.payment_method || '',
      quantity: Number(item.quantity || 0),
      total: Number(item.total || 0),
      transaction_count: item.transaction_count || '',
    }))
    .sort((a, b) => {
      const byProduct = a.product_name.localeCompare(b.product_name, 'pt-BR', { sensitivity: 'base' });
      if (byProduct) return byProduct;
      return Number(b.total || 0) - Number(a.total || 0);
    });
}

function buildSalesSummarySheet(wb, data, storeName) {
  const ws = wb.addWorksheet('Resumo', {
    views: [{ state: 'frozen', ySplit: 6 }],
    pageSetup: { fitToPage: true, fitToWidth: 1, orientation: 'portrait' },
    properties: { tabColor: { argb: `FF${C.blue}` } },
  });
  ws.columns = [
    { key: 'a', width: 22 },
    { key: 'b', width: 18 },
    { key: 'c', width: 4 },
    { key: 'd', width: 22 },
    { key: 'e', width: 18 },
    { key: 'f', width: 10 },
    { key: 'g', width: 10 },
    { key: 'h', width: 10 },
  ];

  const totals = data.totals || {};
  const avgTicket = totals.transaction_count > 0 ? totals.total_sales / totals.transaction_count : 0;
  addTitle(ws, storeName, `Relatorio de vendas - ${periodText(data)}`, 8);
  addSection(ws, 'Indicadores', 8);
  addKeyValueGrid(ws, [
    ['Total de vendas', totals.total_sales || 0, 'moneyBlue'],
    ['Transacoes', totals.transaction_count || 0, 'number'],
    ['Ticket medio', avgTicket, 'money'],
    ['Custo dos produtos', totals.cost_total || 0, 'money'],
    ['Lucro', totals.profit || 0, 'moneyGreen'],
    ['Desconto promocional', totals.promotion_discount || 0, 'money'],
  ]);

  addSection(ws, 'Formas de pagamento', 8);
  addHeader(ws, ['Forma', 'Valor', 'Participacao'], 1, 3);
  [
    ['Dinheiro', totals.total_cash || 0],
    ['Cartao', totals.total_card || 0],
    ['PIX', totals.total_pix || 0],
  ].forEach(([label, value]) => {
    const row = addDataRow(ws, [label, value, totals.total_sales > 0 ? value / totals.total_sales : 0], 3);
    row.getCell(2).numFmt = MONEY_FMT;
    row.getCell(3).numFmt = '0.0%';
  });
  addPaymentBars(ws, totals, 8);
  addProductBars(ws, data.items || [], 8, 'Produtos por receita');

  finishSheet(ws);
}

function buildProductPaymentSheet(wb, data, storeName) {
  const ws = wb.addWorksheet('Produtos por pagamento', {
    views: [{ state: 'frozen', ySplit: 5 }],
    pageSetup: { fitToPage: true, fitToWidth: 1, orientation: 'landscape' },
    properties: { tabColor: { argb: `FF${C.green}` } },
  });
  ws.columns = [
    { key: 'product', width: 34 },
    { key: 'payment', width: 18 },
    { key: 'qty', width: 16 },
    { key: 'total', width: 16 },
    { key: 'share', width: 16 },
    { key: 'transactions', width: 14 },
    { key: 'b1', width: 8 },
    { key: 'b2', width: 8 },
    { key: 'b3', width: 8 },
    { key: 'b4', width: 8 },
  ];

  const totals = data.totals || {};
  const rows = productPaymentItems(data);
  const maxTotal = Math.max(...rows.map(item => Number(item.total || 0)), 0);

  addTitle(ws, storeName, `Produtos por pagamento - ${periodText(data)}`, 10);
  addSection(ws, 'Resumo por produto e forma de pagamento', 10);
  addBarHeader(ws, ['Produto', 'Pagamento', 'Quantidade'], 10);
  const header = ws.lastRow;
  header.getCell(4).value = 'Receita';
  header.getCell(5).value = 'Participacao';
  header.getCell(6).value = 'Transacoes';
  header.getCell(7).value = 'Visual';

  rows.forEach(item => {
    const row = addSegmentBarRow(
      ws,
      [
        item.product_name,
        paymentLabel(item.payment_method),
        item.quantity,
        item.total,
        (totals.total_sales || 0) > 0 ? item.total / totals.total_sales : 0,
        item.transaction_count || '',
      ],
      maxTotal > 0 ? item.total / maxTotal : 0,
      10,
      paymentColor(item.payment_method),
      { value3: '#,##0.###', value4: MONEY_FMT, value5: '0.0%', value6: '#,##0' },
    );
    row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  });

  finishSheet(ws);
}

function buildProductSummarySheet(wb, data, storeName) {
  const ws = wb.addWorksheet('Produtos', {
    views: [{ state: 'frozen', ySplit: 5 }],
    pageSetup: { fitToPage: true, fitToWidth: 1, orientation: 'portrait' },
    properties: { tabColor: { argb: `FF${C.orange}` } },
  });
  ws.columns = [
    { key: 'product', width: 34 },
    { key: 'qty', width: 14 },
    { key: 'total', width: 16 },
    { key: 'b1', width: 7 },
    { key: 'b2', width: 7 },
    { key: 'b3', width: 7 },
    { key: 'b4', width: 7 },
    { key: 'b5', width: 7 },
  ];

  const rows = productPaymentItems(data);
  addTitle(ws, storeName, `Produtos vendidos - ${periodText(data)}`, 8);
  addSection(ws, 'Produtos por forma de pagamento', 8);
  addHeader(ws, ['Produto', 'Pagamento', 'Quantidade', 'Receita', 'Transacoes', 'Visual', '', ''], 1, 8);
  const maxTotal = Math.max(...rows.map(item => Number(item.total || 0)), 0);
  rows.forEach(item => {
    const row = addSegmentBarRow(
      ws,
      [
        item.product_name,
        paymentLabel(item.payment_method),
        Number(item.quantity || 0),
        item.total || 0,
        item.transaction_count || '',
      ],
      maxTotal > 0 ? Number(item.total || 0) / maxTotal : 0,
      8,
      C.orange,
      { value3: '#,##0.###', value4: MONEY_FMT, value5: '#,##0' },
    );
    row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  });
  finishSheet(ws);
}

function buildTodaySheet(wb, data, storeName) {
  const ws = wb.addWorksheet('Hoje', {
    views: [{ state: 'frozen', ySplit: 6 }],
    pageSetup: { fitToPage: true, fitToWidth: 1, orientation: 'portrait' },
  });

  ws.columns = [
    { key: 'a', width: 16 },
    { key: 'b', width: 20 },
    { key: 'c', width: 18 },
    { key: 'd', width: 18 },
    { key: 'e', width: 18 },
    { key: 'f', width: 18 },
    { key: 'g', width: 18 },
  ];

  addTitle(ws, storeName, `Fechamento de caixa - ${formatPtDate(data.date)}`, 7);

  const totals = data.totals || {};
  const register = data.register || {};
  const avgTicket = totals.transaction_count > 0 ? totals.total_sales / totals.transaction_count : 0;

  addSection(ws, 'Resumo', 7);
  addKeyValueGrid(ws, [
    ['Total de vendas', totals.total_sales || 0, 'money'],
    ['Transacoes', totals.transaction_count || 0, 'number'],
    ['Ticket medio', avgTicket, 'money'],
    ['Custo dos produtos', totals.cost_total || 0, 'money'],
    ['Lucro', totals.profit || 0, 'moneyGreen'],
    ['Desconto promocional', totals.promotion_discount || 0, 'money'],
    ['Saldo de abertura', register.opening_balance || 0, 'money'],
    ['Saldo final em caixa', (register.opening_balance || 0) + (totals.total_cash || 0), 'money'],
  ]);

  addSection(ws, 'Formas de pagamento', 7);
  addHeader(ws, ['Forma', 'Valor', 'Participacao'], 1, 3);
  [
    ['Dinheiro', totals.total_cash || 0],
    ['Cartao', totals.total_card || 0],
    ['PIX', totals.total_pix || 0],
  ].forEach(([label, value]) => {
    const row = addDataRow(ws, [label, value, totals.total_sales > 0 ? value / totals.total_sales : 0], 3);
    row.getCell(2).numFmt = MONEY_FMT;
    row.getCell(3).numFmt = '0.0%';
  });
  addPaymentBars(ws, totals, 7);

  if (data.closingNotes || register.notes) {
    addSection(ws, 'Observacoes do fechamento', 7);
    const row = ws.addRow([data.closingNotes || register.notes]);
    ws.mergeCells(row.number, 1, row.number, 7);
    row.height = 44;
    styleBodyCell(row.getCell(1));
    row.getCell(1).alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
  }

  const itemsByPayment = productPaymentItems(data);
  if (itemsByPayment.length) {
    addSection(ws, 'Produtos por forma de pagamento', 7);
    addHeader(ws, ['Produto', 'Pagamento', 'Quantidade', 'Total', 'Transacoes'], 1, 5);
    itemsByPayment.forEach(item => {
      const row = addDataRow(ws, [
        item.product_name,
        paymentLabel(item.payment_method),
        Number(item.quantity || 0),
        item.total || 0,
        item.transaction_count || '',
      ], 5);
      row.getCell(3).numFmt = '#,##0.###';
      row.getCell(4).numFmt = MONEY_FMT;
      row.getCell(5).numFmt = '#,##0';
    });
    addProductBars(ws, data.items, 7, 'Visual de produtos');
  }

  finishSheet(ws);
}

function buildPeriodSheet(wb, label, startDate, endDate, storeName, periodData=null) {
  const period = periodData || loadPeriodData(label, startDate, endDate);
  const ws = wb.addWorksheet(label, {
    views: [{ state: 'frozen', ySplit: 6 }],
    pageSetup: { fitToPage: true, fitToWidth: 1, orientation: 'landscape' },
  });

  ws.columns = [
    { key: 'date', width: 16 },
    { key: 'sales', width: 16 },
    { key: 'cost', width: 16 },
    { key: 'profit', width: 16 },
    { key: 'transactions', width: 14 },
    { key: 'avg', width: 16 },
    { key: 'cash', width: 16 },
    { key: 'card', width: 16 },
    { key: 'pix', width: 16 },
  ];

  addTitle(ws, storeName, `${label} - ${formatPtDate(startDate)} a ${formatPtDate(endDate)}`, 9);

  const rows = [...(period.rows || [])].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const totals = period.totals || { total_sales: 0, cost_total: 0, profit: 0, transactions: 0, cash: 0, card: 0, pix: 0 };

  addSection(ws, 'Resumo do periodo', 9);
  addKeyValueGrid(ws, [
    ['Total de vendas', totals.total_sales, 'money'],
    ['Custo dos produtos', totals.cost_total, 'money'],
    ['Lucro', totals.profit, 'moneyGreen'],
    ['Transacoes', totals.transactions, 'number'],
    ['Ticket medio', totals.transactions > 0 ? totals.total_sales / totals.transactions : 0, 'money'],
  ]);

  addSection(ws, 'Resumo diario', 9);
  addHeader(ws, ['Data', 'Vendas', 'Custo', 'Lucro', 'Transacoes', 'Ticket medio', 'Dinheiro', 'Cartao', 'PIX'], 1, 9);
  rows.forEach(row => {
    const r = addDataRow(ws, [
      formatPtDate(row.date),
      row.total_sales || 0,
      row.cost_total || 0,
      row.profit || 0,
      row.transactions || 0,
      row.avg_ticket || 0,
      row.cash || 0,
      row.card || 0,
      row.pix || 0,
    ], 9);
    [2, 3, 4, 6, 7, 8, 9].forEach(i => r.getCell(i).numFmt = MONEY_FMT);
    r.getCell(4).font = { ...FONT, bold: true, color: { argb: `FF${(row.profit || 0) >= 0 ? C.green : C.red}` } };
  });
  addDailyBars(ws, rows, 9);

  const topProducts = period.topProducts || [];
  const itemsByPayment = productPaymentItems(period);

  if (itemsByPayment.length) {
    addSection(ws, 'Produtos por forma de pagamento', 9);
    addHeader(ws, ['Produto', 'Pagamento', 'Quantidade', 'Receita', 'Transacoes'], 1, 5);
    itemsByPayment.forEach(product => {
      const r = addDataRow(ws, [
        product.product_name,
        paymentLabel(product.payment_method),
        Number(product.quantity || 0),
        product.total || 0,
        product.transaction_count || '',
      ], 5);
      r.getCell(3).numFmt = '#,##0.###';
      r.getCell(4).numFmt = MONEY_FMT;
      r.getCell(5).numFmt = '#,##0';
    });
    addProductBars(ws, topProducts, 9, 'Visual de produtos');
  }

  finishSheet(ws);
}

function addPaymentBars(ws, totals, cols) {
  const total = Number(totals.total_sales || 0);
  addSection(ws, 'Visual de pagamentos', cols);
  addBarHeader(ws, ['Forma', 'Valor', 'Participacao'], cols);
  [
    ['Dinheiro', totals.total_cash || 0, C.green],
    ['Cartao', totals.total_card || 0, C.blue],
    ['PIX', totals.total_pix || 0, C.orange],
  ].forEach(([label, value, color]) => {
    addSegmentBarRow(
      ws,
      [label, value, total > 0 ? value / total : 0],
      total > 0 ? value / total : 0,
      cols,
      color,
      { value2: MONEY_FMT, value3: '0.0%' },
    );
  });
}

function addProductBars(ws, items, cols, title) {
  const list = (items || []).slice(0, 10);
  if (!list.length) return;
  const maxTotal = Math.max(...list.map(item => Number(item.total || 0)), 0);
  addSection(ws, title, cols);
  addBarHeader(ws, ['Produto', 'Quantidade', 'Receita'], cols);
  list.forEach(item => {
    const row = addSegmentBarRow(
      ws,
      [item.product_name, Number(item.quantity || 0), item.total || 0],
      maxTotal > 0 ? Number(item.total || 0) / maxTotal : 0,
      cols,
      C.green,
      { value2: '#,##0.###', value3: MONEY_FMT },
    );
    row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  });
}

function addDailyBars(ws, rows, cols) {
  const list = (rows || []).slice(0, 14);
  if (!list.length) return;
  const maxSales = Math.max(...list.map(row => Number(row.total_sales || 0)), 0);
  addSection(ws, 'Visual diario', cols);
  addBarHeader(ws, ['Data', 'Vendas', 'Lucro'], cols);
  list.forEach(row => {
    const r = addSegmentBarRow(
      ws,
      [formatPtDate(row.date), row.total_sales || 0, row.profit || 0],
      maxSales > 0 ? Number(row.total_sales || 0) / maxSales : 0,
      cols,
      C.blue,
      { value2: MONEY_FMT, value3: MONEY_FMT },
    );
    r.getCell(3).font = { ...FONT, bold: true, color: { argb: `FF${(row.profit || 0) >= 0 ? C.green : C.red}` } };
  });
}

function addTitle(ws, storeName, subtitle, cols) {
  ws.mergeCells(1, 1, 1, cols);
  const title = ws.getCell(1, 1);
  title.value = storeName;
  title.font = { ...FONT, bold: true, size: 17, color: { argb: `FF${C.white}` } };
  title.alignment = { horizontal: 'left', vertical: 'middle' };
  title.fill = solid(C.blueDark);
  ws.getRow(1).height = 28;

  ws.mergeCells(2, 1, 2, cols);
  const sub = ws.getCell(2, 1);
  sub.value = subtitle;
  sub.font = { ...FONT, color: { argb: `FF${C.white}` } };
  sub.alignment = { horizontal: 'left', vertical: 'middle' };
  sub.fill = solid(C.blueDark);
  ws.getRow(2).height = 22;

  ws.addRow([]);
}

function addSection(ws, title, cols) {
  ws.addRow([]);
  const row = ws.addRow([title]);
  ws.mergeCells(row.number, 1, row.number, cols);
  const cell = row.getCell(1);
  cell.fill = solid(C.blueLight);
  cell.font = { ...FONT, bold: true, color: { argb: `FF${C.blueDark}` } };
  cell.alignment = { horizontal: 'left', vertical: 'middle' };
  cell.border = bottomBorder(C.border);
  row.height = 22;
}

function addHeader(ws, values, startCol, colCount) {
  const row = ws.addRow(values);
  for (let i = startCol; i <= colCount; i += 1) {
    const cell = row.getCell(i);
    cell.fill = solid(C.blueDark);
    cell.font = { ...FONT, bold: true, color: { argb: `FF${C.white}` } };
    cell.alignment = { vertical: 'middle', horizontal: i === 1 ? 'left' : 'center' };
    cell.border = thinBorder(C.border);
  }
  row.height = 22;
  return row;
}

function addBarHeader(ws, labels, colCount) {
  const values = Array(colCount).fill('');
  values[0] = labels[0];
  values[1] = labels[1];
  values[2] = labels[2];
  values[3] = 'Visual';
  return addHeader(ws, values, 1, colCount);
}

function addSegmentBarRow(ws, values, percent, colCount, color, formats={}) {
  const rowValues = Array(colCount).fill('');
  values.forEach((value, index) => {
    if (index < colCount) rowValues[index] = value;
  });
  const row = addDataRow(ws, rowValues, colCount);
  Object.entries(formats).forEach(([key, fmt]) => {
    const match = /^value(\d+)$/.exec(key);
    if (match) row.getCell(Number(match[1])).numFmt = fmt;
  });

  const visualStart = Math.min(values.length + 1, colCount);
  const segments = Math.max(1, colCount - values.length);
  const filled = percent > 0 ? Math.max(1, Math.round(percent * segments)) : 0;
  for (let col = visualStart; col <= colCount; col += 1) {
    const segment = col - values.length;
    const cell = row.getCell(col);
    cell.value = '';
    cell.fill = solid(segment <= filled ? color : C.track);
    cell.border = thinBorder(C.white);
  }
  row.height = 23;
  return row;
}

function addDataRow(ws, values, colCount) {
  const row = ws.addRow(values);
  for (let i = 1; i <= colCount; i += 1) {
    styleBodyCell(row.getCell(i), row.number);
  }
  return row;
}

function addKeyValueGrid(ws, items) {
  for (let i = 0; i < items.length; i += 2) {
    const left = items[i];
    const right = items[i + 1] || ['', '', ''];
    const row = ws.addRow([left[0], left[1], '', right[0], right[1]]);
    [1, 4].forEach(col => {
      const cell = row.getCell(col);
      cell.font = { ...FONT, color: { argb: `FF${C.muted}` } };
      cell.fill = solid(C.faint);
      cell.border = bottomBorder(C.border);
    });
    [[2, left[2]], [5, right[2]]].forEach(([col, kind]) => {
      const cell = row.getCell(col);
      const color = kind === 'moneyGreen' ? C.green : kind === 'moneyBlue' ? C.blue : C.ink;
      cell.font = { ...FONT, bold: true, color: { argb: `FF${color}` } };
      cell.alignment = { horizontal: 'right' };
      cell.fill = solid(C.faint);
      cell.border = bottomBorder(C.border);
      if (String(kind || '').startsWith('money')) cell.numFmt = MONEY_FMT;
      if (kind === 'number') cell.numFmt = '#,##0';
    });
  }
}

function finishSheet(ws) {
  ws.eachRow(row => {
    row.eachCell({ includeEmpty: true }, cell => {
      if (!cell.font) cell.font = FONT;
    });
  });

  ws.columns.forEach(column => {
    let max = 10;
    column.eachCell({ includeEmpty: true }, cell => {
      const value = cell.value == null ? '' : String(cell.value);
      max = Math.max(max, Math.min(value.length + 2, 42));
    });
    column.width = Math.max(column.width || 10, max);
  });

  ws.eachRow(row => {
    row.eachCell(cell => {
      cell.alignment = { ...(cell.alignment || {}), vertical: 'middle' };
    });
  });
}

function styleBodyCell(cell, rowNumber=null) {
  cell.font = FONT;
  cell.fill = solid(rowNumber && rowNumber % 2 === 0 ? C.alt : C.white);
  cell.border = bottomBorder(C.border);
  cell.alignment = { vertical: 'middle', horizontal: typeof cell.value === 'number' ? 'right' : 'left' };
}

function solid(color) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${color}` } };
}

function thinBorder(color) {
  const border = { style: 'thin', color: { argb: `FF${color}` } };
  return { top: border, left: border, bottom: border, right: border };
}

function bottomBorder(color) {
  return { bottom: { style: 'thin', color: { argb: `FF${color}` } } };
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function subtractDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function formatPtDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = String(dateStr).split('-');
  return `${d}/${m}/${y}`;
}

function formatTime(value) {
  return value ? String(value).slice(0, 5) : '';
}

function paymentLabel(value) {
  return { cash: 'Dinheiro', card: 'Cartao', pix: 'PIX' }[value] || value || '';
}

function paymentColor(value) {
  return { cash: C.green, card: C.blue, pix: C.orange }[value] || C.blue;
}

function statusLabel(value) {
  return { completed: 'Concluida', cancelled: 'Cancelada' }[value] || value || '';
}

function periodText(data) {
  if (data.startDate && data.endDate) return `${formatPtDate(data.startDate)} a ${formatPtDate(data.endDate)}`;
  if (data.date) return formatPtDate(data.date);
  return todayStr();
}

function decimalCsv(value) {
  return Number(value || 0).toFixed(2).replace('.', ',');
}

function quantityCsv(value) {
  return Number(value || 0).toFixed(3).replace(/\.?0+$/, '').replace('.', ',');
}

function percentCsv(value, total) {
  if (!total || !value) return '0,0%';
  return `${((Number(value || 0) / Number(total || 1)) * 100).toFixed(1).replace('.', ',')}%`;
}

function csvCell(value) {
  let s = String(value ?? '');
  const trimmed = s.trimStart();
  const numeric = /^-?\d+(?:[,.]\d+)?%?$/.test(trimmed);
  if (/^[=+@]/.test(trimmed) || (trimmed.startsWith('-') && !numeric)) {
    s = `'${s}`;
  }
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

module.exports = { generateReportWorkbook, generateSalesHistoryWorkbook, generateSalesHistoryCsv };
