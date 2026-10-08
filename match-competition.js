import { knownHockeyLeague } from './team-aliases.js';

const COMPETITIONS = [
  { id: 'khl', sport: 'hockey', ru: 'КХЛ', en: 'KHL', pattern: /\bKHL\b|(?<![\p{L}])КХЛ(?![\p{L}])/iu },
  { id: 'nhl', sport: 'hockey', ru: 'НХЛ', en: 'NHL', pattern: /\bNHL\b|(?<![\p{L}])НХЛ(?![\p{L}])/iu },
  { id: 'nations-league', sport: 'football', ru: 'Лига наций', en: 'UEFA Nations League', pattern: /лига\s+наций|nations\s+league/iu },
  { id: 'serie-a', sport: 'football', ru: 'Серия А', en: 'Serie A', pattern: /серия\s*[аa](?![\p{L}])|\bserie\s*a\b/iu },
  { id: 'la-liga', sport: 'football', ru: 'Ла Лига', en: 'La Liga', pattern: /ла\s*лига|\bla\s*liga\b|\blaliga\b/iu },
  { id: 'premier-league', sport: 'football', ru: 'АПЛ', en: 'Premier League', pattern: /английск[^\n]{0,30}премьер.?лиг|(?<![\p{L}])АПЛ(?![\p{L}])|\bpremier\s+league\b|\bEPL\b/iu },
  { id: 'bundesliga', sport: 'football', ru: 'Бундеслига', en: 'Bundesliga', pattern: /бундеслиг|\bbundesliga\b/iu },
  { id: 'ligue-1', sport: 'football', ru: 'Лига 1', en: 'Ligue 1', pattern: /французск[^\n]{0,20}лига\s*1|\bligue\s*1\b/iu },
  { id: 'rpl', sport: 'football', ru: 'РПЛ', en: 'Russian Premier League', pattern: /(?<![\p{L}])РПЛ(?![\p{L}])|\brussian\s+premier\s+league\b/iu },
  { id: 'champions-league', sport: 'football', ru: 'Лига чемпионов', en: 'UEFA Champions League', pattern: /лига\s+чемпионов|\bchampions\s+league\b|\bUCL\b/iu },
  { id: 'europa-league', sport: 'football', ru: 'Лига Европы', en: 'UEFA Europa League', pattern: /лига\s+европы|\beuropa\s+league\b/iu },
  { id: 'conference-league', sport: 'football', ru: 'Лига конференций', en: 'UEFA Conference League', pattern: /лига\s+конференций|\bconference\s+league\b/iu },
  { id: 'mls', sport: 'football', ru: 'МЛС', en: 'MLS', pattern: /(?<![\p{L}])МЛС(?![\p{L}])|\bMLS\b/iu },
  { id: 'euro', sport: 'football', ru: 'Евро', en: 'UEFA Euro', pattern: /чемпионат\s+европы|\bUEFA\s+Euro\b|\bEuro\s*20\d\d\b/iu },
  { id: 'world-cup', sport: 'football', ru: 'ЧМ', en: 'FIFA World Cup', pattern: /чемпионат\s+мира|\bworld\s+cup\b|\bFIFA\s+World\s+Cup\b/iu }
];

export function competitionsIn(text, sportIcon) {
  const sport = sportIcon === '🏒' ? 'hockey' : sportIcon === '⚽' || sportIcon === '⚽️' ? 'football' : null;
  if (!sport) return [];
  return COMPETITIONS.filter(item => item.sport === sport && item.pattern.test(String(text || '')));
}

export function matchCompetition(context, match, sportIcon) {
  const found = competitionsIn(context, sportIcon);
  if (sportIcon === '🏒') {
    const names = String(match || '').split(/\s+[—–-]\s+/).slice(0, 2);
    const leagues = [...new Set(names.map(knownHockeyLeague).filter(Boolean))];
    if (leagues.length === 1) return COMPETITIONS.find(item => item.id === leagues[0]);
  }
  return found.length === 1 ? found[0] : null;
}

export function conflictsWithCompetition(text, target, sportIcon) {
  if (!target) return false;
  const mentioned = competitionsIn(text, sportIcon);
  return mentioned.length > 0 && !mentioned.some(item => item.id === target.id);
}
