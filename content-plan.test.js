import test from 'node:test';
import assert from 'node:assert/strict';
import { contentPlanEntries, deletionLabel, moscowDay, planEntryTitle, shiftMoscowDay } from './content-plan.js';

test('контент-план показывает рекламу и напоминания на выбранный московский день без дублей по каналам', () => {
  const at = value => Date.parse(`${value}+03:00`);
  const campaign = { id: '1', sourceText: 'Реклама', captions: ['Первое', 'Второе'], postAt: at('2026-09-25T23:30:00'),
    times: [at('2026-09-26T00:00:00'), at('2026-09-26T00:30:00')] };
  const jobs = ['a', 'b'].flatMap(chatId => [0, 1].map(index => ({ campaignId: '1', kind: 'reminder', index, chatId, status: 'pending' })));
  assert.deepEqual(contentPlanEntries([campaign], jobs, '2026-09-25').map(item => item.kind), ['ad']);
  assert.deepEqual(contentPlanEntries([campaign], jobs, '2026-09-26').map(item => item.index), [0, 1]);
  assert.equal(moscowDay(at('2026-09-26T00:00:00')), '2026-09-26');
  assert.equal(shiftMoscowDay('2026-09-25', 1), '2026-09-26');
  assert.equal(deletionLabel(90), '1ч 30м');
});

test('название строки с эмодзи обрезается без повреждения UTF-8 кнопки', () => {
  const title = planEntryTitle({ kind: 'ad', campaign: { sourceText: `${'a'.repeat(19)}🔥${'z'.repeat(10)}` } });
  assert.equal(title, `${'a'.repeat(19)}🔥…`);
});

test('контент-план показывает статус рекламы бота и перенесённое отдельное напоминание', () => {
  const at = value => Date.parse(`${value}+03:00`);
  const campaign = { id: '2', postManaged: true, sourceText: 'Реклама', captions: ['Первое'],
    postAt: at('2026-09-26T17:00:00'), times: [at('2026-09-26T17:30:00')],
    reminderOverrides: { 0: { at: at('2026-09-27T18:00:00'), caption: 'Изменённое' } } };
  const jobs = [{ campaignId: '2', kind: 'post', status: 'sent' },
    { campaignId: '2', kind: 'reminder', index: 0, status: 'pending' }];
  const today = contentPlanEntries([campaign], jobs, '2026-09-26');
  assert.deepEqual(today.map(entry => [entry.kind, entry.status]), [['ad', 'sent']]);
  const tomorrow = contentPlanEntries([campaign], jobs, '2026-09-27');
  assert.equal(tomorrow[0].at, at('2026-09-27T18:00:00'));
  assert.equal(planEntryTitle(tomorrow[0]), 'Изменённое');
});

test('удалённое одно напоминание исчезает из плана без удаления серии', () => {
  const at = value => Date.parse(`${value}+03:00`);
  const campaign = { id: '3', sourceText: 'Реклама', captions: ['Первое', 'Второе'],
    postAt: at('2026-09-26T17:00:00'), times: [at('2026-09-26T17:30:00'), at('2026-09-26T18:00:00')],
    reminderOverrides: { 0: { removed: true } } };
  assert.deepEqual(contentPlanEntries([campaign], [], '2026-09-26').map(entry => [entry.kind, entry.index]),
    [['ad', null], ['reminder', 1]]);
});
