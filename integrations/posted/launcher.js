import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const command = process.argv[2];
const commands = new Set(['setup', 'login', 'check', 'inspect', 'schema', 'test']);
if (!commands.has(command) || process.argv.length > 3) throw new Error('Команды: setup, login, check, inspect, schema, test');

async function pythonExecutable() {
  if (process.env.POSTED_PYTHON) return process.env.POSTED_PYTHON;
  if (process.platform === 'win32' && process.env.USERPROFILE) {
    const bundled = path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
    try { await fs.access(bundled); return bundled; } catch { /* Use Python from PATH. */ }
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

const args = command === 'setup'
  ? ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--target', path.join(ROOT, '.posted-deps'), '-r', path.join(HERE, 'requirements.txt')]
  : command === 'test'
    ? ['-m', 'unittest', 'discover', '-s', HERE, '-p', 'test_*.py', '-v']
    : [path.join(HERE, 'posted_tool.py'), command];
const child = spawn(await pythonExecutable(), args, { cwd: ROOT, stdio: 'inherit', windowsHide: true,
  env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' } });
child.on('error', () => { console.error('Не удалось запустить Python. Укажите путь в POSTED_PYTHON.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
