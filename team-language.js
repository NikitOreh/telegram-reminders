import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { knownTeamSports, normalizedTeamName, teamSearchVariants } from './team-aliases.js';

const CACHE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'internet-assets');
const CACHE_VERSION = 2;
const USER_AGENT = 'TelegramMatchReminders/0.1 (bilingual team-name search)';

function normalized(value) {
  return normalizedTeamName(String(value || '').normalize('NFKD').replace(/\p{M}/gu, ''));
}

export function translatedClubName(pages, name, sportIcon) {
  const wanted = normalized(name);
  const club = sportIcon === '🏒'
    ? /хоккей|hockey|\bHC\b|\bNHL\b|\bKHL\b/iu
    : /футбол|football|soccer|\bFC\b|\bCF\b|\bSC\b/iu;
  return (pages || []).map(page => {
    const translated = page.langlinks?.[0]?.title || page.langlinks?.[0]?.['*'];
    const source = normalized(page.title);
    if (!translated || !source.includes(wanted) || !club.test(`${page.title} ${translated}`)) return null;
    return { name: translated.replace(/\s*\([^()]*\)\s*$/u, '').trim(), score: Number(club.test(page.title)) * 20 +
      Number(source.startsWith(wanted)) * 10 - page.title.length / 100 };
  }).filter(Boolean).sort((a, b) => b.score - a.score)[0]?.name || null;
}

async function wikipediaClubName(name, sportIcon) {
  const sourceLanguage = /[а-яё]/iu.test(name) ? 'ru' : 'en';
  const targetLanguage = sourceLanguage === 'ru' ? 'en' : 'ru';
  const hint = sourceLanguage === 'ru' ? (sportIcon === '🏒' ? 'хоккейный клуб' : 'футбольный клуб')
    : (sportIcon === '🏒' ? 'ice hockey club' : 'football club');
  for (const query of [name, `${name} ${hint}`]) {
    const url = new URL(`https://${sourceLanguage}.wikipedia.org/w/api.php`);
    for (const [key, value] of Object.entries({ action: 'query', generator: 'search', gsrsearch: query,
      gsrlimit: query === name ? '30' : '10', prop: 'langlinks', lllang: targetLanguage,
      format: 'json', formatversion: '2' })) url.searchParams.set(key, value);
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { 'user-agent': USER_AGENT } });
    if (!response.ok) throw new Error(`Wikipedia HTTP ${response.status}`);
    const translated = translatedClubName((await response.json()).query?.pages, name, sportIcon);
    if (translated) return translated;
  }
  return null;
}

export async function resolveTeamNameVariants(name, sportIcon, options = {}) {
  const local = teamSearchVariants(name, sportIcon);
  // A club-language lookup would misidentify tennis players and basketball teams as football clubs.
  if (sportIcon === '🎾' || sportIcon === '🏀') return local;
  // The built-in dictionary already contains both scripts for this team.
  const known = knownTeamSports(name);
  if (sportIcon === '🏒' ? known.hockey : known.football) return local;
  const key = createHash('sha256').update(`${sportIcon}:${normalized(name)}`).digest('hex').slice(0, 24);
  const cachePath = path.join(CACHE_DIR, `teamlang-${key}.json`);
  if (!options.lookup) {
    try {
      const cached = JSON.parse(await fs.readFile(cachePath, 'utf8'));
      if (cached.version === CACHE_VERSION && Date.now() - cached.checkedAt < (cached.translated ? 30 : 7) * 86_400_000) {
        return [...new Set([...local, cached.translated].filter(Boolean))];
      }
    } catch (error) { if (error.code !== 'ENOENT') console.warn(`Не удалось прочитать кеш названия клуба: ${error.message}`); }
  }
  let translated = null;
  let lookupFailed = false;
  try { translated = await (options.lookup || wikipediaClubName)(name, sportIcon); }
  catch (error) { lookupFailed = true; console.warn(`Не удалось узнать второе название клуба «${name}»: ${error.message}`); }
  if (!options.lookup && !lookupFailed) {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify({ version: CACHE_VERSION, checkedAt: Date.now(), translated }), 'utf8');
  }
  return [...new Set([...local, translated].filter(Boolean))];
}
