import test from 'node:test';
import assert from 'node:assert/strict';
import { parseButtonSpec, parseContinuationSpec, isButtonUrl } from './core.js';
import { postButtons, postKeyboard, originalContent } from './post-links.js';
import { buildItemCopyCampaign } from './item-copy.js';
import { buildCampaignJobs } from './reminder-settings.js';

test('обычная кнопка принимает сторонние сайты HTTP/HTTPS, параметры и якорь', () => {
  for (const url of ['https://example.com/news?a=1&b=2#read', 'http://example.org/page', 'https://t.me/+example']) {
    assert.deepEqual(parseButtonSpec(`Читать - ${url}`), { text: 'Читать', url });
  }
  for (const url of ['javascript:alert(1)', 'https://', 'https://example.com/a b', 'file:///etc/passwd']) {
    assert.equal(isButtonUrl(url), false);
  }
});

test('пост без напоминаний и кнопки создаёт только публикацию без клавиатуры', () => {
  const post = { id: 'post', sourceText: 'Текст', buttons: [], url: null, postManaged: true,
    remindersEnabled: false, channelIds: ['a'], postAt: 1000, captions: [], times: [] };
  assert.equal(postKeyboard(post), undefined);
  assert.deepEqual(originalContent(post), { text: 'Текст', entities: [] });
  assert.deepEqual(buildCampaignJobs(post).map(job => job.kind), ['post']);
  assert.deepEqual(postButtons({ ...post, url: 'https://old.example/' }), [], 'удалённая кнопка не восстанавливается из старого url');
});

test('старый режим ссылки в тексте сохраняет исходные entities существующих постов', () => {
  const sourceText = '🔥 Важный пост';
  const sourceEntities = [{ type: 'bold', offset: 3, length: 11 },
    { type: 'custom_emoji', offset: 0, length: 2, custom_emoji_id: '123' }];
  const post = { sourceText, sourceEntities, buttonMode: 'continuation', buttons: [parseContinuationSpec('https://example.com/long')] };
  const content = originalContent(post);
  assert.equal(content.text, `${sourceText} Читать продолжение…`);
  assert.deepEqual(content.entities.slice(0, 2), sourceEntities);
  assert.deepEqual(content.entities[2], { type: 'text_link', offset: sourceText.length + 1,
    length: 'Читать продолжение…'.length, url: 'https://example.com/long' });
  assert.equal(postKeyboard(post), undefined);
  assert.deepEqual(originalContent(post), content, 'повторная подготовка не дублирует продолжение');
  assert.equal(post.sourceText, sourceText);
});

test('смена типа ссылки и удаление не оставляют старое продолжение в тексте', () => {
  const post = { sourceText: 'Пост', buttonMode: 'continuation', buttons: [parseContinuationSpec('Дальше - https://example.com/')] };
  assert.equal(originalContent(post).text, 'Пост Дальше');
  post.buttonMode = 'regular';
  assert.equal(originalContent(post).text, 'Пост');
  assert.equal(postKeyboard(post).inline_keyboard[0][0].text, 'Дальше');
  post.buttonMode = 'continuation';
  post.buttons = [];
  assert.equal(originalContent(post).text, 'Пост');
});

test('копирование рекламного поста сохраняет скрытое продолжение', () => {
  const post = { sourceText: 'Пост', buttonMode: 'continuation', buttons: [parseContinuationSpec('https://example.com/')] };
  const copy = buildItemCopyCampaign(post, 'a', { id: 'copy', at: 1000, channelIds: ['b'], networkKey: '2', deleteAfter: 30 });
  assert.equal(copy.buttonMode, 'continuation');
  assert.equal(originalContent(copy).text, 'Пост Читать продолжение…');
  assert.equal(postKeyboard(copy), undefined);
});
