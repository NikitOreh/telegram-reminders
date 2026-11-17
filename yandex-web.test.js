import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYandexWebImages, searchYandexWebImages } from './yandex-web.js';
import { yandexPhotoCandidates } from './internet-art.js';
import { teamSearchQuery, knownHockeyLeague } from './team-aliases.js';

test('выдача Яндекса: оригиналы из HTML-атрибутов, источник и удаление дублей', () => {
  const data = { items: [
    { origUrl: 'https://club.example/action.jpg?a=1&b=2', origWidth: 1600, origHeight: 900,
      snippet: { title: 'Северсталь — Лада: матч', url: 'https://club.example/game' } },
    { origUrl: 'https://club.example/action.jpg?a=1&b=2', origWidth: 1600, origHeight: 900,
      snippet: { title: 'Северсталь — Лада: матч', url: 'https://club.example/game' } }
  ] };
  const html = `<div data-state="${JSON.stringify(data).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"></div>`;
  assert.deepEqual(parseYandexWebImages(html), [{ url: 'https://club.example/action.jpg?a=1&b=2',
    title: 'Северсталь — Лада: матч', pageUrl: 'https://club.example/game', width: 1600, height: 900 }]);
});

test('капча прекращает поиск без повторных запросов', async () => {
  let calls = 0;
  await assert.rejects(searchYandexWebImages('Ак Барс Торпедо', { fetcher: async () => {
    calls++;
    return new Response('<div class="SmartCaptcha"></div>');
  } }), /капчу/);
  assert.equal(calls, 1);
});

test('неизвестный формат выдачи возвращает понятную ошибку', async () => {
  await assert.rejects(searchYandexWebImages('матч', { fetcher: async () => new Response('<html>empty</html>') }), /ожидаемом формате/);
});

test('Нью-Йорк в хоккее означает Rangers, Айлендерс сохраняется отдельно', () => {
  assert.equal(teamSearchQuery('Нью-Йорк', '🏒'), 'New York Rangers');
  assert.equal(teamSearchQuery('Нью Йорк', '🏒'), 'New York Rangers');
  assert.equal(teamSearchQuery('Нью-Йорк Айлендерс', '🏒'), 'New York Islanders');
  assert.equal(knownHockeyLeague('Нью-Йорк'), 'nhl');
});

test('точная пара команд выше игрового фото только одной команды', () => {
  const doc = title => `<doc><url>https://club.example/${encodeURIComponent(title)}.jpg</url><title>${title}</title></doc>`;
  const found = yandexPhotoCandidates(doc('Северсталь Динамо хоккей матч') + doc('Северсталь Лада хоккей матч'), 'Северсталь — Лада', '🏒');
  assert.equal(found[0].title, 'Северсталь Лада хоккей матч');
});
