'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const privateKeyPath = path.join(rootDir, 'license-private.pem');
const publicKeyPath = path.join(rootDir, 'src', 'config', 'license-public.pem');

function main() {
  if (fs.existsSync(privateKeyPath) || fs.existsSync(publicKeyPath)) {
    throw new Error('Chaves de licenca ja existem. Remova os arquivos manualmente se quiser gerar outro par.');
  }

  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  fs.mkdirSync(path.dirname(publicKeyPath), { recursive: true });
  fs.writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
  fs.writeFileSync(publicKeyPath, publicKey);

  console.log(`Chave privada criada em: ${path.relative(rootDir, privateKeyPath)}`);
  console.log(`Chave publica criada em: ${path.relative(rootDir, publicKeyPath)}`);
  console.log('Guarde a chave privada fora do app distribuido. Ela gera licencas.');
}

try {
  main();
} catch (err) {
  console.error(`Erro ao criar chaves de licenca: ${err.message}`);
  process.exit(1);
}
