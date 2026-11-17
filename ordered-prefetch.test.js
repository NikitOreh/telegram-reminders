import test from 'node:test';
import assert from 'node:assert/strict';
import { orderedPrefetch } from './ordered-prefetch.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('скачивает три фото параллельно, сохраняет порядок и ограничивает буфер', async () => {
  const gates = Array.from({ length: 5 }, deferred);
  const started = [];
  const iterator = orderedPrefetch([0, 1, 2, 3, 4], async item => {
    started.push(item);
    await gates[item].promise;
    return `image-${item}`;
  });
  const first = iterator.next();
  await Promise.resolve();
  assert.deepEqual(started, [0, 1, 2]);
  gates[2].resolve();
  gates[1].resolve();
  gates[0].resolve();
  assert.equal((await first).value.value, 'image-0');
  assert.deepEqual(started, [0, 1, 2]); // No unbounded downloading while validation is busy.
  assert.equal((await iterator.next()).value.value, 'image-1');
  assert.deepEqual(started, [0, 1, 2, 3]);
  assert.equal((await iterator.next()).value.value, 'image-2');
  gates[3].resolve();
  gates[4].resolve();
  assert.equal((await iterator.next()).value.value, 'image-3');
  assert.equal((await iterator.next()).value.value, 'image-4');
  assert.equal((await iterator.next()).done, true);
});

test('выход после достаточного числа фото отменяет лишние скачивания', async () => {
  const started = [];
  let aborted = 0;
  for await (const result of orderedPrefetch([0, 1, 2, 3], (item, signal) => {
    started.push(item);
    if (item === 0) return 'ready';
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => {
      aborted++;
      reject(signal.reason);
    }, { once: true }));
  })) {
    assert.equal(result.value, 'ready');
    break;
  }
  assert.deepEqual(started, [0, 1, 2]);
  assert.equal(aborted, 2);
});

test('ошибка одного источника не мешает скачивать остальные', async () => {
  const results = [];
  for await (const result of orderedPrefetch([0, 1, 2], item => {
    if (item === 1) throw new Error('HTTP 404');
    return item;
  })) results.push(result);
  assert.deepEqual(results.map(result => result.ok), [true, false, true]);
  assert.equal(results[1].error.message, 'HTTP 404');
  assert.equal(results[2].value, 2);
});

test('отмена устаревшего превью останавливает очередь без новых скачиваний', async () => {
  let canceled = false;
  const started = [];
  const iterator = orderedPrefetch([0, 1, 2, 3], item => {
    started.push(item);
    return item;
  }, { checkActive: () => { if (canceled) throw Object.assign(new Error('canceled'), { backgroundCanceled: true }); } });
  await iterator.next();
  canceled = true;
  await assert.rejects(iterator.next(), { backgroundCanceled: true });
  assert.deepEqual(started, [0, 1, 2]);
});
