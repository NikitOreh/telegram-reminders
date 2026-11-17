import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignJobs, removeCampaignPost, setPostDeleteAfter } from './reminder-settings.js';

const series = () => ({ id: 'series', postManaged: true, postAt: 1000, postDeleteAfter: 60,
  channelIds: ['a', 'b'], captions: ['one', 'two'], times: [2000, 3000], reminderDeleteAfter: 15 });

test('отмена только будущей рекламы сохраняет все напоминания, время и настройки', () => {
  const campaign = series();
  const jobs = buildCampaignJobs(campaign);
  const reminders = structuredClone(jobs.filter(job => job.kind === 'reminder'));
  const result = removeCampaignPost(campaign, jobs, 1500);
  assert.deepEqual(result, { canceled: 2, deleting: 0, uncertain: 0 });
  assert.equal(campaign.postManaged, false);
  assert.equal(campaign.remindersOnly, true);
  assert.equal(campaign.postRemoved, true);
  assert.deepEqual(jobs.filter(job => job.kind === 'reminder'), reminders);
  assert.equal(jobs.filter(job => job.kind === 'post').every(job => job.status === 'canceled'), true);
  assert.equal(buildCampaignJobs(campaign).every(job => job.kind === 'reminder'), true);
  assert.deepEqual(campaign.times, [2000, 3000]);
  assert.equal(campaign.reminderDeleteAfter, 15);
});

test('опубликованные копии рекламы удаляются сейчас, напоминания и чужие серии не меняются', () => {
  const campaign = series();
  const jobs = [
    { campaignId: 'series', kind: 'post', status: 'published', messageId: 10, publishedAt: 1000 },
    { campaignId: 'series', kind: 'post', status: 'sent', messageId: 20, deleteAt: 9000 },
    { campaignId: 'series', kind: 'reminder', status: 'sent', messageId: 30, at: 2000, deleteAt: 8000 },
    { campaignId: 'other', kind: 'post', status: 'published', messageId: 40 }
  ];
  const untouched = structuredClone(jobs.slice(2));
  assert.deepEqual(removeCampaignPost(campaign, jobs, 4000), { canceled: 0, deleting: 2, uncertain: 0 });
  assert.equal(jobs[0].deleteAt, 4000);
  assert.equal(jobs[1].deleteAt, 4000);
  setPostDeleteAfter(campaign, jobs, 120);
  assert.equal(jobs[0].deleteAt, 4000, 'сохранение редактора не откладывает запрошенное удаление');
  assert.deepEqual(jobs.slice(2), untouched);
});

test('неизвестный результат отправки не скрывается, известное сообщение можно удалить', () => {
  const campaign = series();
  const jobs = [
    { campaignId: 'series', kind: 'post', status: 'uncertain' },
    { campaignId: 'series', kind: 'post', status: 'sending' },
    { campaignId: 'series', kind: 'post', status: 'uncertain', messageId: 10 }
  ];
  assert.deepEqual(removeCampaignPost(campaign, jobs, 4000), { canceled: 0, deleting: 1, uncertain: 2 });
  assert.equal(jobs[2].status, 'sent');
  assert.equal(jobs[2].deleteAt, 4000);
  assert.throws(() => removeCampaignPost(campaign, jobs), /уже удалён/);
});
