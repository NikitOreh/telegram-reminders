import { reminderButtonFor, reminderCaptionFor, reminderDeleteAfterFor, reminderIsRemoved, reminderPhotoFor } from './reminder-settings.js';
import { postButtons } from './post-links.js';

export function buildItemCopyCampaign(source, item, { id, at, channelIds, networkKey, deleteAfter }) {
  if (!id || !Number.isFinite(at) || !channelIds?.length) throw new Error('Для копии нужны сетка и время выхода');
  const common = { id, createdAt: Date.now(), channelIds: [...channelIds], networkKeys: [networkKey],
    matches: source.matches || [], odds: source.odds || null, version: 1 };
  if (item === 'a') {
    if (source.standaloneReminder) throw new Error('У этой записи нет рекламного поста');
    return { ...common, postManaged: true, remindersEnabled: false, sourceText: source.sourceText || '',
      sourceEntities: source.sourceEntities || [], photoId: source.photoId || null, videoId: source.videoId || null,
      mainMediaType: source.mainMediaType || null, buttons: structuredClone(postButtons(source)),
      url: source.url || null, buttonText: source.buttonText || null, buttonMode: source.buttonMode || 'regular',
      hiddenContinuation: structuredClone(source.hiddenContinuation || null), postAt: at,
      postDeleteAfter: deleteAfter, captions: [], times: [], templates: [], messageFormat: 'rich' };
  }
  const index = Number(item);
  if (!Number.isInteger(index) || index < 0 || index >= (source.times?.length || 0) || reminderIsRemoved(source, index)) throw new Error('Напоминание для копирования не найдено');
  const photoId = reminderPhotoFor(source, index);
  if (!photoId) throw new Error('У напоминания нет фото для копирования');
  const button = reminderButtonFor(source, index);
  if (!button?.url && !button?.callback_data) throw new Error('У напоминания нет ссылки кнопки');
  return { ...common, standaloneReminder: true, postManaged: false, remindersEnabled: true,
    sourceText: '', sourceEntities: [], photoId: null, reminderPhotoId: photoId, reminderPhotoIds: [photoId],
    captions: [reminderCaptionFor(source, index)], times: [at], templates: [], postAt: at,
    reminderDeleteAfter: deleteAfter === undefined ? reminderDeleteAfterFor(source, index) : deleteAfter,
    buttons: button.url ? [structuredClone(button)] : [], url: button.url || null, buttonText: button.text,
    buttonMode: button.callback_data?.startsWith('hidden:') ? 'hidden' : 'regular',
    hiddenContinuation: button.callback_data?.startsWith('hidden:') ? structuredClone(source.hiddenContinuation) : null,
    messageFormat: source.messageFormat || 'rich' };
}
