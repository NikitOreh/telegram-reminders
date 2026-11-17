import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignJobs } from './reminder-settings.js';
import { contentPlanEntries, moscowDay } from './content-plan.js';

test('серия без поста создаёт только напоминания во всех каналах и показывает только их в плане', () => {
  const postAt = Date.parse('2026-11-11T17:00:00+03:00');
  const campaign = { id: 'reminders-only', postManaged: false, remindersOnly: true,
    postAt, channelIds: ['a', 'b'], captions: ['one', 'two'], times: [postAt + 1800000, postAt + 3600000] };
  const jobs = buildCampaignJobs(campaign);
  assert.equal(jobs.length, 4);
  assert.equal(jobs.every(job => job.kind === 'reminder' && job.status === 'pending'), true);
  assert.deepEqual(jobs.map(job => job.at), [...campaign.times, ...campaign.times]);
  const entries = contentPlanEntries([campaign], jobs, moscowDay(postAt));
  assert.deepEqual(entries.map(entry => entry.kind), ['reminder', 'reminder']);
});

test('обычная серия продолжает создавать исходный пост', () => {
  const jobs = buildCampaignJobs({ id: 'normal', postManaged: true, postAt: 1000,
    channelIds: ['a'], captions: ['one'], times: [2000] });
  assert.deepEqual(jobs.map(job => job.kind), ['post', 'reminder']);
});
