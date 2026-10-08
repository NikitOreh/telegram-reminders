import test from 'node:test';
import assert from 'node:assert/strict';
import { timerKeyboard } from './timer-menu.js';
import { parseDurationMinutes, parseReminderDeleteMinutes } from './core.js';

test('быстрые таймеры доступны для всех экранов удаления', () => {
  for (const prefix of ['delete', 'reminder_delete', 'post_delete_live:123', 'rem_delete:123:0']) {
    const callbacks = timerKeyboard(prefix, 'nav:back').inline_keyboard.flat().map(button => button.callback_data);
    for (const minutes of [15, 30, 60, 90, 120, 360, 600]) assert.ok(callbacks.includes(`${prefix}:${minutes}`));
    assert.ok(callbacks.includes(`${prefix}:custom`));
    assert.ok(callbacks.includes(`${prefix}:none`));
  }
});

test('быстрые значения интерпретируются как минуты, ручной ввод — как в Posted', () => {
  for (const minutes of [15, 30, 60, 90, 120, 360, 600]) assert.equal(parseDurationMinutes(String(minutes)), minutes);
  assert.equal(parseReminderDeleteMinutes('0 15'), 15);
  assert.equal(parseReminderDeleteMinutes('1 30'), 90);
  assert.equal(parseReminderDeleteMinutes('6'), 360);
  assert.equal(parseReminderDeleteMinutes('10'), 600);
});
