import test from 'node:test';
import assert from 'node:assert/strict';
import { answerHiddenContinuation, hiddenButton, hiddenText } from './hidden-content.js';
import { originalContent, postKeyboard } from './post-links.js';
import { reminderButtonFor } from './reminder-settings.js';
import { buildItemCopyCampaign } from './item-copy.js';

const config = { id: 'a'.repeat(32), title: 'ЗАБРАТЬ ПРОГНОЗ', subscriberText: 'Обе забьют — да', nonSubscriberText: 'Подпишись, чтобы забрать прогноз' };
const campaign = { id: 'series', buttonMode: 'hidden', hiddenContinuation: config, sourceText: 'Открытый пост',
  channelIds: ['-100123'], buttons: [], captions: ['напоминание'], times: [1000], reminderPhotoIds: ['photo'] };
const callback = { id: 'query', data: `hidden:${config.id}`, from: { id: 999 },
  message: { message_id: 42, chat: { id: -100123, type: 'channel' } } };
const jobs = [{ campaignId: 'series', kind: 'post', status: 'published', messageId: 42, chatId: '-100123' }];

test('секретные тексты отсутствуют в посте и callback_data', () => {
  const button = hiddenButton(campaign);
  assert.equal(button.text, config.title);
  assert.ok(Buffer.byteLength(button.callback_data) <= 64);
  assert.equal(JSON.stringify(postKeyboard(campaign)).includes(config.subscriberText), false);
  assert.equal(originalContent(campaign).text, 'Открытый пост');
  assert.deepEqual(reminderButtonFor(campaign, 0), button);
});

for (const [member, expected] of [
  [{ status: 'member' }, config.subscriberText], [{ status: 'administrator' }, config.subscriberText],
  [{ status: 'creator' }, config.subscriberText], [{ status: 'restricted', is_member: true }, config.subscriberText],
  [{ status: 'restricted', is_member: false }, config.nonSubscriberText],
  [{ status: 'left' }, config.nonSubscriberText], [{ status: 'kicked' }, config.nonSubscriberText]
]) test(`публичный пользователь ${JSON.stringify(member)} получает только положенный ему текст`, async () => {
  const calls = [];
  await answerHiddenContinuation(callback, { campaigns: [campaign], jobs }, async (method, args) => {
    calls.push({ method, args });
    return method === 'getChatMember' ? member : true;
  });
  assert.deepEqual(calls[0], { method: 'getChatMember', args: { chat_id: -100123, user_id: 999 } });
  assert.equal(calls[1].method, 'answerCallbackQuery');
  assert.equal(calls[1].args.text, expected);
  assert.equal(calls[1].args.show_alert, true);
  assert.equal(calls[1].args.cache_time, 0);
});

test('ошибка проверки подписки не раскрывает текст подписчиков', async () => {
  let answer;
  await answerHiddenContinuation(callback, { campaigns: [campaign], jobs }, async (method, args) => {
    if (method === 'getChatMember') throw new Error('offline');
    answer = args.text;
  });
  assert.match(answer, /Не удалось проверить/);
  assert.equal(answer.includes(config.subscriberText), false);
});

test('callback привязан к конкретному опубликованному сообщению и каналу', async () => {
  for (const message of [{ message_id: 41, chat: callback.message.chat },
    { message_id: 42, chat: { id: -100999, type: 'channel' } },
    { message_id: 42, chat: { id: 999, type: 'private' } }]) {
    const calls = [];
    await answerHiddenContinuation({ ...callback, message }, { campaigns: [campaign], jobs }, async (method, args) => {
      calls.push({ method, args });
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0].args.text, /недоступна/);
  }
});

test('приватное превью доступно только владельцу соответствующего черновика', async () => {
  let answer;
  const preview = { ...callback, message: { message_id: 5, chat: { id: 999, type: 'private' } } };
  await answerHiddenContinuation(preview, { campaigns: [], jobs: [], userSessions: { '999': { draft: campaign } } }, async (_, args) => { answer = args.text; });
  assert.equal(answer, config.subscriberText);
});

test('после подписки повторное нажатие сразу показывает прогноз', async () => {
  let subscribed = false;
  const answers = [];
  const api = async (method, args) => method === 'getChatMember' ? { status: subscribed ? 'member' : 'left' } : answers.push(args.text);
  await answerHiddenContinuation(callback, { campaigns: [campaign], jobs }, api);
  subscribed = true;
  await answerHiddenContinuation(callback, { campaigns: [campaign], jobs }, api);
  assert.deepEqual(answers, [config.nonSubscriberText, config.subscriberText]);
});

test('копия напоминания сохраняет скрытую кнопку без требования URL', () => {
  const copy = buildItemCopyCampaign(campaign, '0', { id: 'copy', at: 2000, channelIds: ['-100456'], networkKey: '2', deleteAfter: 30 });
  assert.deepEqual(reminderButtonFor(copy, 0), hiddenButton(campaign));
  assert.deepEqual(copy.hiddenContinuation, config);
  assert.notEqual(copy.hiddenContinuation, config);
});

test('ограничения текста Telegram проверяются до сохранения', () => {
  assert.throws(() => hiddenText(''), /от 1 до 200/);
  assert.throws(() => hiddenText('я'.repeat(201)), /от 1 до 200/);
  assert.throws(() => hiddenText('a'.repeat(65), 64), /от 1 до 64/);
  assert.equal(hiddenText('🔥'.repeat(200)), '🔥'.repeat(200));
});
