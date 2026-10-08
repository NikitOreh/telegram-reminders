import test from 'node:test';
import assert from 'node:assert/strict';
import { buildItemCopyCampaign } from './item-copy.js';
import { buildCampaignJobs } from './reminder-settings.js';
import { contentPlanEntries } from './content-plan.js';

const at = value => Date.parse(`${value}+03:00`);
const source = { id: 'old', postManaged: true, sourceText: 'Реклама', sourceEntities: [{ type: 'bold', offset: 0, length: 7 }],
  photoId: 'ad-photo', mainMediaType: 'photo', buttons: [{ text: 'ПРОГНОЗ', url: 'https://t.me/example' }],
  url: 'https://t.me/example', buttonText: 'ПРОГНОЗ', postAt: at('2026-10-03T15:00:00'),
  times: [at('2026-10-03T15:30:00')], captions: ['Текст напоминания'], reminderPhotoIds: ['reminder-photo'],
  reminderDeleteAfter: 30, reminderOverrides: { 0: { button: { text: 'СМОТРЕТЬ', url: 'https://t.me/other' }, deleteAfter: 90 } } };

test('копия поста создаёт только один независимый пост в новой сетке', () => {
  const copy = buildItemCopyCampaign(source, 'a', { id: 'copy-ad', at: at('2026-10-04T16:00:00'),
    channelIds: ['target'], networkKey: '2', deleteAfter: 40 });
  assert.deepEqual(buildCampaignJobs(copy).map(job => job.kind), ['post']);
  assert.equal(copy.postDeleteAfter, 40);
  assert.equal(copy.photoId, 'ad-photo');
  assert.equal(copy.networkKeys[0], '2');
});

test('копия напоминания не добавляет фиктивную рекламу в контент-план', () => {
  const copy = buildItemCopyCampaign(source, '0', { id: 'copy-reminder', at: at('2026-10-04T17:00:00'),
    channelIds: ['target'], networkKey: '2', deleteAfter: 60 });
  const jobs = buildCampaignJobs(copy);
  assert.deepEqual(jobs.map(job => job.kind), ['reminder']);
  assert.deepEqual(contentPlanEntries([copy], jobs, '2026-10-04').map(entry => entry.kind), ['reminder']);
  assert.equal(copy.captions[0], 'Текст напоминания');
  assert.equal(copy.reminderPhotoIds[0], 'reminder-photo');
  assert.deepEqual(copy.buttons[0], { text: 'СМОТРЕТЬ', url: 'https://t.me/other' });
  assert.equal(copy.reminderDeleteAfter, 60);
  const neverDelete = buildItemCopyCampaign(source, '0', { id: 'never-delete', at: at('2026-10-04T18:00:00'),
    channelIds: ['target'], networkKey: '2', deleteAfter: null });
  assert.equal(neverDelete.reminderDeleteAfter, null);
});
