import test from 'node:test';
import assert from 'node:assert/strict';
import { compareCosts, formatCostAlert } from './cost.js';

function days(last = 1) {
  return Array.from({ length: 8 }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, '0')}`,
    cost: i === 7 ? last : 1, currency: 'USD', hasData: true }));
}

test('рост свыше 20% сравнивается со средним семи предыдущих дней', () => {
  assert.equal(compareCosts(days(1.2)).status, 'normal');
  const result = compareCosts(days(1.21));
  assert.equal(result.status, 'increase');
  assert.match(formatCostAlert(result), /\+21\.0%/);
});

test('неполная, несогласованная или разновалютная история не вызывает тревогу', () => {
  assert.equal(compareCosts(days().slice(1)).status, 'insufficient_data');
  const missing = days(); missing[3].hasData = false;
  assert.equal(compareCosts(missing).status, 'insufficient_data');
  const currencies = days(); currencies[4].currency = 'EUR';
  assert.equal(compareCosts(currencies).status, 'insufficient_data');
  const gap = days(); gap[4].date = '2026-11-07';
  assert.equal(compareCosts(gap).status, 'insufficient_data');
});

test('при нулевом среднем ненулевой расход отмечается как рост с нуля', () => {
  const zero = days(0.1); zero.slice(0, 7).forEach(row => { row.cost = 0; });
  const result = compareCosts(zero);
  assert.equal(result.status, 'increase');
  assert.match(formatCostAlert(result), /рост с нуля/);
});
