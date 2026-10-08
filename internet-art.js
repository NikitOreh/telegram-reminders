import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { splitMatch } from './card.js';
import { teamSearchQuery } from './team-art.js';
import { teamSearchVariants } from './team-aliases.js';
import { resolveTeamNameVariants } from './team-language.js';
import { conflictsWithCompetition, matchCompetition } from './match-competition.js';
import { imageShowsSportPeople } from './image-people.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'internet-assets');
const SEARCH_CACHE_TTL = 7 * 86_400_000;
const SEARCH_CACHE_VERSION = 7;
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const YANDEX_IMAGE_API = 'https://searchapi.api.cloud.yandex.net/v2/image/search';
const USER_AGENT = 'TelegramMatchReminders/0.1 (match photo search)';
const BAD_SUBJECT = /\b(?:border|map|supporters|fans|crowd|ceremony|press conference|visit|academy|school|training center|programme|program|chart|statistics|season summary|concert|festival|nightclub|kit|jersey|uniform|shirt|socks)\b|границ|болельщик|церемони|академи|школ[аы]|учебн|концерт|музык|вечеринк|форм[аы]/i;
const MATCHUP_ART = /\b(?:poster|preview|matchup|match-up|graphic|illustration|versus|vs\.?)\b|афиш|анонс|превью|постер|коллаж|против/i;
const VENUE_ONLY = /\b(?:stadium|arena|venue)\b|стадион|арен[аы]/i;
const HISTORICAL = /\b(?:historic|historical|vintage|retro|archive|old logo)\b|историческ|архивн|ретро|стар[аы]й логотип/i;
const WOMEN_CATEGORY = /\b(?:women|women's|womens|woman|female|ladies)\b|женск|женщин/i;
const YOUTH_CATEGORY = /\b(?:u[- ]?1[679]|u[- ]?2[013]|under[- ]?1[679]|under[- ]?2[013]|youth)\b|молод[её]ж|юниор/i;
const EMBLEM = /\b(?:logo|badge|crest|emblem|symbol)\b|эмблем|логотип/i;
const FLAG = /\b(?:flags?|banners?|coat of arms|insignia)\b|флаг|герб/i;
const GAME_ACTION = /\b(?:vs\.?|versus|against|match|game|playoffs?|faceoff|goal|shot|save|tackle|skating|serve|rally|dunk|basket|euro)\b|матч|игр[аыеу]|плей.?офф|вбрасыван|гол|шайб|удар|сейв|подач|розыгрыш|данк|бросок/i;
const PORTRAIT = /\b(?:portrait|headshot|cropped|profile)\b|портрет/i;
const PLAYER_WORDS = /\b(?:player|players|goalie|footballer|skater|athlete)\b|игрок|вратар|хоккеист|футболист|спортсмен/i;
const SPORT_CONTEXT = {
  '🏒': /\b(?:hockey|nhl|khl|puck|ice hockey)\b|хокке|нхл|кхл|шайб/i,
  '⚽': /\b(?:football|soccer|uefa|fifa|world cup|nations league)\b|футбол|лига наций/i,
  '🎾': /\b(?:tennis|atp|wta)\b|теннис/i,
  '🏀': /\b(?:basketball|nba|euroleague)\b|баскетбол|нба|евролиг/i
};

function searchSport(icon) {
  return SPORT_CONTEXT[icon] ? icon : '⚽';
}

function wrongSportMentioned(searchable, title, sport, sportMentioned) {
  return Object.entries(SPORT_CONTEXT).some(([other, pattern]) => other !== sport &&
    (pattern.test(title) || pattern.test(searchable) && !sportMentioned));
}

function plain(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&(?:amp|quot|apos|nbsp|lt|gt);/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function normalized(value) {
  return String(value || '').normalize('NFKD').replace(/\p{M}/gu, '')
    .toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function namesFor(name, sportIcon, extra = []) {
  const english = teamSearchQuery(name, sportIcon);
  const englishShort = english.split(' ')[0];
  const names = [...teamSearchVariants(name, sportIcon), ...extra];
  if (englishShort.length >= 5 && !['dynamo', 'lokomotiv', 'spartak', 'borussia', 'manchester',
    'olympique', 'deportivo', 'paris', 'stade'].includes(englishShort.toLowerCase())) names.push(englishShort);
  if (normalized(english) === 'netherlands') names.push('Holland', 'Голландия');
  if (normalized(english) === 'germany') names.push('Deutschland');
  if (normalized(english) === 'czechia') names.push('Czech Republic', 'Czech');
  return [...new Set(names.map(normalized).filter(value => value.length >= 3))];
}

function containsName(title, aliases) {
  const haystack = ` ${normalized(title)} `;
  return aliases.some(name => {
    // New England Revolution is not England's national football team.
    const candidate = name === 'england' ? haystack.replace(/\bnew england\b/g, ' ') : haystack;
    return candidate.includes(` ${name} `);
  });
}

function safeImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname) ? url.toString() : null;
  } catch { return null; }
}

function safePublicImageUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      !isIP(host) && host !== 'localhost' && !host.endsWith('.local') && !host.endsWith('.internal') &&
      host.includes('.') ? url.toString() : null;
  } catch { return null; }
}

function licenseUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'creativecommons.org' ? url.toString() : null;
  } catch { return null; }
}

function yearsIn(value) {
  return [...String(value || '').matchAll(/\b(?:18|19|20)\d{2}\b/g)].map(match => Number(match[0]));
}

function photoYear(info, title, description) {
  const originalDate = plain(info?.extmetadata?.DateTimeOriginal?.value);
  return yearsIn(title)[0] || yearsIn(originalDate)[0] || yearsIn(description)[0] || null;
}

export function matchPhotoCandidates(pages, match, sportIcon, options = {}) {
  const [first, second] = splitMatch(match);
  const competition = matchCompetition(options.context, match, sportIcon);
  const teamNames = [namesFor(first, sportIcon, options.teamVariants?.[0]),
    namesFor(second, sportIcon, options.teamVariants?.[1])];
  const candidates = [];
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    const title = page.title?.replace(/^File:/i, '') || '';
    const sourceUrl = safeImageUrl(info?.thumburl || info?.url);
    const license = plain(info?.extmetadata?.LicenseShortName?.value);
    const description = plain(info?.extmetadata?.ImageDescription?.value);
    const year = photoYear(info, title, description);
    const searchable = `${title} ${description}`;
    const namesInTitle = teamNames.map(names => containsName(title, names));
    const namesInDescription = teamNames.map(names => containsName(description, names));
    const teamCount = namesInTitle.filter(Boolean).length;
    const linkedToTeam = teamCount > 0;
    const emblem = EMBLEM.test(title);
    const sport = searchSport(sportIcon);
    const sportMentioned = SPORT_CONTEXT[sport].test(searchable);
    const wrongSport = wrongSportMentioned(searchable, title, sport, sportMentioned);
    const wrongCategory = !WOMEN_CATEGORY.test(options.context || '') && WOMEN_CATEGORY.test(searchable) ||
      !YOUTH_CATEGORY.test(options.context || '') && YOUTH_CATEGORY.test(searchable);
    const gameAction = GAME_ACTION.test(title);
    const portrait = PORTRAIT.test(title);
    const matchupArt = MATCHUP_ART.test(title);
    const soloSymbol = (emblem || FLAG.test(title)) && !gameAction && !PLAYER_WORDS.test(title);
    const preferred = gameAction || matchupArt ||
      /\b(?:player|players|team photo|goalie|forward|defender|goalkeeper)\b|игрок|вратар|нападающ|защитник/i.test(title);
    const specificTeamName = teamNames.some(names => names.some(name => name.includes(' ') && containsName(title, [name])));
    const score = teamCount * 8 + Number(teamCount === 2) * 18 + Number(namesInDescription.some(Boolean)) * 2 +
      Number(sportMentioned) * 3 + Number(gameAction) * 14 + Number(competition && competition.pattern.test(searchable)) * 12 +
      Number(matchupArt && teamCount === 2) * 10 - Number(portrait) * 7 +
      Number(/\b(?:player|players|goalie|footballer|skater)\b|игрок|вратар|хоккеист|футболист/i.test(title)) * 8;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(info?.mime) ||
      info.width < 220 || info.height < 220 || !sourceUrl ||
      BAD_SUBJECT.test(title) || !teamCount && BAD_SUBJECT.test(description) || !linkedToTeam || wrongSport || wrongCategory || HISTORICAL.test(title) ||
      VENUE_ONLY.test(title) && teamCount < 2 || soloSymbol ||
      conflictsWithCompetition(searchable, competition, sportIcon) ||
      !(sportMentioned || specificTeamName || teamCount === 2 && (gameAction || matchupArt))) continue;
    const sourcePage = `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replaceAll(' ', '_'))}`;
    const artist = plain(info.extmetadata?.Artist?.value).slice(0, 100) || 'Wikimedia Commons';
    const credit = { artist, license, sourcePage, licenseUrl: licenseUrl(info.extmetadata?.LicenseUrl?.value) };
    candidates.push({ sourceUrl, teamName: `${first} — ${second}`, sourcePage, credit, title, photoYear: year, score, preferred, searchIndex: page.index || 0 });
  }
  return candidates.sort((a, b) => b.score - a.score || a.searchIndex - b.searchIndex);
}

async function fetchBytes(url) {
  let response;
  for (let hop = 0; hop < 4; hop++) {
    if (!safePublicImageUrl(url)) throw new Error('Небезопасная ссылка на изображение');
    response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: 'manual',
      headers: { 'user-agent': USER_AGENT } });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const next = response.headers.get('location');
    if (!next) throw new Error('Перенаправление без ссылки');
    url = new URL(next, url).toString();
    if (hop === 3) throw new Error('Слишком много перенаправлений');
  }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    error.retryAfter = Number(response.headers.get('retry-after') || 0);
    throw error;
  }
  if (Number(response.headers.get('content-length') || 0) > 8_000_000) throw new Error('Изображение слишком большое');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 8_000_000) throw new Error('Изображение слишком большое');
  return bytes;
}

function xmlText(value) {
  return String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(x[0-9a-f]+|\d+);|&(?:amp|lt|gt|quot|apos);/gi, token => {
      const named = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
      if (named[token.toLowerCase()]) return named[token.toLowerCase()];
      const code = token.startsWith('&#x') ? parseInt(token.slice(3, -1), 16) : parseInt(token.slice(2, -1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : token;
    }).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function xmlField(doc, name) {
  return xmlText(doc.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1]);
}

export function yandexPhotoCandidates(xml, match, sportIcon, options = {}) {
  const [first, second] = splitMatch(match);
  const names = [namesFor(first, sportIcon, options.teamVariants?.[0]),
    namesFor(second, sportIcon, options.teamVariants?.[1])];
  const competition = matchCompetition(options.context, match, sportIcon);
  const results = [];
  for (const [index, matchDoc] of [...String(xml).matchAll(/<doc\b[^>]*>([\s\S]*?)<\/doc>/gi)].entries()) {
    const doc = matchDoc[1];
    const sourceUrl = safePublicImageUrl(xmlField(doc, 'url'));
    if (!sourceUrl) continue;
    const title = xmlField(doc, 'title');
    const details = xmlText(doc);
    const searchable = `${title} ${details} ${sourceUrl}`;
    const teamCount = names.filter(aliases => containsName(searchable, aliases)).length;
    const sport = searchSport(sportIcon);
    const sportMentioned = SPORT_CONTEXT[sport].test(searchable);
    const wrongSport = wrongSportMentioned(searchable, title, sport, sportMentioned);
    const wrongCategory = !WOMEN_CATEGORY.test(options.context || '') && WOMEN_CATEGORY.test(searchable) ||
      !YOUTH_CATEGORY.test(options.context || '') && YOUTH_CATEGORY.test(searchable);
    const photoYear = yearsIn(title)[0] || yearsIn(details)[0] || null;
    const gameAction = GAME_ACTION.test(title);
    const soloSymbol = (EMBLEM.test(title) || FLAG.test(title)) && !gameAction && !PLAYER_WORDS.test(title);
    if (!teamCount || wrongSport || wrongCategory || BAD_SUBJECT.test(title) || soloSymbol ||
      conflictsWithCompetition(searchable, competition, sportIcon) ||
      !sportMentioned && teamCount < 2) continue;
    const sourcePage = safePublicImageUrl(xmlField(doc, 'page-url')) || sourceUrl;
    const width = Number(xmlField(doc, 'original-width'));
    const height = Number(xmlField(doc, 'original-height'));
    if (width && width < 220 || height && height < 220) continue;
    const matchupArt = MATCHUP_ART.test(title);
    if (HISTORICAL.test(title) || VENUE_ONLY.test(title) && teamCount < 2) continue;
    const score = teamCount * 20 + Number(teamCount === 2) * 18 + Number(gameAction) * 14 +
      Number(matchupArt && teamCount === 2) * 10 + Number(competition && competition.pattern.test(searchable)) * 12 +
      Number(sportMentioned) * 3 + Number(/\b(?:player|players|goalie|footballer|skater)\b|игрок|вратар|хоккеист|футболист/i.test(title)) * 8 - Number(PORTRAIT.test(title)) * 7;
    results.push({ sourceUrl, sourcePage, title: title || `${first} — ${second}`, photoYear, score,
      preferred: gameAction || matchupArt, searchIndex: index, teamName: `${first} — ${second}` });
  }
  return results.sort((a, b) => b.score - a.score || a.searchIndex - b.searchIndex);
}

async function cachedImage(sourceUrl) {
  const key = createHash('sha256').update(sourceUrl).digest('hex').slice(0, 24);
  const cached = path.join(DIR, `${key}.png`);
  try { return await fs.readFile(cached); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    let bytes;
    try { bytes = await fetchBytes(sourceUrl); }
    catch (error) {
      if (error.status !== 429 || error.retryAfter > 5) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.max(2000, error.retryAfter * 1000)));
      bytes = await fetchBytes(sourceUrl);
    }
    const image = await sharp(bytes)
      .resize(1254, 1254, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(cached, image);
    return image;
  }
}

let lastSearchAt = 0;
async function searchCommons(query) {
  const cachePath = path.join(DIR, `search-${createHash('sha256').update(query).digest('hex').slice(0, 24)}.json`);
  let cached;
  try {
    cached = JSON.parse(await fs.readFile(cachePath, 'utf8'));
    if (cached.version === SEARCH_CACHE_VERSION && Date.now() - cached.checkedAt < SEARCH_CACHE_TTL && Array.isArray(cached.pages)) return cached.pages;
  } catch { /* Search has not been cached yet. */ }
  const url = new URL(COMMONS_API);
  for (const [key, value] of Object.entries({ action: 'query', generator: 'search', gsrsearch: query,
    gsrnamespace: '6', gsrlimit: '40', prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata',
    iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|ImageDescription|DateTimeOriginal', iiurlwidth: '1254', format: 'json' })) {
    url.searchParams.set(key, value);
  }
  let result;
  for (let attempt = 0; attempt < 2; attempt++) {
    const wait = Math.max(0, lastSearchAt + 700 - Date.now());
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    lastSearchAt = Date.now();
    try {
      result = JSON.parse((await fetchBytes(url)).toString('utf8'));
      if (result.error) throw new Error(`Wikimedia Commons: ${result.error.info || result.error.code}`);
      break;
    } catch (error) {
      if (error.status === 429 && Array.isArray(cached?.pages)) return cached.pages;
      if (error.status !== 429 || attempt || error.retryAfter > 5) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.max(2000, error.retryAfter * 1000)));
    }
  }
  const pages = Object.values(result.query?.pages || {});
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify({ version: SEARCH_CACHE_VERSION, checkedAt: Date.now(), pages }), 'utf8');
  return pages;
}

async function searchYandex(query, match, sportIcon, options = {}) {
  const apiKey = process.env.YANDEX_SEARCH_API_KEY;
  const folderId = process.env.YANDEX_FOLDER_ID;
  if (!apiKey || !folderId) return [];
  const cachePath = path.join(DIR, `yandex-${createHash('sha256').update(`${query}:${match}:${sportIcon}:${options.context || ''}`).digest('hex').slice(0, 24)}.json`);
  try {
    const cached = JSON.parse(await fs.readFile(cachePath, 'utf8'));
    if (cached.version === SEARCH_CACHE_VERSION && Date.now() - cached.checkedAt < SEARCH_CACHE_TTL && Array.isArray(cached.candidates)) return cached.candidates;
  } catch { /* No cached search. */ }
  const response = await fetch(YANDEX_IMAGE_API, { method: 'POST', signal: AbortSignal.timeout(20_000),
    headers: { 'authorization': `Api-Key ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: { searchType: 'SEARCH_TYPE_RU', queryText: query,
      familyMode: 'FAMILY_MODE_MODERATE', page: '0', fixTypoMode: 'FIX_TYPO_MODE_OFF' },
    imageSpec: { size: 'IMAGE_SIZE_LARGE' }, docsOnPage: '50', folderId }) });
  if (!response.ok) {
    const error = new Error(`Яндекс.Картинки: HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const data = await response.json();
  if (typeof data.rawData !== 'string') throw new Error('Яндекс.Картинки вернули ответ без результатов XML');
  const xml = Buffer.from(data.rawData, 'base64').toString('utf8');
  if (xml.length > 5_000_000) throw new Error('Ответ Яндекс.Картинок слишком большой');
  const candidates = yandexPhotoCandidates(xml, match, sportIcon, options);
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify({ version: SEARCH_CACHE_VERSION, checkedAt: Date.now(), candidates }), 'utf8');
  return candidates;
}

export async function collectMatchBackgrounds(matches, count, searchOne) {
  const required = Math.ceil(count / 2);
  const images = [];
  const errors = [];
  const seen = new Set();
  for (const entry of matches) {
    if (images.length >= required) break;
    try {
      const found = await searchOne(entry, (required - images.length) * 2, images.map(image => image.sourceUrl));
      for (const image of found) {
        if (seen.has(image.sourceUrl)) continue;
        seen.add(image.sourceUrl);
        images.push(image);
      }
    } catch (error) { errors.push({ match: entry.match, error }); }
  }
  return { images, errors };
}

export async function getInternetMatchBackgrounds(match, sportIcon, count = 1, options = {}) {
  const alternatives = (options.fallbackMatches || []).filter(item => item?.match && item.match !== match);
  if (alternatives.length) {
    const matches = [{ match, sportIcon }, ...alternatives];
    const { images, errors } = await collectMatchBackgrounds(matches, count, (entry, needed, alreadyUsed) =>
      getInternetMatchBackgrounds(entry.match, entry.sportIcon, needed, {
        ...options, fallbackMatches: [], allowPartial: true,
        excludedSourceUrls: [...(options.excludedSourceUrls || []), ...alreadyUsed]
      }));
    if (images.length * 2 >= count) return images;
    const reason = errors.length ? ` ${errors.map(item => `«${item.match}»: ${item.error.message}`).join(' ')}` : '';
    throw new Error(`Не нашёл достаточно подходящих фото для матчей ${matches.map(item => `«${item.match}»`).join(' и ')}. Для ${count} напоминаний требуется минимум ${Math.ceil(count / 2)} фото.${reason} Загрузите свои фото.`);
  }
  const [first, second] = splitMatch(match);
  const teamVariants = await Promise.all([first, second].map(name => resolveTeamNameVariants(name, sportIcon)));
  const searchOptions = { ...options, teamVariants };
  const sportEnglish = { '🏒': 'hockey', '🎾': 'tennis', '🏀': 'basketball' }[sportIcon] || 'football';
  const sportRussian = { '🏒': 'хоккей', '🎾': 'теннис', '🏀': 'баскетбол' }[sportIcon] || 'футбол';
  const athletesRussian = { '🏒': 'хоккеисты', '🎾': 'теннисисты', '🏀': 'баскетболисты' }[sportIcon] || 'футболисты';
  const competition = matchCompetition(options.context, match, sportIcon);
  const leagueEnglish = competition?.en || sportEnglish;
  const leagueRussian = competition?.ru || sportRussian;
  const englishTeams = [first, second].map((name, index) => {
    const mapped = teamSearchQuery(name, sportIcon);
    if (/^[\p{Script=Latin}]/u.test(mapped)) return mapped;
    return [...teamVariants[index]].reverse().find(value => /[\p{Script=Latin}]/u.test(value)) || name;
  });
  const russianTeams = [first, second].map((name, index) =>
    /[\p{Script=Cyrillic}]/u.test(name) ? name :
      [...teamVariants[index]].reverse().find(value => /[\p{Script=Cyrillic}]/u.test(value)) || name);
  const alternativeEnglishTeams = englishTeams.map(team => team === 'Czechia' ? 'Czech Republic' : team);
  const shortEnglishTeams = englishTeams.map(team => team.split(' ')[0]);
  const queries = [...new Set([
    `${englishTeams.join(' vs ')} ${leagueEnglish} players match`,
    `${alternativeEnglishTeams.join(' vs ')} ${leagueEnglish} match photo`,
    `${russianTeams.join(' — ')} ${leagueRussian} игроки матч`,
    `${shortEnglishTeams.join(' ')} ${leagueEnglish} players`,
    ...englishTeams.map(team => `${team} ${leagueEnglish} player match`),
    ...russianTeams.map(team => `${team} ${leagueRussian} игроки`)
  ])];
  const candidates = [];
  let rateLimited = false;
  for (const query of queries) {
    try {
      for (const candidate of matchPhotoCandidates(await searchCommons(query), match, sportIcon, searchOptions)) {
        if (!candidates.some(item => item.sourcePage === candidate.sourcePage)) candidates.push(candidate);
      }
    } catch (error) {
      console.warn(`Не удалось поискать изображение команды «${query}»: ${error.message}`);
      if (error.status === 429) { rateLimited = true; break; }
    }
    if (candidates.filter(candidate => candidate.preferred).length >= Math.ceil(count / 2) &&
      query === `${englishTeams[1]} ${sportEnglish}`) break;
  }
  const images = [];
  let downloadRateLimited = false;
  let visionError = null;
  const seenUrls = new Set();
  const excludedUrls = new Set(options.excludedSourceUrls || []);
  async function downloadAll(found) {
    for (const candidate of found.sort((a, b) => b.score - a.score || a.searchIndex - b.searchIndex)) {
      if (images.length >= count) break;
      if (seenUrls.has(candidate.sourceUrl) || excludedUrls.has(candidate.sourceUrl)) continue;
      seenUrls.add(candidate.sourceUrl);
      try {
        const image = await cachedImage(candidate.sourceUrl);
        if (!await imageShowsSportPeople(image, sportIcon)) continue;
        images.push({ ...candidate, image });
      }
      catch (error) {
        console.warn(`Не удалось загрузить изображение команды «${candidate.title}»: ${error.message}`);
        if (error.status === 429) downloadRateLimited = true;
        if (error.visionService) { visionError = error; break; }
      }
    }
  }
  await downloadAll(candidates);
  if (visionError && images.length * 2 < count) throw new Error(`${visionError.message}. Повторите позже или загрузите свои фото.`);
  let yandexAuthError = false;
  if (images.length * 2 < count && process.env.YANDEX_SEARCH_API_KEY && process.env.YANDEX_FOLDER_ID) {
    const yandexQueries = [...new Set([
      `${russianTeams.join(' ')} ${leagueRussian} игроки матч фото`,
      `${russianTeams.join(' ')} ${leagueRussian} ${athletesRussian}`,
      `${russianTeams[0]} ${leagueRussian} игроки на матче`,
      `${englishTeams.join(' ')} ${leagueEnglish} players match photo`
    ])];
    for (const query of yandexQueries) {
      try { await downloadAll(await searchYandex(query, match, sportIcon, searchOptions)); }
      catch (error) {
        console.warn(`Не удалось поискать изображения через Яндекс: ${error.message}`);
        if ([401, 403].includes(error.status)) { yandexAuthError = true; break; }
      }
      if (images.length * 2 >= count) break;
    }
  }
  if (images.length * 2 < count) {
    if (visionError) throw new Error(`${visionError.message}. Повторите позже или загрузите свои фото.`);
    if (options.allowPartial && images.length) return images;
    if (options.allowPartial && !yandexAuthError && !rateLimited && !downloadRateLimited) return images;
    if (yandexAuthError) throw new Error('Яндекс.Картинки отклонили ключ доступа. Проверьте YANDEX_SEARCH_API_KEY и YANDEX_FOLDER_ID или загрузите свои фото.');
    if (rateLimited || downloadRateLimited) throw new Error('Wikimedia Commons временно ограничил поиск или загрузку изображений (429). Повторите превью позже или загрузите свои фото.');
    throw new Error(`${excludedUrls.size ? 'Других подходящих изображений не нашлось' : 'Не нашёл достаточно фотографий игроков нужного вида спорта'} для матча «${match}». Для ${count} напоминаний требуется минимум ${Math.ceil(count / 2)} фото. Загрузите свои фото${process.env.YANDEX_SEARCH_API_KEY && process.env.YANDEX_FOLDER_ID ? '' : ' или подключите поиск Яндекс.Картинок'}.`);
  }
  return images;
}

export async function getInternetMatchBackground(match, sportIcon) {
  return (await getInternetMatchBackgrounds(match, sportIcon, 1))[0];
}
