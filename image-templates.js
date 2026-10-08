import path from 'node:path';

export const BUILTIN_IMAGE_TEMPLATES = [
  { id: 'football-solo', name: 'Футбол · игрок и два круга', sport: 'football', layout: 'two_circles', file: 'football-solo.png', builtin: true },
  { id: 'hockey-solo', name: 'Хоккей · игрок и круг', sport: 'hockey', layout: 'single_circle', file: 'hockey-solo.png', builtin: true },
  { id: 'football-duel-boxes', name: 'Футбол · дуэль с рамками', sport: 'football', layout: 'two_boxes', file: 'football-duel-boxes.png', builtin: true },
  { id: 'football-duel-strike', name: 'Футбол · дуэль и молния', sport: 'football', layout: 'two_boxes', file: 'football-duel-strike.png', builtin: true },
  { id: 'football-duel-circles', name: 'Футбол · дуэль и круги', sport: 'football', layout: 'two_circles', file: 'football-duel-circles.png', builtin: true }
];

export function defaultImageTemplateId(sportIcon) {
  return sportIcon === '🏒' ? 'hockey-solo' : 'football-duel-circles';
}

export function imageTemplatePath(dir, template) {
  if (!template || !/^[a-z0-9][a-z0-9.-]*\.png$/i.test(template.file) || path.basename(template.file) !== template.file) {
    throw new Error('Некорректное имя файла шаблона');
  }
  return path.join(dir, 'image-templates', template.file);
}
