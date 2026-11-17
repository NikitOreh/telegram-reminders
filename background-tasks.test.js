import test from 'node:test';
import assert from 'node:assert/strict';
import { BackgroundCanceled, createBackgroundQueue, createKeyedExecutor } from './background-tasks.js';
import { collectMatchBackgrounds, getInternetMatchBackgrounds } from './internet-art.js';
import { createUserState } from './user-sessions.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('медленный поиск не удерживает обработчик следующих действий', async () => {
  const queue = createBackgroundQueue();
  const actions = createKeyedExecutor();
  const gate = deferred();
  let menuAnswered = false;
  let finished = false;
  let task;
  await actions.run(1, async () => {
    task = queue.start(1, { identity: {}, revision: 1, isCurrent: () => true,
      work: () => gate.promise, finish: () => actions.run(1, () => { finished = true; }) });
  });
  await actions.run(1, () => { menuAnswered = true; });
  assert.equal(menuAnswered, true);
  assert.equal(finished, false);
  gate.resolve();
  await task.done;
  assert.equal(finished, true);
});

test('изменённый или заменённый черновик не получает старый результат и не публикуется', async () => {
  for (const replace of [false, true]) {
    const queue = createBackgroundQueue();
    const gate = deferred();
    const started = deferred();
    const original = { editedAt: 1 };
    let draft = original;
    let saved = false;
    let disposed = 0;
    let published = false;
    const task = queue.start(1, { identity: original, revision: 1,
      isCurrent: () => draft === original && original.editedAt === 1,
      work: async () => { started.resolve(); await gate.promise; },
      finish: async (_, control) => { saved = true; await control.after(); },
      after: () => { published = true; }, dispose: async () => { disposed++; } });
    await started.promise;
    if (replace) draft = { editedAt: 1 }; else original.editedAt = 2;
    gate.resolve();
    await task.done;
    assert.equal(saved, false);
    assert.equal(published, false);
    assert.equal(disposed, 1);
  }
});

test('повторные нажатия используют одну подготовку и откладывают пост ровно один раз', async () => {
  const queue = createBackgroundQueue();
  const gate = deferred();
  const identity = {};
  let preparations = 0;
  let publications = 0;
  const spec = { identity, revision: 1, variant: true, isCurrent: () => true,
    work: async () => { preparations++; await gate.promise; },
    finish: async (_, control) => {
      control.commit();
      assert.equal(queue.hasCurrent(1, identity, 1), false, 'автопубликация не должна повторно ждать собственную подготовку');
      if (control.hasAfter()) await control.after();
    } };
  const first = queue.start(1, spec);
  assert.equal(queue.hasCurrent(1, identity, 1), true);
  const duplicate = queue.start(1, { ...spec, variant: false, after: () => { publications++; } });
  assert.equal(duplicate.reused, true);
  gate.resolve();
  await first.done;
  assert.equal(preparations, 1);
  assert.equal(publications, 1);
});

test('очередь ограничивает тяжёлую подготовку одним заданием и пропускает устаревшие', async () => {
  const queue = createBackgroundQueue();
  const gate = deferred();
  const started = deferred();
  let running = 0;
  let maximum = 0;
  const completed = [];
  const spec = (name, work) => ({ identity: {}, revision: 1, isCurrent: () => true,
    work: async () => { running++; maximum = Math.max(maximum, running); await work?.(); running--; },
    finish: () => { completed.push(name); } });
  const first = queue.start(1, spec('first', async () => { started.resolve(); await gate.promise; }));
  await started.promise;
  const stale = queue.start(2, spec('stale'));
  const latest = queue.start(2, spec('latest'));
  gate.resolve();
  await Promise.all([first.done, stale.done, latest.done]);
  assert.equal(maximum, 1);
  assert.deepEqual(completed, ['first', 'latest']);
});

test('ошибка поиска не останавливает следующие задания и попадает своему пользователю', async () => {
  const queue = createBackgroundQueue();
  const { runForUser, currentUserId } = createUserState({}, 1);
  const observed = [];
  let first;
  let second;
  await runForUser(10, async () => {
    first = queue.start(10, { identity: {}, revision: 1, isCurrent: () => true,
      work: () => { throw new Error('failed'); }, finish: () => {},
      onError: error => { observed.push([currentUserId(), error.message]); } });
  });
  await runForUser(20, async () => {
    second = queue.start(20, { identity: {}, revision: 1, isCurrent: () => true,
      work: async () => currentUserId(), finish: id => { observed.push([currentUserId(), id]); } });
  });
  await Promise.all([first.done, second.done]);
  assert.deepEqual(observed, [[10, 'failed'], [20, 20]]);
});

test('отменённый поиск не запускает резервные матчи и сетевые запросы', async () => {
  let calls = 0;
  await assert.rejects(collectMatchBackgrounds([{ match: 'first' }, { match: 'second' }], 2, async () => {
    calls++;
    throw new BackgroundCanceled();
  }), error => error.backgroundCanceled);
  assert.equal(calls, 1);
  await assert.rejects(getInternetMatchBackgrounds('Ак Барс — Торпедо', '🏒', 2, {
    checkActive() { throw new BackgroundCanceled(); }
  }), error => error.backgroundCanceled);
});
