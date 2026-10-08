import { extractMatches, extractOdds } from './core.js';
import { entitiesToRichHtml } from './rich.js';

function replaceSpan(value, entities, start, end, replacement) {
  const delta = replacement.length - (end - start);
  const next = [];
  for (const entity of entities) {
    const left = entity.offset;
    const right = left + entity.length;
    if (right <= start) next.push(entity);
    else if (left >= end) next.push({ ...entity, offset: left + delta });
    else if (left <= start && right >= end && entity.type !== 'custom_emoji') {
      next.push({ ...entity, length: entity.length + delta });
    }
  }
  return { text: value.slice(0, start) + replacement + value.slice(end), entities: next };
}

function matchLineSpans(text) {
  const spans = [];
  const lines = text.split('\n');
  let offset = 0;
  for (const line of lines) {
    const content = line.replace(/\r$/, '');
    if (extractMatches(content).length) spans.push({ start: offset, end: offset + content.length });
    offset += line.length + 1;
  }
  return spans;
}

function oddsSpan(text) {
  const labeled = text.match(/(?:коэффиц(?:иент)?|кэф|кф|📊)[^\n\d]{0,20}(\d+[.,]\d+\+?)/i);
  if (labeled) {
    const number = labeled[1];
    const start = labeled.index + labeled[0].lastIndexOf(number);
    return { start, end: start + number.length };
  }
  const odds = extractOdds(text);
  if (!odds) return null;
  const escaped = odds.replace(',', '___SEP___').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('___SEP___', '[.,]');
  const pattern = new RegExp(`(?<!\\d)${escaped}(?!\\d)`, 'i');
  const found = pattern.exec(text);
  return found ? { start: found.index, end: found.index + found[0].length } : null;
}

export function messageToTemplate(text, sourceEntities = []) {
  const sourceText = String(text || '');
  if (!sourceText.trim() || sourceText.length > 4000) throw new Error('Текст шаблона должен содержать от 1 до 4000 символов');
  let value = sourceText;
  let entities = sourceEntities.map(entity => ({ ...entity }));
  if (!value.includes('{matches}')) {
    const spans = matchLineSpans(value);
    for (let index = spans.length - 1; index >= 0; index--) {
      const { start, end } = spans[index];
      ({ text: value, entities } = replaceSpan(value, entities, start, end, index === 0 ? '{matches}' : ''));
    }
  }
  if (!value.includes('{odds}')) {
    const span = oddsSpan(value);
    if (span) ({ text: value, entities } = replaceSpan(value, entities, span.start, span.end, '{odds}'));
  }
  let body = entitiesToRichHtml(value, entities);
  if (!sourceEntities.length) body = body.replace(/\*\*([^*<]+)\*\*/g, '<b>$1</b>');
  return { format: 'rich_html', body, sourceText, sourceEntities };
}

export function templateText(template) {
  return typeof template === 'string' ? template : template?.sourceText || '';
}

export function templateIdentity(template) {
  return typeof template === 'string' ? template : JSON.stringify([template?.body, template?.sourceText]);
}

export function removeTextTemplate(templates, index, nextTemplateIndex) {
  if (!Number.isInteger(index) || index < 0 || index >= templates.length) throw new Error('Шаблон не найден');
  const remaining = templates.filter((_, position) => position !== index);
  if (!remaining.length) return { templates: remaining, nextTemplateIndex: 0 };
  const current = ((nextTemplateIndex || 0) % templates.length + templates.length) % templates.length;
  const next = current > index ? current - 1 : current;
  return { templates: remaining, nextTemplateIndex: next % remaining.length };
}
