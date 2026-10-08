import test from 'node:test';
import assert from 'node:assert/strict';
import { FOOTBALL_LEAGUES_2026_27, NHL_CLUBS } from './club-catalog.js';
import { knownHockeyLeague, knownTeamSports, normalizedTeamName,
  teamSearchQuery, teamSearchVariants } from './team-aliases.js';

test('словарь содержит все 32 клуба НХЛ и участников четырёх высших лиг 2026/27', () => {
  assert.equal(NHL_CLUBS.length, 32);
  assert.deepEqual(Object.fromEntries(Object.entries(FOOTBALL_LEAGUES_2026_27)
    .map(([league, clubs]) => [league, clubs.length])),
  { premierLeague: 20, bundesliga: 18, laLiga: 20, ligue1: 18 });
  const records = [...NHL_CLUBS, ...Object.values(FOOTBALL_LEAGUES_2026_27).flat()];
  const allAliases = records.flatMap(([russian, , ...other]) => [russian, ...other].map(normalizedTeamName));
  assert.equal(new Set(allAliases).size, allAliases.length, 'один псевдоним не должен принадлежать двум клубам');
});

test('название каждого клуба НХЛ понимается на русском и английском', () => {
  for (const [russian, english, ...other] of NHL_CLUBS) {
    for (const name of [russian, english, ...other]) {
      assert.equal(teamSearchQuery(name, '🏒'), english, name);
      assert.equal(knownHockeyLeague(name), 'nhl', name);
      assert.equal(knownTeamSports(name).hockey, true, name);
    }
    assert.ok(teamSearchVariants(english, '🏒').some(name => normalizedTeamName(name) === normalizedTeamName(russian)));
  }
});

test('название каждого футбольного клуба понимается на русском и на языке лиги', () => {
  for (const clubs of Object.values(FOOTBALL_LEAGUES_2026_27)) {
    for (const [russian, english, ...other] of clubs) {
      for (const name of [russian, english, ...other]) {
        assert.equal(teamSearchQuery(name, '⚽'), english, name);
        assert.equal(knownTeamSports(name).football, true, name);
      }
      assert.ok(teamSearchVariants(english, '⚽').some(name => normalizedTeamName(name) === normalizedTeamName(russian)));
    }
  }
});
