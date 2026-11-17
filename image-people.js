import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createImageDetectorWorker } from './image-detector-worker.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(ROOT, 'internet-assets');
const CHECK_VERSION = 2;

async function pythonExecutable() {
  if (process.env.PERSON_DETECTOR_PYTHON) return process.env.PERSON_DETECTOR_PYTHON;
  const bundled = path.join(process.env.USERPROFILE || '', '.cache', 'codex-runtimes',
    'codex-primary-runtime', 'dependencies', 'python', 'python.exe');
  try { await fs.access(bundled); return bundled; }
  catch { return process.platform === 'win32' ? 'python' : 'python3'; }
}

let worker;
let workerPython;

export async function runLocalPersonDetector(image, options = {}) {
  const python = options.python || await pythonExecutable();
  if (!worker || python !== workerPython) {
    worker?.close();
    workerPython = python;
    worker = createImageDetectorWorker({
      spawnWorker: () => spawn(python, [path.join(ROOT, 'detect-person.py'), '--worker'],
        { cwd: ROOT, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, BOT_ROOT: ROOT, PYTHONUTF8: '1' } })
    });
  }
  return worker.run(image);
}

export function closePersonDetector() {
  worker?.close();
  worker = undefined;
}

export async function imageShowsSportPeople(image, _sportIcon, options = {}) {
  const cacheKey = createHash('sha256').update(image).update(`local-person:${CHECK_VERSION}`).digest('hex').slice(0, 32);
  const cachePath = path.join(CACHE_DIR, `people-${cacheKey}.json`);
  if (!options.skipCache) {
    try { return JSON.parse(await fs.readFile(cachePath, 'utf8')).hasPeople === true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  let result;
  try { result = await (options.detector || runLocalPersonDetector)(image, options); }
  catch (error) { error.visionService = true; throw error; }
  if (!options.skipCache) {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify({ hasPeople: result, checkedAt: Date.now(), detector: CHECK_VERSION }), 'utf8');
  }
  return result;
}
