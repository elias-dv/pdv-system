'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const venvDir = path.join(rootDir, '.venv-report-charts');
const requirementsPath = path.join(rootDir, 'requirements.txt');
const scriptPath = path.join(rootDir, 'src', 'services', 'reportWorkbookBuilder.py');
const requestedArch = process.platform === 'darwin'
  ? (process.env.PDV_REPORT_BUILDER_ARCH || process.arch)
  : process.arch;
const outputKey = requestedArch === 'universal2'
  ? process.platform
  : `${process.platform}-${requestedArch}`;
const distPath = path.join(rootDir, 'build', 'report-workbook-builder', outputKey);
const workPath = path.join(rootDir, 'build', 'pyinstaller-work', outputKey);
const specPath = path.join(rootDir, 'build', 'pyinstaller-spec', outputKey);
const executableName = process.platform === 'win32'
  ? 'reportWorkbookBuilder.exe'
  : 'reportWorkbookBuilder';
const executablePath = path.join(distPath, 'reportWorkbookBuilder', executableName);
const pipEnv = {
  ...process.env,
  PIP_DISABLE_PIP_VERSION_CHECK: '1',
  PIP_CACHE_DIR: path.join(venvDir, '.pip-cache'),
  PYINSTALLER_CONFIG_DIR: path.join(venvDir, '.pyinstaller-cache'),
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

function ensureInputs() {
  if (!fs.existsSync(requirementsPath)) {
    throw new Error('requirements.txt nao encontrado.');
  }
  if (!fs.existsSync(scriptPath)) {
    throw new Error('reportWorkbookBuilder.py nao encontrado.');
  }
}

function ensureVenv() {
  const venvPython = venvPythonPath();
  if (fs.existsSync(venvPython)) return venvPython;

  const python = detectPython();
  console.log(`Criando ambiente virtual local em ${path.relative(rootDir, venvDir)}...`);
  run(python.command, [...python.args, '-m', 'venv', venvDir]);
  return venvPython;
}

function installBuildDependencies(venvPython) {
  console.log('Instalando dependencias do gerador de relatorios na venv local...');
  run(venvPython, ['-m', 'pip', 'install', '-r', requirementsPath, 'pyinstaller>=6,<7']);
}

function buildBinary(venvPython) {
  fs.rmSync(path.join(distPath, 'reportWorkbookBuilder'), { recursive: true, force: true });
  fs.mkdirSync(distPath, { recursive: true });
  fs.mkdirSync(workPath, { recursive: true });
  fs.mkdirSync(specPath, { recursive: true });

  const args = [
    '-m', 'PyInstaller',
    '--noconfirm',
    '--clean',
    '--onedir',
    '--name', 'reportWorkbookBuilder',
    '--distpath', distPath,
    '--workpath', workPath,
    '--specpath', specPath,
    '--collect-all', 'xlsxwriter',
  ];

  if (process.platform === 'darwin' && requestedArch) {
    args.push('--target-architecture', requestedArch);
  }

  args.push(scriptPath);

  console.log(`Gerando binario de relatorio em ${path.relative(rootDir, distPath)}...`);
  run(venvPython, args);

  if (!fs.existsSync(executablePath)) {
    throw new Error(`Binario nao encontrado apos build: ${executablePath}`);
  }
  if (process.platform !== 'win32') {
    fs.chmodSync(executablePath, 0o755);
  }
  console.log(`Binario pronto: ${path.relative(rootDir, executablePath)}`);
}

function main() {
  ensureInputs();
  const venvPython = ensureVenv();
  installBuildDependencies(venvPython);
  buildBinary(venvPython);
}

try {
  main();
} catch (err) {
  console.error(`Erro ao gerar binario de relatorio: ${err.message}`);
  process.exit(1);
}
