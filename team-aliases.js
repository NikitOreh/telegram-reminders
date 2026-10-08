import { NHL_CLUBS, TOP_FOOTBALL_CLUBS } from './club-catalog.js';

function catalogAliases(clubs) {
  return Object.fromEntries(clubs.flatMap(([russian, english, ...other]) =>
    [russian, ...other].map(name => [normalizedTeamName(name), english])));
}

const HOCKEY_ALIASES = {
  'амур': 'Amur Khabarovsk', 'автомобилист': 'Avtomobilist Yekaterinburg',
  'северсталь': 'Severstal Cherepovets', 'локомотив': 'Lokomotiv Yaroslavl',
  'трактор': 'Traktor Chelyabinsk', 'ска': 'SKA Saint Petersburg',
  'динамо мос': 'Динамо Мос', 'динамо москва': 'Динамо Мос',
  'динамо мин': 'Динамо Мин', 'динамо минск': 'Динамо Мин',
  'ак барс': 'Ak Bars Kazan', 'авангард': 'Avangard Omsk',
  'цска': 'CSKA Moscow', 'спартак': 'Spartak Moscow',
  'металлург': 'Metallurg Magnitogorsk', 'салават юлаев': 'Salavat Yulaev Ufa',
  'торпедо': 'Torpedo Nizhny Novgorod', 'нефтехимик': 'Neftekhimik Nizhnekamsk',
  'сибирь': 'Sibir Novosibirsk', 'адмирал': 'Admiral Vladivostok',
  'лада': 'Lada Togliatti',
  'барыс': 'Barys Astana', 'витязь': 'Vityaz Podolsk',
  ...catalogAliases(NHL_CLUBS)
};
const FOOTBALL_ALIASES = {
  'нидерланды': 'Netherlands', 'голландия': 'Netherlands',
  'германия': 'Germany', 'норвегия': 'Norway', 'дания': 'Denmark',
  'франция': 'France', 'англия': 'England', 'чехия': 'Czechia', 'испания': 'Spain',
  'италия': 'Italy', 'португалия': 'Portugal', 'бразилия': 'Brazil',
  'аргентина': 'Argentina', 'хорватия': 'Croatia', 'швеция': 'Sweden',
  'швейцария': 'Switzerland', 'польша': 'Poland', 'украина': 'Ukraine',
  'турция': 'Turkey', 'сербия': 'Serbia', 'бельгия': 'Belgium',
  'локомотив': 'Lokomotiv Moscow', 'спартак': 'Spartak Moscow',
  'цска': 'CSKA Moscow', 'зенит': 'Zenit Saint Petersburg',
  'динамо мос': 'Dynamo Moscow', 'динамо москва': 'Dynamo Moscow',
  ...catalogAliases(TOP_FOOTBALL_CLUBS)
};
const NHL_NAMES = new Set(NHL_CLUBS.flatMap(([russian, , ...other]) =>
  [russian, ...other].map(normalizedTeamName)));
const CYRILLIC = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };

export function normalizedTeamName(name) {
  return String(name).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}

export function teamSearchQuery(name, sportIcon) {
  const normalized = normalizedTeamName(name);
  const aliases = sportIcon === '🏒' ? HOCKEY_ALIASES : FOOTBALL_ALIASES;
  return aliases[normalized] || Object.values(aliases).find(value => normalizedTeamName(value) === normalized) || normalized;
}

export function transliterateTeamName(name) {
  return String(name || '').toLocaleLowerCase('ru-RU').replace(/[а-яё]/gu, letter => CYRILLIC[letter] ?? letter);
}

export function teamSearchVariants(name, sportIcon) {
  const aliases = sportIcon === '🏒' ? HOCKEY_ALIASES : FOOTBALL_ALIASES;
  const normalized = normalizedTeamName(name);
  const canonical = teamSearchQuery(name, sportIcon);
  const reverse = Object.entries(aliases).filter(([, value]) => normalizedTeamName(value) === normalizedTeamName(canonical)).map(([key]) => key);
  return [...new Set([name, canonical, ...reverse, transliterateTeamName(name)].map(value => String(value || '').trim()).filter(Boolean))];
}

export function knownTeamSports(name) {
  const normalized = normalizedTeamName(name);
  const known = aliases => Object.hasOwn(aliases, normalized) || Object.values(aliases).some(value => normalizedTeamName(value) === normalized);
  return { hockey: known(HOCKEY_ALIASES), football: known(FOOTBALL_ALIASES) };
}

export function knownHockeyLeague(name) {
  const normalized = normalizedTeamName(name);
  if (NHL_NAMES.has(normalized) || [...NHL_NAMES].some(key => normalizedTeamName(HOCKEY_ALIASES[key]) === normalized)) return 'nhl';
  return Object.hasOwn(HOCKEY_ALIASES, normalized) ? 'khl' : null;
}
