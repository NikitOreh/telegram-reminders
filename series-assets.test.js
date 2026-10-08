import test from 'node:test';
import assert from 'node:assert/strict';
import { compatibleReminderTemplates, distributeManualPhotos, reminderTemplateSport, repeatAtMostTwice, selectReminderTemplates, validateCaptionRepetitions } from './series-assets.js';

test('картинки в серии не повторяются больше двух раз', () => {
  assert.deepEqual(repeatAtMostTwice(['a', 'b', 'c'], 6), ['a', 'b', 'c', 'a', 'b', 'c']);
  assert.throws(() => repeatAtMostTwice(['a', 'b'], 6), /минимум 3/);
});

test('короткая серия требует разных текстов, длинная допускает два использования', () => {
  const render = text => text;
  const keepOrder = max => max - 1;
  assert.deepEqual(selectReminderTemplates(['A', 'B'], 2, render, keepOrder).map(x => x.caption), ['A', 'B']);
  assert.throws(() => selectReminderTemplates(['A', 'B'], 3, render, keepOrder), /минимум 3/);
  const captions = selectReminderTemplates(['A', 'B', 'C', 'D'], 7, render, keepOrder).map(x => x.caption);
  assert.deepEqual(captions, ['A', 'B', 'C', 'D', 'A', 'B', 'C']);
  validateCaptionRepetitions(captions);
  assert.throws(() => validateCaptionRepetitions(['A', 'B', 'A']), /больше 1/);
});

test('для новой рекламы шаблоны перемешиваются без повторов', () => {
  const pool = ['A', 'B', 'C', 'D'];
  const original = selectReminderTemplates(pool, 3, text => text, max => max - 1).map(item => item.caption);
  const shuffled = selectReminderTemplates(pool, 3, text => text, () => 0).map(item => item.caption);
  assert.notDeepEqual(shuffled, original);
  assert.equal(new Set(shuffled).size, 3);
  assert.deepEqual(pool, ['A', 'B', 'C', 'D']);
});

test('свои фото принимаются от одного до числа напоминаний и идут по порядку', () => {
  assert.deepEqual(distributeManualPhotos(['a'], 3), ['a', 'a', 'a']);
  assert.deepEqual(distributeManualPhotos(['a', 'b'], 5), ['a', 'b', 'a', 'b', 'a']);
  assert.deepEqual(distributeManualPhotos(['a', 'b', 'c'], 3), ['a', 'b', 'c']);
  assert.throws(() => distributeManualPhotos([], 3), /от 1 до 3/);
  assert.throws(() => distributeManualPhotos(['a', 'b', 'c'], 2), /от 1 до 2/);
});

test('футбольная реклама берёт футбольные и нейтральные напоминания, хоккейная — хоккейные и нейтральные', () => {
  const football = '⚽ ФУТБОЛЬНЫЙ ПРОГНОЗ\n{matches}\nКэф {odds}';
  const hockey = '🏒 ХОККЕЙНЫЙ ПРОГНОЗ\n{matches}\nКэф {odds}';
  const neutral = '🔥 ПРОГНОЗ\n{matches}\nКэф {odds}';
  const matchOnly = { sourceText: '🏒 Амур — Локомотив\nКэф 2,4', body: '{matches}<br>Кэф {odds}' };
  const mixed = '⚽ Футбол и 🏒 хоккей\n{matches}';
  assert.equal(reminderTemplateSport(matchOnly), 'neutral');
  assert.equal(reminderTemplateSport(mixed), 'mixed');
  assert.deepEqual(compatibleReminderTemplates([football, hockey, neutral, matchOnly, mixed], '⚽️'), [football, neutral, matchOnly]);
  assert.deepEqual(compatibleReminderTemplates([football, hockey, neutral, matchOnly, mixed], '🏒'), [hockey, neutral, matchOnly]);
  assert.deepEqual(compatibleReminderTemplates([football, hockey, neutral, matchOnly, mixed], 'mixed'), [neutral, matchOnly]);
});

test('теннисные и баскетбольные шаблоны не смешиваются с другими видами спорта', () => {
  const neutral = '🔥 ПРОГНОЗ\n{matches}\nКэф {odds}';
  const tennis = '🎾 ТЕННИСНЫЙ ПРОГНОЗ\n{matches}\nКэф {odds}';
  const basketball = '🏀 БАСКЕТБОЛЬНЫЙ ПРОГНОЗ\n{matches}\nКэф {odds}';
  const football = '⚽ ФУТБОЛЬНЫЙ ПРОГНОЗ\n{matches}\nКэф {odds}';
  assert.equal(reminderTemplateSport(tennis), 'tennis');
  assert.equal(reminderTemplateSport(basketball), 'basketball');
  assert.deepEqual(compatibleReminderTemplates([neutral, tennis, basketball, football], '🎾'), [neutral, tennis]);
  assert.deepEqual(compatibleReminderTemplates([neutral, tennis, basketball, football], '🏀'), [neutral, basketball]);
  assert.deepEqual(compatibleReminderTemplates([neutral, tennis, basketball, football], 'mixed'), [neutral]);
});
