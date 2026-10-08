import { spawn } from 'node:child_process';
import path from 'node:path';

export async function preventWindowsIdleSleep(directory) {
  if (process.platform !== 'win32') return null;
  const helper = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(directory, 'sleep-guard.ps1')
  ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

  let errors = '';
  helper.stderr.on('data', chunk => { errors = (errors + chunk).slice(-2000); });
  await new Promise((resolve, reject) => {
    let ready = false;
    let output = '';
    const timer = setTimeout(() => {
      helper.kill();
      reject(new Error(`Не удалось включить защиту от сна: ${errors || 'нет ответа от Windows'}`));
    }, 10_000);
    helper.stdout.on('data', chunk => {
      output += chunk;
      if (!ready && output.includes('READY')) {
        ready = true;
        clearTimeout(timer);
        resolve();
      }
    });
    helper.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    helper.once('exit', code => {
      if (ready) console.error(`Защита от сна завершилась во время работы бота (код ${code}).`);
      else {
        clearTimeout(timer);
        reject(new Error(`Не удалось включить защиту от сна: ${errors || `код ${code}`}`));
      }
    });
  });
  return helper;
}
