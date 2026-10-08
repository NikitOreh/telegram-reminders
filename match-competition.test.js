import test from 'node:test';
import assert from 'node:assert/strict';
import { matchCompetition, conflictsWithCompetition } from './match-competition.js';

test('турнир берётся из поста, а для известных хоккейных клубов — из команд', () => {
  assert.equal(matchCompetition('Футбол. Серия А', 'Интер — Милан', '⚽️')?.id, 'serie-a');
  assert.equal(matchCompetition('Футбол. Ла Лига', 'Реал — Барселона', '⚽️')?.id, 'la-liga');
  assert.equal(matchCompetition('Лига наций УЕФА', 'Англия — Чехия', '⚽️')?.id, 'nations-league');
  assert.equal(matchCompetition('', 'Нефтехимик — Сибирь', '🏒')?.id, 'khl');
  assert.equal(matchCompetition('', 'Флорида — Тампа', '🏒')?.id, 'nhl');
  assert.equal(conflictsWithCompetition('La Liga football players', matchCompetition('Серия А', 'Интер — Милан', '⚽️'), '⚽️'), true);
});
