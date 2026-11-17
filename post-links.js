import { hiddenButton } from './hidden-content.js';

export function postButtons(post) {
  if (Array.isArray(post.buttons)) return post.buttons;
  return post.url ? [{ text: post.buttonText || 'ПРОГНОЗ', url: post.url }] : [];
}

export function postKeyboard(post) {
  const hidden = hiddenButton(post);
  if (hidden) return { inline_keyboard: [[hidden]] };
  if (post.buttonMode === 'continuation') return undefined;
  const buttons = postButtons(post);
  return buttons.length ? { inline_keyboard: buttons.map(button => [{ text: button.text, url: button.url }]) } : undefined;
}

export function primaryPostButton(post) {
  return hiddenButton(post) || postButtons(post)[0];
}

export function originalContent(post) {
  const text = post.sourceText || '';
  const entities = (post.sourceEntities || []).map(entity => ({ ...entity }));
  const link = postButtons(post)[0];
  if (post.buttonMode !== 'continuation' || !link) return { text, entities };
  const prefix = text ? `${text}${/\s$/.test(text) ? '' : ' '}` : '';
  const label = link.text || 'Читать продолжение…';
  entities.push({ type: 'text_link', offset: prefix.length, length: label.length, url: link.url });
  return { text: prefix + label, entities };
}
