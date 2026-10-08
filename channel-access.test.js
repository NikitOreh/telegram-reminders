import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleCampaignsAndJobs } from './channel-access.js';

test('администратор видит серии других авторов только в своих каналах', () => {
  const campaigns = [{ id: 'one', channelIds: ['a', 'b', 'c'], sourceText: 'Чужой пост' },
    { id: 'two', channelIds: ['c'], sourceText: 'Скрытый пост' }];
  const jobs = ['a', 'b', 'c'].map(chatId => ({ campaignId: 'one', chatId, status: 'pending' }));
  const view = visibleCampaignsAndJobs(campaigns, jobs, new Set(['a', 'b']));
  assert.deepEqual(view.campaigns.map(campaign => [campaign.id, campaign.channelIds]), [['one', ['a', 'b']]]);
  assert.deepEqual(view.jobs.map(job => job.chatId), ['a', 'b']);
});

test('просмотр сетки не разделяет общую серию и её задания', () => {
  const campaigns = [{ id: 'one', channelIds: ['a', 'b', 'c'], sourceText: 'Пост' }];
  const jobs = ['a', 'b', 'c'].flatMap(chatId => ['post', 'reminder'].map(kind => ({ id: `one:${chatId}:${kind}`,
    campaignId: 'one', chatId, kind, status: 'pending' })));
  const view = visibleCampaignsAndJobs(campaigns, jobs, new Set(['a', 'b']));
  assert.deepEqual(view.campaigns[0].channelIds, ['a', 'b']);
  assert.deepEqual(view.jobs.map(job => job.chatId), ['a', 'a', 'b', 'b']);
  campaigns[0].sourceText = 'Изменённый пост';
  assert.equal(campaigns[0].sourceText, 'Изменённый пост');
  assert.deepEqual(campaigns[0].channelIds, ['a', 'b', 'c']);
  assert.equal(jobs.length, 6);
});
