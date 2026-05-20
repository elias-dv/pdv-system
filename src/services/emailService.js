'use strict';

const nodemailer = require('nodemailer');
const { getDb }  = require('../database/db');
const { generateReportWorkbook } = require('./excelService');

// ─── Rate limiting: max 5 emails per hour ─────────────────────────────────────
const _emailLog = [];
function checkRateLimit() {
  const now    = Date.now();
  const window = 60 * 60 * 1000;
  while (_emailLog.length && now - _emailLog[0] > window) _emailLog.shift();
  if (_emailLog.length >= 5) throw new Error('Limite de envios atingido (5/hora). Aguarde antes de enviar novamente.');
  _emailLog.push(now);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

// SMTP credentials come EXCLUSIVELY from .env — never from the database.
function getTransporter() {
  const host   = process.env.EMAIL_HOST || 'smtp.gmail.com';
  const port   = parseInt(process.env.EMAIL_PORT || '587', 10);
  const secure = port === 465;
  const user   = process.env.EMAIL_USER || '';
  const pass   = process.env.EMAIL_PASS || '';

  if (!user || !pass) {
    throw new Error('Credenciais de e-mail ausentes. Configure EMAIL_USER e EMAIL_PASS no .env e reinicie o sistema.');
  }

  return {
    transporter: nodemailer.createTransport({
      host, port, secure,
      auth: { user, pass },
      tls:  { rejectUnauthorized: true },
      connectionTimeout: 15000,
      greetingTimeout:   10000,
      socketTimeout:     20000,
    }),
    from: `"${process.env.EMAIL_FROM_NAME || 'PDV Sistema'}" <${user}>`,
  };
}

async function sendDailyReport(reportData) {
  checkRateLimit();

  const db = getDb();
  const to        = db.prepare("SELECT value FROM settings WHERE key='email_to'").get()?.value || process.env.EMAIL_TO || '';
  const storeName = db.prepare("SELECT value FROM settings WHERE key='store_name'").get()?.value || 'Loja';

  if (!isValidEmail(to)) throw new Error('E-mail destinatário inválido. Configure em Configurações.');

  const { transporter, from } = getTransporter();

  let excelBuffer = null;
  try {
    excelBuffer = await generateReportWorkbook(reportData, storeName);
  } catch (err) {
    console.error('[EMAIL] Excel geração falhou:', err.message);
  }

  const dateTag  = (reportData.date || todayStr()).replace(/-/g, '');
  const filename = `relatorio_pdv_${dateTag}.xlsx`;

  const info = await transporter.sendMail({
    from, to,
    subject:     `📊 Fechamento de Caixa — ${storeName} — ${formatDate(reportData.date)}`,
    text:        buildReportText(reportData, storeName),
    html:        buildReportHtml(reportData, storeName),
    attachments: excelBuffer
      ? [{ filename, content: excelBuffer, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }]
      : [],
  });

  console.log(`[EMAIL] Enviado: ${info.messageId} | Excel: ${excelBuffer ? filename : 'não gerado'}`);
  return { success: true, messageId: info.messageId, to, hasExcel: !!excelBuffer };
}

async function sendTestEmail() {
  checkRateLimit();

  const db = getDb();
  const to = db.prepare("SELECT value FROM settings WHERE key='email_to'").get()?.value || process.env.EMAIL_TO || '';

  if (!isValidEmail(to)) throw new Error('E-mail destinatário não configurado ou inválido.');

  const { transporter, from } = getTransporter();
  await transporter.verify();

  const info = await transporter.sendMail({
    from, to,
    subject: '✅ PDV Sistema — Teste de Conexão',
    html: `<div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#fff;border-radius:16px">
      <h2 style="color:#1D1D1F;margin:0 0 12px">Conexão estabelecida ✅</h2>
      <p style="color:#48484A;font-size:15px;line-height:1.6;margin:0 0 16px">
        Sua configuração de e-mail está funcionando. Os relatórios serão enviados com anexo Excel.
      </p>
      <p style="color:#86868B;font-size:12px;margin:0">PDV Sistema — ${new Date().toLocaleString('pt-BR')}</p>
    </div>`,
  });

  return { success: true, messageId: info.messageId, to };
}

// ─── HTML / Text builders ─────────────────────────────────────────────────────

function buildReportHtml(data, storeName) {
  const c = (v) => `R$ ${Number(v||0).toFixed(2).replace('.', ',')}`;
  const t = data.totals || {};
  const reg = data.register || {};
  const avg = t.transaction_count > 0 ? t.total_sales / t.transaction_count : 0;
  const notes = sanitizeEmailText(data.closingNotes || reg.notes || '');

  const productPaymentRows = productPaymentItems(data).map((it, i) => `
    <tr style="background:${i%2===0?'#fff':'#F5F5F7'}">
      <td style="padding:8px 12px;font-size:13px;font-weight:500">${escHtml(it.product_name)}</td>
      <td style="padding:8px 12px;font-size:13px">${paymentBadge(it.payment_method)}</td>
      <td style="padding:8px 12px;text-align:center;font-size:13px;color:#48484A">${formatQuantity(it.quantity)}</td>
      <td style="padding:8px 12px;text-align:right;font-size:14px;font-weight:700">${c(it.total)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:24px;background:#F5F5F7;font-family:-apple-system,'Helvetica Neue',sans-serif">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
  <div style="background:linear-gradient(135deg,#007AFF,#0055CC);padding:36px 32px;text-align:center">
    <div style="font-size:40px;margin-bottom:8px">🏪</div>
    <h1 style="color:#fff;font-size:22px;font-weight:700;margin:0 0 4px">${escHtml(storeName)}</h1>
    <p style="color:rgba(255,255,255,.8);margin:0 0 8px;font-size:14px">Relatório de Fechamento de Caixa</p>
    <p style="color:#fff;font-size:17px;font-weight:600;margin:0">${formatDate(data.date)}</p>
  </div>
  <div style="display:flex;border-bottom:1px solid #F2F2F7">
    <div style="flex:1;padding:20px 12px;text-align:center"><div style="font-size:22px;margin-bottom:4px">💰</div><div style="font-size:16px;font-weight:700;color:#1D1D1F">${c(t.total_sales||0)}</div><div style="font-size:11px;color:#86868B">Total Vendas</div></div>
    <div style="flex:1;padding:20px 12px;text-align:center;border-left:1px solid #F2F2F7"><div style="font-size:22px;margin-bottom:4px">🧾</div><div style="font-size:16px;font-weight:700;color:#1D1D1F">${t.transaction_count||0}</div><div style="font-size:11px;color:#86868B">Transações</div></div>
    <div style="flex:1;padding:20px 12px;text-align:center;border-left:1px solid #F2F2F7"><div style="font-size:22px;margin-bottom:4px">📈</div><div style="font-size:16px;font-weight:700;color:#1D1D1F">${c(avg)}</div><div style="font-size:11px;color:#86868B">Ticket Médio</div></div>
  </div>
  <div style="padding:28px 32px">
    <h2 style="font-size:16px;font-weight:700;color:#1D1D1F;margin:0 0 12px">Formas de Pagamento</h2>
    <div style="background:#F5F5F7;border-radius:12px;overflow:hidden;margin-bottom:20px">
      ${pmRow('💵','Dinheiro',t.total_cash||0,t.total_sales||0)}
      ${pmRow('💳','Cartão',t.total_card||0,t.total_sales||0)}
      ${pmRow('📱','PIX',t.total_pix||0,t.total_sales||0)}
    </div>
    <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:12px;padding:16px 20px;margin-bottom:20px">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="color:#1D4ED8;font-size:13px">Saldo de Abertura</span><span style="color:#1D4ED8;font-size:13px;font-weight:600">${c(reg.opening_balance||0)}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:#1D4ED8;font-size:15px;font-weight:700">Saldo Final em Caixa</span><span style="color:#1D4ED8;font-size:17px;font-weight:800">${c((reg.opening_balance||0)+(t.total_cash||0))}</span></div>
    </div>
    ${notes ? `<h2 style="font-size:16px;font-weight:700;color:#1D1D1F;margin:0 0 12px">Observações do Fechamento</h2><div style="background:#F5F5F7;border:1px solid #E5E5EA;border-radius:12px;padding:14px 16px;color:#48484A;font-size:14px;line-height:1.5;margin-bottom:20px">${escHtml(notes).replace(/\n/g,'<br>')}</div>` : ''}
    ${productPaymentRows?`<h2 style="font-size:16px;font-weight:700;color:#1D1D1F;margin:0 0 12px">Produtos por Forma de Pagamento</h2><table style="width:100%;border-collapse:collapse;margin-bottom:20px"><thead><tr style="background:#007AFF"><th style="padding:10px 12px;color:#fff;font-size:11px;text-align:left">Produto</th><th style="padding:10px 12px;color:#fff;font-size:11px;text-align:left">Pagamento</th><th style="padding:10px 12px;color:#fff;font-size:11px;text-align:center">Qtd</th><th style="padding:10px 12px;color:#fff;font-size:11px;text-align:right">Total</th></tr></thead><tbody>${productPaymentRows}</tbody></table>`:''}
    <p style="font-size:12px;color:#AEAEB2;margin:20px 0 0;text-align:center">📎 Relatório Excel (hoje + 7 dias + 30 dias) em anexo.</p>
  </div>
  <div style="background:#F5F5F7;padding:18px 32px;text-align:center;border-top:1px solid #E5E5EA"><p style="color:#86868B;font-size:12px;margin:0">Gerado pelo <strong>PDV Sistema</strong> em ${new Date().toLocaleString('pt-BR')}</p></div>
</div></body></html>`;
}

function pmRow(icon, label, val, total) {
  const c = (v) => `R$ ${Number(v||0).toFixed(2).replace('.', ',')}`;
  const pct = total > 0 && val > 0 ? ` (${((val/total)*100).toFixed(0)}%)` : '';
  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid #E5E5EA"><span style="color:#48484A;font-size:14px">${icon} ${label}</span><span style="font-size:15px;font-weight:700;color:#1D1D1F">${c(val)}<span style="font-size:12px;color:#86868B;font-weight:400">${pct}</span></span></div>`;
}

function productPaymentItems(data) {
  const rows = data?.itemsByPayment?.length
    ? data.itemsByPayment
    : (data?.items || []).map(item => ({ ...item, payment_method: '' }));
  return rows
    .map(item => ({
      product_name: item.product_name || '',
      payment_method: item.payment_method || '',
      quantity: Number(item.quantity || 0),
      total: Number(item.total || 0),
    }))
    .sort((a, b) => {
      const byProduct = a.product_name.localeCompare(b.product_name, 'pt-BR', { sensitivity: 'base' });
      if (byProduct) return byProduct;
      return Number(b.total || 0) - Number(a.total || 0);
    });
}

function paymentBadge(method) {
  const label = { cash: 'Dinheiro', card: 'Cartão', pix: 'PIX' }[method] || method || 'Geral';
  const bg = { cash: '#D1FAE5', card: '#DBEAFE', pix: '#EDE9FE' }[method] || '#F5F5F7';
  const color = { cash: '#065F46', card: '#1E40AF', pix: '#5B21B6' }[method] || '#48484A';
  return `<span style="background:${bg};color:${color};padding:2px 8px;border-radius:100px;font-size:11px;font-weight:600">${label}</span>`;
}

function formatQuantity(value) {
  return Number(value || 0).toFixed(3).replace(/\.?0+$/, '').replace('.', ',');
}

function buildReportText(data, storeName) {
  const c = (v) => `R$ ${Number(v||0).toFixed(2)}`;
  const t = data.totals || {};
  const notes = sanitizeEmailText(data.closingNotes || data.register?.notes || '');
  return [`FECHAMENTO — ${storeName}`, `Data: ${formatDate(data.date)}`, '='.repeat(36),
    `Total: ${c(t.total_sales)}  |  Transações: ${t.transaction_count||0}`,
    `Dinheiro: ${c(t.total_cash)}  |  Cartão: ${c(t.total_card)}  |  PIX: ${c(t.total_pix)}`,
    notes ? `Observações: ${notes}` : '',
    '', '(Relatório Excel completo em anexo)', '='.repeat(36),
    `Gerado por PDV Sistema em ${new Date().toLocaleString('pt-BR')}`].join('\n');
}

function formatDate(dateStr) {
  if (!dateStr) return new Date().toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
  const [y, m, d] = dateStr.split('-');
  return new Date(y, m-1, d).toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
}

function todayStr() { return new Date().toISOString().slice(0,10); }
function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function sanitizeEmailText(s) { return String(s || '').trim().slice(0, 1000); }

module.exports = { sendDailyReport, sendTestEmail };
