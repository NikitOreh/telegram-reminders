import test from 'node:test';
import assert from 'node:assert/strict';
import { messageToTemplate, removeTextTemplate } from './text-templates.js';
import { renderTemplate } from './core.js';

test('готовая напоминалка без служебных полей сохраняет выделения и премиум-эмодзи', () => {
  const text = '🔥 ПРОГНОЗ\n⚽ Англия — Испания\n📊 Коэффициент 2,40\n👇 СМОТРЕТЬ';
  const entities = [
    { type: 'custom_emoji', offset: 0, length: 2, custom_emoji_id: '5368324170671202286' },
    { type: 'bold', offset: 3, length: 7 },
    { type: 'italic', offset: text.indexOf('СМОТРЕТЬ'), length: 8 }
  ];
  const template = messageToTemplate(text, entities);
  const html = renderTemplate(template, { matches: ['Чехия — Хорватия'], odds: '3,15', sportIcon: '⚽️' });
  assert.match(html, /<tg-emoji emoji-id="5368324170671202286">🔥<\/tg-emoji>/);
  assert.match(html, /<b>ПРОГНОЗ<\/b>/);
  assert.match(html, /<i>СМОТРЕТЬ<\/i>/);
  assert.match(html, /Чехия — Хорватия/);
  assert.match(html, /3,15/);
  assert.doesNotMatch(html, /Англия|Испания|2,40/);
});

test('подстановка матча не сбрасывает вложенное выделение, ссылку и премиум-эмодзи', () => {
  const text = '🔥 ЖБ ПРОГНОЗ\n🏒 Амур — Лада\nКоэффициент 2,40\nЗабрать прогноз';
  const link = 'Забрать прогноз';
  const entities = [
    { type: 'bold', offset: 0, length: '🔥 ЖБ ПРОГНОЗ'.length },
    { type: 'custom_emoji', offset: 0, length: 2, custom_emoji_id: '5368324170671202286' },
    { type: 'text_link', offset: text.indexOf(link), length: link.length, url: 'https://t.me/example' }
  ];
  const html = renderTemplate(messageToTemplate(text, entities), {
    matches: ['Сибирь — Авангард'], odds: '3,15', sportIcon: '🏒'
  });
  assert.match(html, /<b><tg-emoji emoji-id="5368324170671202286">🔥<\/tg-emoji> ЖБ ПРОГНОЗ<\/b>/);
  assert.match(html, /<a href="https:\/\/t\.me\/example">Забрать прогноз<\/a>/);
  assert.match(html, /Сибирь — Авангард/);
  assert.match(html, /3,15/);
});

test('допускается шаблон без коэффициента и матча', () => {
  const template = messageToTemplate('⏰ Прогноз по кнопке');
  assert.equal(renderTemplate(template, { matches: [], odds: null }), '⏰ Прогноз по кнопке');
});

test('несколько матчей превращаются в одно поле без повторения', () => {
  const template = messageToTemplate('⚽ Англия — Испания\n⚽ Чехия — Хорватия\nКоэффициент 2,937');
  const html = renderTemplate(template, { matches: ['Амур — Локомотив', 'Трактор — СКА'], odds: '5,98', sportIcon: '🏒' });
  assert.equal((html.match(/Амур/g) || []).length, 1);
  assert.equal((html.match(/Трактор/g) || []).length, 1);
  assert.doesNotMatch(html, /Англия|Испания|Чехия|Хорватия|2,937/);
});

test('текстовый импорт по-прежнему понимает ручное жирное выделение', () => {
  const template = messageToTemplate('**ПРОГНОЗ**\n{matches}\n{odds}');
  const html = renderTemplate(template, { matches: ['А — Б'], odds: '2,40' });
  assert.match(html, /<b>ПРОГНОЗ<\/b>/);
  assert.match(html, /А — Б/);
  assert.match(html, /2,40/);
});

test('удаление шаблона сохраняет следующий по очереди шаблон', () => {
  const original = ['А', 'Б', 'В', 'Г'];
  const result = removeTextTemplate(original, 1, 2);
  assert.deepEqual(result.templates, ['А', 'В', 'Г']);
  assert.equal(result.nextTemplateIndex, 1);
  assert.deepEqual(original, ['А', 'Б', 'В', 'Г']);
  assert.deepEqual(removeTextTemplate(original, 2, 2), { templates: ['А', 'Б', 'Г'], nextTemplateIndex: 2 });
  assert.deepEqual(removeTextTemplate(['А'], 0, 0), { templates: [], nextTemplateIndex: 0 });
});
