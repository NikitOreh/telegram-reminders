import { randomInt } from 'node:crypto';
import { extractMatches } from './core.js';

export function reminderTemplateSport(template) {
  const source = typeof template === 'string' ? template : template?.sourceText || template?.body || '';
  const withoutMatches = source.split(/\r?\n/).filter(line => !extractMatches(line).length).join('\n')
    .replace(/\{matches\}|\{sport\}/gi, ' ').replace(/<[^>]*>/g, ' ');
  const sports = [
    ['football', /⚽|\b(?:football|soccer|uefa|fifa)\b|футбол|лига чемпионов|лига наций/iu],
    ['hockey', /🏒|\b(?:hockey|nhl|khl)\b|хокке|(?<![\p{L}])(?:нхл|кхл)(?![\p{L}])|шайб/iu],
    ['tennis', /🎾|теннис|\b(?:tennis|atp|wta)\b/iu],
    ['basketball', /🏀|баскетбол|\b(?:basketball|nba|euroleague)\b|(?<![\p{L}])(?:нба|евролига)(?![\p{L}])/iu]
  ].filter(([, pattern]) => pattern.test(withoutMatches));
  return sports.length > 1 ? 'mixed' : sports[0]?.[0] || 'neutral';
}

export function compatibleReminderTemplates(pool, sportIcon) {
  const requested = { '🏒': 'hockey', '⚽️': 'football', '⚽': 'football', '🎾': 'tennis', '🏀': 'basketball' }[sportIcon];
  return pool.filter(template => {
    const sport = reminderTemplateSport(template);
    return sport === 'neutral' || Boolean(requested) && sport === requested;
  });
}

export function repeatAtMostTwice(uniqueItems, count) {
  if (!Number.isInteger(count) || count < 0) throw new Error('Некорректное число напоминаний');
  if (count > uniqueItems.length * 2) throw new Error(`Для ${count} напоминаний нужно минимум ${Math.ceil(count / 2)} разных изображений, найдено ${uniqueItems.length}. Загрузите свои фото.`);
  return Array.from({ length: count }, (_, index) => uniqueItems[index % uniqueItems.length]);
}

export function distributeManualPhotos(photoIds, count) {
  if (!Number.isInteger(count) || count < 1 || !Array.isArray(photoIds) || !photoIds.length || photoIds.length > count || photoIds.some(id => !id)) {
    throw new Error(`Пришлите от 1 до ${count} фото для напоминаний`);
  }
  return Array.from({ length: count }, (_, index) => photoIds[index % photoIds.length]);
}

export function selectReminderTemplates(pool, count, render, pickIndex = randomInt) {
  const unique = [];
  const captions = new Set();
  for (const template of pool) {
    const caption = render(template);
    if (!captions.has(caption)) { unique.push({ template, caption }); captions.add(caption); }
  }
  const minimum = count > 6 ? Math.ceil(count / 2) : count;
  if (unique.length < minimum) throw new Error(`Для ${count} напоминаний нужно минимум ${minimum} разных текстов, в пуле после подстановки матча ${unique.length}. Добавьте шаблоны.`);
  for (let index = unique.length - 1; index > 0; index--) {
    const other = pickIndex(index + 1);
    if (!Number.isInteger(other) || other < 0 || other > index) throw new Error('Некорректный источник случайных чисел');
    [unique[index], unique[other]] = [unique[other], unique[index]];
  }
  const chosen = unique.slice(0, Math.min(count, unique.length));
  return Array.from({ length: count }, (_, index) => chosen[index % chosen.length]);
}

export function validateCaptionRepetitions(captions) {
  const limit = captions.length > 6 ? 2 : 1;
  const counts = new Map();
  for (const caption of captions) {
    const next = (counts.get(caption) || 0) + 1;
    if (next > limit) throw new Error(`Текст напоминания повторяется больше ${limit} раз. Измените пул шаблонов.`);
    counts.set(caption, next);
  }
}
