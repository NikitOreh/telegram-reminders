import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createImageDetectorWorker } from './image-detector-worker.js';

const fixture = `
let buffer = Buffer.alloc(0), busy = false;
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32BE()) {
    const size = buffer.readUInt32BE();
    const input = buffer.subarray(4, 4 + size).toString();
    buffer = buffer.subarray(4 + size);
    if (busy) { console.log('OVERLAP'); return; }
    busy = true;
    if (input === 'hang') return;
    if (input === 'crash') process.exit(9);
    setTimeout(() => {
      busy = false;
      console.log(input === 'bad' ? 'INVALID' : input === 'yes' ? 'PASS' : 'REJECT');
    }, 10);
  }
});
process.stdin.on('end', () => process.exit(0));
`;

function detector(t, options = {}) {
  let spawns = 0;
  const worker = createImageDetectorWorker({ timeoutMs: 2000, ...options,
    spawnWorker: () => {
      spawns++;
      return spawn(process.execPath, ['-e', fixture], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } });
  t.after(() => worker.close());
  return { worker, spawns: () => spawns };
}

test('детектор сохраняет один процесс и последовательно обслуживает очередь', async t => {
  const { worker, spawns } = detector(t);
  const results = await Promise.all(['yes', 'no', 'yes', 'no'].map(value => worker.run(Buffer.from(value))));
  assert.deepEqual(results, [true, false, true, false]);
  assert.equal(spawns(), 1);
  assert.equal(await worker.run(Buffer.from('yes')), true);
  assert.equal(spawns(), 1);
});

test('после сбоя процесса следующая проверка запускает новый детектор', async t => {
  const { worker, spawns } = detector(t);
  const first = worker.run(Buffer.from('crash'));
  const second = worker.run(Buffer.from('yes'));
  await assert.rejects(first, /код 9/);
  assert.equal(await second, true);
  assert.equal(spawns(), 2);
});

test('зависший детектор прерывается и не блокирует следующие картинки', async t => {
  const { worker, spawns } = detector(t, { timeoutMs: 500 });
  await assert.rejects(worker.run(Buffer.from('hang')), /время проверки истекло/);
  assert.equal(await worker.run(Buffer.from('yes')), true);
  assert.equal(spawns(), 2);
});

test('неверный ответ не пропускает картинку, процесс можно восстановить', async t => {
  const { worker, spawns } = detector(t);
  await assert.rejects(worker.run(Buffer.from('bad')), /неверный ответ/);
  assert.equal(await worker.run(Buffer.from('no')), false);
  assert.equal(spawns(), 2);
});

test('остановка завершает активную и ожидающую проверки', async t => {
  const { worker } = detector(t);
  const active = worker.run(Buffer.from('hang'));
  const queued = worker.run(Buffer.from('yes'));
  // Let the child be created before shutdown.
  await new Promise(resolve => setImmediate(resolve));
  worker.close();
  const results = await Promise.allSettled([active, queued]);
  assert.ok(results.every(result => result.status === 'rejected'));
});

test('пустые и слишком большие изображения не запускают процесс', async t => {
  const { worker, spawns } = detector(t);
  await assert.rejects(worker.run(Buffer.alloc(0)), /размер/);
  await assert.rejects(worker.run(Buffer.alloc(24 * 1024 * 1024 + 1)), /размер/);
  assert.equal(spawns(), 0);
});

test('простаивающий детектор не мешает завершению основного процесса', async () => {
  const source = `
    import { spawn } from 'node:child_process';
    import { createImageDetectorWorker } from ${JSON.stringify(new URL('./image-detector-worker.js', import.meta.url).href)};
    const worker = createImageDetectorWorker({spawnWorker: () => spawn(process.execPath,
      ['-e', ${JSON.stringify(fixture)}], {stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true})});
    console.log(await worker.run(Buffer.from('yes')));
  `;
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', source],
    { timeout: 3000, windowsHide: true });
  assert.equal(stdout.trim(), 'true');
});
