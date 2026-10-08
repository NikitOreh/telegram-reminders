import test from 'node:test';
import assert from 'node:assert/strict';
import { publicationDeadline, shouldRetryPublication } from './job-delivery.js';

test('временный сбой Telegram повторяется до конца размещения, даже после пяти попыток', () => {
  const at = Date.parse('2026-10-06T06:00:00+03:00');
  const job = { kind: 'post', at, attempts: 5 };
  const campaign = { adEnd: at + 2 * 60 * 60_000, postDeleteAfter: null };
  assert.equal(publicationDeadline(job, campaign), campaign.adEnd);
  assert.equal(shouldRetryPublication({ permanent: false }, job, campaign, at + 90 * 60_000), true);
  assert.equal(shouldRetryPublication({ permanent: false }, job, campaign, campaign.adEnd), false);
  assert.equal(shouldRetryPublication({ permanent: true }, job, campaign, at + 60_000), false);
});

test('пропущенное напоминание не выходит после истечения собственного таймера', () => {
  const at = Date.parse('2026-10-06T06:30:00+03:00');
  const job = { kind: 'reminder', at, index: 0 };
  const campaign = { adEnd: at + 2 * 60 * 60_000, reminderDeleteAfter: 20 };
  assert.equal(publicationDeadline(job, campaign), at + 20 * 60_000);
  assert.equal(shouldRetryPublication({}, job, campaign, at + 19 * 60_000), true);
  assert.equal(shouldRetryPublication({}, job, campaign, at + 20 * 60_000), false);
});
