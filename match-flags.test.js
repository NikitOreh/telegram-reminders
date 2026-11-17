import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMatches, renderTemplate } from './core.js';

test('флаги исходных матчей сохраняются вместо добавления значка спорта', () => {
  const sourceText = '🇩🇪 Германия - Англия 🇬🇧\n🇫🇷 Франция — Италия 🇮🇹';
  const matches = extractMatches(sourceText);
  for (const template of ['{matches}', { format: 'rich_html', body: '<b>{matches}</b>' }]) {
    const caption = renderTemplate(template, { matches, odds: '2.4', sourceText, sportIcon: '⚽' });
    assert.ok(caption.includes('🇩🇪 Германия - Англия 🇬🇧'));
    assert.ok(caption.includes('🇫🇷 Франция — Италия 🇮🇹'));
    assert.equal(caption.includes('⚽'), false);
  }
});

test('премиум-флаги сохраняют ID и UTF-16 смещения после текста с эмодзи', () => {
  const sourceText = '🔥 ПРОГНОЗ\n🇩🇪 Германия — Англия 🇬🇧';
  const sourceEntities = [
    { type: 'custom_emoji', offset: sourceText.indexOf('🇩🇪'), length: '🇩🇪'.length, custom_emoji_id: '12345' },
    { type: 'custom_emoji', offset: sourceText.indexOf('🇬🇧'), length: '🇬🇧'.length, custom_emoji_id: '67890' }
  ];
  for (const template of ['{matches}', { format: 'rich_html', body: '<b>{matches}</b>' }]) {
    const caption = renderTemplate(template, { matches: extractMatches(sourceText), sourceText, sourceEntities });
    assert.ok(caption.includes('<tg-emoji emoji-id="12345">🇩🇪</tg-emoji>'));
    assert.ok(caption.includes('<tg-emoji emoji-id="67890">🇬🇧</tg-emoji>'));
    assert.equal(caption.includes('⚽'), false);
  }
});

test('в смешанном посте флаги сохраняются только для нужной строки, другой матч получает свой спорт', () => {
  const sourceText = '🇫🇷 Франция — Италия 🇮🇹\n🏒 Ак Барс — Торпедо';
  const caption = renderTemplate('{matches}', { matches: extractMatches(sourceText), sourceText });
  assert.ok(caption.includes('🇫🇷 Франция — Италия 🇮🇹'));
  assert.ok(caption.includes('🏒 Ак Барс — Торпедо'));
});
