'use strict';

let _currentReportData = null;

window.loadReport = async () => {
  const startDate = document.getElementById('reportStartDate')?.value || todayStr();
  const endDate   = document.getElementById('reportEndDate')?.value || startDate;
  const operator  = document.getElementById('reportOperator')?.value?.trim() || '';
  const status    = document.getElementById('reportStatus')?.value || 'completed';
  const kpiEl  = document.getElementById('kpiGrid');
  const bodyEl = document.getElementById('reportBody');
  if (kpiEl)  kpiEl.innerHTML  = skeletons();
  if (bodyEl) bodyEl.innerHTML = '';
  try {
    const data = await window.api.reports.salesHistory({ startDate, endDate, operator, status });
    _currentReportData = data;
    renderKpis(data.totals, data.register);
    renderBody(data);
  } catch (err) {
    if (kpiEl) kpiEl.innerHTML = `<p style="color:var(--color-danger);padding:16px;font-size:14px">Erro: ${err.message}</p>`;
  }
};

function skeletons() {
  return Array(4).fill(`<div class="kpi-card" style="opacity:.5"><div style="height:14px;width:80px;background:var(--color-surface-tertiary);border-radius:4px;margin-bottom:12px"></div><div style="height:32px;width:120px;background:var(--color-surface-tertiary);border-radius:4px"></div></div>`).join('');
}

function renderKpis(t={}, reg) {
  const el = document.getElementById('kpiGrid');
  if (!el) return;
  const avg = (t.transaction_count||0) > 0 ? (t.total_sales / t.transaction_count) : 0;
  const regStatus = reg
    ? (reg.status==='open' ? `<span style="color:var(--color-success);font-weight:600">● Aberto</span>` : `<span style="color:var(--color-text-tertiary)">● Fechado</span>`)
    : `<span style="color:var(--color-text-quaternary)">Sem registro</span>`;

  el.innerHTML = `
    <div class="kpi-card"><div class="kpi-label">Total de Vendas</div><div class="kpi-value" style="color:var(--color-primary)">${formatCurrency(t.total_sales||0)}</div><div class="kpi-sub">período filtrado</div></div>
    <div class="kpi-card"><div class="kpi-label">Transações</div><div class="kpi-value">${t.transaction_count||0}</div><div class="kpi-sub">${(t.transaction_count||0)===1?'venda':'vendas'} concluídas</div></div>
    <div class="kpi-card"><div class="kpi-label">Ticket Médio</div><div class="kpi-value">${formatCurrency(avg)}</div><div class="kpi-sub">por transação</div></div>
    <div class="kpi-card"><div class="kpi-label">Lucro</div><div class="kpi-value" style="color:var(--color-success)">${formatCurrency(t.profit||0)}</div><div class="kpi-sub">após custo dos produtos</div></div>`;
}

function renderBody(data) {
  const el = document.getElementById('reportBody');
  if (!el) return;
  const t   = data.totals||{};
  const periodLabel = data.startDate && data.endDate
    ? `${formatDate(data.startDate)} até ${formatDate(data.endDate)}`
    : 'Período selecionado';

  el.innerHTML = `
    <div class="report-summary-grid">
      <div class="report-card">
        <div class="report-card-header"><span class="report-card-title">Formas de Pagamento</span></div>
        <div class="payment-breakdown">
          ${pmRow('Dinheiro',t.total_cash,t.total_sales)}
          ${pmRow('Cartão',t.total_card,t.total_sales)}
          ${pmRow('PIX',t.total_pix,t.total_sales)}
        </div>
      </div>
      <div class="report-card">
        <div class="report-card-header"><span class="report-card-title">Resultado</span></div>
        <div class="report-result-list">
          ${resultRow('Receita bruta', t.total_sales)}
          ${resultRow('Custo dos produtos', t.cost_total)}
          ${resultRow('Desconto promocional', t.promotion_discount)}
          ${resultRow('Lucro', t.profit, true)}
        </div>
      </div>
    </div>
    <div class="report-card report-sales-card">
      <div class="report-card-header report-card-header-row">
        <span class="report-card-title">Vendas</span>
        <span class="report-period-label">${periodLabel}</span>
      </div>
      ${renderSalesList(data.sales)}
    </div>`;
}

function pmRow(label, val, total) {
  const pct = (total>0&&val>0) ? `${((val/total)*100).toFixed(0)}%` : '—';
  return `<div class="payment-row-report"><span class="payment-row-label">${label}</span><div class="payment-row-values"><span>${pct}</span><strong>${formatCurrency(val||0)}</strong></div></div>`;
}

function resultRow(label, value, highlight=false) {
  return `<div class="report-result-row ${highlight ? 'highlight' : ''}"><span>${label}</span><strong>${formatCurrency(value||0)}</strong></div>`;
}

function renderSalesList(sales) {
  if (!sales?.length) return '<div class="no-data">Nenhuma venda registrada.</div>';
  const mLabel = {cash:'Dinheiro',card:'Cartão',pix:'PIX'};
  const mBadge = {cash:'badge-green',card:'badge-blue',pix:'badge-orange'};
  const sLabel = {completed:'Concluída',cancelled:'Cancelada'};
  const sBadge = {completed:'badge-green',cancelled:'badge-red'};
  return `<div class="report-table-wrap"><table class="data-table report-sales-table">
    <thead><tr><th>Venda</th><th>Data</th><th>Hora</th><th>Operador</th><th>Status</th><th>Pagamento</th><th class="text-right">Desconto</th><th class="text-right">Total</th><th class="text-right">Lucro</th><th class="text-center">Ações</th></tr></thead>
    <tbody>${sales.map(s=>`<tr>
      <td style="font-family:var(--font-mono);font-size:12px;color:var(--color-text-tertiary)">#${String(s.id).padStart(4,'0')}</td>
      <td style="color:var(--color-text-secondary)">${formatPtDateShort(s.date)}</td>
      <td style="color:var(--color-text-secondary)">${formatTime(s.time)}</td>
      <td style="color:var(--color-text-secondary)">${escHtml(s.cashier_name || '—')}</td>
      <td><span class="badge ${sBadge[s.status]||'badge-blue'}">${sLabel[s.status]||s.status}</span></td>
      <td><span class="badge ${mBadge[s.payment_method]||'badge-blue'}">${mLabel[s.payment_method]||s.payment_method}</span></td>
      <td class="text-right" style="color:${s.discount>0?'var(--color-warning)':'var(--color-text-quaternary)'}">${s.discount>0?formatCurrency(s.discount):'—'}</td>
      <td class="text-right" style="font-weight:700">${formatCurrency(s.total)}</td>
      <td class="text-right" style="font-weight:700;color:${(s.profit||0)>=0?'var(--color-success)':'var(--color-danger)'}">${formatCurrency(s.profit||0)}</td>
      <td class="text-center">
        <div class="table-actions">
          <button class="action-btn btn-view-items" data-id="${s.id}" title="Ver itens"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
          ${s.status === 'completed' ? `<button class="action-btn delete btn-cancel-sale" data-id="${s.id}" title="Cancelar venda"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></button>` : ''}
        </div>
      </td>
    </tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="7" style="font-weight:700;color:var(--color-text-secondary)">TOTAL — ${sales.length} venda${sales.length!==1?'s':''}</td><td class="text-right" style="font-weight:800;color:var(--color-primary)">${formatCurrency(sales.reduce((s,r)=>s+(r.total||0),0))}</td><td class="text-right" style="font-weight:800;color:var(--color-success)">${formatCurrency(sales.reduce((s,r)=>s+(r.profit||0),0))}</td><td></td></tr></tfoot>
  </table></div>`;
}

// ─── View sale items ──────────────────────────────────────────────────────────
async function viewSaleItems(saleId) {
  try {
    const items = await window.api.sales.getItems(saleId);
    await window.api.app.showMessageBox({
      type:'info', title:`Itens — Venda #${String(saleId).padStart(4,'0')}`,
      message:`${items.length} item${items.length!==1?'s':''}`,
      detail: items.map(i=>`${i.product_name} × ${Number(i.quantity).toFixed(2)} = ${formatCurrency(i.total)}`).join('\n'),
      buttons:['Fechar'],
    });
  } catch(err) { toast.error('Erro: '+err.message); }
}

async function cancelSale(saleId) {
  const res = await window.api.app.showMessageBox({
    type: 'warning',
    title: 'Cancelar venda',
    message: `Cancelar a venda #${String(saleId).padStart(4,'0')}?`,
    detail: 'Use quando a venda foi registrada, mas o pagamento falhou ou precisou ser desfeito. O estoque será reposto.',
    buttons: ['Voltar', 'Cancelar venda'],
    defaultId: 0,
    cancelId: 0,
  });
  if (res.response !== 1) return;
  try {
    await window.api.sales.cancel(saleId);
    toast.success('Venda cancelada e estoque reposto.');
    await window.refreshCashStatus?.();
    await window.loadReport?.();
    if (AppState.currentView === 'products') await window.loadProductsList?.();
  } catch (err) {
    toast.error('Erro ao cancelar: ' + err.message);
  }
}

document.addEventListener('click', e => {
  const viewBtn = e.target.closest('.btn-view-items');
  if (viewBtn) viewSaleItems(parseInt(viewBtn.dataset.id));
  const cancelBtn = e.target.closest('.btn-cancel-sale');
  if (cancelBtn) cancelSale(parseInt(cancelBtn.dataset.id));
});

// ─── Close Cash modal ─────────────────────────────────────────────────────────
async function openCloseCashModal() {
  if (!AppState.cashRegister) { toast.warning('Nenhum caixa aberto.'); return; }
  const modal   = document.getElementById('closeCashModal');
  const summaryEl = document.getElementById('closeCashSummary');
  if (!modal) return;
  document.getElementById('closeCashNotes').value = '';

  const reg = AppState.cashRegister;
  if (summaryEl) {
    summaryEl.innerHTML = '<div class="close-cash-summary-row"><span class="label">Apurando sessão…</span><span class="value">—</span></div>';
  }
  modal.style.display = 'flex';

  try {
    const session = await window.api.cashRegister.getSessionSummary(reg.id);
    const t = session.totals || {};
    if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="close-cash-summary-row"><span class="label">Saldo de abertura</span><span class="value">${formatCurrency(reg.opening_balance||0)}</span></div>
      <div class="close-cash-summary-row"><span class="label">Vendas — Dinheiro</span><span class="value">${formatCurrency(t.total_cash||0)}</span></div>
      <div class="close-cash-summary-row"><span class="label">Vendas — Cartão</span><span class="value">${formatCurrency(t.total_card||0)}</span></div>
      <div class="close-cash-summary-row"><span class="label">Vendas — PIX</span><span class="value">${formatCurrency(t.total_pix||0)}</span></div>
      <div class="close-cash-summary-row total"><span class="label">Total de Vendas</span><span class="value">${formatCurrency(t.total_sales||0)}</span></div>
      <div class="close-cash-summary-row" style="padding-top:6px"><span class="label" style="font-size:13px">Saldo final em caixa</span><span class="value" style="color:var(--color-success)">${formatCurrency((reg.opening_balance||0)+(t.total_cash||0))}</span></div>`;
    }
  } catch (err) {
    if (summaryEl) summaryEl.innerHTML = `<div class="close-cash-summary-row"><span class="label" style="color:var(--color-danger)">Erro ao apurar sessão</span><span class="value">—</span></div>`;
    toast.error(err.message);
  }
}
window.openCloseCashModal = openCloseCashModal;

async function confirmCloseCash() {
  const reg = AppState.cashRegister;
  if (!reg) return;
  const btn = document.getElementById('btnConfirmCloseCash');
  btn.disabled=true; btn.textContent='Fechando…';
  try {
    const result = await window.api.cashRegister.close({
      registerId: reg.id,
      notes:      document.getElementById('closeCashNotes')?.value?.trim()||'',
    });
    document.getElementById('closeCashModal').style.display='none';

    let msgs = [`Caixa fechado · Sessão ${formatCurrency(result.sessionTotals?.total_sales || 0)}`];
    if (result.emailResult?.success) msgs.push(`Relatório c/ Excel enviado para ${result.emailResult.to}`);
    else if (result.emailResult?.error) toast.error('E-mail: '+result.emailResult.error, 5000);
    if (result.backupResult?.success) msgs.push(`Backup (${formatBytes(result.backupResult.sizeBytes)})`);
    toast.success(msgs.join(' · '));

    await window.refreshCashStatus();
    window.switchView('pdv');
  } catch(err) { toast.error('Erro: '+err.message); }
  finally { btn.disabled=false; btn.textContent='Confirmar Fechamento'; }
}

window.updateCashCloseControls = () => {
  const btn = document.getElementById('btnCloseCash');
  if (!btn) return;
  const isOpen = Boolean(AppState.cashRegister);
  btn.style.display = isOpen ? 'inline-flex' : 'none';
  btn.disabled = !isOpen;
};

function initReports() {
  ['reportStartDate','reportEndDate','reportStatus'].forEach(id =>
    document.getElementById(id)?.addEventListener('change', () => window.loadReport?.())
  );
  document.getElementById('reportOperator')?.addEventListener('input', debounce(() => window.loadReport?.(), 250));
  document.getElementById('btnLoadReport')?.addEventListener('click', () => window.loadReport?.());
  document.getElementById('btnExportReport')?.addEventListener('click', exportReport);
  document.getElementById('btnCloseCash')?.addEventListener('click', openCloseCashModal);

  document.getElementById('btnCloseCloseCashModal')?.addEventListener('click', () => { document.getElementById('closeCashModal').style.display='none'; });
  document.getElementById('btnCancelCloseCash')?.addEventListener('click',  () => { document.getElementById('closeCashModal').style.display='none'; });
  document.getElementById('btnConfirmCloseCash')?.addEventListener('click', confirmCloseCash);
  document.getElementById('closeCashModal')?.addEventListener('click', e => { if(e.target===document.getElementById('closeCashModal')) document.getElementById('closeCashModal').style.display='none'; });
  window.updateCashCloseControls();

  console.log('[Reports] initialized.');
}

async function exportReport() {
  const btn = document.getElementById('btnExportReport');
  const filters = {
    startDate: document.getElementById('reportStartDate')?.value || todayStr(),
    endDate: document.getElementById('reportEndDate')?.value || todayStr(),
    operator: document.getElementById('reportOperator')?.value?.trim() || '',
    status: document.getElementById('reportStatus')?.value || 'completed',
  };
  btn.disabled = true;
  btn.textContent = 'Exportando…';
  try {
    const result = await window.api.reports.exportSales(filters);
    toast.success(`Planilhas exportadas em Downloads: ${result.baseName}`);
  } catch (err) {
    toast.error('Erro ao exportar: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Exportar`;
  }
}

document.addEventListener('DOMContentLoaded', initReports);

function escHtml(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function formatBytes(b) { return !b?'—':b<1024?`${b} B`:b<1048576?`${(b/1024).toFixed(1)} KB`:`${(b/1048576).toFixed(2)} MB`; }
function formatPtDateShort(s) { if(!s) return '—'; const [y,m,d]=s.split('-'); return `${d}/${m}/${y}`; }
