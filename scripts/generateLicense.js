'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const LICENSE_PREFIX = 'PDV1';
const LICENSE_PRODUCT = 'pdv-system';

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return '';
  return process.argv[index + 1] || '';
}

function hasArg(name) {
  return process.argv.includes(name);
}

function usage() {
  console.log([
    'Uso:',
    '  node scripts/generateLicense.js --device CODIGO-DA-MAQUINA --customer "Cliente"',
    '',
    'Opcoes:',
    '  --private-key caminho.pem   Padrao: ./license-private.pem',
    '  --expires YYYY-MM-DD        Opcional; omita para pagamento unico sem vencimento',
    '  --output arquivo.txt        Opcional; salva a licenca em arquivo',
  ].join('\n'));
}

function normalizeDeviceId(value) {
  const normalized = String(value || '').toLowerCase().replace(/[^a-f0-9]/g, '');
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error('Codigo da maquina invalido. Ele deve ter 64 caracteres hexadecimais.');
  }
  return normalized;
}

function base64UrlJson(data) {
  return Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
}

function main() {
  if (hasArg('--help') || hasArg('-h')) {
    usage();
    return;
  }

  const deviceId = normalizeDeviceId(argValue('--device'));
  const customer = argValue('--customer') || 'Cliente';
  const privateKeyPath = path.resolve(rootDir, argValue('--private-key') || 'license-private.pem');
  const outputPath = argValue('--output');
  const expiresAt = argValue('--expires') || null;

  if (!fs.existsSync(privateKeyPath)) {
    throw new Error(`Chave privada nao encontrada: ${privateKeyPath}`);
  }
  if (expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
    throw new Error('Data de vencimento invalida. Use YYYY-MM-DD.');
  }

  const payloadPart = base64UrlJson({
    v: 1,
    product: LICENSE_PRODUCT,
    licenseId: crypto.randomUUID(),
    customer,
    deviceId,
    issuedAt: new Date().toISOString(),
    expiresAt,
  });
  const signature = crypto.sign(
    'RSA-SHA256',
    Buffer.from(payloadPart),
    fs.readFileSync(privateKeyPath, 'utf8'),
  ).toString('base64url');
  const licenseKey = `${LICENSE_PREFIX}.${payloadPart}.${signature}`;

  if (outputPath) {
    fs.writeFileSync(path.resolve(rootDir, outputPath), `${licenseKey}\n`);
  }
  console.log(licenseKey);
}

try {
  main();
} catch (err) {
  console.error(`Erro ao gerar licenca: ${err.message}`);
  usage();
  process.exit(1);
}
