'use strict';

window.AppState = {
  currentView:  'pdv',
  cashRegister: null,
  cart:         [],
  paymentMethod:'cash',
  settings:     {},
  isAdmin:      false,
  license:      null,
};

// ─── Utilities ────────────────────────────────────────────────────────────────
window.formatCurrency = (v) => {
  const n = Number(v)||0;
  return `R$ ${n.toFixed(2).replace('.',',').replace(/\B(?=(\d{3})+(?!\d))/g,'.')}`;
};
window.formatDate = (s) => {
  if (!s) return new Date().toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'short',year:'numeric'});
  const [y,m,d]=s.split('-').map(Number);
  return new Date(y,m-1,d).toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'short',year:'numeric'});
};
window.formatTime   = (s) => s ? s.slice(0,5) : '';
window.todayStr     = () => new Date().toISOString().slice(0,10);
window.formatBytes  = (b) => !b?'—':b<1024?`${b} B`:b<1048576?`${(b/1024).toFixed(1)} KB`:`${(b/1048576).toFixed(2)} MB`;
window.debounce     = (fn,ms) => { let t; return (...a) => { clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };

// ─── Toast ────────────────────────────────────────────────────────────────────
window.toast = (() => {
  const container = () => document.getElementById('toastContainer');
  function show(msg, type='info', ms=3200) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    container()?.appendChild(el);
    setTimeout(() => { el.classList.add('removing'); el.addEventListener('animationend',()=>el.remove()); }, ms);
  }
  return {
    success: (m,ms) => show(m,'success',ms),
    error:   (m,ms) => show(m,'error',ms||4500),
    info:    (m,ms) => show(m,'info',ms),
    warning: (m,ms) => show(m,'warning',ms),
  };
})();

// ─── License Gate ────────────────────────────────────────────────────────────
let appInitialized = false;

function showLicenseModal(status) {
  const modal = document.getElementById('licenseModal');
  const codeEl = document.getElementById('licenseMachineCode');
  const errorEl = document.getElementById('licenseError');
  if (codeEl) codeEl.textContent = status?.machineCode || '';
  if (errorEl) errorEl.textContent = status?.error || '';
  if (modal) modal.style.display = 'flex';
  setTimeout(() => document.getElementById('licenseKeyInput')?.focus(), 50);
}

function closeLicenseModal() {
  const modal = document.getElementById('licenseModal');
  if (modal) modal.style.display = 'none';
}

async function ensureLicenseActive() {
  const status = await window.api.license.getStatus();
  AppState.license = status;
  if (status.valid) return true;
  showLicenseModal(status);
  return false;
}

async function handleLicenseActivation() {
  const keyEl = document.getElementById('licenseKeyInput');
  const errEl = document.getElementById('licenseError');
  const btn = document.getElementById('btnActivateLicense');
  const licenseKey = keyEl?.value || '';

  if (errEl) errEl.textContent = '';
  if (!licenseKey.trim()) {
    if (errEl) errEl.textContent = 'Informe a chave de licença.';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Ativando...';
  try {
    const result = await window.api.license.activate(licenseKey);
    AppState.license = result.status;
    closeLicenseModal();
    toast.success('Sistema ativado.');
    await startApp();
  } catch (err) {
    if (errEl) errEl.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ativar Sistema';
  }
}

function initLicenseUI() {
  document.getElementById('btnActivateLicense')?.addEventListener('click', handleLicenseActivation);
  document.getElementById('licenseKeyInput')?.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleLicenseActivation();
  });
  document.getElementById('btnCopyMachineCode')?.addEventListener('click', async () => {
    const code = document.getElementById('licenseMachineCode')?.textContent || '';
    try {
      await navigator.clipboard.writeText(code);
      toast.success('Código copiado.');
    } catch (_) {
      toast.info('Selecione e copie o código manualmente.');
    }
  });
}

// ─── Admin Auth ───────────────────────────────────────────────────────────────
window.requireAdmin = (callback) => {
  // Show the login modal; after success, call callback
  window._adminCallback = callback;
  openLoginModal();
};

function openLoginModal() {
  const modal = document.getElementById('loginModal');
  if (!modal) return;
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginError').textContent = '';
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('loginPassword')?.focus(), 50);
}

function closeLoginModal() {
  const modal = document.getElementById('loginModal');
  if (modal) modal.style.display = 'none';
  window._adminCallback = null;
}

async function handleLogin() {
  const pw    = document.getElementById('loginPassword')?.value || '';
  const errEl = document.getElementById('loginError');
  const btn   = document.getElementById('btnLoginConfirm');

  btn.disabled = true; btn.textContent = 'Verificando…';
  errEl.textContent = '';

  try {
    const hasPassword = await window.api.auth.hasPassword();

    // First-time: no password set → open set-password flow
    if (!hasPassword) {
      closeLoginModal();
      openSetPasswordModal(false);
      return;
    }

    const ok = await window.api.auth.verify(pw);
    if (ok) {
      AppState.isAdmin = true;
      updateAdminIndicator();
      closeLoginModal();
      toast.success('Modo administrador ativado.');
      window._adminCallback?.();
      window._adminCallback = null;
    } else {
      errEl.textContent = 'Senha incorreta. Tente novamente.';
      document.getElementById('loginPassword').value = '';
      document.getElementById('loginPassword')?.focus();
    }
  } catch(err) {
    errEl.textContent = 'Erro: ' + err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Entrar';
  }
}

function openSetPasswordModal(requireOld = true) {
  const modal = document.getElementById('setPasswordModal');
  if (!modal) return;
  document.getElementById('spOldWrap').style.display = requireOld ? 'flex' : 'none';
  ['spOldPassword','spNewPassword','spConfirmPassword'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('spError').textContent = '';
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById(requireOld?'spOldPassword':'spNewPassword')?.focus(), 50);
}

function closeSetPasswordModal() {
  const modal = document.getElementById('setPasswordModal');
  if (modal) modal.style.display = 'none';
}

async function handleSetPassword() {
  const requireOld = document.getElementById('spOldWrap').style.display !== 'none';
  const oldPw  = document.getElementById('spOldPassword')?.value || '';
  const newPw  = document.getElementById('spNewPassword')?.value || '';
  const confPw = document.getElementById('spConfirmPassword')?.value || '';
  const errEl  = document.getElementById('spError');
  const btn    = document.getElementById('btnSetPasswordConfirm');

  errEl.textContent = '';
  if (newPw.length < 4) { errEl.textContent = 'A senha deve ter pelo menos 4 caracteres.'; return; }
  if (newPw !== confPw) { errEl.textContent = 'As senhas não coincidem.'; return; }

  btn.disabled = true; btn.textContent = 'Salvando…';
  try {
    await window.api.auth.setPassword({ oldPassword: requireOld ? oldPw : '', newPassword: newPw });
    closeSetPasswordModal();
    AppState.isAdmin = true;
    updateAdminIndicator();
    toast.success('Senha de administrador definida!');
    window._adminCallback?.();
    window._adminCallback = null;
  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Salvar Senha';
  }
}

function lockAdmin() {
  AppState.isAdmin = false;
  updateAdminIndicator();
  toast.info('Modo administrador bloqueado.');
  // If currently on protected view, go back to PDV
  if (['reports','settings'].includes(AppState.currentView)) switchView('pdv');
}

function updateAdminIndicator() {
  const dot   = document.getElementById('adminDot');
  const label = document.getElementById('adminLabel');
  const btn   = document.getElementById('btnLockAdmin');
  if (!dot) return;
  if (AppState.isAdmin) {
    dot.className = 'admin-dot unlocked';
    if (label) label.textContent = 'Admin';
    if (btn) btn.style.display = 'flex';
  } else {
    dot.className = 'admin-dot locked';
    if (label) label.textContent = 'Bloqueado';
    if (btn) btn.style.display = 'none';
  }
}

// ─── Navigation ───────────────────────────────────────────────────────────────
const PROTECTED_VIEWS = new Set(['reports','settings']);

function initNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const viewId = btn.dataset.view;
      if (PROTECTED_VIEWS.has(viewId) && !AppState.isAdmin) {
        window.requireAdmin(() => switchView(viewId));
        return;
      }
      switchView(viewId);
    });
  });
}

window.switchView = (viewId) => {
  if (PROTECTED_VIEWS.has(viewId) && !AppState.isAdmin) {
    window.requireAdmin(() => window.switchView(viewId));
    return false;
  }

  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const btn  = document.querySelector(`.nav-btn[data-view="${viewId}"]`);
  const view = document.getElementById(`view-${viewId}`);
  if (btn)  btn.classList.add('active');
  if (view) view.classList.add('active');
  AppState.currentView = viewId;

  if (viewId === 'pdv')        window.loadQuickProducts?.();
  if (viewId === 'products')   window.loadProductsList?.();
  if (viewId === 'movements')  window.loadMovements?.(window.getMovementFilters?.() || {});
  if (viewId === 'reports')    window.loadReport?.();
  if (viewId === 'settings')   window.loadSettings?.();
  window.updateCashCloseControls?.();
  return true;
};

// ─── Cash register status ──────────────────────────────────────────────────────
window.refreshCashStatus = async () => {
  try {
    const register = await window.api.cashRegister.getStatus();
    AppState.cashRegister = register;
    const dot   = document.getElementById('cashDot');
    const label = document.getElementById('cashStatusLabel');
    if (register) {
      if (dot)   dot.className   = 'cash-dot open';
      if (label) label.textContent = 'Aberto';
    } else {
      if (dot)   dot.className   = 'cash-dot closed';
      if (label) label.textContent = 'Fechado';
    }
    window.onCashStatusChanged?.(register);
    window.updateCashCloseControls?.();
  } catch (err) { console.error('refreshCashStatus:', err); }
};

// ─── Settings ─────────────────────────────────────────────────────────────────
window.loadSettings = async () => {
  try {
    const s = await window.api.settings.getAll();
    AppState.settings = s;
    const fields = [
      ['s_store_name','store_name'], ['s_store_cnpj','store_cnpj'],
      ['s_store_address','store_address'], ['s_store_phone','store_phone'],
      ['s_email_to','email_to'],
      ['s_backup_max_files','backup_max_files'], ['s_backup_schedule','backup_schedule'],
    ];
    fields.forEach(([elId,key]) => { const el=document.getElementById(elId); if(el&&s[key]!==undefined) el.value=s[key]; });
    // Show env-only display values (read-only)
    const hostEl = document.getElementById('s_email_host_display');
    const userEl = document.getElementById('s_email_user_display');
    if (hostEl) hostEl.textContent = s.email_host_display || '(não configurado)';
    if (userEl) userEl.textContent = s.email_user_display || '(não configurado)';
    await loadBackupHistory();
  } catch (err) { toast.error('Erro ao carregar configurações: ' + err.message); }
};

async function loadBackupHistory() {
  try {
    const history = await window.api.backup.getHistory();
    const el = document.getElementById('backupHistory');
    if (!el) return;
    if (!history.length) { el.innerHTML = '<p style="padding:16px 20px;color:var(--color-text-quaternary);font-size:13px">Nenhum backup ainda.</p>'; return; }
    el.innerHTML = history.slice(0,8).map(b =>
      `<div class="backup-item"><span class="backup-item-date">${b.created_at} — <span class="backup-status-${b.status==='success'?'ok':'err'}">${b.status==='success'?'✓':'✗'}</span> ${b.trigger||'auto'}</span><span class="backup-item-size">${window.formatBytes(b.size_bytes)}</span></div>`
    ).join('');
  } catch (err) { console.error('loadBackupHistory:', err); }
}

function initSettingsHandlers() {
  document.getElementById('btnSaveSettings')?.addEventListener('click', async () => {
    try {
      await window.api.settings.saveMany({
        store_name:       document.getElementById('s_store_name')?.value||'',
        store_cnpj:       document.getElementById('s_store_cnpj')?.value||'',
        store_address:    document.getElementById('s_store_address')?.value||'',
        store_phone:      document.getElementById('s_store_phone')?.value||'',
        email_to:         document.getElementById('s_email_to')?.value||'',
        backup_max_files: document.getElementById('s_backup_max_files')?.value||'30',
        backup_schedule:  document.getElementById('s_backup_schedule')?.value||'23:50',
      });
      toast.success('Configurações salvas!');
    } catch (err) { toast.error('Erro: ' + err.message); }
  });

  document.getElementById('btnTestEmail')?.addEventListener('click', async () => {
    const btn = document.getElementById('btnTestEmail');
    btn.disabled=true; btn.textContent='Enviando…';
    try {
      const r = await window.api.email.test();
      toast.success(`E-mail de teste enviado para ${r.to}!`);
    } catch (err) { toast.error('Falha: ' + err.message); }
    finally { btn.disabled=false; btn.innerHTML=`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.86 9.5 19.79 19.79 0 01.79 1a2 2 0 012-2h3a2 2 0 012 2 12.6 12.6 0 00.36 2.99A2 2 0 017.61 5l-1.29 1.29a16 16 0 006.29 6.29L13.9 11.2a2 2 0 012.12-.45A12.6 12.6 0 0019 11a2 2 0 012 2v3.92z"/></svg>Testar Conexão`; }
  });

  document.getElementById('btnChangePassword')?.addEventListener('click', () => openSetPasswordModal(true));

  document.getElementById('btnManualBackup')?.addEventListener('click', async () => {
    const btn = document.getElementById('btnManualBackup');
    btn.disabled=true; btn.textContent='⏳ Fazendo backup…';
    try {
      const r = await window.api.backup.create();
      if (r.success) { toast.success(`Backup criado! (${window.formatBytes(r.sizeBytes)})`); await loadBackupHistory(); }
      else toast.error('Backup falhou: '+(r.error||r.reason));
    } catch (err) { toast.error('Erro: '+err.message); }
    finally { btn.disabled=false; btn.textContent='Fazer Backup Agora'; }
  });

  document.getElementById('btnOpenBackupFolder')?.addEventListener('click', async () => {
    const dir = await window.api.backup.getDir();
    await window.api.app.openFolder(dir);
  });
}

function initAuthUI() {
  // Login modal
  document.getElementById('btnLoginConfirm')?.addEventListener('click', handleLogin);
  document.getElementById('loginPassword')?.addEventListener('keydown', e => { if(e.key==='Enter') handleLogin(); });
  document.getElementById('btnCloseLoginModal')?.addEventListener('click', closeLoginModal);
  document.getElementById('btnCloseLoginModal2')?.addEventListener('click', closeLoginModal);

  // Set password modal
  document.getElementById('btnSetPasswordConfirm')?.addEventListener('click', handleSetPassword);
  document.getElementById('btnCloseSetPasswordModal')?.addEventListener('click', closeSetPasswordModal);
  document.getElementById('btnCloseSetPasswordModal2')?.addEventListener('click', closeSetPasswordModal);
  ['spOldPassword','spNewPassword','spConfirmPassword'].forEach(id =>
    document.getElementById(id)?.addEventListener('keydown', e => { if(e.key==='Enter') handleSetPassword(); })
  );

  // Lock button in sidebar
  document.getElementById('btnLockAdmin')?.addEventListener('click', lockAdmin);
}

// ─── Company Modal ───────────────────────────────────────────────────────────
function openCompanyModal() {
  const modal = document.getElementById('companyModal');
  if (!modal) return;
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('btnCloseCompanyModal')?.focus(), 50);
}

function closeCompanyModal() {
  const modal = document.getElementById('companyModal');
  if (modal) modal.style.display = 'none';
}

function initCompanyModal() {
  const modal = document.getElementById('companyModal');
  document.getElementById('btnOpenCompanyModal')?.addEventListener('click', openCompanyModal);
  document.getElementById('btnCloseCompanyModal')?.addEventListener('click', closeCompanyModal);
  modal?.addEventListener('click', e => {
    if (e.target === modal) closeCompanyModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal?.style.display === 'flex') closeCompanyModal();
  });
}

// ─── Header date ──────────────────────────────────────────────────────────────
function updateHeaderDate() {
  const el = document.getElementById('pdvDate');
  if (el) el.textContent = new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function startApp() {
  if (appInitialized) return;
  appInitialized = true;
  initNavigation();
  initSettingsHandlers();
  initAuthUI();
  initCompanyModal();
  updateHeaderDate();
  updateAdminIndicator();

  try { AppState.settings = await window.api.settings.getAll(); } catch(e) { console.error(e); }

  await window.refreshCashStatus();
  window.initPDV?.();

  const rs = document.getElementById('reportStartDate');
  const re = document.getElementById('reportEndDate');
  if (rs) rs.value = todayStr();
  if (re) re.value = todayStr();

  console.log('[APP] Ready.');
}

async function boot() {
  console.log('[APP] Booting…');
  initLicenseUI();
  try {
    const licensed = await ensureLicenseActive();
    if (!licensed) return;
  } catch (err) {
    showLicenseModal({ machineCode: '', error: err.message });
    return;
  }
  await startApp();
}

document.addEventListener('DOMContentLoaded', boot);
