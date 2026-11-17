import test from 'node:test';
import assert from 'node:assert/strict';
import { previewIsCurrent, shouldPreparePreview } from './preview-policy.js';

test('новому черновику нужен первый предпросмотр', () => {
  assert.equal(shouldPreparePreview({ editedAt: 100 }), false);
});

test('любое число правок после первого предпросмотра подготавливается автоматически', () => {
  const draft = { editedAt: 100, previewedAt: 100 };
  assert.equal(previewIsCurrent(draft), true);
  assert.equal(shouldPreparePreview(draft), false);
  for (const field of ['url', 'sourceText', 'postAt', 'adEnd', 'imageSource', 'reminderDeleteAfter']) {
    draft[field] = 'changed';
    draft.editedAt++;
    assert.equal(shouldPreparePreview(draft), true, field);
  }
});

test('вся отложенная серия готовится без ручного превью, в том числе пост без напоминаний', () => {
  assert.equal(shouldPreparePreview({ editingCampaignId: 'series', editedAt: 100 }), true);
  assert.equal(shouldPreparePreview({ editingCampaignId: 'post', remindersEnabled: false, editedAt: 100 }), true);
});
