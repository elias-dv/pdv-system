'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const venvDir = path.join(rootDir, '.venv-report-charts');
const requirementsPath = path.join(rootDir, 'requirements.txt');
const pipEnv = {
  ...process.env,
  PIP_DISABLE_PIP_VERSION_CHECK: '1',
  PIP_CACHE_DIR: path.join(venvDir, '.pip-cache'),
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    windowsHide: true,
    env: pipEnv,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} terminou com codigo ${result.status}`);
  }
}

function detectPython() {
  const configured = process.env.PDV_REPORT_PYTHON || process.env.PYTHON;
  const candidates = configured
    ? [[configured, []]]
    : process.platform === 'win32'
      ? [['py', ['-3']], ['python', []], ['python3', []]]
      : [['python3', []], ['python', []]];

  for (const [command, args] of candidates) {
    const result = spawnSync(command, [...args, '-c', 'import sys; print(sys.executable)'], {
      cwd: rootDir,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.status === 0) return { command, args };
  }

  throw new Error('Python 3 nao encontrado. Instale Python 3 e tente novamente.');
}

function venvPythonPath() {
  return process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');
}

function main() {
  if (!fs.existsSync(requirementsPath)) {
    throw new Error('requirements.txt nao encontrado.');
  }

  const python = detectPython();
  if (!fs.existsSync(venvPythonPath())) {
    console.log(`Criando ambiente virtual local em ${path.relative(rootDir, venvDir)}...`);
    run(python.command, [...python.args, '-m', 'venv', venvDir]);
  }

  const venvPython = venvPythonPath();
  console.log('Instalando dependencias dos graficos no ambiente virtual local...');
  run(venvPython, ['-m', 'pip', 'install', '-r', requirementsPath]);
  console.log('Dependencias de relatorios instaladas com sucesso.');
}

try {
  main();
} catch (err) {
  console.error(`Erro ao instalar dependencias de relatorio: ${err.message}`);
  process.exit(1);
}
