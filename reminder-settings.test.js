import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignJobs, moveCampaignSchedule, reminderButtonFor, reminderCaptionFor, reminderDeleteAfterFor, reminderIsRemoved, reminderPhotoFor, reminderTimeFor, removeReminder, setPostDeleteAfter, setReminderOverride, validateReminderTime } from './reminder-settings.js';

test('время отдельной напоминалки свободное после рекламы, автоматический шаг не меняется', () => {
  const now = 1_000_000;
  const campaign = { postAt: now + 10 * 60_000, adEnd: now + 90 * 60_000,
    times: [now + 40 * 60_000, now + 70 * 60_000] };
  assert.doesNotThrow(() => validateReminderTime(campaign, 0, campaign.postAt + 60_000, now));
  assert.doesNotThrow(() => validateReminderTime(campaign, 0, campaign.adEnd + 60_000, now));
  assert.throws(() => validateReminderTime(campaign, 0, campaign.postAt, now), /после рекламы/);
  assert.throws(() => validateReminderTime(campaign, 0, campaign.times[1], now), /уже назначено/);
  assert.throws(() => validateReminderTime(campaign, 0, now + 30_000, now), /хотя бы через минуту/);
  assert.doesNotThrow(() => validateReminderTime({ ...campaign, standaloneReminder: true }, 0, now + 60_000, now));
});

test('изменение одного напоминания не меняет остальные в серии', () => {
  const campaign = { captions: ['A', 'B'], reminderPhotoIds: ['photo-a', 'photo-b'], times: [100, 200],
    buttonText: 'ПРОГНОЗ', url: 'https://t.me/example', reminderDeleteAfter: 30 };
  setReminderOverride(campaign, 1, { caption: 'B2', photoId: 'new-photo', button: { text: 'ОТКРЫТЬ', url: 'https://t.me/new' }, at: 250, deleteAfter: 90 });
  assert.equal(reminderCaptionFor(campaign, 0), 'A');
  assert.equal(reminderCaptionFor(campaign, 1), 'B2');
  assert.equal(reminderPhotoFor(campaign, 0), 'photo-a');
  assert.equal(reminderPhotoFor(campaign, 1), 'new-photo');
  assert.deepEqual(reminderButtonFor(campaign, 1), { text: 'ОТКРЫТЬ', url: 'https://t.me/new' });
  assert.equal(reminderTimeFor(campaign, 0), 100);
  assert.equal(reminderTimeFor(campaign, 1), 250);
  assert.equal(reminderDeleteAfterFor(campaign, 0), 30);
  assert.equal(reminderDeleteAfterFor(campaign, 1), 90);
});

test('фото матча из Commons получает атрибуцию, заменённое вручную фото — нет', () => {
  const campaign = { captions: ['<b>ПРОГНОЗ</b>'], reminderPhotoCredits: [{ artist: 'Автор', license: 'CC BY-SA 4.0',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:Match.jpg', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' }] };
  assert.match(reminderCaptionFor(campaign, 0), /Автор.*CC BY-SA 4\.0.*кадрировано/);
  setReminderOverride(campaign, 0, { photoId: 'own-photo' });
  assert.equal(reminderCaptionFor(campaign, 0), '<b>ПРОГНОЗ</b>');
});

test('фото CC0 не добавляет строку с источником к напоминанию', () => {
  const campaign = { captions: ['<b>ПРОГНОЗ</b>'], reminderPhotoCredits: [{ artist: 'Автор', license: 'CC0 1.0',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:Match.jpg' }] };
  assert.equal(reminderCaptionFor(campaign, 0), '<b>ПРОГНОЗ</b>');
});

test('новая серия откладывает исходную рекламу и напоминания в каждом канале', () => {
  const campaign = { id: 'id', postManaged: true, channelIds: ['one', 'two'], postAt: 100,
    times: [130, 160], captions: ['A', 'B'], reminderOverrides: { 1: { at: 170 } } };
  const jobs = buildCampaignJobs(campaign);
  assert.deepEqual(jobs.map(job => `${job.chatId}:${job.kind}:${job.at}`), [
    'one:post:100', 'one:reminder:130', 'one:reminder:170',
    'two:post:100', 'two:reminder:130', 'two:reminder:170'
  ]);
  assert.equal(buildCampaignJobs({ ...campaign, postManaged: false }).filter(job => job.kind === 'post').length, 0);
});

test('немедленный выход отложенного поста сдвигает напоминания и индивидуальное время', () => {
  const campaign = { id: 'series', postAt: 1_000_000, adEnd: 1_180_000,
    times: [1_030_000, 1_060_000], reminderOverrides: { 1: { at: 1_070_000 } } };
  const jobs = [{ kind: 'post', status: 'pending', at: 1_000_000 },
    { kind: 'reminder', status: 'pending', at: 1_030_000 },
    { kind: 'reminder', status: 'pending', at: 1_070_000 }];
  moveCampaignSchedule(campaign, jobs, 2_000_000);
  assert.deepEqual(jobs.map(job => job.at), [2_000_000, 2_030_000, 2_070_000]);
  assert.deepEqual(campaign.times, [2_030_000, 2_060_000]);
  assert.equal(campaign.reminderOverrides[1].at, 2_070_000);
  assert.equal(campaign.adEnd, 2_180_000);
});

test('изменение таймера рекламы обновляет все опубликованные копии, но не напоминания', () => {
  const campaign = { postDeleteAfter: null };
  const jobs = [
    { kind: 'post', status: 'sent', publishedAt: 1_000, deleteAt: 31_000 },
    { kind: 'post', status: 'published', publishedAt: 2_000, deleteAt: null },
    { kind: 'post', status: 'pending', at: 3_000, deleteAt: null },
    { kind: 'reminder', status: 'sent', publishedAt: 1_000, deleteAt: 31_000 }
  ];
  setPostDeleteAfter(campaign, jobs, 60);
  assert.equal(campaign.postDeleteAfter, 60);
  assert.deepEqual(jobs.slice(0, 2).map(job => job.deleteAt), [3_601_000, 3_602_000]);
  assert.equal(jobs[2].deleteAt, null);
  assert.equal(jobs[3].deleteAt, 31_000);
  setPostDeleteAfter(campaign, jobs, null);
  assert.deepEqual(jobs.slice(0, 2).map(job => job.status), ['published', 'published']);
  assert.deepEqual(jobs.slice(0, 2).map(job => job.deleteAt), [null, null]);
});

test('одна напоминалка удаляется во всех каналах, а реклама и другая напоминалка остаются', () => {
  const campaign = { id: 'series', postManaged: true, channelIds: ['a', 'b'], postAt: 100,
    captions: ['Первая', 'Вторая'], times: [200, 300], reminderDeleteAfter: 30 };
  const jobs = buildCampaignJobs(campaign);
  jobs.find(job => job.kind === 'reminder' && job.index === 0 && job.chatId === 'a').status = 'published';
  jobs.find(job => job.kind === 'reminder' && job.index === 1 && job.chatId === 'a').status = 'published';
  const result = removeReminder(campaign, jobs, 0, 500);
  assert.deepEqual(result, { pending: 1, published: 1, uncertain: 0 });
  assert.equal(reminderIsRemoved(campaign, 0), true);
  assert.equal(reminderIsRemoved(campaign, 1), false);
  assert.equal(jobs.find(job => job.kind === 'reminder' && job.index === 0 && job.chatId === 'a').deleteAt, 500);
  assert.equal(jobs.find(job => job.kind === 'reminder' && job.index === 0 && job.chatId === 'b').status, 'canceled');
  assert.equal(jobs.find(job => job.kind === 'post' && job.chatId === 'a').status, 'pending');
  assert.equal(jobs.find(job => job.kind === 'reminder' && job.index === 1 && job.chatId === 'a').status, 'published');
  assert.deepEqual(buildCampaignJobs(campaign).filter(job => job.kind === 'reminder').map(job => job.index), [1, 1]);
});

test('удаление напоминания можно отключить для серии или только для одной записи', () => {
  const campaign = { reminderDeleteAfter: null, captions: ['A'], times: [100] };
  assert.equal(reminderDeleteAfterFor(campaign, 0), null);
  campaign.reminderDeleteAfter = 30;
  setReminderOverride(campaign, 0, { deleteAfter: null });
  assert.equal(reminderDeleteAfterFor(campaign, 0), null);
});
