import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMatches, extractOdds, formatMoscow, parseScheduleCommand, renderTemplate, scheduleTimes, reminderToTemplate, entitiesToMarkdown, parseFlexibleMoscow, parseDurationMinutes, parseReminderDeleteMinutes, parsePostDeleteMinutes, parseButtonSpec, sportIcon, sportIconForMatch, hasMixedMatchSports } from './core.js';
import { makeMatchCard, makeTemplateCard, splitMatch } from './card.js';
import { BUILTIN_IMAGE_TEMPLATES, defaultImageTemplateId, imageTemplatePath } from './image-templates.js';
import { normalizedTeamName, teamSearchQuery } from './team-art.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { entitiesToRichHtml, reminderRichMessage, richPhotoFileId } from './rich.js';
import sharp from 'sharp';

test('смешанный пост показывает значок каждого матча по его виду спорта', () => {
  const matches = ['Бельгия — Турция', 'Авангард — Лада'];
  assert.equal(sportIconForMatch(matches[0], '🏒'), '⚽️');
  assert.equal(sportIconForMatch(matches[1], '⚽️'), '🏒');
  assert.equal(sportIconForMatch(matches[1], '⚽️', '⚽️ Авангард — Лада'), '🏒');
  assert.equal(hasMixedMatchSports(matches), true);
  const unknownMatches = ['Альфа — Бета', 'Гамма — Дельта'];
  const sourceText = '⚽️ Альфа — Бета\n🏒 Гамма — Дельта';
  assert.equal(hasMixedMatchSports(unknownMatches, sourceText), true);
  assert.equal(sportIconForMatch(unknownMatches[1], '⚽️', sourceText), '🏒');
  const data = { matches, odds: '2,59', sportIcon: '⚽️' };
  assert.match(renderTemplate('🔥 ПРОГНОЗ\n{matches}', data), /⚽️ Бельгия — Турция\n🏒 Авангард — Лада/);
  assert.match(renderTemplate({ format: 'rich_html', body: '<b>ПРОГНОЗ</b><br>{matches}' }, data), /⚽️ Бельгия — Турция<br>🏒 Авангард — Лада/);
});

test('теннис и баскетбол получают свои значки в обычном и смешанном посте', () => {
  assert.equal(sportIcon('Теннис ATP. Джокович — Синнер'), '🎾');
  assert.equal(sportIcon('NBA. Бостон — Майами'), '🏀');
  assert.equal(sportIcon('Баскетбол. Реал Мадрид — Барселона'), '🏀');
  assert.equal(sportIconForMatch('Джокович — Синнер', '🎾'), '🎾');
  const sourceText = 'Теннис\nДжокович — Синнер\nБаскетбол NBA\nБостон — Майами';
  const matches = extractMatches(sourceText);
  assert.deepEqual(matches, ['Джокович — Синнер', 'Бостон — Майами']);
  assert.equal(sportIconForMatch(matches[0], '🎾', sourceText), '🎾');
  assert.equal(sportIconForMatch(matches[1], '🎾', sourceText), '🏀');
  assert.equal(hasMixedMatchSports(matches, sourceText), true);
  assert.match(renderTemplate('🔥 ПРОГНОЗ\n{matches}', {
    matches, odds: '2,40', sportIcon: '🎾', sourceText
  }), /🎾 Джокович — Синнер\n🏀 Бостон — Майами/);
});

test('шаблоны картинок подставляют команды для футбола и хоккея', async () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  assert.equal(defaultImageTemplateId('🏒'), 'hockey-solo');
  assert.equal(defaultImageTemplateId('⚽️'), 'football-duel-circles');
  for (const sport of ['🏒', '⚽️']) {
    const template = BUILTIN_IMAGE_TEMPLATES.find(item => item.id === defaultImageTemplateId(sport));
    const templatePath = imageTemplatePath(dir, template);
    const first = await makeTemplateCard('Амур — Локомотив', templatePath, template.layout);
    const second = await makeTemplateCard('Трактор — СКА', templatePath, template.layout);
    const capitalized = await makeTemplateCard('АМУР — ЛОКОМОТИВ', templatePath, template.layout);
    const variant = await makeTemplateCard('Амур — Локомотив', templatePath, template.layout, null, 1);
    const meta = await sharp(first).metadata();
    assert.equal(meta.width, 1254);
    assert.equal(meta.height, 1254);
    assert.notDeepEqual(first, second);
    assert.notDeepEqual(first, variant);
    assert.deepEqual(first, capitalized);
  }
});

test('карточка использует найденные эмблемы, а названия команд сопоставляются по виду спорта', async () => {
  assert.equal(normalizedTeamName('🇳🇱 Нидерланды 🇳🇱'), 'нидерланды');
  assert.equal(teamSearchQuery('Локомотив', '🏒'), 'Lokomotiv Yaroslavl');
  assert.equal(teamSearchQuery('Нидерланды', '⚽'), 'Netherlands');
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const template = BUILTIN_IMAGE_TEMPLATES.find(item => item.id === 'football-duel-circles');
  const badge = await sharp({ create: { width: 180, height: 180, channels: 4, background: '#e96929' } }).png().toBuffer();
  const plain = await makeTemplateCard('Нидерланды — Германия', imageTemplatePath(dir, template), template.layout);
  const withBadges = await makeTemplateCard('Нидерланды — Германия', imageTemplatePath(dir, template), template.layout,
    { home: { badge, color: '#E96929' }, away: { badge, color: '#FFFFFF' } });
  assert.notDeepEqual(withBadges, plain);
  assert.equal((await sharp(withBadges).metadata()).width, 1254);
});

test('расписание: первый через 30 минут, последний за 30 минут', () => {
  const start = Date.parse('2026-09-24T15:00:00+03:00');
  const end = Date.parse('2026-09-24T17:00:00+03:00');
  assert.deepEqual(scheduleTimes(start, end).map(formatMoscow), [
    '2026-09-24 15:30', '2026-09-24 16:00', '2026-09-24 16:30'
  ]);
});

test('число напоминаний учитывает таймер удаления и конец рекламы', () => {
  const start = Date.parse('2026-09-24T15:00:00+03:00');
  const end = Date.parse('2026-09-24T18:00:00+03:00');
  assert.deepEqual(scheduleTimes(start, end, 150).map(formatMoscow), ['2026-09-24 15:30']);
  assert.deepEqual(scheduleTimes(start, end, 60).map(formatMoscow), ['2026-09-24 15:30', '2026-09-24 16:30']);
  assert.deepEqual(scheduleTimes(start, end, 20).map(formatMoscow), [
    '2026-09-24 15:20', '2026-09-24 15:40', '2026-09-24 16:00', '2026-09-24 16:20',
    '2026-09-24 16:40', '2026-09-24 17:00', '2026-09-24 17:20', '2026-09-24 17:40'
  ]);
  assert.throws(() => scheduleTimes(start, start + 60 * 60_000, 150), /слишком короткий/);
});

test('короткий таймер рекламы сдвигает одну напоминалку так, чтобы оба сообщения удалились вместе', () => {
  const start = Date.parse('2026-10-02T16:00:00+03:00');
  const end = Date.parse('2026-10-02T18:00:00+03:00');
  assert.deepEqual(scheduleTimes(start, end, 20, 40).map(formatMoscow), ['2026-10-02 16:20']);
  assert.equal(scheduleTimes(start, end, 20, 40)[0] + 20 * 60_000, start + 40 * 60_000);
  assert.throws(() => scheduleTimes(start, end, 30, 20), /удаляется слишком рано/);
  assert.deepEqual(scheduleTimes(start, end, 20).map(formatMoscow), [
    '2026-10-02 16:20', '2026-10-02 16:40', '2026-10-02 17:00', '2026-10-02 17:20', '2026-10-02 17:40'
  ]);
  assert.deepEqual(scheduleTimes(start, end, null, 40).map(formatMoscow), ['2026-10-02 16:30']);
});

test('часовая реклама с таймером напоминаний 15 минут создаёт три напоминания', () => {
  const start = Date.parse('2026-10-06T17:30:00+03:00');
  const end = Date.parse('2026-10-06T18:30:00+03:00');
  assert.deepEqual(scheduleTimes(start, end, 15, 60).map(formatMoscow), [
    '2026-10-06 17:45', '2026-10-06 18:00', '2026-10-06 18:15'
  ]);
  assert.deepEqual(scheduleTimes(start, end, 15).map(formatMoscow), [
    '2026-10-06 17:45', '2026-10-06 18:00', '2026-10-06 18:15'
  ]);
});

test('разбор рекламы с двумя футбольными матчами и коэффициентом', () => {
  const text = `ЖЕЛЕЗНЫЙ ЭКСПРЕСС ДНЯ! 🔥\n🇳🇱 Нидерланды — Германия 🇩🇪\n🇳🇴 Норвегия — Дания 🇩🇰\n📊 КОЭФФИЦИЕНТ — 2.2+🔥`;
  assert.deepEqual(extractMatches(text), ['Нидерланды — Германия', 'Норвегия — Дания']);
  assert.equal(extractOdds(text), '2,2+');
});

test('КХЛ и НХЛ определяются как хоккей даже без эмодзи', () => {
  assert.equal(sportIcon('Хоккей. Флорида — Тампа'), '🏒');
  assert.equal(sportIcon('КХЛ. Амур — Локомотив'), '🏒');
  assert.equal(sportIcon('NHL. Florida — Tampa'), '🏒');
  assert.equal(sportIcon('Лига Наций УЕФА. Нидерланды — Германия'), '⚽️');
});

test('вид спорта определяется по командам, если в рекламе нет названия спорта', () => {
  const hockeyPost = '🔥 ЖЕЛЕЗНЫЙ ДВОЙНИК\n🐺 Нефтехимик - Сибирь ❄️\n🚗 Автомобилист - Амур 🐅';
  assert.equal(sportIcon(hockeyPost), '🏒');
  assert.equal(sportIcon('🇳🇱 Нидерланды — Германия 🇩🇪\n🇳🇴 Норвегия — Дания 🇩🇰'), '⚽️');
  assert.equal(sportIcon(`⚽️ Футбол\n${hockeyPost}`), '⚽️');
});

test('настройка публикации и удаление', () => {
  const setting = parseScheduleCommand('/schedule 2026-09-24 15:00 | 2026-09-24 17:00 | 30 | https://t.me/example | ПРОГНОЗ');
  assert.equal(setting.times.length, 3);
  assert.equal(setting.deleteAfter, 30);
  assert.equal(setting.buttonText, 'ПРОГНОЗ');
});

test('команда расписания учитывает таймер удаления напоминаний', () => {
  const setting = parseScheduleCommand('/schedule 2026-09-24 15:00 | 2026-09-24 18:00 | 150 | https://t.me/example | ПРОГНОЗ');
  assert.deepEqual(setting.times.map(formatMoscow), ['2026-09-24 15:30']);
});

test('подстановка и экранирование HTML в шаблоне', () => {
  assert.equal(renderTemplate('**{odds}**\n{matches}', { odds: '2,2+', matches: ['A < B — C'] }), '<b>2,2+</b>\n⚽️ A &lt; B — C');
});

test('между последним матчем и призывом остаётся не больше одной пустой строки', () => {
  const values = { odds: '2,937', matches: ['Бельгия — Турция', 'Авангард — Лада'] };
  const plain = renderTemplate('{matches}\n\n\n\nПРОГНОЗ НИЖЕ⬇️', values);
  const rich = renderTemplate({ format: 'rich_html', body: '{matches}<br><br><br><br>ПРОГНОЗ НИЖЕ⬇️' }, values);
  const formatted = renderTemplate({ format: 'rich_html', body: '{matches}<b><br></b><b><br><br></b><tg-emoji emoji-id="1">⬇️</tg-emoji> ПРОГНОЗ В КНОПКЕ' }, values);
  assert.match(plain, /Авангард — Лада\n\nПРОГНОЗ НИЖЕ/);
  assert.doesNotMatch(plain, /\n{3,}/);
  assert.match(rich, /Авангард — Лада<br><br>ПРОГНОЗ НИЖЕ/);
  assert.doesNotMatch(rich, /(?:<br>){3,}/);
  assert.match(formatted.replace(/<\/?b>/g, ''), /Авангард — Лада<br><br><tg-emoji/);
  assert.equal((formatted.match(/<br>/g) || []).length, 3);
});

test('пересланное напоминание становится шаблоном для новой рекламы', () => {
  const source = '**БЕСПЛАТНЫЙ ПРОГНОЗ**\n**Коэффициент — 2.40**\n\n**Нидерланды — Германия**\n**Норвегия — Дания**\n\nПрогноз в кнопке';
  const template = reminderToTemplate(source);
  assert.match(template, /\{odds\}/);
  assert.equal(template.match(/\{matches\}/g)?.length, 1);
  assert.ok(!template.includes('Нидерланды'));
  assert.ok(!template.includes('Норвегия'));
  assert.match(renderTemplate(template, { matches: ['Северсталь — Автомобилист'], odds: '2,3', sportIcon: '🏒' }), /🏒 Северсталь — Автомобилист/);
});

test('сохраняется жирное выделение из пересланного поста', () => {
  assert.equal(entitiesToMarkdown('Прогноз сегодня', [{ type: 'bold', offset: 0, length: 7 }]), '**Прогноз** сегодня');
});

test('разные способы ввода времени по Москве', () => {
  const now = Date.parse('2026-09-24T12:00:00+03:00');
  assert.equal(formatMoscow(parseFlexibleMoscow('сегодня 18:00', now)), '2026-09-24 18:00');
  assert.equal(formatMoscow(parseFlexibleMoscow('завтра 18:00', now)), '2026-09-25 18:00');
  assert.equal(formatMoscow(parseFlexibleMoscow('25.09 18:00', now)), '2026-09-25 18:00');
  assert.equal(formatMoscow(parseFlexibleMoscow('25.09.2026 18:00', now)), '2026-09-25 18:00');
  assert.equal(formatMoscow(parseFlexibleMoscow('18:00', now)), '2026-09-24 18:00');
  assert.equal(formatMoscow(parseFlexibleMoscow('19', now)), '2026-09-24 19:00');
  assert.equal(formatMoscow(parseFlexibleMoscow('1928', now)), '2026-09-24 19:28');
  assert.equal(formatMoscow(parseFlexibleMoscow('928', now)), '2026-09-25 09:28');
  assert.equal(formatMoscow(parseFlexibleMoscow('через 30 минут', now)), '2026-09-24 12:30');
  assert.equal(parseDurationMinutes('1ч 30м'), 90);
  assert.equal(formatMoscow(parseFlexibleMoscow('завтра 1928', now)), '2026-09-25 19:28');
  assert.equal(formatMoscow(parseFlexibleMoscow('25.09 19', now)), '2026-09-25 19:00');
});

test('таймер удаления напоминаний принимает часы и минуты как в Posted', () => {
  assert.equal(parseReminderDeleteMinutes('0 30'), 30);
  assert.equal(parseReminderDeleteMinutes('1'), 60);
  assert.equal(parseReminderDeleteMinutes('1 30'), 90);
  assert.equal(parseReminderDeleteMinutes('47 59'), 2879);
  assert.equal(parseReminderDeleteMinutes('нет'), null);
  assert.throws(() => parseReminderDeleteMinutes('48'));
  assert.throws(() => parseReminderDeleteMinutes('0 0'));
});

test('таймер исходного поста принимает время как в Posted и отключение удаления', () => {
  assert.equal(parsePostDeleteMinutes('0 30'), 30);
  assert.equal(parsePostDeleteMinutes('1'), 60);
  assert.equal(parsePostDeleteMinutes('1 30'), 90);
  assert.equal(parsePostDeleteMinutes('47 59'), 2879);
  assert.equal(parsePostDeleteMinutes('нет'), null);
  assert.throws(() => parsePostDeleteMinutes('48'));
  assert.throws(() => parsePostDeleteMinutes('0 0'));
});

test('строка без скобок сразу превращается в кнопку', () => {
  assert.deepEqual(parseButtonSpec('СМОТРЕТЬ ПРОГНОЗ - https://t.me/+ExampleInvite'), {
    text: 'СМОТРЕТЬ ПРОГНОЗ', url: 'https://t.me/+ExampleInvite'
  });
  assert.throws(() => parseButtonSpec('СМОТРЕТЬ ПРОГНОЗ - http://example.com'));
});

test('изображение напоминания находится в цитате после текста', () => {
  const rich = reminderRichMessage('<b>Прогноз</b>\nАмур — Локомотив', 'file-id');
  assert.match(rich.html, /<p><b>Прогноз<\/b><br>Амур — Локомотив<\/p><blockquote><img/);
  assert.equal(rich.media[0].media.media, 'file-id');
  assert.equal(entitiesToRichHtml('Ставка <5', [{ type: 'bold', offset: 0, length: 6 }]), '<b>Ставка</b> &lt;5');
  const sent = { rich_message: { blocks: [{ type: 'blockquote', blocks: [
    { type: 'photo', photo: [{ file_id: 'created-id' }] }
  ] }] } };
  assert.equal(richPhotoFileId(sent), 'created-id');
});

test('карточка создаётся по названиям команд без фото рекламы', async () => {
  assert.deepEqual(splitMatch('Нидерланды — Германия'), ['Нидерланды', 'Германия']);
  const png = await makeMatchCard('Нидерланды — Германия', '⚽');
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 1000);
  assert.equal(metadata.height, 1000);
});
