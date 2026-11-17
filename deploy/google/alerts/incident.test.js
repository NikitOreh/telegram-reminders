import test from 'node:test';
import assert from 'node:assert/strict';
import { incidentText } from './server.js';

test('открытие и закрытие аварии описаны отдельно', () => {
  const incident = { policy_name: 'Сервер недоступен', summary: 'Проверка не прошла', url: 'https://example.com/incident' };
  assert.match(incidentText({ incident: { ...incident, state: 'open' } }), /Авария Google Cloud/);
  assert.match(incidentText({ incident: { ...incident, state: 'closed' } }), /Ситуация восстановлена/);
  assert.equal(incidentText({ incident: { ...incident, state: 'unknown' } }), null);
});
