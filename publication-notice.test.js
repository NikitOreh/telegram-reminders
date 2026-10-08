import test from 'node:test';
import assert from 'node:assert/strict';
import { publishedMessageLink, publicationNotice, publicationGroupKey, publicationGroupNotice, publicationGroupReady, stalePublicationNotices } from './publication-notice.js';

test('новая публикация удаляет старые уведомления, сохраняя обе сетки того же времени', () => {
  const notices = [
    { messageId: 1, at: 1000 },
    { messageId: 2, at: 2000 },
    { messageId: 3, at: 2000 }
  ];
  assert.deepEqual(stalePublicationNotices(notices).map(item => item.messageId), [1]);
  assert.deepEqual(stalePublicationNotices([]), []);
});

test('уведомление ведёт на опубликованный пост в закрытом канале', () => {
  const job = { kind: 'post', chatId: '-1001111111111', messageId: 123,
    publishedAt: Date.parse('2026-10-05T12:30:00+03:00') };
  const notice = publicationNotice(job, { sourceText: '🔥 Прогноз\nМатч сегодня' }, { title: 'Тестовый канал' });
  assert.match(notice.text, /Реклама опубликована\nКанал: Тестовый канал\nВремя: 2026-10-05 12:30 МСК/);
  assert.equal(notice.reply_markup.inline_keyboard[0][0].url, 'https://t.me/c/1111111111/123');
});

test('для публичного канала ссылка использует username, напоминание отличается от рекламы', () => {
  assert.equal(publishedMessageLink('-1001111111111', 123, 'mychannel'), 'https://t.me/mychannel/123');
  assert.equal(publishedMessageLink('bad', 123), null);
  const notice = publicationNotice({ kind: 'reminder', chatId: '-1001111111111', messageId: 124,
    publishedAt: Date.parse('2026-10-05T13:00:00+03:00') },
  { matches: ['Амур — Лада'], sourceText: 'Реклама' }, { title: 'Тестовый канал' });
  assert.match(notice.text, /Напоминание опубликовано/);
  assert.match(notice.text, /Амур — Лада/);
});

test('одно уведомление объединяет каналы одной сетки и даёт ссылку на каждый пост', () => {
  const at = Date.parse('2026-10-06T15:30:00+03:00');
  const campaign = { id: 'series-1', networkKeys: ['1', '2'], matches: ['СКА — Северсталь'],
    channelIds: ['-100111', '-100222', '-100333'] };
  const networks = { 1: ['-100111', '-100222'], 2: ['-100333'] };
  const jobs = [
    { campaignId: 'series-1', kind: 'reminder', index: 0, at, chatId: '-100111', messageId: 10,
      publishedAt: at, status: 'sent', notificationChat: { title: 'Первый канал' } },
    { campaignId: 'series-1', kind: 'reminder', index: 0, at, chatId: '-100222', messageId: 11,
      publishedAt: at + 10_000, status: 'sent', notificationChat: { title: 'Второй канал' } },
    { campaignId: 'series-1', kind: 'reminder', index: 0, at, chatId: '-100333', messageId: 12,
      publishedAt: at, status: 'sent', notificationChat: { title: 'Другая сетка' } }
  ];
  assert.equal(publicationGroupKey(jobs[0], campaign, networks), publicationGroupKey(jobs[1], campaign, networks));
  assert.notEqual(publicationGroupKey(jobs[0], campaign, networks), publicationGroupKey(jobs[2], campaign, networks));
  assert.equal(publicationGroupReady([jobs[0], { ...jobs[1], status: 'pending' }]), false);
  assert.equal(publicationGroupReady(jobs.slice(0, 2)), true);
  const notice = publicationGroupNotice(jobs.slice(0, 2), campaign, '1');
  assert.match(notice.text, /Напоминание опубликовано в сетке 1/);
  assert.match(notice.text, /• Первый канал\n• Второй канал/);
  assert.doesNotMatch(notice.text, /Другая сетка/);
  assert.equal(notice.reply_markup.inline_keyboard.length, 2);
});
