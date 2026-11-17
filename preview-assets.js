import { createHash } from 'node:crypto';
import { sportIconForMatch } from './core.js';
import { matchCompetition } from './match-competition.js';
import { imageSettingsFor } from './image-source.js';
import { sportIcon } from './core.js';

const signature = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

export function reminderImageSourceKey(draft) {
  if (draft.imageSource === 'manual') return `manual:${signature(draft.manualReminderPhotoIds || [])}`;
  if (draft.imageSource !== 'internet') throw new Error('Выберите свои фото или поиск в интернете');
  const context = draft.sourceText || '';
  const matches = (draft.matches || []).map(match => {
    const sport = sportIconForMatch(match, draft.sportIcon, context);
    return [match, sport, matchCompetition(context, match, sport)?.id || null];
  });
  // Only search-relevant content invalidates photos; links, odds and prose do not.
  const categories = [
    /\b(?:women|women's|womens|woman|female|ladies)\b|женск|женщин/i.test(context),
    /\b(?:u[- ]?1[679]|u[- ]?2[013]|under[- ]?1[679]|under[- ]?2[013]|youth)\b|молод[её]ж|юниор/i.test(context)
  ];
  return `internet:team-images-v10:${signature([matches, categories])}`;
}

export function migratePreparedPhotoKey(draft) {
  if (draft.imageSource !== 'internet' || !draft.matches?.length || draft.reminderPhotoMatch !== draft.matches[0]) return draft;
  const legacyMatches = draft.matches.map(match => [match, sportIconForMatch(match, draft.sportIcon, draft.sourceText)]);
  const legacy = `internet:team-images-v9:second-match-fallback:${signature([legacyMatches, draft.sourceText])}`;
  if (draft.reminderPhotoTemplateId === legacy) draft.reminderPhotoTemplateId = reminderImageSourceKey(draft);
  return draft;
}

export function preparedPhotosAreCurrent(draft, count, styleVersion) {
  return draft.reminderPhotoIds?.length === count && draft.reminderPhotoIds.every(Boolean) &&
    draft.reminderPhotoMatch === draft.matches?.[0] &&
    draft.reminderPhotoTemplateId === reminderImageSourceKey(draft) && draft.reminderPhotoStyleVersion === styleVersion;
}

export function finishPreviewPreparation(draft, { captions, templates }, now = Date.now()) {
  draft.previewCaptions = captions;
  draft.selectedReminderTemplates = templates;
  draft.previewedAt = Math.max(now, draft.editedAt || 0);
  draft.autoPreviewAfterMetadataEdit = false;
}

// Cheap validation and text rendering, without search, uploads or preview messages.
export function refreshPreparedPreview(draft, prepare, styleVersion) {
  const prepared = prepare();
  if (draft.remindersEnabled !== false && !preparedPhotosAreCurrent(draft, prepared.captions.length, styleVersion)) return false;
  finishPreviewPreparation(draft, prepared);
  return true;
}

export function retainedLivePhotos(draft, previous, count) {
  if (!previous?.times?.length || count <= previous.times.length) return [];
  const original = { ...previous, ...imageSettingsFor(previous), sportIcon: sportIcon(previous.sourceText || '') };
  if (reminderImageSourceKey(draft) !== reminderImageSourceKey(original) ||
    JSON.stringify(draft.reminderPhotoIds) !== JSON.stringify(previous.reminderPhotoIds) ||
    draft.reminderPhotoId !== previous.reminderPhotoId) return [];
  const photos = previous.times.map((_, index) => previous.reminderPhotoIds?.[index] || previous.reminderPhotoId || previous.photoId);
  return photos.every(Boolean) ? photos : [];
}
