import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sportIconForMatch } from './core.js';
import { reminderImageSourceKey, migratePreparedPhotoKey, preparedPhotosAreCurrent, refreshPreparedPreview, retainedLivePhotos } from './preview-assets.js';
import { previewIsCurrent } from './preview-policy.js';

function draft() {
  const value = { sourceText: '🏒 Ак Барс — Торпедо\nКФ 2,4', matches: ['Ак Барс — Торпедо'], sportIcon: '🏒',
    imageSource: 'internet', reminderPhotoIds: ['photo1', 'photo2'], reminderPhotoMatch: 'Ак Барс — Торпедо',
    reminderPhotoStyleVersion: 6, previewedAt: 100, editedAt: 200 };
  value.reminderPhotoTemplateId = reminderImageSourceKey(value);
  return value;
}

test('правки ссылок, кнопок, коэффициента, времени и таймеров сохраняют готовые фото', () => {
  for (const change of [
    { url: 'https://example.com/new', buttons: [{ text: 'НОВАЯ КНОПКА', url: 'https://example.com/new' }] },
    { sourceText: '🏒 Ак Барс — Торпедо\nКФ 3,9\nhttps://example.com/new' },
    { postAt: 123, adEnd: 456 }, { postDeleteAfter: 180 }, { reminderDeleteAfter: 20 }
  ]) {
    const value = Object.assign(draft(), change);
    assert.equal(preparedPhotosAreCurrent(value, 2, 6), true);
    let validations = 0;
    assert.equal(refreshPreparedPreview(value, () => {
      validations++;
      return { captions: ['обновлённый текст 1', 'обновлённый текст 2'], templates: ['a', 'b'] };
    }, 6), true);
    assert.equal(validations, 1);
    assert.equal(previewIsCurrent(value), true);
    assert.deepEqual(value.previewCaptions, ['обновлённый текст 1', 'обновлённый текст 2']);
    assert.deepEqual(value.reminderPhotoIds, ['photo1', 'photo2']);
  }
});

test('изменение матча, второго матча, источника и числа напоминаний требует подготовки фото', () => {
  for (const change of [{ matches: ['СКА — Лада'] }, { matches: ['Ак Барс — Торпедо', 'СКА — Лада'] },
    { imageSource: 'manual', manualReminderPhotoIds: ['own'] }, { reminderPhotoIds: ['photo1'] },
    { reminderPhotoStyleVersion: 5 }]) {
    const value = Object.assign(draft(), change);
    assert.equal(refreshPreparedPreview(value, () => ({ captions: ['a', 'b'], templates: ['x', 'y'] }), 6), false);
    assert.equal(value.previewedAt, 100);
  }
  assert.equal(preparedPhotosAreCurrent(draft(), 3, 6), false);
});

test('смена футбольного турнира и категории команд меняет поиск', () => {
  const base = { imageSource: 'internet', matches: ['Англия — Чехия'], sportIcon: '⚽️', sourceText: 'Лига наций' };
  assert.notEqual(reminderImageSourceKey(base), reminderImageSourceKey({ ...base, sourceText: 'Чемпионат мира' }));
  assert.notEqual(reminderImageSourceKey(base), reminderImageSourceKey({ ...base, sourceText: 'Женская Лига наций' }));
});

test('готовые фото отложенной серии переходят на новый ключ без повторного поиска', () => {
  const value = draft();
  const matches = value.matches.map(match => [match, sportIconForMatch(match, value.sportIcon, value.sourceText)]);
  const hash = createHash('sha256').update(JSON.stringify([matches, value.sourceText])).digest('hex').slice(0, 16);
  value.reminderPhotoTemplateId = `internet:team-images-v9:second-match-fallback:${hash}`;
  assert.equal(preparedPhotosAreCurrent(migratePreparedPhotoKey(value), 2, 6), true);
  const wrong = { ...value, reminderPhotoTemplateId: `internet:team-images-v9:second-match-fallback:${hash}`, matches: ['СКА — Лада'] };
  assert.equal(preparedPhotosAreCurrent(migratePreparedPhotoKey(wrong), 2, 6), false);
});

test('пост без напоминаний сохраняется без пересылки превью, ошибки валидации не обходятся', () => {
  const value = { remindersEnabled: false, editedAt: 200 };
  assert.equal(refreshPreparedPreview(value, () => ({ captions: [], templates: [] }), 6), true);
  assert.equal(previewIsCurrent(value), true);
  assert.throws(() => refreshPreparedPreview(draft(), () => { throw new Error('Некорректная ссылка'); }, 6), /ссылка/);
});

test('смена своих фотографий требует обновления, остальные настройки сохраняют их', () => {
  const value = { ...draft(), imageSource: 'manual', manualReminderPhotoIds: ['own'] };
  value.reminderPhotoTemplateId = reminderImageSourceKey(value);
  assert.equal(preparedPhotosAreCurrent(value, 2, 6), true);
  value.manualReminderPhotoIds = ['other'];
  assert.equal(preparedPhotosAreCurrent(value, 2, 6), false);
});

test('продление сохраняет прежние фото, включая серию со старой версией картинок', () => {
  const previous = { ...draft(), times: [1, 2], reminderPhotoStyleVersion: 3 };
  const changed = { ...previous, postDeleteAfter: 420, adEnd: 999, url: 'https://example.com/new' };
  assert.deepEqual(retainedLivePhotos(changed, previous, 4), ['photo1', 'photo2']);
  assert.deepEqual(retainedLivePhotos({ ...changed, matches: ['СКА — Лада'] }, previous, 4), []);
  assert.deepEqual(retainedLivePhotos({ ...changed, reminderPhotoIds: ['replacement'] }, previous, 4), []);
  assert.deepEqual(retainedLivePhotos(changed, previous, 2), []);
});
