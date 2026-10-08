import { knownTeamSports, normalizedTeamName } from './team-aliases.js';

export const MINUTE = 60_000;

export const DEFAULT_TEMPLATES = [
  '🎯 **БЕСПЛАТНЫЙ ПРОГНОЗ** 🎯\n🔝 **Коэффициент — {odds}**\n\n{matches}\n\n⬇️ **ПРОГНОЗ В КНОПКЕ** ⬇️',
  '⚡️ **ПРОГНОЗ НА СЕГОДНЯ**\n📊 Коэффициент: **{odds}**\n\n{matches}\n\n👇 Подробности — в кнопке',
  '🔥 **МАТЧИ ДНЯ**\n\n{matches}\n\n📈 **{odds}** | Прогноз по кнопке ниже ⬇️',
  '🎯 **ЗАБИРАЙТЕ ПРОГНОЗ**\n\n{matches}\n\nКоэффициент **{odds}**. Ссылка — в кнопке 👇',
  '🏆 **СЕГОДНЯ В ИГРЕ**\n\n{matches}\n\n📊 Коэффициент **{odds}**\n⬇️ Прогноз в кнопке',
  '📣 **НАПОМИНАЕМ О ПРОГНОЗЕ**\n\n{matches}\n\n**{odds}** — перейти по кнопке ниже 👇',
  '⏰ **СКОРО МАТЧ**\n\n{matches}\n\n📈 Коэффициент **{odds}**\n🎯 Прогноз по кнопке',
  '⚽️ **ПРОГНОЗ К МАТЧУ**\n\n{matches}\n\nКоэффициент: **{odds}**\n👇 Смотрите в кнопке',
  '💥 **ПРОГНОЗ УЖЕ ГОТОВ**\n\n{matches}\n\n📊 **{odds}**\n⬇️ Открыть прогноз',
  '🔔 **НАПОМИНАНИЕ**\n\n{matches}\n\nКоэффициент **{odds}**. Прогноз доступен по кнопке 👇',
  '📌 **НЕ ПРОПУСТИТЕ МАТЧ**\n\n{matches}\n\n📈 **{odds}** | Прогноз в кнопке',
  '🎯 **ВРЕМЯ ПРОГНОЗА**\n\n{matches}\n\nКоэффициент — **{odds}**\n⬇️ Перейти к прогнозу',
  '⚡ **СЕГОДНЯШНИЙ ВЫБОР**\n\n{matches}\n\n📊 **{odds}**\n👇 Прогноз ниже',
  '🏟 **ВСТРЕЧА ДНЯ**\n\n{matches}\n\nКоэффициент **{odds}**. Кнопка ниже ⬇️',
  '🔥 **ПРОГНОЗ НА ЭТИ МАТЧИ**\n\n{matches}\n\n📈 Коэффициент — **{odds}**\n👇 Подробности по кнопке',
  '📣 **ПРОГНОЗ ДОСТУПЕН**\n\n{matches}\n\n**{odds}** | Забрать по кнопке ⬇️',
  '🎯 **ЕЩЁ УСПЕВАЕТЕ**\n\n{matches}\n\n📊 **{odds}**\n⬇️ Прогноз в кнопке',
  '🔝 **МАТЧ И ПРОГНОЗ**\n\n{matches}\n\nКоэффициент **{odds}**\n👇 Открыть',
  '⚽ **СЕГОДНЯ ИГРАЮТ**\n\n{matches}\n\n📈 **{odds}** | Прогноз в кнопке',
  '⏰ **НАПОМИНАЕМ ПЕРЕД МАТЧЕМ**\n\n{matches}\n\nКоэффициент — **{odds}**\n👇 Перейти',
  '🏆 **ПРОГНОЗ К ИГРЕ**\n\n{matches}\n\n📊 **{odds}**\n⬇️ Смотреть прогноз',
  '💬 **ПРОГНОЗ НА СЕГОДНЯ**\n\n{matches}\n\nКоэффициент **{odds}**. Ссылка в кнопке 👇',
  '⚡️ **МАТЧ УЖЕ БЛИЗКО**\n\n{matches}\n\n📈 **{odds}**\n⬇️ Прогноз по кнопке',
  '🎯 **ПОСЛЕДНЕЕ НАПОМИНАНИЕ**\n\n{matches}\n\nКоэффициент **{odds}**\n👇 Прогноз доступен в кнопке'
];

export function parseMoscow(value) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)) throw new Error('Время укажите как ГГГГ-ММ-ДД ЧЧ:ММ');
  const instant = new Date(`${value.replace(' ', 'T')}:00+03:00`);
  if (Number.isNaN(instant.valueOf()) || formatMoscow(instant.valueOf()) !== value) throw new Error('Некорректная дата или время');
  return instant.valueOf();
}

export function formatMoscow(timestamp) {
  return new Date(timestamp + 3 * 60 * MINUTE).toISOString().slice(0, 16).replace('T', ' ');
}

export function parseFlexibleMoscow(input, now = Date.now()) {
  const value = input.trim().toLowerCase().replace(/\s*мск\.?$/i, '').replace(/\s+/g, ' ');
  let match;
  if ((match = value.match(/^(сегодня|завтра|послезавтра) (\d{1,4})$/))) {
    const time = match[2].length <= 2 ? `${match[2]}:00` : `${match[2].slice(0, -2)}:${match[2].slice(-2)}`;
    return parseFlexibleMoscow(`${match[1]} ${time}`, now);
  }
  if ((match = value.match(/^(\d{1,2}\.\d{1,2}(?:\.\d{4})?) (\d{1,4})$/))) {
    const time = match[2].length <= 2 ? `${match[2]}:00` : `${match[2].slice(0, -2)}:${match[2].slice(-2)}`;
    return parseFlexibleMoscow(`${match[1]} ${time}`, now);
  }
  if (/^\d{1,4}$/.test(value)) {
    const compact = value.length <= 2 ? `${value.padStart(2, '0')}:00` : `${value.slice(0, -2).padStart(2, '0')}:${value.slice(-2)}`;
    return parseFlexibleMoscow(compact, now);
  }
  if (/^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}$/.test(value)) {
    const normalized = value.replace(/ (\d):/, ' 0$1:');
    return parseMoscow(normalized);
  }
  if ((match = value.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?[ ,]+(\d{1,2}):(\d{2})$/))) {
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    const time = `${match[4].padStart(2, '0')}:${match[5]}`;
    const currentYear = Number(formatMoscow(now).slice(0, 4));
    let year = match[3] ? Number(match[3]) : currentYear;
    let at = parseMoscow(`${year}-${month}-${day} ${time}`);
    if (!match[3] && at <= now) {
      year++;
      at = parseMoscow(`${year}-${month}-${day} ${time}`);
    }
    return at;
  }
  if ((match = value.match(/^(сегодня|завтра|послезавтра) (\d{1,2}):(\d{2})$/))) {
    const days = { сегодня: 0, завтра: 1, послезавтра: 2 }[match[1]];
    const baseDay = parseMoscow(`${formatMoscow(now).slice(0, 10)} 00:00`) + days * 24 * 60 * MINUTE;
    const dayString = formatMoscow(baseDay).slice(0, 10);
    return parseMoscow(`${dayString} ${match[2].padStart(2, '0')}:${match[3]}`);
  }
  if ((match = value.match(/^(?:через )?(\d+)\s*(минут[уы]?|мин|м|час(?:а|ов)?|ч)$/))) {
    const count = Number(match[1]);
    const minutes = /^(?:час|ч)/.test(match[2]) ? count * 60 : count;
    if (minutes < 1 || minutes > 365 * 24 * 60) throw new Error('Слишком большой интервал');
    return now + minutes * MINUTE;
  }
  if ((match = value.match(/^(\d{1,2}):(\d{2})$/))) {
    const day = formatMoscow(now).slice(0, 10);
    let at = parseMoscow(`${day} ${match[1].padStart(2, '0')}:${match[2]}`);
    if (at <= now) at += 24 * 60 * MINUTE;
    return at;
  }
  throw new Error('Укажите время как «25.09 18:00», «завтра 18:00», «18:00» или «через 30 минут»');
}

export function parseDurationMinutes(input) {
  const value = input.trim().toLowerCase().replace(/\s+/g, ' ');
  let minutes;
  let match;
  if (/^\d+$/.test(value)) minutes = Number(value);
  else if ((match = value.match(/^(\d{1,2}):(\d{2})$/))) minutes = Number(match[1]) * 60 + Number(match[2]);
  else if ((match = value.match(/^(\d+)\s*(?:ч|час(?:а|ов)?)(?:\s*(\d+)\s*(?:м|мин(?:ут[уы]?)?))?$/))) minutes = Number(match[1]) * 60 + Number(match[2] || 0);
  else if ((match = value.match(/^(\d+)\s*(?:м|мин(?:ут[уы]?)?)$/))) minutes = Number(match[1]);
  else throw new Error('Интервал: 30, 30м, 1ч, 1ч 30м или 1:30');
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes >= 48 * 60) throw new Error('Интервал должен быть от 1 минуты до 47 часов 59 минут: Telegram не удаляет сообщения старше 48 часов');
  return minutes;
}

export function parseReminderDeleteMinutes(input) {
  const value = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^(?:нет|не удалять|без удаления)$/.test(value)) return null;
  const match = value.match(/^(\d{1,2})(?:\s+([0-5]?\d))?$/);
  if (!match) return parseDurationMinutes(value);
  const minutes = Number(match[1]) * 60 + Number(match[2] || 0);
  if (minutes < 1 || minutes >= 48 * 60) throw new Error('Таймер удаления должен быть от 1 минуты до 47 часов 59 минут: Telegram не удаляет сообщения старше 48 часов');
  return minutes;
}

export function parsePostDeleteMinutes(input) {
  if (/^(?:нет|не удалять|без удаления)$/i.test(input.trim())) return null;
  return parseReminderDeleteMinutes(input);
}

export function parseButtonSpec(text) {
  const value = text.trim().replace(/^\[([\s\S]*)\]$/, '$1').trim();
  const match = value.match(/^(.+?)\s+-\s+(https:\/\/\S+)$/i);
  if (!match || !/^https:\/\/(?:t\.me|telegram\.me)\//i.test(match[2])) throw new Error('Формат кнопки: СМОТРЕТЬ ПРОГНОЗ - https://t.me/...');
  return { text: match[1].trim(), url: match[2] };
}

export function scheduleTimes(adStart, adEnd, deleteAfter = 30, postDeleteAfter = null) {
  if (adEnd <= adStart) throw new Error('Конец рекламы должен быть позже начала');
  const deleteMinutes = deleteAfter ?? 30;
  const intervalMinutes = deleteAfter === null ? 30 : deleteMinutes;
  const endPaddingMinutes = deleteAfter === null && postDeleteAfter !== null ? 0 : deleteMinutes;
  const effectiveEnd = postDeleteAfter === null ? adEnd : Math.min(adEnd, adStart + postDeleteAfter * MINUTE);
  const firstDelay = deleteAfter === null ? 30 : Math.min(30, deleteMinutes,
    Math.floor((effectiveEnd - adStart) / MINUTE) - deleteMinutes);
  if (firstDelay < 1) throw new Error(postDeleteAfter === null
    ? 'Период рекламы слишком короткий для напоминания с выбранным таймером удаления'
    : 'Реклама удаляется слишком рано для напоминания с выбранным таймером');
  const times = [];
  for (let t = adStart + firstDelay * MINUTE; t + endPaddingMinutes * MINUTE <= effectiveEnd; t += intervalMinutes * MINUTE) times.push(t);
  if (!times.length) throw new Error('Период рекламы слишком короткий для напоминания с выбранным таймером удаления');
  if (times.length > 48) throw new Error('За одну серию допускается не более 48 напоминаний');
  return times;
}

function cleanLine(line) {
  return line.replace(/<[^>]*>/g, ' ').replace(/\*|_|\\|&#x[a-fA-F0-9]+;|&nbsp;/g, ' ').replace(/\[[^\]]*\]\([^)]*\)/g, ' ').replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '').replace(/^[^\p{L}\p{N}]+/u, '').replace(/\s+/g, ' ').trim();
}

export function extractMatches(text) {
  const matches = [];
  for (const sourceLine of text.split(/\r?\n/)) {
    const line = cleanLine(sourceLine);
    const found = line.match(/^(.{2,60}?)\s+[—–-]\s+(.{2,60})$/u);
    if (!found) continue;
    const left = found[1].trim();
    const right = found[2].trim();
    if (/^(?:коэффициент|кэф|прогноз|ставка|статус|лига)/i.test(left)) continue;
    if (/\d{4}|https?:|t\.me/i.test(left + right)) continue;
    const match = `${left} — ${right}`;
    if (!matches.includes(match)) matches.push(match);
  }
  return matches.slice(0, 5);
}

export function extractOdds(text) {
  const match = text.match(/(?:коэффиц(?:иент)?|кэф|кф|📊)[^\n\d]{0,20}(\d+[.,]\d+\+?)/i) || text.match(/\b([12][.,]\d{1,2}\+?)\b/);
  return match?.[1]?.replace('.', ',') ?? null;
}

const SPORT_MARKERS = [
  ['🏒', /🏒|хокке|\b(?:nhl|khl|ice hockey)\b|(?<![\p{L}])(?:нхл|кхл)(?![\p{L}])/iu],
  ['⚽️', /⚽|футбол|\b(?:football|soccer|uefa|fifa)\b/iu],
  ['🎾', /🎾|теннис|\b(?:tennis|atp|wta)\b/iu],
  ['🏀', /🏀|баскетбол|\b(?:basketball|nba|euroleague)\b|(?<![\p{L}])(?:нба|евролига)(?![\p{L}])/iu]
];

function mentionedSportIcons(text) {
  return SPORT_MARKERS.filter(([, pattern]) => pattern.test(text)).map(([icon]) => icon);
}

export function sportIcon(text) {
  const mentioned = mentionedSportIcons(text);
  if (mentioned.length === 1) return mentioned[0];
  let hockeyTeams = 0;
  let footballTeams = 0;
  for (const match of extractMatches(text)) {
    for (const name of match.split(/\s+[—–-]\s+/).slice(0, 2)) {
      const sports = knownTeamSports(name);
      hockeyTeams += Number(sports.hockey);
      footballTeams += Number(sports.football);
    }
  }
  if (hockeyTeams !== footballTeams) return hockeyTeams > footballTeams ? '🏒' : '⚽️';
  if (mentioned.length) {
    const first = SPORT_MARKERS.map(([icon, pattern]) => ({ icon, index: String(text).search(pattern) }))
      .filter(item => item.index >= 0).sort((a, b) => a.index - b.index)[0];
    return first.icon;
  }
  return '⚽️';
}

export function sportIconForMatch(match, fallback = '⚽️', sourceText = '') {
  const names = String(match).split(/\s+[—–-]\s+/).slice(0, 2);
  const matchIcon = mentionedSportIcons(match)[0];
  if (matchIcon === '🎾' || matchIcon === '🏀') return matchIcon;
  let lineIcon = null;
  if (names.length === 2 && sourceText) {
    const normalizedNames = names.map(normalizedTeamName);
    let sectionIcon = null;
    for (const line of String(sourceText).split(/\r?\n/)) {
      const mentioned = mentionedSportIcons(line);
      if (mentioned.length === 1) sectionIcon = mentioned[0];
      const normalizedLine = normalizedTeamName(line);
      if (!/[—–-]/u.test(line) || !normalizedNames.every(name => name && normalizedLine.includes(name))) continue;
      lineIcon = mentioned[0] || sectionIcon;
      break;
    }
  }
  if (lineIcon === '🎾' || lineIcon === '🏀') return lineIcon;
  let hockey = 0;
  let football = 0;
  for (const name of names) {
    const sports = knownTeamSports(name);
    if (sports.hockey && !sports.football) hockey++;
    if (sports.football && !sports.hockey) football++;
  }
  if (hockey !== football) return hockey > football ? '🏒' : '⚽️';
  if (matchIcon) return matchIcon;
  if (lineIcon) return lineIcon;
  return fallback;
}

export function hasMixedMatchSports(matches, sourceText = '') {
  const known = new Set(matches.map(match => sportIconForMatch(match, null, sourceText)).filter(Boolean));
  return known.size > 1;
}

export function entitiesToMarkdown(text, entities = []) {
  const inserts = [];
  for (const entity of entities) {
    if (entity.type !== 'bold') continue;
    inserts.push({ at: entity.offset, value: '**', closing: false });
    inserts.push({ at: entity.offset + entity.length, value: '**', closing: true });
  }
  inserts.sort((a, b) => b.at - a.at || Number(a.closing) - Number(b.closing));
  let result = text;
  for (const insert of inserts) result = result.slice(0, insert.at) + insert.value + result.slice(insert.at);
  return result;
}

export function reminderToTemplate(text) {
  const matches = extractMatches(text);
  const odds = extractOdds(text);
  if (!matches.length || !odds) throw new Error('В напоминании не найдены матч или коэффициент');
  const lines = text.split(/\r?\n/);
  let replacedMatches = false;
  const normalized = [];
  for (const line of lines) {
    if (extractMatches(line).length) {
      if (!replacedMatches) normalized.push('{matches}');
      replacedMatches = true;
    } else normalized.push(line);
  }
  const oddsLiteral = odds.replace(/[.,]/g, '___SEP___').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('___SEP___', '[.,]');
  const oddsPattern = new RegExp(`(?<!\\d)${oddsLiteral}(?!\\d)`, 'g');
  const result = normalized.join('\n').replace(oddsPattern, '{odds}').replace(/⚽️?|🏒|🎾|🏀/gu, '{sport}').trim();
  if (!result.includes('{odds}') || !result.includes('{matches}')) throw new Error('Не удалось заменить коэффициент и матчи');
  return result;
}

export function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function normalizeReminderSpacing(text, rich = false) {
  if (rich) {
    const tokens = text.replace(/<br\s*\/?>(?:[ \t]*\r?\n)?/gi, '<br>').match(/<[^>]*>|[^<]+/g) || [];
    let breaks = 0;
    let result = '';
    for (const token of tokens) {
      if (/^<br>$/i.test(token)) {
        if (breaks++ < 2) result += '<br>';
      } else if (/^<[^>]*>$/.test(token)) {
        result += token;
      } else {
        for (const part of token.split(/(\r?\n)/)) {
          if (/^\r?\n$/.test(part)) {
            if (breaks++ < 2) result += '<br>';
          } else {
            result += part;
            if (part.trim()) breaks = 0;
          }
        }
      }
    }
    return result;
  }
  return text.replace(/(?:[ \t]*\r?\n){3,}/g, '\n\n');
}

export function renderTemplate(template, { matches, odds, sportIcon: icon = '⚽️', sourceText = '' }) {
  if (template?.format === 'rich_html') {
    const replacements = {
      '{matches}': matches.map(match => `${escapeHtml(sportIconForMatch(match, icon, sourceText))} ${escapeHtml(match)}`).join('<br>'),
      '{odds}': escapeHtml(odds || ''),
      '{sport}': escapeHtml(icon)
    };
    return normalizeReminderSpacing(template.body.replace(/\{matches\}|\{odds\}|\{sport\}/g, token => replacements[token]), true);
  }
  const replacements = {
    matches: matches.map(match => `${sportIconForMatch(match, icon, sourceText)} ${match}`).join('\n'),
    odds,
    sport: icon
  };
  const parts = String(template).replace(/⚽️?/gu, '{sport}').split(/(\{matches\}|\{odds\}|\{sport\})/g);
  const escaped = parts.map(part => /^\{(?:matches|odds|sport)\}$/.test(part) ? escapeHtml(replacements[part.slice(1, -1)]) : escapeHtml(part)).join('');
  return normalizeReminderSpacing(escaped.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>'));
}

export function parseScheduleCommand(text) {
  const parts = text.replace(/^\/schedule(?:@\w+)?\s*/i, '').split('|').map(x => x.trim());
  if (parts.length < 4 || parts.length > 5) throw new Error('Формат: /schedule начало | конец | удалить через N минут | ссылка | текст кнопки');
  const [startText, endText, deleteText, url, buttonText = 'ЗАБРАТЬ ПРОГНОЗ'] = parts;
  const start = parseFlexibleMoscow(startText);
  const end = parseFlexibleMoscow(endText);
  const deleteAfter = parseDurationMinutes(deleteText);
  if (!/^https:\/\/(?:t\.me|telegram\.me)\//i.test(url)) throw new Error('Ссылка кнопки должна начинаться с https://t.me/');
  if (!buttonText || buttonText.length > 64) throw new Error('Текст кнопки должен быть от 1 до 64 символов');
  const times = scheduleTimes(start, end, deleteAfter);
  return { start, end, deleteAfter, url, buttonText, times };
}
