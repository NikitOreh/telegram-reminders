import test from 'node:test';
import assert from 'node:assert/strict';
import { createHealthMonitor } from './health.js';

test('проверка выявляет зависшую очередь, потерю связи и нехватку диска', () => {
  let time = 0;
  const health = createHealthMonitor({ now: () => time, staleAfter: 300000 });
  assert.equal(health.isHealthy(), true);
  assert.equal(health.isHealthy({ diskFreeRatio: 0.049 }), false);
  time = 300001;
  assert.equal(health.isHealthy(), false);
  health.jobsSucceeded();
  assert.equal(health.isHealthy(), false);
  health.pollSucceeded();
  assert.equal(health.isHealthy(), true);
});

test('серьёзная ошибка публикации удерживает аварийный статус 15 минут', () => {
  let time = 100;
  const health = createHealthMonitor({ now: () => time, staleAfter: 3600000 });
  health.incident();
  assert.equal(health.isHealthy(), false);
  time += 900000;
  assert.equal(health.isHealthy(), true);
});
