import test from 'node:test';
import assert from 'node:assert/strict';
import { collectMatchBackgrounds, matchPhotoCandidates, yandexPhotoCandidates } from './internet-art.js';
import { teamSearchQuery, teamSearchVariants, transliterateTeamName } from './team-aliases.js';
import { resolveTeamNameVariants, translatedClubName } from './team-language.js';

function page(title, license = 'CC0 1.0', description = 'Football match action', mime = 'image/jpeg', width = 1200, height = 800, date = '2024-06-15') {
  return { title: `File:${title}`, imageinfo: [{ mime, width, height,
    thumburl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/example.jpg',
    extmetadata: { LicenseShortName: { value: license }, LicenseUrl: { value: 'https://creativecommons.org/publicdomain/zero/1.0/' },
      Artist: { value: '<a href="https://commons.wikimedia.org">Автор</a>' }, ImageDescription: { value: description },
      DateTimeOriginal: date ? { value: date } : undefined } }] };
}

test('поиск принимает игровые фото, но отсеивает эмблемы, флаги и нерелевантное', () => {
  const pages = [
    page('Germany-Netherlands border.jpg'),
    page('Netherlands Germany football logo.png', 'CC0 1.0', 'Team emblems', 'image/png', 300, 300),
    page('Netherlands Germany football flags.png', 'CC0 1.0', 'National flags', 'image/png', 300, 300),
    page('Manuel Neuer Euro 2024 vs Netherlands.jpg'),
    page('Sneijder, Robben and de Jong Netherlands-Germany Euro 2012.jpg', 'CC0 1.0', 'Players before Euro 2012 match'),
    page('Netherlands Germany football match fans.jpg'),
    page('Netherlands-Germany Euro 2024 match.jpg', 'CC BY-NC 4.0'),
    page('Netherlands-Germany Euro 2024 match.jpg'),
    page('Germany hockey team logo.jpg', 'CC0 1.0', 'Ice hockey emblem')
  ];
  const found = matchPhotoCandidates(pages, 'Нидерланды — Германия', '⚽');
  assert.deepEqual(new Set(found.map(item => item.title)), new Set([
    'Manuel Neuer Euro 2024 vs Netherlands.jpg',
    'Sneijder, Robben and de Jong Netherlands-Germany Euro 2012.jpg',
    'Netherlands-Germany Euro 2024 match.jpg'
  ]));
  assert.equal(found[0].credit.artist, 'Автор');
});

test('хоккейный поиск принимает игроков одной команды, но не одиночную эмблему', () => {
  const pages = [
    page('Florida Panthers logo.svg', 'CC0 1.0', 'Team badge', 'image/svg+xml', 300, 300),
    page('Tampa Bay Lightning hockey player.jpg', 'CC0 1.0', 'Player on ice'),
    page('Ottawa v Tampa Bay faceoff April 2024.jpg', 'CC0 1.0', 'Tampa Bay Lightning ice hockey action'),
    page('Florida Panthers football fans.jpg', 'CC0 1.0', 'Football crowd')
  ];
  const found = matchPhotoCandidates(pages, 'Флорида — Тампа', '🏒');
  assert.deepEqual(new Set(found.map(item => item.title)), new Set([
    'Tampa Bay Lightning hockey player.jpg', 'Ottawa v Tampa Bay faceoff April 2024.jpg'
  ]));
});

test('теннис и баскетбол не получают фото другого вида спорта', () => {
  const tennis = matchPhotoCandidates([
    page('Djokovic vs Sinner ATP tennis match.jpg', 'CC0 1.0', 'Tennis players'),
    page('Djokovic vs Sinner football match.jpg', 'CC0 1.0', 'Football players')
  ], 'Djokovic — Sinner', '🎾');
  assert.deepEqual(tennis.map(item => item.title), ['Djokovic vs Sinner ATP tennis match.jpg']);
  const basketball = matchPhotoCandidates([
    page('Boston vs Miami NBA basketball game.jpg', 'CC0 1.0', 'Basketball players'),
    page('Boston vs Miami NHL hockey game.jpg', 'CC0 1.0', 'Hockey players')
  ], 'Boston — Miami', '🏀');
  assert.deepEqual(basketball.map(item => item.title), ['Boston vs Miami NBA basketball game.jpg']);
});

test('флаг рядом с игроками допускается, одиночный флаг отсеивается', () => {
  const pages = [
    page('England flag.jpg', 'CC0 1.0', 'Football national team'),
    page('England players with flag football match.jpg', 'CC0 1.0', 'Footballers before kick-off')
  ];
  assert.deepEqual(matchPhotoCandidates(pages, 'Англия — Чехия', '⚽').map(item => item.title),
    ['England players with flag football match.jpg']);
});

test('поиск предпочитает игровые кадры и отсекает концерт, арену и элементы формы', () => {
  const pages = [
    page('Carolina Hurricanes vs. Florida Panthers 2022.jpg', 'CC0 1.0', 'Ice hockey match'),
    page('Florida Panthers player portrait cropped.jpg', 'CC0 1.0', 'Ice hockey player'),
    page('Concert after Tampa Bay Lightning hockey game.jpg', 'CC0 1.0', 'Ice hockey game'),
    page('SKK Blinova.jpg', 'CC0 1.0', 'Avangard Omsk home arena for ice hockey'),
    page('Belgium football kit shirt.png', 'CC0 1.0', 'Belgium football team', 'image/png')
  ];
  const hockey = matchPhotoCandidates(pages, 'Флорида — Тампа', '🏒');
  assert.deepEqual(hockey.map(item => item.title), [
    'Carolina Hurricanes vs. Florida Panthers 2022.jpg',
    'Florida Panthers player portrait cropped.jpg'
  ]);
  assert.deepEqual(matchPhotoCandidates(pages, 'Авангард — Лада', '🏒'), []);
  assert.deepEqual(matchPhotoCandidates(pages, 'Бельгия — Турция', '⚽'), []);
});

test('поиск не ограничивает год фото и принимает недатированные спортивные кадры', () => {
  const pages = [
    page('Denmark football team 1918.jpg', 'CC0 1.0', 'Denmark football players', 'image/jpeg', 1200, 800, '2024-03-01'),
    page('Denmark football match.jpg', 'CC0 1.0', 'Football match in 1922, uploaded in 2024', 'image/jpeg', 1200, 800, '2024-03-01'),
    page('Denmark football match 2024.jpg', 'CC0 1.0', 'Football players', 'image/jpeg', 1200, 800, '2019-03-01'),
    page('Denmark football match without date.jpg', 'CC0 1.0', 'Football players', 'image/jpeg', 1200, 800, null),
    page('Denmark football match 2023.jpg', 'CC0 1.0', 'Football players', 'image/jpeg', 1200, 800, null),
    page('Denmark football match.jpg', 'CC0 1.0', 'Football players', 'image/jpeg', 1200, 800, '2021-09-10')
  ];
  const found = matchPhotoCandidates(pages, 'Дания — Норвегия', '⚽');
  assert.deepEqual(new Set(found.map(item => item.title)), new Set([
    'Denmark football team 1918.jpg', 'Denmark football match.jpg', 'Denmark football match 2024.jpg',
    'Denmark football match without date.jpg', 'Denmark football match 2023.jpg'
  ]));
  assert.ok(found.some(item => item.photoYear === 1918));
  assert.ok(found.some(item => item.photoYear === null));
});

test('поиск не отбрасывает современные фото по названию лицензии', () => {
  const pages = [
    page('Denmark football match 2024.jpg', 'CC BY-SA 4.0'),
    page('Denmark football game 2024.jpg', 'CC0 1.0'),
    page('Norway football game 2024.jpg', 'Public domain')
  ];
  const found = matchPhotoCandidates(pages, 'Дания — Норвегия', '⚽');
  assert.deepEqual(new Set(found.map(item => item.title)), new Set([
    'Denmark football match 2024.jpg', 'Denmark football game 2024.jpg', 'Norway football game 2024.jpg'
  ]));
});

test('короткие названия клубов распознаются без города в названии файла', () => {
  const pages = [
    page('Neftekhimik vs Sibir KHL 2024.jpg', 'CC BY-SA 4.0', 'Ice hockey match'),
    page('Neftekhimik plant 2024.jpg', 'CC0 1.0', 'Industrial photography')
  ];
  assert.deepEqual(matchPhotoCandidates(pages, 'Нефтехимик — Сибирь', '🏒').map(item => item.title),
    ['Neftekhimik vs Sibir KHL 2024.jpg']);
});

test('поиск Яндекса принимает фото разных лет, но не чужой вид спорта', () => {
  const xml = `<yandexsearch><response><grouping>
    <group><doc><url>https://images.example.com/khl/neftekhimik-sibir-2024.jpg</url><title>Нефтехимик — Сибирь КХЛ 2024 матч</title><image-properties><original-width>1200</original-width><original-height>800</original-height></image-properties></doc></group>
    <group><doc><url>https://images.example.com/khl/neftekhimik-sibir-2013.jpg</url><title>Нефтехимик — Сибирь КХЛ 2013 матч</title></doc></group>
    <group><doc><url>https://images.example.com/football/neftekhimik-2024.jpg</url><title>Нефтехимик футбол 2024</title></doc></group>
    <group><doc><url>https://127.0.0.1/private.jpg</url><title>Нефтехимик Сибирь КХЛ 2024</title></doc></group>
  </grouping></response></yandexsearch>`;
  const found = yandexPhotoCandidates(xml, 'Нефтехимик — Сибирь', '🏒');
  assert.deepEqual(found.map(item => item.sourceUrl), [
    'https://images.example.com/khl/neftekhimik-sibir-2024.jpg',
    'https://images.example.com/khl/neftekhimik-sibir-2013.jpg'
  ]);
});

test('афиша двух соперников и игровой кадр предпочтительнее портрета одного игрока', () => {
  const pages = [
    page('Belgium football player portrait 2024.jpg'),
    page('Belgium Turkey football match 2024.jpg'),
    page('Belgium vs Turkey football poster.jpg', 'CC0 1.0', 'Matchup graphic with both teams', 'image/jpeg', 1200, 675, null),
    page('Belgium football stadium 2024.jpg'),
    page('Belgium Turkey football border map 2024.jpg')
  ];
  const found = matchPhotoCandidates(pages, 'Бельгия — Турция', '⚽');
  assert.deepEqual(found.map(item => item.title), [
    'Belgium vs Turkey football poster.jpg',
    'Belgium Turkey football match 2024.jpg',
    'Belgium football player portrait 2024.jpg'
  ]);
});

test('Яндекс отбрасывает отдельную эмблему, оставляя кандидата с двумя командами', () => {
  const xml = `<yandexsearch><response><grouping>
    <group><doc><url>https://images.example.com/2026/florida-logo.jpg</url><title>Флорида Panthers hockey logo 2026</title></doc></group>
    <group><doc><url>https://images.example.com/2026/florida-tampa.jpg</url><title>Флорида — Тампа хоккей афиша 2026</title></doc></group>
  </grouping></response></yandexsearch>`;
  const found = yandexPhotoCandidates(xml, 'Флорида — Тампа', '🏒');
  assert.deepEqual(found.map(item => item.title), ['Флорида — Тампа хоккей афиша 2026']);
});

test('Англия — Чехия не принимает женский Евро и эмблему New England', () => {
  assert.equal(teamSearchQuery('Чехия', '⚽'), 'Czechia');
  const pages = [
    page("UEFA Women's EURO England 2022 logo text.png", 'CC0 1.0', "Women's football tournament", 'image/png'),
    page('MLS crest logo RGB - New England Revolution.svg', 'CC0 1.0', 'Soccer team', 'image/svg+xml', 500, 500),
    page('England Czech Republic UEFA Nations League 2026 preview.jpg', 'CC0 1.0', 'Football national teams'),
    page('England Czech Republic football players 2024.jpg', 'CC0 1.0', 'Football match action')
  ];
  const found = matchPhotoCandidates(pages, 'Англия — Чехия', '⚽', { context: 'Лига наций' });
  assert.deepEqual(new Set(found.map(item => item.title)), new Set([
    'England Czech Republic UEFA Nations League 2026 preview.jpg',
    'England Czech Republic football players 2024.jpg'
  ]));
});

test('женский матч может брать фото женских команд, если это указано в посте', () => {
  const pages = [page("England Women vs Czech Republic Women football 2024.jpg", 'CC0 1.0', "Women's football match")];
  assert.equal(matchPhotoCandidates(pages, 'Англия — Чехия', '⚽').length, 0);
  assert.equal(matchPhotoCandidates(pages, 'Англия — Чехия', '⚽', { context: 'Женская лига наций' }).length, 1);
});

test('КХЛ и Лига наций не подмешивают снимки других турниров', () => {
  const hockey = [
    page('Avangard vs Sibir NHL hockey players.jpg', 'CC0 1.0', 'NHL match'),
    page('Avangard vs Sibir KHL hockey players.jpg', 'CC0 1.0', 'KHL match')
  ];
  assert.deepEqual(matchPhotoCandidates(hockey, 'Авангард — Сибирь', '🏒').map(item => item.title),
    ['Avangard vs Sibir KHL hockey players.jpg']);
  const football = [
    page('England Czech Republic UEFA Euro 2024 football players.jpg'),
    page('England Czech Republic UEFA Nations League football players.jpg')
  ];
  assert.deepEqual(matchPhotoCandidates(football, 'Англия — Чехия', '⚽', { context: 'Лига наций' }).map(item => item.title),
    ['England Czech Republic UEFA Nations League football players.jpg']);
});

test('Вашингтон — Питтсбург ищется по английским названиям клубов НХЛ', () => {
  assert.equal(teamSearchQuery('Вашингтон', '🏒'), 'Washington Capitals');
  assert.equal(teamSearchQuery('Питтсбург', '🏒'), 'Pittsburgh Penguins');
  const found = matchPhotoCandidates([
    page('Pittsburgh Penguins, Washington Capitals, Bryan Rust.jpg', 'CC BY-SA 4.0', 'NHL hockey players at game'),
    page('Washington Capitals NHL logo.jpg', 'CC0 1.0', 'Team crest')
  ], 'Вашингтон — Питтсбург', '🏒', { context: '🏒 НХЛ' });
  assert.deepEqual(found.map(item => item.title), ['Pittsburgh Penguins, Washington Capitals, Bryan Rust.jpg']);
});

test('названия известных клубов ищутся на обоих языках независимо от языка поста', () => {
  assert.ok(teamSearchVariants('Washington Capitals', '🏒').includes('вашингтон'));
  assert.ok(teamSearchVariants('Вашингтон', '🏒').includes('Washington Capitals'));
  const found = matchPhotoCandidates([
    page('Вашингтон — Питтсбург НХЛ матч 2026.jpg', 'CC0 1.0', 'Хоккеисты на льду'),
    page('Washington Capitals vs Pittsburgh Penguins NHL hockey game 2026.jpg')
  ], 'Washington Capitals — Pittsburgh Penguins', '🏒', { context: 'NHL' });
  assert.equal(found.length, 2);
});

test('для незнакомого клуба английское название дополняется переводом Википедии и транслитерацией', async () => {
  assert.equal(transliterateTeamName('Бискра'), 'biskra');
  assert.equal(translatedClubName([
    { title: 'Константина (город)', langlinks: [{ title: 'Constantine, Algeria' }] },
    { title: 'Константина (футбольный клуб)', langlinks: [{ title: 'CS Constantine' }] }
  ], 'Константина', '⚽'), 'CS Constantine');
  assert.equal(translatedClubName([
    { title: 'CS Constantine', langlinks: [{ title: 'Константина (футбольный клуб)' }] }
  ], 'CS Constantine', '⚽'), 'Константина');
  const variants = await resolveTeamNameVariants('Константина', '⚽', { lookup: async () => 'CS Constantine' });
  assert.ok(variants.includes('Константина'));
  assert.ok(variants.includes('konstantina'));
  assert.ok(variants.includes('CS Constantine'));
  const found = matchPhotoCandidates([
    page('CS Constantine football players 2026.jpg'),
    page('Константина футболисты матч 2026.jpg', 'CC0 1.0', 'Футбол'),
    page('Biskra football players 2026.jpg')
  ], 'Константина — Бискра', '⚽', { teamVariants: [variants, ['Бискра', 'Biskra']] });
  assert.equal(found.length, 3);
});

test('если фото первого матча не хватает, поиск добирает их по второму матчу и его виду спорта', async () => {
  const calls = [];
  const { images } = await collectMatchBackgrounds([
    { match: 'Вашингтон — Питтсбург', sportIcon: '🏒' },
    { match: 'Константина — Бискра', sportIcon: '⚽️' }
  ], 4, async (entry, needed, used) => {
    calls.push({ ...entry, needed, used });
    return entry.sportIcon === '🏒'
      ? [{ sourceUrl: 'https://example.com/hockey.jpg' }]
      : [{ sourceUrl: 'https://example.com/hockey.jpg' }, { sourceUrl: 'https://example.com/football.jpg' }];
  });
  assert.deepEqual(calls.map(call => [call.sportIcon, call.needed]), [['🏒', 4], ['⚽️', 2]]);
  assert.deepEqual(calls[1].used, ['https://example.com/hockey.jpg']);
  assert.deepEqual(images.map(image => image.sourceUrl), [
    'https://example.com/hockey.jpg', 'https://example.com/football.jpg'
  ]);
});
