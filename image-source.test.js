import test from 'node:test';
import assert from 'node:assert/strict';
import { imageSettingsFor } from './image-source.js';

test('свои фото выбраны для нового черновика без загрузок', () => {
  assert.deepEqual(imageSettingsFor({}), { imageSource: 'manual', manualReminderPhotoIds: [] });
});

test('старые сгенерированные фото остаются доступными при редактировании', () => {
  assert.deepEqual(imageSettingsFor({ imageSource: 'generated', reminderPhotoIds: ['a', 'b', 'a'] }), {
    imageSource: 'manual', manualReminderPhotoIds: ['a', 'b']
  });
});

test('поиск в интернете и уже загруженные свои фото сохраняются', () => {
  assert.deepEqual(imageSettingsFor({ imageSource: 'internet' }).imageSource, 'internet');
  assert.deepEqual(imageSettingsFor({ imageSource: 'manual', manualReminderPhotoIds: ['a', 'b'] }).manualReminderPhotoIds, ['a', 'b']);
});
