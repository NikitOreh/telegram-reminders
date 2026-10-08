import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { splitMatch } from './card.js';
import { normalizedTeamName, teamSearchQuery } from './team-aliases.js';

export { normalizedTeamName, teamSearchQuery } from './team-aliases.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'team-assets');
const API = 'https://www.thesportsdb.com/api/v1/json/123/searchteams.php?t=';
function sportName(sportIcon) { return sportIcon === '🏒' ? 'Ice Hockey' : 'Soccer'; }
function cacheId(name, sportIcon) { return createHash('sha256').update(`${sportName(sportIcon)}:${normalizedTeamName(name)}`).digest('hex').slice(0, 24); }
function validColor(color) { return /^#[0-9a-f]{6}$/i.test(color || '') ? color.toUpperCase() : null; }

function badgeUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && /(^|\.)thesportsdb\.com$/i.test(url.hostname)) return url.toString();
  } catch { /* Empty or invalid URL. */ }
  return null;
}

async function readCached(name, sportIcon) {
  const id = cacheId(name, sportIcon);
  try {
    const metadata = JSON.parse(await fs.readFile(path.join(DIR, `${id}.json`), 'utf8'));
    if (Date.now() - metadata.checkedAt > (metadata.found ? 30 : 7) * 86_400_000) return undefined;
    if (!metadata.found) return null;
    return { ...metadata, badge: await fs.readFile(path.join(DIR, `${id}.png`)) };
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    return undefined;
  }
}

async function writeCached(name, sportIcon, result) {
  await fs.mkdir(DIR, { recursive: true });
  const id = cacheId(name, sportIcon);
  if (result?.badge) await fs.writeFile(path.join(DIR, `${id}.png`), result.badge);
  const metadata = result ? { found: true, checkedAt: Date.now(), teamName: result.teamName,
    sourceUrl: result.sourceUrl, color: result.color } : { found: false, checkedAt: Date.now() };
  await fs.writeFile(path.join(DIR, `${id}.json`), JSON.stringify(metadata, null, 2), 'utf8');
}

async function fetchLimited(url, timeout = 12_000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { 'user-agent': 'TelegramMatchReminders/0.1' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > 5_000_000) throw new Error('Эмблема слишком большая');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 5_000_000) throw new Error('Эмблема слишком большая');
  return bytes;
}

async function dominantColor(badge) {
  const { data, info } = await sharp(badge).resize(48, 48, { fit: 'contain', background: '#00000000' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const buckets = new Map();
  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b, a] = data.subarray(i, i + 4);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (a < 120 || max < 55 || max - min < 45 || max > 240 && min > 225) continue;
    const key = `${Math.floor(r / 48)},${Math.floor(g / 48)},${Math.floor(b / 48)}`;
    const item = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    item.count++; item.r += r; item.g += g; item.b += b;
    buckets.set(key, item);
  }
  const best = [...buckets.values()].sort((a, b) => b.count - a.count)[0];
  if (!best) return null;
  return '#' + [best.r, best.g, best.b].map(value => Math.round(value / best.count).toString(16).padStart(2, '0')).join('').toUpperCase();
}

export async function getTeamArt(name, sportIcon) {
  const cached = await readCached(name, sportIcon);
  if (cached !== undefined) return cached;
  const query = teamSearchQuery(name, sportIcon);
  if (!query) return null;
  try {
    const data = JSON.parse((await fetchLimited(API + encodeURIComponent(query))).toString('utf8'));
    const expectedSport = sportName(sportIcon);
    const team = (data.teams || []).find(item => item.strSport === expectedSport && badgeUrl(item.strBadge));
    if (!team) { await writeCached(name, sportIcon, null); return null; }
    const sourceUrl = badgeUrl(team.strBadge);
    const badge = await sharp(await fetchLimited(sourceUrl)).resize(400, 400,
      { fit: 'contain', background: '#00000000' }).png().toBuffer();
    const colors = [validColor(team.strColour1), validColor(team.strColour2)].filter(Boolean);
    const color = colors.find(value => !['#FFFFFF', '#000000'].includes(value)) || await dominantColor(badge) || colors[0] || '#FFFFFF';
    const result = { teamName: team.strTeam, sourceUrl, color, badge };
    await writeCached(name, sportIcon, result);
    return result;
  } catch (error) {
    console.warn(`Не удалось получить эмблему «${name}»: ${error.message}`);
    return null;
  }
}

export async function getMatchArt(match, sportIcon) {
  const [home, away] = splitMatch(match);
  const [homeArt, awayArt] = await Promise.all([getTeamArt(home, sportIcon), getTeamArt(away, sportIcon)]);
  return { home: homeArt, away: awayArt };
}
