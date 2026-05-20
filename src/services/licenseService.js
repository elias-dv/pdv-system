'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { app } = require('electron');

const LICENSE_PREFIX = 'PDV1';
const LICENSE_PRODUCT = 'pdv-system';
const PUBLIC_KEY_PATH = path.join(__dirname, '..', 'config', 'license-public.pem');

let cachedDeviceId = null;

function getLicenseFilePath() {
  return path.join(app.getPath('userData'), 'license.json');
}

function readTextIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8').trim();
  } catch (_) {}
  return '';
}

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2500,
      windowsHide: true,
    }).trim();
  } catch (_) {
    return '';
  }
}

function nativeMachineId() {
  if (process.platform === 'darwin') {
    const output = commandOutput('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']);
    const match = output.match(/"IOPlatformUUID"\s=\s"([^"]+)"/);
    if (match) return `darwin:${match[1]}`;
  }

  if (process.platform === 'win32') {
    const output = commandOutput('powershell.exe', [
      '-NoProfile',
      '-Command',
      '(Get-CimInstance -ClassName Win32_ComputerSystemProduct).UUID',
    ]);
    if (output) return `win32:${output.split(/\r?\n/).filter(Boolean).pop()}`;
  }

  if (process.platform === 'linux') {
    const machineId = readTextIfExists('/etc/machine-id') || readTextIfExists('/var/lib/dbus/machine-id');
    if (machineId) return `linux:${machineId}`;
  }

  return [
    process.platform,
    os.hostname(),
    os.userInfo().username,
    os.homedir(),
  ].join(':');
}

function getDeviceId() {
  if (cachedDeviceId) return cachedDeviceId;
  cachedDeviceId = crypto
    .createHash('sha256')
    .update(`${LICENSE_PRODUCT}:${nativeMachineId()}`)
    .digest('hex');
  return cachedDeviceId;
}

function formatDeviceId(deviceId) {
  return String(deviceId || '')
    .toUpperCase()
    .match(/.{1,4}/g)
    ?.join('-') || '';
}

function normalizeLicenseKey(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function base64UrlDecode(value) {
  return Buffer.from(String(value || ''), 'base64url');
}

function readPublicKey() {
  if (!fs.existsSync(PUBLIC_KEY_PATH)) {
    throw new Error('Chave publica de licenca nao encontrada no aplicativo.');
  }
  return fs.readFileSync(PUBLIC_KEY_PATH, 'utf8');
}

function parseAndVerifyLicense(licenseKey) {
  const normalized = normalizeLicenseKey(licenseKey);
  const [prefix, payloadPart, signaturePart] = normalized.split('.');
  if (prefix !== LICENSE_PREFIX || !payloadPart || !signaturePart) {
    throw new Error('Formato de licenca invalido.');
  }

  const ok = crypto.verify(
    'RSA-SHA256',
    Buffer.from(payloadPart),
    readPublicKey(),
    base64UrlDecode(signaturePart),
  );
  if (!ok) throw new Error('Assinatura da licenca invalida.');

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadPart).toString('utf8'));
  } catch (_) {
    throw new Error('Dados da licenca invalidos.');
  }

  if (payload.product !== LICENSE_PRODUCT) {
    throw new Error('Licenca emitida para outro produto.');
  }
  if (payload.deviceId !== getDeviceId()) {
    throw new Error('Licenca emitida para outro computador.');
  }
  if (payload.expiresAt && new Date(payload.expiresAt).getTime() < Date.now()) {
    throw new Error('Licenca expirada.');
  }

  return payload;
}

function readStoredLicenseKey() {
  try {
    const data = JSON.parse(fs.readFileSync(getLicenseFilePath(), 'utf8'));
    return data.licenseKey || '';
  } catch (_) {
    return '';
  }
}

function safeLicenseInfo(payload) {
  if (!payload) return null;
  return {
    licenseId: payload.licenseId || '',
    customer: payload.customer || '',
    issuedAt: payload.issuedAt || '',
    expiresAt: payload.expiresAt || null,
  };
}

function getLicenseStatus() {
  const deviceId = getDeviceId();
  const base = {
    activated: false,
    valid: false,
    deviceId,
    machineCode: formatDeviceId(deviceId),
    license: null,
    error: '',
  };

  const licenseKey = readStoredLicenseKey();
  if (!licenseKey) return base;

  try {
    const payload = parseAndVerifyLicense(licenseKey);
    return {
      ...base,
      activated: true,
      valid: true,
      license: safeLicenseInfo(payload),
    };
  } catch (err) {
    return {
      ...base,
      activated: true,
      error: err.message,
    };
  }
}

function requireActiveLicense() {
  const status = getLicenseStatus();
  if (!status.valid) {
    throw new Error(status.error || 'Ative a licenca para acessar o sistema.');
  }
  return status;
}

function activateLicense(licenseKey) {
  const normalized = normalizeLicenseKey(licenseKey);
  const payload = parseAndVerifyLicense(normalized);
  fs.mkdirSync(path.dirname(getLicenseFilePath()), { recursive: true });
  fs.writeFileSync(getLicenseFilePath(), JSON.stringify({
    licenseKey: normalized,
    activatedAt: new Date().toISOString(),
  }, null, 2));

  return {
    success: true,
    status: {
      ...getLicenseStatus(),
      license: safeLicenseInfo(payload),
    },
  };
}

function clearLicense() {
  try {
    fs.unlinkSync(getLicenseFilePath());
  } catch (_) {}
  return { success: true, status: getLicenseStatus() };
}

module.exports = {
  getDeviceId,
  getLicenseStatus,
  requireActiveLicense,
  activateLicense,
  clearLicense,
};
