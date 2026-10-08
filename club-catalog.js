// Current teams checked against the leagues' official club lists on 2026-10-07.
// Each row is [Russian name, search name, ...other common Russian/Latin names].
export const NHL_CLUBS = [
  ['Анахайм', 'Anaheim Ducks', 'Анахайм Дакс'],
  ['Бостон', 'Boston Bruins', 'Бостон Брюинз'],
  ['Баффало', 'Buffalo Sabres', 'Баффало Сейбрз'],
  ['Калгари', 'Calgary Flames', 'Калгари Флэймз'],
  ['Каролина', 'Carolina Hurricanes', 'Каролина Харрикейнз'],
  ['Чикаго', 'Chicago Blackhawks', 'Чикаго Блэкхокс'],
  ['Колорадо', 'Colorado Avalanche', 'Колорадо Эвеланш'],
  ['Коламбус', 'Columbus Blue Jackets', 'Коламбус Блю Джекетс'],
  ['Даллас', 'Dallas Stars', 'Даллас Старз'],
  ['Детройт', 'Detroit Red Wings', 'Детройт Ред Уингз'],
  ['Эдмонтон', 'Edmonton Oilers', 'Эдмонтон Ойлерз'],
  ['Флорида', 'Florida Panthers', 'Флорида Пантерз'],
  ['Лос-Анджелес', 'Los Angeles Kings', 'Лос Анджелес Кингз'],
  ['Миннесота', 'Minnesota Wild', 'Миннесота Уайлд'],
  ['Монреаль', 'Montreal Canadiens', 'Montréal Canadiens', 'Монреаль Канадиенс'],
  ['Нэшвилл', 'Nashville Predators', 'Нэшвилл Предаторз'],
  ['Нью-Джерси', 'New Jersey Devils', 'Нью Джерси Девилз'],
  ['Айлендерс', 'New York Islanders', 'Нью-Йорк Айлендерс'],
  ['Рейнджерс', 'New York Rangers', 'Нью-Йорк Рейнджерс'],
  ['Оттава', 'Ottawa Senators', 'Оттава Сенаторз'],
  ['Филадельфия', 'Philadelphia Flyers', 'Филадельфия Флайерз'],
  ['Питтсбург', 'Pittsburgh Penguins', 'Питтсбург Пингвинз'],
  ['Сан-Хосе', 'San Jose Sharks', 'Сан Хосе Шаркс'],
  ['Сиэтл', 'Seattle Kraken', 'Сиэтл Кракен'],
  ['Сент-Луис', 'St. Louis Blues', 'Сент Луис Блюз', 'St Louis Blues'],
  ['Тампа', 'Tampa Bay Lightning', 'Тампа-Бэй', 'Тампа Бэй Лайтнинг'],
  ['Торонто', 'Toronto Maple Leafs', 'Торонто Мэйпл Лифс'],
  ['Юта', 'Utah Mammoth', 'Юта Маммот'],
  ['Ванкувер', 'Vancouver Canucks', 'Ванкувер Кэнакс'],
  ['Вегас', 'Vegas Golden Knights', 'Вегас Голден Найтс'],
  ['Вашингтон', 'Washington Capitals', 'Вашингтон Кэпиталз'],
  ['Виннипег', 'Winnipeg Jets', 'Виннипег Джетс']
];

export const FOOTBALL_LEAGUES_2026_27 = {
  premierLeague: [
    ['Арсенал', 'Arsenal'], ['Астон Вилла', 'Aston Villa'],
    ['Борнмут', 'AFC Bournemouth', 'Bournemouth'], ['Брентфорд', 'Brentford'],
    ['Брайтон', 'Brighton & Hove Albion', 'Brighton and Hove Albion'], ['Челси', 'Chelsea'],
    ['Ковентри', 'Coventry City'], ['Кристал Пэлас', 'Crystal Palace', 'Кристал Пэлэс'],
    ['Эвертон', 'Everton'], ['Фулхэм', 'Fulham'], ['Халл', 'Hull City'],
    ['Ипсвич', 'Ipswich Town'], ['Лидс', 'Leeds United'], ['Ливерпуль', 'Liverpool'],
    ['Манчестер Сити', 'Manchester City', 'Ман Сити', 'Man City'],
    ['Манчестер Юнайтед', 'Manchester United', 'Ман Юнайтед', 'Man United', 'Man Utd'],
    ['Ньюкасл', 'Newcastle United'], ['Ноттингем Форест', 'Nottingham Forest'],
    ['Сандерленд', 'Sunderland'], ['Тоттенхэм', 'Tottenham Hotspur', 'Tottenham', 'Шпоры']
  ],
  bundesliga: [
    ['Аугсбург', 'FC Augsburg', 'Augsburg'], ['Унион Берлин', 'Union Berlin', '1. FC Union Berlin'],
    ['Вердер', 'Werder Bremen', 'Вердер Бремен'], ['Боруссия Дортмунд', 'Borussia Dortmund', 'Дортмунд'],
    ['Эльферсберг', 'SV Elversberg'], ['Айнтрахт Франкфурт', 'Eintracht Frankfurt', 'Айнтрахт'],
    ['Фрайбург', 'SC Freiburg', 'Freiburg'], ['Гамбург', 'Hamburger SV', 'Гамбург СВ'],
    ['Хоффенхайм', 'TSG Hoffenheim', 'Hoffenheim'], ['Кёльн', '1. FC Köln', 'Кельн', 'FC Cologne', 'FC Koln'],
    ['РБ Лейпциг', 'RB Leipzig', 'Лейпциг'], ['Байер', 'Bayer Leverkusen', 'Байер Леверкузен'],
    ['Майнц', 'Mainz 05', '1. FSV Mainz 05'],
    ['Боруссия Менхенгладбах', 'Borussia Mönchengladbach', 'Боруссия М', 'Borussia Monchengladbach'],
    ['Бавария', 'Bayern Munich', 'FC Bayern München', 'Bayern München'],
    ['Падерборн', 'SC Paderborn 07', 'Paderborn'], ['Шальке', 'Schalke 04', 'FC Schalke 04'],
    ['Штутгарт', 'VfB Stuttgart', 'Stuttgart']
  ],
  laLiga: [
    ['Атлетик Бильбао', 'Athletic Club', 'Athletic Bilbao'],
    ['Атлетико Мадрид', 'Atlético Madrid', 'Atletico Madrid', 'Атлетико'],
    ['Осасуна', 'CA Osasuna', 'Osasuna'], ['Сельта', 'Celta Vigo', 'RC Celta'],
    ['Алавес', 'Deportivo Alavés', 'Deportivo Alaves'], ['Эльче', 'Elche CF', 'Elche'],
    ['Барселона', 'FC Barcelona', 'Barcelona'], ['Хетафе', 'Getafe CF', 'Getafe'],
    ['Леванте', 'Levante UD', 'Levante'], ['Малага', 'Málaga CF', 'Malaga CF'],
    ['Расинг Сантандер', 'Racing Santander', 'Racing Club Santander', 'Расинг'],
    ['Райо Вальекано', 'Rayo Vallecano', 'Райо'],
    ['Депортиво Ла-Корунья', 'Deportivo La Coruña', 'RC Deportivo', 'Депортиво'],
    ['Эспаньол', 'RCD Espanyol', 'Espanyol'], ['Бетис', 'Real Betis'],
    ['Реал Мадрид', 'Real Madrid'], ['Реал Сосьедад', 'Real Sociedad'],
    ['Севилья', 'Sevilla FC', 'Sevilla'], ['Валенсия', 'Valencia CF', 'Valencia'],
    ['Вильярреал', 'Villarreal CF', 'Villarreal']
  ],
  ligue1: [
    ['Анже', 'Angers SCO', 'Angers'], ['Осер', 'AJ Auxerre', 'Auxerre'],
    ['Брест', 'Stade Brestois 29', 'Brest'], ['Гавр', 'Le Havre AC', 'Le Havre'],
    ['Ланс', 'RC Lens', 'Lens'], ['Лилль', 'Lille OSC', 'LOSC', 'Lille'],
    ['Лорьян', 'FC Lorient', 'Lorient'], ['Лион', 'Olympique Lyonnais', 'Lyon'],
    ['Ле-Ман', 'Le Mans FC', 'Le Mans'], ['Марсель', 'Olympique de Marseille', 'Marseille'],
    ['Монако', 'AS Monaco', 'Monaco'], ['Ницца', 'OGC Nice', 'Nice'],
    ['Париж', 'Paris FC'], ['ПСЖ', 'Paris Saint-Germain', 'Пари Сен-Жермен', 'PSG'],
    ['Ренн', 'Stade Rennais FC', 'Rennes'], ['Страсбург', 'RC Strasbourg Alsace', 'Strasbourg'],
    ['Тулуза', 'Toulouse FC', 'Toulouse'], ['Труа', 'ESTAC Troyes', 'Troyes']
  ]
};

export const TOP_FOOTBALL_CLUBS = Object.values(FOOTBALL_LEAGUES_2026_27).flat();
