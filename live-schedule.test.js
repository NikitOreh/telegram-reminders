import test from 'node:test';
import assert from 'node:assert/strict';
import { MINUTE, parseMoscow, parseFlexibleMoscow, scheduleTimes } from './core.js';
import { buildCampaignJobs, reminderIsRemoved, setReminderOverride, setPostDeleteAfter, syncAutomaticPostDeletion } from './reminder-settings.js';
import { planLiveSchedule, applyLiveSchedule, campaignHasStarted } from './live-schedule.js';
import { contentPlanEntries } from './content-plan.js';

const at = time => parseMoscow(`2026-11-${time.startsWith('00') || time.startsWith('01') ? '15' : '14'} ${time}`);
function fixture(postManaged = true) {
  const campaign = { id: 'live', postAt: at('18:00'), adEnd: at('23:00'), postManaged, remindersOnly: !postManaged,
    postDeleteAuto: true, postDeleteAfter: 300, reminderDeleteAfter: 30, channelIds: ['a', 'b'],
    times: scheduleTimes(at('18:00'), at('23:00')), captions: Array.from({ length: 9 }, (_, i) => `caption-${i}`) };
  const jobs = buildCampaignJobs(campaign);
  for (const job of jobs) if (job.kind === 'post') Object.assign(job, { status: 'sent', messageId: `ad-${job.chatId}`, publishedAt: at('18:00'), deleteAt: at('23:00') });
  for (const job of jobs) if (job.kind === 'reminder' && job.index === 0) Object.assign(job, { status: 'deleted', messageId: `first-${job.chatId}` });
  const draft = { ...campaign, adEnd: at('01:00') };
  syncAutomaticPostDeletion(draft);
  return { campaign, jobs, draft };
}
function prepareCaptions(campaign, plan) {
  while (campaign.captions.length < plan.times.length) campaign.captions.push(`caption-${campaign.captions.length}`);
}

test('18–23 продлевается до 01:00: новые слоты и обе копии, без повторного поста и истории', () => {
  const { campaign, jobs, draft } = fixture();
  const history = structuredClone(jobs);
  const plan = planLiveSchedule(campaign, jobs, draft, at('19:15'));
  assert.deepEqual(plan.times.slice(9), ['23:00', '23:30', '00:00', '00:30'].map(at));
  prepareCaptions(campaign, plan);
  campaign.postDeleteAfter = draft.postDeleteAfter;
  const result = applyLiveSchedule(campaign, jobs, plan, at('19:15'));
  assert.equal(result.remindersAdded, 4);
  assert.equal(result.added, 8);
  assert.deepEqual(jobs.slice(0, history.length), history);
  assert.equal(jobs.filter(job => job.kind === 'post').length, 2);
  assert.ok(jobs.slice(history.length).every(job => job.kind === 'reminder' && job.status === 'pending'));
  setPostDeleteAfter(campaign, jobs, draft.postDeleteAfter);
  assert.ok(jobs.filter(job => job.kind === 'post').every(job => job.deleteAt === at('01:00')));
  const second = planLiveSchedule(campaign, jobs, draft, at('19:16'));
  assert.equal(applyLiveSchedule(campaign, jobs, second, at('19:16')).added, 0);
  assert.equal(new Set(jobs.map(job => job.id)).size, jobs.length);
  assert.deepEqual(contentPlanEntries([campaign], jobs, '2026-11-15').map(entry => entry.at), [at('00:00'), at('00:30')]);
});

test('серия без поста считается начавшейся ещё до первой напоминалки', () => {
  const { campaign, jobs, draft } = fixture(false);
  for (const job of jobs) job.status = 'pending';
  assert.equal(campaignHasStarted(campaign, jobs, at('18:05')), true);
  const plan = planLiveSchedule(campaign, jobs, draft, at('18:05'));
  prepareCaptions(campaign, plan);
  applyLiveSchedule(campaign, jobs, plan, at('18:05'));
  assert.ok(jobs.every(job => job.kind === 'reminder'));
  assert.equal(jobs.filter(job => job.index >= 9).length, 8);
});

test('индивидуальные время, фото, текст, кнопка и удалённые напоминания сохраняются', () => {
  const { campaign, jobs, draft } = fixture();
  setReminderOverride(campaign, 2, { at: at('23:30'), photoId: 'own', caption: 'edited', button: { text: 'X', url: 'https://example.com' } });
  setReminderOverride(campaign, 3, { removed: true });
  const overrides = structuredClone(campaign.reminderOverrides);
  const plan = planLiveSchedule(campaign, jobs, draft, at('19:15'));
  assert.ok(!plan.times.slice(9).includes(at('23:30')));
  prepareCaptions(campaign, plan);
  applyLiveSchedule(campaign, jobs, plan, at('19:15'));
  assert.deepEqual(campaign.reminderOverrides, overrides);
});

test('после окончания старой серии добавляются только будущие слоты', () => {
  const { campaign, jobs, draft } = fixture(false);
  const plan = planLiveSchedule(campaign, jobs, draft, at('23:10'));
  assert.deepEqual(plan.times.slice(9), ['23:30', '00:00', '00:30'].map(at));
});

test('сокращение отменяет только будущие слоты, повторное продление восстанавливает их', () => {
  const { campaign, jobs, draft } = fixture();
  setReminderOverride(campaign, 2, { removed: true });
  const short = { ...draft, adEnd: at('21:00') };
  syncAutomaticPostDeletion(short);
  let plan = planLiveSchedule(campaign, jobs, short, at('19:15'));
  assert.deepEqual(plan.cancelIndices, [5, 6, 7, 8]);
  campaign.postDeleteAfter = short.postDeleteAfter;
  applyLiveSchedule(campaign, jobs, plan, at('19:15'));
  assert.ok(reminderIsRemoved(campaign, 5));
  plan = planLiveSchedule(campaign, jobs, draft, at('19:16'));
  assert.deepEqual(plan.restoreIndices, [5, 6, 7, 8]);
  prepareCaptions(campaign, plan);
  campaign.postDeleteAfter = draft.postDeleteAfter;
  applyLiveSchedule(campaign, jobs, plan, at('19:16'));
  assert.equal(reminderIsRemoved(campaign, 5), false);
  assert.equal(reminderIsRemoved(campaign, 2), true);
  assert.ok(jobs.filter(job => job.kind === 'reminder' && job.index === 5).every(job => job.status === 'pending'));
});

test('индекс не отменяется, если одна копия уже публикуется', () => {
  const { campaign, jobs, draft } = fixture();
  const sending = jobs.find(job => job.kind === 'reminder' && job.index === 5);
  sending.status = 'sending';
  const short = { ...draft, adEnd: at('21:00'), postDeleteAfter: 180 };
  const plan = planLiveSchedule(campaign, jobs, short, at('19:15'));
  assert.ok(!plan.cancelIndices.includes(5));
  applyLiveSchedule(campaign, jobs, plan, at('19:15'));
  assert.equal(sending.status, 'sending');
});

test('начало опубликованной рекламы менять нельзя, 01:00 определяется как следующая ночь', () => {
  const { campaign, jobs, draft } = fixture();
  assert.equal(parseFlexibleMoscow('01', at('19:15')), at('01:00'));
  assert.throws(() => planLiveSchedule(campaign, jobs, { ...draft, postAt: at('19:00') }, at('19:15')), /начала/);
  assert.throws(() => planLiveSchedule(campaign, jobs, { ...draft, adEnd: at('19:00') }, at('19:15')), /в будущем/);
});

test('свой таймер удаления поста продолжает ограничивать расписание', () => {
  const { campaign, jobs, draft } = fixture();
  const plan = planLiveSchedule(campaign, jobs, { ...draft, postDeleteAuto: false, postDeleteAfter: 300 }, at('19:15'));
  assert.equal(plan.times.length, campaign.times.length);
});

test('долгая подготовка не ставит новые напоминания задним числом', () => {
  const { campaign, jobs, draft } = fixture();
  const plan = planLiveSchedule(campaign, jobs, draft, at('22:58'));
  prepareCaptions(campaign, plan);
  applyLiveSchedule(campaign, jobs, plan, at('23:02'));
  assert.equal(reminderIsRemoved(campaign, 9), true);
  assert.ok(!jobs.some(job => job.index === 9));
  assert.ok(jobs.filter(job => job.index >= 10).every(job => job.at > at('23:02')));
});

test('устаревший план не перезаписывает параллельную правку расписания', () => {
  const { campaign, jobs, draft } = fixture();
  const plan = planLiveSchedule(campaign, jobs, draft, at('19:15'));
  prepareCaptions(campaign, plan);
  campaign.adEnd += MINUTE;
  assert.throws(() => applyLiveSchedule(campaign, jobs, plan), /уже изменена/);
});
