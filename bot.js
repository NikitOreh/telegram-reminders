import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_TEMPLATES, MINUTE, extractMatches, extractOdds, formatMoscow,
  parseScheduleCommand, parseFlexibleMoscow, parseDurationMinutes, parseReminderDeleteMinutes, parsePostDeleteMinutes, parseButtonSpec, scheduleTimes,
  renderTemplate, sportIcon, sportIconForMatch, hasMixedMatchSports
} from './core.js';
import { getInternetMatchBackgrounds } from './internet-art.js';
import { imageSettingsFor } from './image-source.js';
import { compatibleReminderTemplates, distributeManualPhotos, repeatAtMostTwice, selectReminderTemplates, validateCaptionRepetitions } from './series-assets.js';
import { buildCampaignJobs, moveCampaignSchedule, reminderButtonFor, reminderCaptionFor, reminderDeleteAfterFor, reminderIsRemoved, reminderPhotoFor, reminderTimeFor, removeReminder, setPostDeleteAfter, setReminderOverride, validateReminderTime } from './reminder-settings.js';
import { contentPlanEntries, deletionLabel, moscowDay, planEntryTitle, shiftMoscowDay } from './content-plan.js';
import { entitiesToRichHtml, richWithQuotedPhoto, reminderRichMessage, richPhotoFileId } from './rich.js';
import { messageToTemplate, removeTextTemplate, templateIdentity, templateText } from './text-templates.js';
import { preventWindowsIdleSleep } from './sleep-guard.js';
import { createUserState, parseOwnerIds } from './user-sessions.js';
import { visibleCampaignsAndJobs, visibleChannels } from './channel-access.js';
import { timerKeyboard } from './timer-menu.js';
import { buildItemCopyCampaign } from './item-copy.js';
import { publicationGroupKey, publicationGroupNotice, publicationGroupReady, publicationNetworkKey, stalePublicationNotices } from './publication-notice.js';
import { publicationDeadline, shouldRetryPublication } from './job-delivery.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(DIR, 'data.json');
const CARD_STYLE_VERSION = 6;
try { process.loadEnvFile(path.join(DIR, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }

const TOKEN = process.env.BOT_TOKEN;
const OWNER_IDS = parseOwnerIds(process.env.OWNER_ID);
const OWNER_ID = OWNER_IDS[0];
const NETWORKS = Object.fromEntries([1, 2].map(number => [String(number), (process.env[`NETWORK_${number}`] || '').split(',').map(x => x.trim()).filter(Boolean)]));
const CONFIGURED_CHANNELS = [...new Set(Object.values(NETWORKS).flat())];
if (!TOKEN || TOKEN.includes('replace-me') || NETWORKS['1'].length + NETWORKS['2'].length < 1) {
  throw new Error('Заполните BOT_TOKEN, OWNER_ID и хотя бы один канал в NETWORK_1 или NETWORK_2 файла .env');
}

const API = `https://api.telegram.org/bot${TOKEN}`;
const { state, rawState, currentUserId, runForUser } = createUserState(await loadState(), OWNER_ID);
let busy = false;
let saving = Promise.resolve();
const CHANNEL_TITLES = new Map();
const USER_CHANNELS = new Map();
let botUserId = null;

async function adminChannelsFor(userId) {
  const checks = await Promise.all(CONFIGURED_CHANNELS.map(async channelId => {
    try {
      const member = await telegram('getChatMember', { chat_id: channelId, user_id: userId });
      return ['creator', 'administrator'].includes(member.status) ? channelId : null;
    } catch (error) {
      console.error(`Не удалось проверить администратора ${userId} в канале ${channelId}: ${error.message}`);
      return null;
    }
  }));
  return new Set(checks.filter(Boolean));
}

function allowedChannels() { return USER_CHANNELS.get(currentUserId()) || new Set(); }

function assertChannelsAllowed(ids) {
  const allowed = allowedChannels();
  const forbidden = ids.filter(id => !allowed.has(String(id)));
  if (forbidden.length) throw new Error('Нет прав администратора в одном или нескольких выбранных каналах. Откройте «Сетка» и выберите доступные каналы.');
}

function planChannels() {
  const network = state.planNetwork;
  if (!NETWORKS[network]) return new Set();
  const allowed = allowedChannels();
  return new Set(NETWORKS[network].filter(id => allowed.has(id)));
}

function visibleCampaign(id, inPlan = false) {
  const campaign = state.campaigns.find(item => item.id === id);
  if (!campaign) throw new Error('Серия не найдена');
  const channelIds = visibleChannels(campaign, inPlan ? planChannels() : allowedChannels());
  if (!channelIds.length) throw new Error('У вас нет прав администратора в каналах этой серии');
  return { ...campaign, channelIds };
}

function writableCampaign(id) {
  visibleCampaign(id);
  return state.campaigns.find(item => item.id === id);
}

function assertCampaignAccess(campaign) {
  if (!campaign) throw new Error('Серия не найдена');
  if (!visibleChannels(campaign, allowedChannels()).length) throw new Error('У вас нет прав администратора в каналах этой серии');
}

function assertChannelSelectionEditable(draft) {
  if (!draft?.editingCampaignId) return;
  const campaign = state.campaigns.find(item => item.id === draft.editingCampaignId);
  assertCampaignAccess(campaign);
  if (visibleChannels(campaign, allowedChannels()).length !== campaign.channelIds.length) {
    throw new Error('Состав каналов общей серии может менять только администратор всех её каналов. Текст, время и таймеры можно менять здесь — они обновятся во всех копиях.');
  }
}

async function loadState() {
  try {
    const saved = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
    saved.templates ||= [...DEFAULT_TEMPLATES];
    saved.imageTemplates ||= [];
    saved.campaigns ||= [];
    saved.jobs ||= [];
    saved.nextTemplateIndex ||= 0;
    saved.offset ||= 0;
    saved.draft ||= null;
    saved.mode ||= null;
    if (saved.mode === 'image_template') saved.mode = null;
    for (const session of Object.values(saved.userSessions || {})) if (session.mode === 'image_template') session.mode = null;
    for (const draft of [saved.draft, ...Object.values(saved.userSessions || {}).map(session => session.draft)].filter(Boolean)) {
      draft.networkKeys ||= [NETWORKS['1'].length ? '1' : '2'];
      draft.sportIcon = sportIcon(draft.sourceText || '');
      if (draft.reminderDeleteAfter === undefined) draft.reminderDeleteAfter = 30;
      draft.remindersEnabled ??= Boolean(draft.matches?.length && draft.odds);
      draft.sourceEntities ||= [];
      draft.mainMediaType ||= draft.videoId ? 'video' : draft.photoId ? 'photo' : null;
      draft.buttons ||= draft.url ? [{ text: draft.buttonText || 'ПРОГНОЗ', url: draft.url }] : [];
      draft.channelIds ||= [...new Set(draft.networkKeys.flatMap(key => NETWORKS[key] || []))];
      Object.assign(draft, imageSettingsFor(draft));
      if (draft.reminderPhotoStyleVersion !== CARD_STYLE_VERSION) {
        draft.reminderPhotoId = null;
        draft.reminderPhotoIds = null;
      }
    }
    return saved;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { templates: [...DEFAULT_TEMPLATES], imageTemplates: [], campaigns: [], jobs: [], nextTemplateIndex: 0, offset: 0, draft: null, mode: null };
  }
}

function save() {
  saving = saving.then(async () => {
    const temp = DATA_FILE + '.tmp';
    await fs.writeFile(temp, JSON.stringify(rawState, null, 2), 'utf8');
    await fs.rename(temp, DATA_FILE);
  });
  return saving;
}

function telegramError(method, description, status, parameters) {
  const customEmojiDenied = /custom[ _-]?emoji/i.test(description || '');
  const message = customEmojiDenied
    ? `${method}: Telegram запретил боту использовать премиум-эмодзи. Для публикации таких эмодзи в каналах боту нужен дополнительный username, купленный на Fragment. Текст и оформление сохранены в данных бота; публикация без них не выполнялась. Ответ Telegram: ${description}`
    : `${method}: ${description || status}`;
  const error = new Error(message);
  error.retryAfter = parameters?.retry_after;
  error.permanent = customEmojiDenied || status === 400 || status === 403 || /^(?:Bad Request|Forbidden):/i.test(description || '');
  return error;
}

async function telegram(method, payload) {
  const response = await fetch(`${API}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(35_000)
  });
  const data = await response.json();
  if (!data.ok) throw telegramError(method, data.description, response.status, data.parameters);
  return data.result;
}

async function sendGeneratedRichPhoto(chatId, png, caption, button) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('photo', new Blob([png], { type: 'image/png' }), 'match.png');
  form.append('rich_message', JSON.stringify(reminderRichMessage(caption, 'attach://photo')));
  if (button) form.append('reply_markup', JSON.stringify({ inline_keyboard: [[button]] }));
  const response = await fetch(`${API}/sendRichMessage`, { method: 'POST', body: form, signal: AbortSignal.timeout(35_000) });
  const data = await response.json();
  if (!data.ok) throw telegramError('sendRichMessage', data.description, response.status, data.parameters);
  return data.result;
}

const reply = (text, extra = {}) => telegram('sendMessage', { chat_id: currentUserId(), text, ...extra });
async function replyDraftInfo(text, extra = {}) {
  const message = await reply(text, extra);
  state.draftInfoMessageIds ||= [];
  state.draftInfoMessageIds.push(message.message_id);
  await save();
  return message;
}

async function clearDraftInfoMessages() {
  const ids = state.draftInfoMessageIds || [];
  if (!ids.length) return;
  state.draftInfoMessageIds = [];
  await save();
  for (const id of ids) {
    await telegram('deleteMessage', { chat_id: currentUserId(), message_id: id }).catch(error =>
      console.warn(`Не удалось удалить сообщение черновика ${id}: ${error.message}`));
  }
}

async function trackPreviewMessage(message, scope = 'draft') {
  if (!message?.message_id) return message;
  const key = scope === 'copy' ? 'copyPreviewMessageIds' : 'draftPreviewMessageIds';
  state[key] ||= [];
  state[key].push(message.message_id);
  await save();
  return message;
}

async function clearPreviewMessages(scope = 'draft') {
  const key = scope === 'copy' ? 'copyPreviewMessageIds' : 'draftPreviewMessageIds';
  const ids = state[key] || [];
  if (!ids.length) return;
  state[key] = [];
  await save();
  for (const id of ids) {
    await telegram('deleteMessage', { chat_id: currentUserId(), message_id: id }).catch(error =>
      console.warn(`Не удалось удалить предпросмотр ${id}: ${error.message}`));
  }
}

async function clearPrompt(expectedId = state.promptMessageId) {
  if (!expectedId || state.promptMessageId !== expectedId) return;
  state.promptMessageId = null;
  await save();
  await telegram('deleteMessage', { chat_id: currentUserId(), message_id: expectedId }).catch(error =>
    console.warn(`Не удалось удалить служебное сообщение ${expectedId}: ${error.message}`));
}

async function sendPrompt(text, extra = {}) {
  await clearPrompt();
  const message = await reply(text, extra);
  state.promptMessageId = message.message_id;
  await save();
  return message;
}

async function briefNotice(text, extra = {}) {
  const message = await reply(text, extra);
  const chatId = currentUserId();
  setTimeout(() => telegram('deleteMessage', { chat_id: chatId, message_id: message.message_id }).catch(() => {}), 20_000).unref();
  return message;
}
const short = value => Array.from(value).length > 3800 ? Array.from(value).slice(0, 3800).join('') + '\n…' : value;
const MENU = { keyboard: [[{ text: '➕ Новый пост' }, { text: '📅 Контент-план' }], [{ text: '📚 Шаблоны текстов' }, { text: '❓ Помощь' }]], resize_keyboard: true };
const BUTTON_URL = /^https:\/\/(?:t\.me|telegram\.me)\//i;
const TEXT_TEMPLATE_PAGE_SIZE = 12;

function replyError(message) {
  const editingTemplate = state.mode === 'template_edit' && Number.isInteger(state.editTemplateIndex);
  const addingTemplate = state.mode === 'template_add' || state.mode === 'template' || state.mode === 'templates';
  const editingReminder = state.mode?.startsWith('reminder_edit_') && state.editReminder;
  const editingPostTimer = state.mode === 'post_delete_live' && state.modeCampaignId;
  const editingCopy = Boolean(state.copyItem);
  return reply(`Ошибка: ${message}`, { reply_markup: { inline_keyboard: [[{
    text: editingCopy ? '← К копии' : editingReminder ? '← К напоминанию' : editingPostTimer ? '← К посту' : editingTemplate ? '← К шаблону' : addingTemplate ? '← К списку шаблонов' : state.draft ? '← Назад к черновику' : '← Назад в меню',
    callback_data: editingCopy ? 'dup:edit' : editingReminder ? `rem:edit:${state.editReminder.id}:${state.editReminder.index}` : editingPostTimer ? `plan:item:${state.modeCampaignId}:a` : editingTemplate ? `template:view:${state.editTemplateIndex}` : addingTemplate ? 'template:list:0' : 'nav:back'
  }]] } });
}

function editorKeyboard(draft) {
  const managesPost = !draft.editingCampaignId || state.campaigns.find(campaign => campaign.id === draft.editingCampaignId)?.postManaged;
  const channelSelectionEditable = !draft.editingCampaignId || visibleChannels(state.campaigns.find(campaign => campaign.id === draft.editingCampaignId), allowedChannels()).length === selectedChannels(draft).length;
  return { inline_keyboard: [
    [{ text: '✏️ Изменить текст', callback_data: 'edit:content' }, { text: '👀 Превью', callback_data: 'edit:preview' }],
    [{ text: '🖼 Прикрепить медиа', callback_data: 'edit:media' }],
    ...(!draft.editingCampaignId ? [[{ text: `🔔 Напоминания: ${draft.remindersEnabled === false ? 'выключены' : 'включены'}`, callback_data: 'edit:reminders' }]] : []),
    ...(draft.remindersEnabled === false ? [] : [[{ text: `🖼 Картинка: ${draft.imageSource === 'internet' ? 'из интернета' : `свои фото (${draft.manualReminderPhotoIds?.length || 0})`}`, callback_data: 'edit:image_source' }]]),
    ...(draft.remindersEnabled !== false && draft.imageSource === 'internet' && draft.reminderPhotoIds?.length
      ? [[{ text: '🔄 Перенайти картинки', callback_data: 'edit:reroll_images' }]] : []),
    [...(channelSelectionEditable ? [{ text: `📍 ${networkLabelForChannels(selectedChannels(draft))}`, callback_data: 'edit:network' }] : []), { text: '🔗 Кнопка', callback_data: 'edit:button' }],
    ...(channelSelectionEditable ? [[{ text: '📋 Копировать в каналы', callback_data: 'edit:copy' }]] : []),
    ...(managesPost ? [[{ text: `⏱ Удаление поста: ${draft.postDeleteAfter ? deletionLabel(draft.postDeleteAfter) : 'не удалять'}`, callback_data: 'edit:delete' }]] : []),
    ...(draft.remindersEnabled === false ? [] : [[{ text: `⏱ Удаление напоминаний: ${draft.reminderDeleteAfter === null ? 'не удалять' : deletionLabel(draft.reminderDeleteAfter ?? 30)}`, callback_data: 'edit:reminder_delete' }]]),
    ...(draft.editingCampaignId
      ? [[{ text: '💾 Сохранить изменения', callback_data: 'edit:save' }]]
      : [[{ text: '🕓 Отложить', callback_data: 'edit:defer' }], [{ text: '🚀 Опубликовать сейчас', callback_data: 'edit:publish_now' }], [{ text: '❌ Отменить создание', callback_data: 'edit:discard' }]])
  ] };
}

async function showMenu() {
  await reply('Выберите действие или пришлите текст рекламы — я создам серию напоминаний.', { reply_markup: MENU });
  state.menuShown = true;
  await save();
}

function selectedChannels(draft) {
  return [...new Set(draft.channelIds ?? (draft.networkKeys || []).flatMap(key => NETWORKS[key] || []))];
}

function networkLabelForChannels(channels = []) {
  const selected = new Set(channels.map(String));
  const labels = Object.entries(NETWORKS).filter(([, ids]) => ids.some(id => selected.has(id))).map(([key]) => `Сетка ${key}`);
  return labels.join(', ') || 'Сетка не выбрана';
}

function reminderImageSourceKey(draft) {
  if (draft.imageSource === 'internet') {
    const matches = (draft.matches || []).map(match => [match, sportIconForMatch(match, draft.sportIcon, draft.sourceText)]);
    const signature = createHash('sha256').update(JSON.stringify([matches, draft.sourceText])).digest('hex').slice(0, 16);
    return `internet:team-images-v9:second-match-fallback:${signature}`;
  }
  if (draft.imageSource === 'manual') return `manual:${createHash('sha256').update(JSON.stringify(draft.manualReminderPhotoIds || [])).digest('hex').slice(0, 16)}`;
  throw new Error('Выберите свои фото или поиск в интернете');
}

function manualPhotoLimit(draft) {
  if (!draft.postAt || !draft.adEnd) return 48;
  return scheduleTimes(draft.postAt, draft.adEnd, draft.reminderDeleteAfter, draft.postDeleteAfter).filter(at => at >= Date.now() + MINUTE).length || 1;
}

async function promptManualPhotos() {
  const count = state.draft?.manualReminderPhotoIds?.length || 0;
  const limit = manualPhotoLimit(state.draft);
  return sendPrompt(`Пришлите фото для напоминаний по одному сообщению или альбомом. Сейчас загружено ${count} из ${limit}. Можно использовать от одного до ${limit} фото; если фото меньше, они повторятся по порядку. Затем нажмите «Готово» и проверьте «Превью».`, {
    reply_markup: { inline_keyboard: [
      [{ text: '✅ Готово', callback_data: 'manual:done' }],
      [{ text: '🗑 Очистить загруженные фото', callback_data: 'manual:reset' }],
      [{ text: '← К черновику', callback_data: 'nav:back' }]
    ] }
  });
}

function postButtons(post) {
  return post.buttons?.length ? post.buttons : post.url ? [{ text: post.buttonText || 'ПРОГНОЗ', url: post.url }] : [];
}

function postKeyboard(post) {
  const buttons = postButtons(post);
  return buttons.length ? { inline_keyboard: buttons.map(button => [{ text: button.text, url: button.url }]) } : undefined;
}

function draftSummary(draft) {
  const channels = selectedChannels(draft).filter(id => allowedChannels().has(id));
  return [
    draft.remindersEnabled === false ? '📝 Черновик поста' : '📝 Черновик напоминаний',
    `Медиа рекламы: ${draft.photoId ? '+' : '-'}`,
    `Каналы: ${channels.length ? channels.map(id => CHANNEL_TITLES.get(id) || id).join(', ') : 'не выбраны'}${draft.editingCampaignId ? '\nИзменения серии применятся ко всем её копиям.' : ''}`,
    `Выход рекламы: ${draft.postAt ? `${formatMoscow(draft.postAt)} МСК` : 'задаётся при откладывании'}`,
    `Кнопки: ${postButtons(draft).length ? postButtons(draft).map(b => b.text).join(', ') : 'не заданы'}`,
    ...(draft.remindersEnabled === false ? [] : [`Матчи: ${draft.matches?.join('; ') || 'не определены'}`, `Коэффициент: ${draft.odds || 'не определён'}`])
  ].join('\n');
}

async function cacheChannelTitles(ids) {
  await Promise.all(ids.filter(id => !CHANNEL_TITLES.has(id)).map(async id => {
    try {
      const chat = await telegram('getChat', { chat_id: id });
      if (chat.title) CHANNEL_TITLES.set(id, chat.title);
    } catch (error) { console.error(`Не удалось получить название канала ${id}: ${error.message}`); }
  }));
}

async function validateChannelAccess(ids) {
  botUserId ||= (await telegram('getMe', {})).id;
  const results = await Promise.all(ids.map(async id => {
    try {
      const chat = await telegram('getChat', { chat_id: id });
      if (chat.type !== 'channel') throw new Error('это не канал');
      const member = await telegram('getChatMember', { chat_id: id, user_id: botUserId });
      if (member.status !== 'creator' && (member.status !== 'administrator' || !member.can_post_messages || !member.can_delete_messages)) {
        throw new Error('боту нужны права публикации и удаления сообщений');
      }
      CHANNEL_TITLES.set(id, chat.title || id);
      return null;
    } catch (error) { return `${id}: ${error.message}`; }
  }));
  const failures = results.filter(Boolean);
  if (failures.length) throw new Error(`Не могу отложить серию: проверьте ID каналов и добавьте бота администратором с правами публикации и удаления. ${failures.join('; ')}`);
}

async function showDraft() {
  if (!state.draft) return reply('Черновика нет. Пришлите текст рекламы для новой серии.', { reply_markup: MENU });
  if (state.draft.editingCampaignId) assertCampaignAccess(state.campaigns.find(item => item.id === state.draft.editingCampaignId));
  else {
    const current = selectedChannels(state.draft);
    const permitted = current.filter(id => allowedChannels().has(id));
    if (permitted.length !== current.length) {
      state.draft.channelIds = permitted;
      markEdited();
      await save();
    }
  }
  await cacheChannelTitles(selectedChannels(state.draft).filter(id => allowedChannels().has(id)));
  await reply(draftSummary(state.draft), { reply_markup: editorKeyboard(state.draft) });
}

function templateTitle(template) {
  const line = templateText(template).split(/\r?\n/).map(value => value.trim()).find(Boolean) || 'Без названия';
  const plain = line.replace(/\*\*|<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  const characters = Array.from(plain);
  return characters.length > 31 ? `${characters.slice(0, 30).join('')}…` : plain;
}

function templateFingerprint(template) {
  return createHash('sha256').update(templateIdentity(template)).digest('hex').slice(0, 12);
}

async function showTextTemplates(page = 0) {
  const pages = Math.max(1, Math.ceil(state.templates.length / TEXT_TEMPLATE_PAGE_SIZE));
  page = Math.max(0, Math.min(page, pages - 1));
  const rows = state.templates.slice(page * TEXT_TEMPLATE_PAGE_SIZE, (page + 1) * TEXT_TEMPLATE_PAGE_SIZE)
    .map((template, offset) => {
      const index = page * TEXT_TEMPLATE_PAGE_SIZE + offset;
      return [{ text: `${String(index + 1).padStart(2, '0')} · ${templateTitle(template)}`, callback_data: `template:view:${index}` }];
    });
  if (pages > 1) rows.push([
    ...(page ? [{ text: '← Ранее', callback_data: `template:list:${page - 1}` }] : []),
    { text: `${page + 1}/${pages}`, callback_data: `template:list:${page}` },
    ...(page + 1 < pages ? [{ text: 'Далее →', callback_data: `template:list:${page + 1}` }] : [])
  ]);
  rows.push([{ text: '➕ Добавить шаблон', callback_data: 'template:add' }]);
  rows.push([{ text: '← Меню', callback_data: 'nav:back' }]);
  await reply(`📚 Шаблоны текстов: ${state.templates.length}\nНажмите на строку, чтобы прочитать полный шаблон или изменить его.`, { reply_markup: { inline_keyboard: rows } });
}

async function showTextTemplate(index) {
  if (!Number.isInteger(index) || index < 0 || index >= state.templates.length) throw new Error('Шаблон не найден');
  const page = Math.floor(index / TEXT_TEMPLATE_PAGE_SIZE);
  const template = state.templates[index];
  let formattedPreview = true;
  if (template?.format === 'rich_html') {
    try { await telegram('sendMessage', { chat_id: currentUserId(), text: template.sourceText,
      entities: template.sourceEntities?.length ? template.sourceEntities : undefined }); }
    catch (error) {
      formattedPreview = false;
      await reply(`Telegram не смог показать этот шаблон с оформлением: ${error.message}`);
      await reply(template.sourceText);
    }
  }
  await reply(`📄 Шаблон ${index + 1} из ${state.templates.length}${typeof template === 'string' ? `\n\n${template}` : formattedPreview ? '\n\nВыше — исходная напоминалка с её оформлением.' : '\n\nВыше — текст без оформления: Telegram отклонил оформленный предпросмотр.'}\n\nНайденные матч и коэффициент подставятся из новой рекламы. Изменения применятся к новым сериям.`, {
    reply_markup: { inline_keyboard: [
      [{ text: '✏️ Изменить', callback_data: `template:edit:${index}` }],
      [{ text: '🗑 Удалить', callback_data: `template:askdelete:${index}:${templateFingerprint(template)}` }],
      [{ text: '➕ Добавить новый', callback_data: 'template:add' }],
      [{ text: '← К списку', callback_data: `template:list:${page}` }]
    ] }
  });
}

function markEdited() { state.draft.editedAt = Date.now(); }

function createDraft(message) {
  const text = message.text || message.caption || '';
  if (!text.trim() && !message.photo?.length) throw new Error('Пришлите текст рекламы или фото с подписью');
  const matches = extractMatches(text);
  const odds = extractOdds(text);
  const allowed = allowedChannels();
  const firstNetwork = ['1', '2'].find(key => NETWORKS[key].some(channel => allowed.has(channel)));
  if (!firstNetwork) throw new Error('У вас нет прав администратора ни в одном подключённом канале');
  state.draft = {
    sourceText: text,
    sourceEntities: message.entities || message.caption_entities || [],
    photoId: message.photo?.at(-1)?.file_id || null,
    videoId: message.video?.file_id || null,
    mainMediaType: message.video ? 'video' : message.photo?.length ? 'photo' : null,
    buttons: [],
    matches, odds, sportIcon: sportIcon(text), imageSource: 'manual', manualReminderPhotoIds: [],
    networkKeys: [firstNetwork],
    channelIds: NETWORKS[firstNetwork].filter(channel => allowed.has(channel)),
    remindersEnabled: true,
    reminderDeleteAfter: 30,
    editedAt: Date.now()
  };
  state.mode = null;
}

function prepareDraft(draft, postAt) {
  if (!draft?.sourceText && !draft?.photoId && !draft?.videoId) throw new Error('Пришлите текст или медиа для поста');
  const channels = selectedChannels(draft);
  if (!channels.length) throw new Error('Выберите сетку с подключёнными каналами');
  const previous = draft.editingCampaignId && state.campaigns.find(c => c.id === draft.editingCampaignId);
  if (previous) {
    assertCampaignAccess(previous);
    if (JSON.stringify([...channels].sort()) !== JSON.stringify([...previous.channelIds].sort())) {
      assertChannelSelectionEditable(draft);
      assertChannelsAllowed(channels);
    }
  } else assertChannelsAllowed(channels);
  if (!postAt) throw new Error('Укажите время выхода рекламы через «Отложить»');
  if (postButtons(draft).some(button => !BUTTON_URL.test(button.url))) throw new Error('Ссылка кнопки должна начинаться с https://t.me/');
  if (draft.remindersEnabled === false) return { captions: [], times: [], channels, templates: [] };
  if (!draft.matches?.length || !draft.odds) throw new Error('В тексте рекламы должны быть строка с матчем и коэффициент. Если бот не распознал их, используйте /matches и /odds');
  if (!draft.adEnd) throw new Error('Укажите конец размещения рекламы');
  if (!postButtons(draft).length) throw new Error('Добавьте кнопку в формате СМОТРЕТЬ ПРОГНОЗ - https://t.me/...');
  const times = scheduleTimes(postAt, draft.adEnd, draft.reminderDeleteAfter, draft.postDeleteAfter).filter(at => at >= Date.now() + 60_000);
  if (!times.length) throw new Error('До конца рекламы не осталось будущих напоминаний');
  const templateSport = hasMixedMatchSports(draft.matches, draft.sourceText) ? 'mixed' : draft.sportIcon;
  const compatible = compatibleReminderTemplates(state.templates, templateSport);
  const matchesSport = templates => templates?.every(template => compatibleReminderTemplates([template], templateSport).length);
  const selected = previous?.templates?.length === times.length && matchesSport(previous.templates) ? previous.templates :
    draft.selectedReminderTemplates?.length === times.length && matchesSport(draft.selectedReminderTemplates) ? draft.selectedReminderTemplates :
      selectReminderTemplates(compatible, times.length, template => renderTemplate(template, draft)).map(item => item.template);
  const captions = selected.map(template => renderTemplate(template, draft));
  validateCaptionRepetitions(captions);
  if (captions.some(c => c.length > (previous && previous.messageFormat !== 'rich' ? 1024 : 32768))) throw new Error('Текст напоминания слишком длинный');
  return { captions, times, channels, templates: selected };
}

async function sendOriginal(chatId, draft) {
  const keyboard = postKeyboard(draft);
  if (draft.mainMediaType === 'video' && draft.videoId) return telegram('sendVideo', {
    chat_id: chatId, video: draft.videoId, caption: draft.sourceText || undefined,
    caption_entities: draft.sourceEntities?.length ? draft.sourceEntities : undefined,
    reply_markup: keyboard
  });
  if (draft.photoId && draft.postManaged && draft.sourceText?.trim()) return telegram('sendRichMessage', { chat_id: chatId,
    rich_message: richWithQuotedPhoto(entitiesToRichHtml(draft.sourceText, draft.sourceEntities), draft.photoId),
    reply_markup: keyboard });
  if (draft.photoId) return telegram('sendPhoto', { chat_id: chatId, photo: draft.photoId,
    caption: draft.sourceText || undefined, caption_entities: draft.sourceEntities?.length ? draft.sourceEntities : undefined,
    reply_markup: keyboard });
  return telegram('sendMessage', {
    chat_id: chatId, text: draft.sourceText, entities: draft.sourceEntities?.length ? draft.sourceEntities : undefined,
    reply_markup: keyboard
  });
}

async function preview({ rerollInternetImages = false } = {}) {
  const draft = state.draft;
  if (!draft) throw new Error('Пришлите текст или фото для нового поста');
  if (rerollInternetImages && (draft.imageSource !== 'internet' || draft.remindersEnabled === false)) {
    throw new Error('Перенайти можно только картинки из интернета для напоминаний');
  }
  const postAt = draft.postAt || Date.now();
  if (draft.remindersEnabled === false) {
    prepareDraft(draft, postAt);
    await replyDraftInfo(`Превью поста:\n${draftSummary(draft)}\nНапоминания выключены.`);
    await trackPreviewMessage(await sendOriginal(currentUserId(), { ...draft, postManaged: true }));
    draft.previewedAt = Date.now();
    await save();
    return showDraft();
  }
  const old = draft.editingCampaignId && state.campaigns.find(c => c.id === draft.editingCampaignId);
  const live = old && state.jobs.some(j => j.campaignId === old.id && ['sent', 'published', 'deleted'].includes(j.status));
  const sample = draft.adEnd ? draft : { ...draft, adEnd: postAt + (30 + (draft.reminderDeleteAfter ?? 30)) * MINUTE };
  const { captions, times, templates } = live ? prepareLiveDraft(draft, old) : prepareDraft(sample, postAt);
  const match = draft.matches[0];
  const sourceKey = reminderImageSourceKey(draft);
  const photoCacheValid = !rerollInternetImages && draft.reminderPhotoIds?.length === captions.length &&
    draft.reminderPhotoIds.every(Boolean) && draft.reminderPhotoMatch === match &&
    draft.reminderPhotoTemplateId === sourceKey && draft.reminderPhotoStyleVersion === CARD_STYLE_VERSION;
  let internetImages = null;
  let manualImages = null;
  if (!photoCacheValid) {
    if (draft.imageSource === 'internet') {
      try {
        const excludedSourceUrls = rerollInternetImages
          ? [...new Set([...(draft.rejectedReminderPhotoSourceUrls || []), ...(draft.reminderPhotoSourceUrls || [])])]
          : [];
        const found = await getInternetMatchBackgrounds(match, sportIconForMatch(match, draft.sportIcon, draft.sourceText), captions.length, {
          context: draft.sourceText,
          excludedSourceUrls,
          fallbackMatches: draft.matches.slice(1).map(other => ({
            match: other, sportIcon: sportIconForMatch(other, draft.sportIcon, draft.sourceText)
          }))
        });
        internetImages = repeatAtMostTwice(found, captions.length);
      } catch (error) {
        return replyDraftInfo(`${error.message}\n\nМожно загрузить свои фото в этот черновик — от одного до ${captions.length}.`, {
          reply_markup: { inline_keyboard: [
            [{ text: '📤 Загрузить свои фото', callback_data: 'source:manual' }],
            [{ text: '← К черновику', callback_data: 'nav:back' }]
          ] }
        });
      }
    } else if (draft.imageSource === 'manual') {
      if (!draft.manualReminderPhotoIds?.length) return replyDraftInfo('Для предпросмотра напоминаний сначала загрузите хотя бы одно своё фото.', {
        reply_markup: { inline_keyboard: [
          [{ text: '📤 Загрузить свои фото', callback_data: 'source:manual' }],
          [{ text: '← К черновику', callback_data: 'nav:back' }]
        ] }
      });
      manualImages = distributeManualPhotos(draft.manualReminderPhotoIds, captions.length);
    } else throw new Error('Выберите свои фото или поиск в интернете');
  }
  await replyDraftInfo(`Превью рекламы и напоминания:\n${draftSummary(draft)}${draft.postAt && draft.adEnd ? `\nНапоминаний: ${times.length}; первое ${formatMoscow(times[0])} МСК` : '\nРасписание задаётся через «Отложить».'}`);
  if (draft.photoId) await trackPreviewMessage(await telegram('sendRichMessage', { chat_id: currentUserId(),
    rich_message: richWithQuotedPhoto(entitiesToRichHtml(draft.sourceText, draft.sourceEntities), draft.photoId),
    reply_markup: postKeyboard(draft) }));
  else await trackPreviewMessage(await telegram('sendMessage', { chat_id: currentUserId(), text: draft.sourceText,
    entities: draft.sourceEntities?.length ? draft.sourceEntities : undefined, reply_markup: postKeyboard(draft) }));
  const button = postButtons(draft)[0];
  const photoIds = photoCacheValid ? [...draft.reminderPhotoIds] : manualImages ? [...manualImages] : [];
  const previewCaption = index => reminderCaptionFor({ ...draft, captions,
    reminderPhotoCredits: photoCacheValid ? draft.reminderPhotoCredits : [] }, index);
  const photoIdBySource = new Map();
  for (let index = 0; index < captions.length; index++) {
    let photoId = photoIds[index];
    if (!photoId && internetImages?.[index]) photoId = photoIdBySource.get(internetImages[index].sourceUrl);
    if (photoId) await trackPreviewMessage(await telegram('sendRichMessage', { chat_id: currentUserId(),
      rich_message: reminderRichMessage(previewCaption(index), photoId),
      reply_markup: { inline_keyboard: [[button]] } }));
    else {
      const png = internetImages?.[index]?.image;
      if (!png) throw new Error('Картинка для напоминания не подготовлена');
      const sent = await sendGeneratedRichPhoto(currentUserId(), png, previewCaption(index), button);
      await trackPreviewMessage(sent);
      photoId = richPhotoFileId(sent);
      if (!photoId) throw new Error('Telegram не вернул ID картинки напоминания');
      if (internetImages) photoIdBySource.set(internetImages[index].sourceUrl, photoId);
    }
    photoIds[index] = photoId;
    if (index + 1 < captions.length) await new Promise(resolve => setTimeout(resolve, 1050));
  }
  if (!photoCacheValid) {
    draft.reminderPhotoCredits = [];
    if (rerollInternetImages) draft.rejectedReminderPhotoSourceUrls = [...new Set([
      ...(draft.rejectedReminderPhotoSourceUrls || []), ...(draft.reminderPhotoSourceUrls || [])
    ])].slice(-200);
    draft.reminderPhotoIds = photoIds;
    draft.reminderPhotoId = photoIds[0];
    draft.reminderPhotoSourceUrls = internetImages?.map(item => item.sourceUrl) || [];
    draft.reminderPhotoSourceUrl = internetImages?.[0]?.sourceUrl || null;
    draft.reminderPhotoMatch = match;
    draft.reminderPhotoTemplateId = sourceKey;
    draft.reminderPhotoStyleVersion = CARD_STYLE_VERSION;
  }
  draft.previewCaptions = captions;
  draft.selectedReminderTemplates = templates;
  draft.previewedAt = Date.now();
  await save();
  await showDraft();
}

function prepareLiveDraft(draft, old) {
  const channels = selectedChannels(draft);
  assertCampaignAccess(old);
  if (JSON.stringify([...channels].sort()) !== JSON.stringify([...old.channelIds].sort())) throw new Error('После выхода поста состав каналов менять нельзя');
  if (draft.postAt !== old.postAt || draft.adEnd !== old.adEnd) throw new Error('Время рекламы нельзя изменить после выхода напоминания');
  if (!draft.sourceText) throw new Error('Пришлите текст рекламы');
  if (postButtons(draft).some(button => !BUTTON_URL.test(button.url))) throw new Error('Проверьте ссылки кнопок');
  if (!draft.matches?.length || !draft.odds || !postButtons(draft).length) throw new Error('Для напоминаний нужны матч, коэффициент и кнопка');
  const templateSport = hasMixedMatchSports(draft.matches, draft.sourceText) ? 'mixed' : draft.sportIcon;
  const templates = (old.templates || []).every(template => compatibleReminderTemplates([template], templateSport).length)
    ? old.templates || []
    : selectReminderTemplates(compatibleReminderTemplates(state.templates, templateSport), old.times.length,
      template => renderTemplate(template, draft)).map(item => item.template);
  const captions = templates.map(template => renderTemplate(template, draft));
  if (captions.length !== old.times.length) throw new Error('Не найдены шаблоны исходной серии');
  validateCaptionRepetitions(captions);
  if (captions.some(c => c.length > (old.messageFormat === 'rich' ? 32768 : 1024))) throw new Error('Текст напоминания слишком длинный');
  return { captions, times: old.times, channels, templates };
}

async function syncPublishedJob(job, campaign) {
  if (!['sent', 'published'].includes(job.status) || !job.messageId || (job.syncedVersion ?? 1) >= (campaign.version || 1)) return;
  const address = { chat_id: job.chatId, message_id: job.messageId };
  try {
    if (job.kind === 'post') {
      const currentMedia = campaign.mainMediaType === 'video' ? campaign.videoId : campaign.photoId;
      if (campaign.postManaged && campaign.photoId) await telegram('editMessageText', { ...address,
        rich_message: richWithQuotedPhoto(entitiesToRichHtml(campaign.sourceText, campaign.sourceEntities), campaign.photoId),
        reply_markup: postKeyboard(campaign) || { inline_keyboard: [] } });
      else if (!campaign.mainMediaType) await telegram('editMessageText', { ...address, text: campaign.sourceText,
        entities: campaign.sourceEntities?.length ? campaign.sourceEntities : undefined, reply_markup: postKeyboard(campaign) || { inline_keyboard: [] } });
      else if (job.mediaId !== currentMedia) await telegram('editMessageMedia', { ...address,
        media: { type: campaign.mainMediaType, media: currentMedia, caption: campaign.sourceText || '',
          caption_entities: campaign.sourceEntities?.length ? campaign.sourceEntities : undefined }, reply_markup: postKeyboard(campaign) || { inline_keyboard: [] } });
      else await telegram('editMessageCaption', { ...address, caption: campaign.sourceText || '',
        caption_entities: campaign.sourceEntities?.length ? campaign.sourceEntities : undefined, reply_markup: postKeyboard(campaign) || { inline_keyboard: [] } });
      job.mediaId = currentMedia || null;
    } else {
      const keyboard = { inline_keyboard: [[reminderButtonFor(campaign, job.index)]] };
      const reminderPhotoId = reminderPhotoFor(campaign, job.index);
      if (campaign.messageFormat === 'rich') await telegram('editMessageText', { ...address,
        rich_message: reminderRichMessage(reminderCaptionFor(campaign, job.index), reminderPhotoId), reply_markup: keyboard });
      else if (job.mediaId !== reminderPhotoId) await telegram('editMessageMedia', { ...address,
        media: { type: 'photo', media: reminderPhotoId, caption: reminderCaptionFor(campaign, job.index), parse_mode: 'HTML' }, reply_markup: keyboard });
      else await telegram('editMessageCaption', { ...address, caption: reminderCaptionFor(campaign, job.index), parse_mode: 'HTML', reply_markup: keyboard });
      job.mediaId = reminderPhotoId;
    }
    job.syncedVersion = campaign.version;
    job.syncError = null;
  } catch (error) {
    if (/message is not modified/i.test(error.message)) {
      job.syncedVersion = campaign.version;
      job.syncError = null;
    } else {
      job.syncError = error.message;
      job.syncRetryAt = Date.now() + (error.retryAfter || 60) * 1000;
      console.error(error);
    }
  }
  await save();
}

async function saveCampaignEdits() {
  const draft = state.draft;
  const campaign = state.campaigns.find(c => c.id === draft?.editingCampaignId);
  if (!campaign) throw new Error('Исходный пост не найден');
  assertCampaignAccess(campaign);
  const jobs = state.jobs.filter(j => j.campaignId === campaign.id);
  const live = jobs.some(j => ['sent', 'published', 'deleted'].includes(j.status));
  if (!live) return publish('plan');
  if (!campaign.times?.length && (draft.postAt !== campaign.postAt || JSON.stringify(selectedChannels(draft).sort()) !== JSON.stringify([...campaign.channelIds].sort()))) {
    throw new Error('После публикации поста нельзя менять его время и состав каналов');
  }
  const { captions, templates } = campaign.times?.length ? prepareLiveDraft(draft, campaign) : prepareDraft(draft, campaign.postAt);
  const buttons = postButtons(draft);
  const contentChanged = JSON.stringify([campaign.sourceText, campaign.photoId, campaign.reminderPhotoIds, campaign.reminderPhotoId, campaign.reminderPhotoCredits, postButtons(campaign), campaign.captions]) !==
    JSON.stringify([draft.sourceText, draft.photoId, draft.reminderPhotoIds, draft.reminderPhotoId, draft.reminderPhotoCredits, buttons, captions]);
  if (contentChanged && (!draft.previewedAt || draft.previewedAt < draft.editedAt || JSON.stringify(captions) !== JSON.stringify(draft.previewCaptions))) throw new Error('Сначала нажмите «Предпросмотр»');
  Object.assign(campaign, { sourceText: draft.sourceText, sourceEntities: draft.sourceEntities || [], photoId: draft.photoId,
    reminderPhotoId: draft.reminderPhotoId, reminderPhotoIds: draft.reminderPhotoIds,
    reminderPhotoCredits: draft.reminderPhotoCredits || [],
    reminderPhotoSourceUrls: draft.reminderPhotoSourceUrls || [], reminderPhotoMatch: draft.reminderPhotoMatch,
    reminderPhotoTemplateId: draft.reminderPhotoTemplateId, reminderPhotoStyleVersion: draft.reminderPhotoStyleVersion,
    imageSource: draft.imageSource || 'manual', manualReminderPhotoIds: draft.manualReminderPhotoIds || [],
    reminderPhotoSourceUrl: draft.reminderPhotoSourceUrl || null,
    videoId: draft.videoId, buttons, url: buttons[0]?.url || null, buttonText: buttons[0]?.text || 'ПРОГНОЗ',
    matches: draft.matches, odds: draft.odds, captions, templates,
    reminderDeleteAfter: draft.reminderDeleteAfter === undefined ? 30 : draft.reminderDeleteAfter, postDeleteAfter: draft.postDeleteAfter ?? null });
  if (contentChanged) campaign.version = (campaign.version || 1) + 1;
  setPostDeleteAfter(campaign, jobs, campaign.postDeleteAfter);
  for (const job of jobs) {
    if (job.kind !== 'reminder' || reminderIsRemoved(campaign, job.index) || !['sent', 'published'].includes(job.status)) continue;
    const minutes = reminderDeleteAfterFor(campaign, job.index);
    job.deleteAt = minutes === null ? null : (job.publishedAt || job.at) + minutes * MINUTE;
    job.status = job.deleteAt ? 'sent' : 'published';
  }
  state.draft = null;
  state.mode = null;
  await save();
  await clearDraftInfoMessages();
  await clearPreviewMessages();
  if (contentChanged) for (const job of jobs) await syncPublishedJob(job, campaign);
  const failures = jobs.filter(j => j.syncError && ['sent', 'published'].includes(j.status));
  await briefNotice(`Изменения поста ${campaign.id} сохранены для ${campaign.channelIds.length} каналов.${failures.length ? ` Не удалось сразу обновить ${failures.length} сообщений; повторю автоматически. Ошибка: ${failures[0].syncError}` : ''}`, { reply_markup: MENU });
  if (state.planDay) await showSavedContentPlan();
}

async function publish(mode = 'plan') {
  const draft = state.draft;
  if (!draft) throw new Error('Нет черновика напоминаний');
  const postAt = mode === 'now' ? Date.now() : draft.postAt;
  const { captions, times, channels, templates } = prepareDraft(draft, postAt);
  await validateChannelAccess(channels);
  if (draft.remindersEnabled !== false) {
    if (!draft.previewedAt || draft.previewedAt < draft.editedAt) throw new Error('Сначала нажмите «Превью» после ввода времени');
    if (JSON.stringify(captions) !== JSON.stringify(draft.previewCaptions)) throw new Error('Шаблоны изменились после предпросмотра. Повторите /preview');
    if (draft.reminderPhotoIds?.length !== captions.length || !draft.reminderPhotoIds.every(Boolean) || draft.reminderPhotoMatch !== draft.matches[0] || draft.reminderPhotoTemplateId !== reminderImageSourceKey(draft) || draft.reminderPhotoStyleVersion !== CARD_STYLE_VERSION) throw new Error('Сначала нажмите «Превью», чтобы подготовить картинки всех напоминаний');
  }
  const id = String(Date.now());
  const editingId = draft.editingCampaignId;
  const previousCampaign = editingId ? state.campaigns.find(c => c.id === editingId) : null;
  if (editingId) assertCampaignAccess(previousCampaign);
  const postManaged = editingId ? previousCampaign?.postManaged === true : true;
  if (postManaged && mode !== 'now' && postAt < Date.now() + MINUTE) throw new Error('Время выхода рекламы должно быть хотя бы через минуту. Измените его и повторите предпросмотр.');
  if (editingId) {
    const oldJobs = state.jobs.filter(j => j.campaignId === editingId);
    if (!oldJobs.length || oldJobs.some(j => !['pending', 'canceled'].includes(j.status))) throw new Error('Исходный пост уже начал выходить; редактирование расписания недоступно');
    state.jobs = state.jobs.filter(j => j.campaignId !== editingId);
    state.campaigns = state.campaigns.filter(c => c.id !== editingId);
  }
  const finalId = editingId || id;
  const primaryButton = postButtons(draft)[0];
  const scheduleShift = previousCampaign ? postAt - previousCampaign.postAt : 0;
  const reminderOverrides = Object.fromEntries(Object.entries(previousCampaign?.reminderOverrides || {}).map(([index, override]) => [index,
    override.at === undefined ? { ...override } : { ...override, at: override.at + scheduleShift }]));
  const campaign = { id: finalId, createdAt: Date.now(), sourceText: draft.sourceText, sourceEntities: draft.sourceEntities || [],
    matches: draft.matches || [], odds: draft.odds, photoId: draft.photoId, reminderPhotoId: draft.reminderPhotoId,
    reminderPhotoIds: draft.reminderPhotoIds, reminderPhotoSourceUrls: draft.reminderPhotoSourceUrls || [],
    reminderPhotoCredits: draft.reminderPhotoCredits || [],
    reminderPhotoMatch: draft.reminderPhotoMatch, reminderPhotoTemplateId: draft.reminderPhotoTemplateId,
    reminderPhotoStyleVersion: draft.reminderPhotoStyleVersion, reminderPhotoSourceUrl: draft.reminderPhotoSourceUrl || null,
    videoId: draft.videoId,
    imageSource: draft.imageSource || 'manual', manualReminderPhotoIds: draft.manualReminderPhotoIds || [],
    mainMediaType: draft.mainMediaType, networkKeys: draft.networkKeys, channelIds: channels, postManaged,
    postAt, postDeleteAfter: draft.postDeleteAfter || null, buttons: postButtons(draft),
    url: primaryButton?.url || null, buttonText: primaryButton?.text || 'ПРОГНОЗ', remindersEnabled: draft.remindersEnabled,
    adEnd: draft.adEnd || null, reminderDeleteAfter: draft.reminderDeleteAfter === undefined ? 30 : draft.reminderDeleteAfter, captions, times, templates,
    reminderOverrides,
    messageFormat: 'rich', version: 1 };
  state.jobs.push(...buildCampaignJobs(campaign));
  state.campaigns.push(campaign);
  state.draft = null;
  state.mode = null;
  await save();
  await clearDraftInfoMessages();
  await clearPreviewMessages();
  if (mode === 'now') await processJobs(finalId);
  const postJobs = state.jobs.filter(job => job.campaignId === finalId && job.kind === 'post');
  const posted = mode === 'now' && postJobs.every(job => ['sent', 'published', 'deleted'].includes(job.status));
  await briefNotice(`${mode === 'now' ? posted ? 'Пост опубликован' : 'Пост поставлен на немедленную публикацию' : captions.length ? 'Серия отложена' : 'Пост отложен'}: ${formatMoscow(postAt)} МСК.${captions.length ? ` Напоминаний на канал: ${captions.length}, первое ${formatMoscow(times[0])} МСК.` : ' Без напоминаний.'} Каналов: ${channels.length}.`, { reply_markup: MENU });
  if (editingId && state.planDay) await showSavedContentPlan();
}

const PLAN_PAGE_SIZE = 18;
const PLAN_STATUS = { external: '📣', pending: '🕓', sent: '✅', deleted: '🗑', canceled: '🚫', failed: '⚠️' };

async function showPlanNetworks() {
  const rows = Object.entries(NETWORKS).flatMap(([key, ids]) => {
    const count = ids.filter(id => allowedChannels().has(id)).length;
    return count ? [[{ text: `Сетка ${key} · ${count} каналов`, callback_data: `plan:network:${key}` }]] : [];
  });
  if (!rows.length) throw new Error('Нет доступных сеток');
  await reply('📅 Контент-план\nВыберите сетку. Внутри будут показаны реклама и напоминания этого бота в каналах, где вы администратор.', { reply_markup: { inline_keyboard: rows } });
}

function dayCaption(day) {
  return new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Moscow' })
    .format(Date.parse(`${day}T12:00:00+03:00`));
}

async function showContentPlan(day = moscowDay(Date.now()), page = 0, calendar = false) {
  if (!planChannels().size) return showPlanNetworks();
  const visible = visibleCampaignsAndJobs(state.campaigns, state.jobs, planChannels());
  const entries = contentPlanEntries(visible.campaigns, visible.jobs, day);
  const pages = Math.max(1, Math.ceil(entries.length / PLAN_PAGE_SIZE));
  page = Math.max(0, Math.min(page, pages - 1));
  state.planDay = day;
  state.planPage = page;
  state.planCalendar = calendar;
  await save();
  const rows = entries.slice(page * PLAN_PAGE_SIZE, (page + 1) * PLAN_PAGE_SIZE).map(entry => [{
    text: `${formatMoscow(entry.at).slice(11)} ${PLAN_STATUS[entry.status] || '•'} ${entry.kind === 'ad' ? 'РЕКЛАМА · ' : ''}${planEntryTitle(entry)} ${entry.kind === 'ad' ? (entry.campaign.postManaged ? entry.campaign.postDeleteAfter ? `🗑${deletionLabel(entry.campaign.postDeleteAfter)}` : 'бот' : 'Posted') : reminderDeleteAfterFor(entry.campaign, entry.index) === null ? 'без удаления' : `🗑${deletionLabel(reminderDeleteAfterFor(entry.campaign, entry.index))}`}`,
    callback_data: `plan:item:${entry.campaign.id}:${entry.kind === 'ad' ? 'a' : entry.index}:${day}:${page}`
  }]);
  if (pages > 1) rows.push([
    ...(page ? [{ text: '← Ранее', callback_data: `plan:day:${day}:${page - 1}` }] : []),
    { text: `${page + 1}/${pages}`, callback_data: `plan:day:${day}:${page}` },
    ...(page + 1 < pages ? [{ text: 'Далее →', callback_data: `plan:day:${day}:${page + 1}` }] : [])
  ]);
  rows.push([
    { text: `← ${dayCaption(shiftMoscowDay(day, -1)).slice(0, 12)}`, callback_data: `plan:day:${shiftMoscowDay(day, -1)}:0` },
    { text: day === moscowDay(Date.now()) ? 'Сегодня' : '↩ Сегодня', callback_data: `plan:day:${moscowDay(Date.now())}:0` },
    { text: `${dayCaption(shiftMoscowDay(day, 1)).slice(0, 12)} →`, callback_data: `plan:day:${shiftMoscowDay(day, 1)}:0` }
  ]);
  rows.push([{ text: calendar ? '↑ Свернуть календарь' : '↓ Развернуть календарь', callback_data: `plan:calendar:${day}:${calendar ? 0 : 1}` }]);
  if (calendar) {
    for (let offset = -10; offset <= 10; offset += 3) {
      rows.push([offset, offset + 1, offset + 2].filter(n => n <= 10).map(n => {
        const choice = shiftMoscowDay(day, n);
        return { text: `${n === 0 ? '✅ ' : ''}${choice.slice(5).replace('-', '.')}`, callback_data: `plan:day:${choice}:0` };
      }));
    }
  }
  rows.push([{ text: '← Выбрать сетку', callback_data: 'plan:list' }]);
  await reply(`📅 Сетка ${state.planNetwork} · ${dayCaption(day)} · МСК\n${entries.length ? `${entries.length} записей. Реклама новых серий публикуется ботом; старые серии помечены Posted.` : 'На этот день записей нет.'}`, {
    reply_markup: { inline_keyboard: rows }
  });
}

function showSavedContentPlan() {
  return showContentPlan(state.planDay || moscowDay(Date.now()), state.planPage || 0, Boolean(state.planCalendar));
}

function reminderJobs(campaign, index) {
  return state.jobs.filter(job => job.campaignId === campaign.id && job.kind === 'reminder' && job.index === index && campaign.channelIds.includes(job.chatId));
}

async function showPlanItem(id, item) {
  const campaign = visibleCampaign(id, true);
  const ad = item === 'a';
  const index = ad ? null : Number(item);
  if (!ad && (!Number.isInteger(index) || index < 0 || index >= (campaign.times?.length || 0) || reminderIsRemoved(campaign, index))) throw new Error('Напоминание не найдено');
  const at = ad ? campaign.postAt : reminderTimeFor(campaign, index);
  const jobs = ad ? state.jobs.filter(job => job.campaignId === id && job.kind === 'post' && campaign.channelIds.includes(job.chatId)) : reminderJobs(campaign, index);
  const networks = networkLabelForChannels(campaign.channelIds);
  if (ad) await sendOriginal(currentUserId(), campaign);
  else {
    const caption = reminderCaptionFor(campaign, index);
    const photoId = reminderPhotoFor(campaign, index);
    const keyboard = { inline_keyboard: [[reminderButtonFor(campaign, index)]] };
    if (photoId && campaign.messageFormat === 'rich') await telegram('sendRichMessage', { chat_id: currentUserId(),
      rich_message: reminderRichMessage(caption, photoId), reply_markup: keyboard });
    else if (photoId) await telegram('sendPhoto', { chat_id: currentUserId(), photo: photoId,
      caption, parse_mode: 'HTML', reply_markup: keyboard });
    else await telegram('sendMessage', { chat_id: currentUserId(), text: caption, parse_mode: 'HTML', reply_markup: keyboard });
  }
  await reply(short(`${ad ? campaign.postManaged ? '📣 Реклама' : '📣 Реклама (Posted)' : '⏰ Напоминание'}\n${formatMoscow(at)} МСК\nКаналы: ${networks}\n${ad ? campaign.postManaged ? `Удаление рекламы: ${campaign.postDeleteAfter ? `через ${deletionLabel(campaign.postDeleteAfter)}` : 'не удалять'}` : 'Удаление рекламы: в Posted' : `Удаление: ${reminderDeleteAfterFor(campaign, index) === null ? 'не удалять' : `через ${deletionLabel(reminderDeleteAfterFor(campaign, index))}`}`}`), {
    reply_markup: { inline_keyboard: [
      ...(ad ? [[{ text: campaign.times?.length ? '✏️ Изменить серию' : '✏️ Изменить пост', callback_data: `plan:edit:${id}` }, { text: '🕓 Перенести', callback_data: `plan:move:${id}` }]] :
        [[{ text: '✏️ Изменить это напоминание', callback_data: `rem:edit:${id}:${index}` }]]),
      ...(ad && campaign.postManaged && jobs.some(job => ['pending', 'sent', 'published'].includes(job.status)) ?
        [[{ text: `⏱ Удаление поста: ${campaign.postDeleteAfter ? deletionLabel(campaign.postDeleteAfter) : 'не удалять'}`, callback_data: `post:delete:${id}` }]] : []),
      ...(ad && campaign.postManaged && state.jobs.filter(job => job.campaignId === id).every(job => ['pending', 'canceled'].includes(job.status)) ?
        [[{ text: '🚀 Опубликовать сейчас', callback_data: `post:now:${id}` }]] : []),
      [{ text: '📋 Дублировать в другую сетку', callback_data: `dup:start:${id}:${item}` }],
      [ad ? { text: campaign.times?.length ? '🗑 Удалить серию' : '🗑 Удалить пост', callback_data: `plan:delete:${id}` } : { text: '🗑 Удалить эту напоминалку', callback_data: `rem:remove:${id}:${index}` }],
      [{ text: '← К списку', callback_data: 'plan:return' }]
    ] }
  });
}

async function showCopyEditor() {
  const copy = state.copyItem;
  if (!copy) throw new Error('Копия не выбрана. Откройте пост или напоминание в контент-плане.');
  visibleCampaign(copy.sourceId);
  const kind = copy.item === 'a' ? 'поста' : 'напоминания';
  await reply(`📋 Копия ${kind}\n${copy.networkKey ? `Сетка: ${copy.networkKey}` : 'Сетка: выберите'}\nВыход: ${copy.at ? `${formatMoscow(copy.at)} МСК` : 'не задан'}\nУдаление: ${copy.deleteAfter === null ? 'не удалять' : `через ${deletionLabel(copy.deleteAfter)}`}\nКопия будет независимой: изменение исходной записи её не затронет.`, {
    reply_markup: { inline_keyboard: [
      [{ text: `📍 ${copy.networkKey ? `Сетка ${copy.networkKey}` : 'Выбрать сетку'}`, callback_data: 'dup:network' }],
      [{ text: '🕓 Изменить время', callback_data: 'dup:time' }, { text: '⏱ Изменить удаление', callback_data: 'dup:delete' }],
      [{ text: '👀 Превью', callback_data: 'dup:preview' }],
      [{ text: '🕓 Отложить копию', callback_data: 'dup:schedule' }, { text: '🚀 Опубликовать сейчас', callback_data: 'dup:now' }],
      [{ text: '← Отмена', callback_data: 'dup:cancel' }]
    ] }
  });
}

async function showCopyNetworks() {
  const copy = state.copyItem;
  if (!copy) throw new Error('Копия не выбрана');
  const source = visibleCampaign(copy.sourceId);
  const available = Object.entries(NETWORKS).map(([key, ids]) => ({ key, ids: ids.filter(id => allowedChannels().has(id)) }))
    .filter(option => option.ids.length);
  const choices = available.filter(option => !option.ids.some(id => source.channelIds.includes(id)));
  if (!choices.length) throw new Error('Другой доступной сетки для этого поста нет');
  return reply('Выберите сетку, в которую отправить копию:', { reply_markup: { inline_keyboard: [
    ...choices.map(option => [{ text: `Сетка ${option.key} · ${option.ids.length} каналов`, callback_data: `dup:choose:${option.key}` }]),
    [{ text: '← К копии', callback_data: 'dup:edit' }]
  ] } });
}

async function previewItemCopy() {
  const copy = state.copyItem;
  const source = visibleCampaign(copy?.sourceId);
  if (copy.item === 'a') await trackPreviewMessage(await sendOriginal(currentUserId(), { ...source, postManaged: true }), 'copy');
  else {
    const index = Number(copy.item);
    const photoId = reminderPhotoFor(source, index);
    const caption = reminderCaptionFor(source, index);
    const keyboard = { inline_keyboard: [[reminderButtonFor(source, index)]] };
    if (source.messageFormat === 'rich' && photoId) await trackPreviewMessage(await telegram('sendRichMessage', { chat_id: currentUserId(),
      rich_message: reminderRichMessage(caption, photoId), reply_markup: keyboard }), 'copy');
    else if (photoId) await trackPreviewMessage(await telegram('sendPhoto', { chat_id: currentUserId(), photo: photoId,
      caption, parse_mode: 'HTML', reply_markup: keyboard }), 'copy');
    else throw new Error('У напоминания нет фото для копирования');
  }
  return showCopyEditor();
}

async function publishItemCopy(now = false) {
  const copy = state.copyItem;
  if (!copy?.networkKey) throw new Error('Сначала выберите сетку для копии');
  if (!now && (!copy.at || copy.at < Date.now() + MINUTE)) throw new Error('Укажите будущее время выхода копии хотя бы через минуту');
  const source = visibleCampaign(copy.sourceId);
  const channelIds = NETWORKS[copy.networkKey]?.filter(id => allowedChannels().has(id)) || [];
  if (!channelIds.length) throw new Error('Нет прав администратора в выбранной сетке');
  await validateChannelAccess(channelIds);
  const at = now ? Date.now() : copy.at;
  const campaign = buildItemCopyCampaign(source, copy.item, { id: `${Date.now()}-${randomUUID().slice(0, 6)}`,
    at, channelIds, networkKey: copy.networkKey, deleteAfter: copy.deleteAfter });
  state.campaigns.push(campaign);
  state.jobs.push(...buildCampaignJobs(campaign));
  state.copyItem = null;
  state.mode = null;
  state.planNetwork = copy.networkKey;
  state.planDay = moscowDay(at);
  state.planPage = 0;
  state.planCalendar = false;
  await save();
  await clearPreviewMessages('copy');
  if (now) await processJobs(campaign.id);
  const jobs = state.jobs.filter(job => job.campaignId === campaign.id);
  const sent = now && jobs.every(job => ['sent', 'published', 'deleted'].includes(job.status));
  await briefNotice(`${sent ? 'Копия опубликована' : now ? 'Копия поставлена на немедленную публикацию' : 'Копия отложена'} в сетку ${copy.networkKey}: ${formatMoscow(at)} МСК, ${channelIds.length} каналов.`);
  return showSavedContentPlan();
}

async function showReminderEditor(id, index) {
  const campaign = visibleCampaign(id, true);
  if (!campaign || !Number.isInteger(index) || index < 0 || index >= campaign.times.length || reminderIsRemoved(campaign, index)) throw new Error('Напоминание не найдено');
  await reply(`✏️ Напоминание ${index + 1} · ${formatMoscow(reminderTimeFor(campaign, index))} МСК\nВыберите, что изменить. Изменение применится к этому напоминанию во всех выбранных каналах.`, {
    reply_markup: { inline_keyboard: [
      [{ text: '📝 Текст', callback_data: `rem:field:${id}:${index}:text` }, { text: '🖼 Фото', callback_data: `rem:field:${id}:${index}:photo` }],
      [{ text: '🔗 Кнопка', callback_data: `rem:field:${id}:${index}:button` }, { text: '🕓 Время', callback_data: `rem:field:${id}:${index}:time` }],
      [{ text: `⏱ Удаление: ${reminderDeleteAfterFor(campaign, index) === null ? 'не удалять' : deletionLabel(reminderDeleteAfterFor(campaign, index))}`, callback_data: `rem:field:${id}:${index}:delete` }],
      [{ text: '🗑 Удалить эту напоминалку', callback_data: `rem:remove:${id}:${index}` }],
      [{ text: '← К напоминанию', callback_data: `plan:item:${id}:${index}` }]
    ] }
  });
}

async function applyReminderEdit(campaign, index, patch, syncContent = false) {
  assertCampaignAccess(campaign);
  const jobs = reminderJobs(campaign, index);
  setReminderOverride(campaign, index, patch);
  for (const job of jobs) {
    if (patch.at !== undefined && job.status === 'pending') job.at = patch.at;
    if (patch.deleteAfter !== undefined && ['sent', 'published'].includes(job.status)) {
      job.deleteAt = patch.deleteAfter === null ? null : (job.publishedAt || job.at) + patch.deleteAfter * MINUTE;
      job.status = patch.deleteAfter === null ? 'published' : 'sent';
    }
    if (syncContent && ['sent', 'published'].includes(job.status)) {
      job.syncedVersion = (campaign.version || 1) - 1;
      job.syncRetryAt = null;
    }
  }
  await save();
  if (syncContent) for (const job of jobs) await syncPublishedJob(job, campaign);
  const failures = jobs.filter(job => job.syncError && ['sent', 'published'].includes(job.status));
  if (failures.length) await replyError(`Изменение сохранено, но ${failures.length} опубликованных сообщений пока не обновились. Повторю автоматически: ${failures[0].syncError}`);
}

async function showCampaign(id) {
  const campaign = visibleCampaign(id, true);
  const jobs = state.jobs.filter(j => j.campaignId === id && campaign.channelIds.includes(j.chatId));
  const pending = jobs.filter(j => j.status === 'pending').length;
  const sent = jobs.filter(j => ['sent', 'published'].includes(j.status)).length;
  const remaining = (campaign.times || []).map((_, index) => index).filter(index => !reminderIsRemoved(campaign, index));
  await reply(`Напоминания ${id}\n${campaign.matches?.join('; ')}\nКаналов: ${campaign.channelIds?.length || 0}\nНапоминаний осталось: ${remaining.length}\nПервая: ${remaining.length ? `${formatMoscow(reminderTimeFor(campaign, remaining[0]))} МСК` : 'нет'}\nУдаление рекламы: ${campaign.postManaged ? campaign.postDeleteAfter ? `через ${deletionLabel(campaign.postDeleteAfter)}` : 'не удалять' : 'в Posted'}\nУдаление напоминаний: ${campaign.reminderDeleteAfter === null ? 'не удалять' : `через ${deletionLabel(campaign.reminderDeleteAfter ?? 30)}`}\nВ очереди: ${pending}; опубликовано: ${sent}`, {
    reply_markup: { inline_keyboard: [
      [{ text: '✏️ Изменить', callback_data: `plan:edit:${id}` }, { text: '🕓 Перенести', callback_data: `plan:move:${id}` }],
      [{ text: '🗑 Удалить', callback_data: `plan:delete:${id}` }],
      [{ text: '← Контент-план', callback_data: 'plan:return' }]
    ] }
  });
}

function draftFromCampaign(campaign, editing = false) {
  return { sourceText: campaign.sourceText, sourceEntities: campaign.sourceEntities || [],
    photoId: campaign.photoId, reminderPhotoId: campaign.reminderPhotoId,
    reminderPhotoCredits: campaign.reminderPhotoCredits || [],
    reminderPhotoIds: campaign.reminderPhotoIds, reminderPhotoSourceUrls: campaign.reminderPhotoSourceUrls || [],
    reminderPhotoMatch: campaign.reminderPhotoMatch, reminderPhotoTemplateId: campaign.reminderPhotoTemplateId,
    reminderPhotoStyleVersion: campaign.reminderPhotoStyleVersion,
    ...imageSettingsFor(campaign),
    reminderPhotoSourceUrl: campaign.reminderPhotoSourceUrl || null,
    videoId: campaign.videoId, mainMediaType: campaign.mainMediaType,
    matches: campaign.matches || [], odds: campaign.odds,
    sportIcon: sportIcon(campaign.sourceText || ''), networkKeys: campaign.networkKeys || [NETWORKS['1'].length ? '1' : '2'],
    channelIds: campaign.channelIds || [...new Set((campaign.networkKeys || []).flatMap(key => NETWORKS[key] || []))],
    postAt: editing ? campaign.postAt : null, postDeleteAfter: campaign.postDeleteAfter, url: campaign.url,
    buttonText: campaign.buttonText, buttons: [...postButtons(campaign)], remindersEnabled: campaign.remindersEnabled,
    adEnd: editing ? campaign.adEnd : null, reminderDeleteAfter: campaign.reminderDeleteAfter === undefined ? 30 : campaign.reminderDeleteAfter,
    editingCampaignId: editing ? campaign.id : null, editedAt: Date.now() };
}

async function cancelCampaign(id) {
  const campaign = await writableCampaign(id);
  for (const job of state.jobs.filter(j => j.campaignId === campaign.id)) {
    if (job.status === 'pending') job.status = 'canceled';
    if (job.status === 'sent' || job.status === 'published') {
      job.status = 'sent';
      job.deleteAt = Date.now();
    }
  }
  await save();
  await briefNotice(`Серия ${campaign.id} удалена из очереди во всех каналах. Уже опубликованные сообщения будут удалены.`);
  if (state.planDay) await showSavedContentPlan();
}

async function promptMode(mode, prompt, extra = {}) {
  if (!state.draft) throw new Error('Сначала пришлите текст или фото поста');
  state.mode = mode;
  await save();
  await sendPrompt(prompt, extra);
}

async function showCopyChannels() {
  if (!state.draft) throw new Error('Черновик не найден');
  assertChannelSelectionEditable(state.draft);
  const all = CONFIGURED_CHANNELS.filter(id => allowedChannels().has(id));
  await cacheChannelTitles(all);
  const chosen = new Set(selectedChannels(state.draft));
  const rows = all.map(id => [{ text: `${chosen.has(id) ? '☑️' : '▫️'} ${CHANNEL_TITLES.get(id)}`, callback_data: `copy:toggle:${id}` }]);
  rows.push([{ text: '✅ Готово', callback_data: 'copy:done' }]);
  await reply('Выберите каналы для напоминаний. Во всех выбранных каналах будет одно расписание и таймер удаления.', { reply_markup: { inline_keyboard: rows } });
}

async function handleCallback(callback) {
  try { await telegram('answerCallbackQuery', { callback_query_id: callback.id }); }
  catch (error) {
    if (/query is too old|query ID is invalid/i.test(error.message)) return;
    throw error;
  }
  const data = callback.data || '';
  if (data === 'nav:back') {
    state.mode = null;
    state.modeCampaignId = null;
    state.editTemplateIndex = null;
    state.editReminder = null;
    await save();
    return state.draft ? showDraft() : showMenu();
  }
  if (data.startsWith('template:')) {
    const [, action, value, fingerprint] = data.split(':');
    if (action === 'list') {
      state.mode = null;
      state.editTemplateIndex = null;
      await save();
      return showTextTemplates(Number(value) || 0);
    }
    if (action === 'view') {
      state.mode = null;
      state.editTemplateIndex = null;
      await save();
      return showTextTemplate(Number(value));
    }
    if (action === 'add') {
      state.mode = 'template_add';
      state.editTemplateIndex = null;
      await save();
      return sendPrompt('Пришлите готовую напоминалку с выделениями и премиум-эмодзи. Бот сам найдёт матч и коэффициент и подставит данные новой рекламы.', {
        reply_markup: { inline_keyboard: [[{ text: '← Отмена', callback_data: 'template:list:0' }]] }
      });
    }
    if (action === 'edit') {
      const index = Number(value);
      if (!Number.isInteger(index) || index < 0 || index >= state.templates.length) throw new Error('Шаблон не найден');
      state.mode = 'template_edit';
      state.editTemplateIndex = index;
      await save();
      return sendPrompt(`Пришлите новую готовую версию шаблона №${index + 1} с нужным оформлением.`, {
        reply_markup: { inline_keyboard: [[{ text: '← Отмена', callback_data: `template:view:${index}` }]] }
      });
    }
    if (action === 'askdelete' || action === 'delete') {
      const index = Number(value);
      const template = state.templates[index];
      if (!Number.isInteger(index) || !template || templateFingerprint(template) !== fingerprint) {
        throw new Error('Список шаблонов изменился. Откройте нужный шаблон заново.');
      }
      if (action === 'askdelete') return reply(`Удалить шаблон №${index + 1} «${templateTitle(template)}»? Уже отложенные напоминания сохранят свой текст.`, {
        reply_markup: { inline_keyboard: [
          [{ text: '🗑 Да, удалить', callback_data: `template:delete:${index}:${fingerprint}` }],
          [{ text: '← Отмена', callback_data: `template:view:${index}` }]
        ] }
      });
      const result = removeTextTemplate(state.templates, index, state.nextTemplateIndex);
      state.templates = result.templates;
      state.nextTemplateIndex = result.nextTemplateIndex;
      state.mode = null;
      state.editTemplateIndex = null;
      await save();
      await reply(`Шаблон удалён. Осталось: ${state.templates.length}.`);
      return showTextTemplates(Math.floor(index / TEXT_TEMPLATE_PAGE_SIZE));
    }
  }
  if (data.startsWith('image:')) return reply('Шаблоны картинок больше не используются. Откройте «Картинка» в черновике и загрузите свои фото.', { reply_markup: { inline_keyboard: [[{ text: '← К черновику', callback_data: 'nav:back' }]] } });
  if (data.startsWith('source:')) {
    if (!state.draft) throw new Error('Сначала создайте черновик');
    const choice = data.slice('source:'.length);
    if (!['internet', 'manual'].includes(choice)) throw new Error('Генерация изображений отключена. Выберите свои фото или поиск в интернете');
    state.draft.imageSource = choice;
    state.draft.reminderPhotoId = null;
    state.draft.reminderPhotoIds = null;
    state.draft.reminderPhotoTemplateId = null;
    state.draft.reminderPhotoSourceUrl = null;
    state.draft.reminderPhotoSourceUrls = [];
    state.draft.rejectedReminderPhotoSourceUrls = [];
    state.draft.reminderPhotoCredits = [];
    state.mode = choice === 'manual' ? 'manual_photos' : null;
    markEdited();
    await save();
    return choice === 'manual' ? promptManualPhotos() : showDraft();
  }
  if (data.startsWith('manual:')) {
    if (!state.draft || state.draft.imageSource !== 'manual') throw new Error('Черновик со своими фото не найден');
    const action = data.slice('manual:'.length);
    if (action === 'reset') {
      state.draft.manualReminderPhotoIds = [];
      state.draft.reminderPhotoIds = null;
      markEdited();
      await save();
      return promptManualPhotos();
    }
    if (action === 'done') {
      if (!state.draft.manualReminderPhotoIds?.length) throw new Error('Сначала пришлите хотя бы одно фото');
      if (state.draft.manualReminderPhotoIds.length > manualPhotoLimit(state.draft)) throw new Error('Фото больше, чем напоминаний. Очистите список и пришлите нужное количество');
      state.mode = null;
      await save();
      return showDraft();
    }
    throw new Error('Неизвестное действие с фото');
  }
  if (data === 'copy:done') return showDraft();
  if (data.startsWith('copy:toggle:')) {
    if (!state.draft) throw new Error('Черновик не найден');
    assertChannelSelectionEditable(state.draft);
    const id = data.slice('copy:toggle:'.length);
    if (!CONFIGURED_CHANNELS.includes(id) || !allowedChannels().has(id)) throw new Error('У вас нет прав администратора в этом канале');
    const chosen = new Set(selectedChannels(state.draft));
    if (chosen.has(id)) chosen.delete(id);
    else chosen.add(id);
    state.draft.channelIds = [...chosen];
    markEdited();
    await save();
    return showCopyChannels();
  }
  if (data.startsWith('network:')) {
    if (!state.draft) throw new Error('Черновик не найден');
    assertChannelSelectionEditable(state.draft);
    const key = data.slice('network:'.length);
    const keys = key === 'both' ? ['1', '2'] : [key];
    if (keys.some(k => !NETWORKS[k]?.some(id => allowedChannels().has(id)))) throw new Error('В выбранной сетке нет доступных вам каналов');
    state.draft.networkKeys = keys;
    state.draft.channelIds = [...new Set(keys.flatMap(k => NETWORKS[k]).filter(id => allowedChannels().has(id)))];
    markEdited();
    await save();
    return showDraft();
  }
  if (data.startsWith('delete:') || data.startsWith('reminder_delete:')) {
    if (!state.draft) throw new Error('Черновик не найден');
    const reminder = data.startsWith('reminder_delete:');
    const raw = data.slice(data.indexOf(':') + 1);
    if (raw === 'custom') return sendPrompt('Пришлите время удаления: 0 15, 1 30, 6 или 10. Можно указать любой интервал до 47 59 либо отправить «нет».');
    if (reminder) state.draft.reminderDeleteAfter = raw === 'none' ? null : parseDurationMinutes(raw);
    else state.draft.postDeleteAfter = raw === 'none' ? null : parseDurationMinutes(raw);
    state.mode = null;
    markEdited();
    await save();
    return showDraft();
  }
  if (data.startsWith('post_delete_live:')) {
    const [, id, raw] = data.split(':');
    const campaign = visibleCampaign(id, true);
    if (!campaign.postManaged) throw new Error('Таймер этого поста нельзя изменить');
    if (raw === 'custom') return sendPrompt('Пришлите время удаления поста: 0 15, 1 30, 6 или 10. Допустимо до 47 59; «нет» отключает удаление.');
    const original = writableCampaign(id);
    const minutes = raw === 'none' ? null : parseDurationMinutes(raw);
    const jobs = state.jobs.filter(job => job.campaignId === id && job.kind === 'post');
    if (!jobs.some(job => ['pending', 'sent', 'published'].includes(job.status))) throw new Error('Удаление этого поста уже нельзя изменить');
    setPostDeleteAfter(original, jobs, minutes);
    state.mode = null;
    state.modeCampaignId = null;
    await save();
    return showPlanItem(id, 'a');
  }
  if (data.startsWith('rem_delete:')) {
    const [, id, rawIndex, raw] = data.split(':');
    const campaign = visibleCampaign(id, true);
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0 || index >= campaign.times.length || reminderIsRemoved(campaign, index)) throw new Error('Напоминание не найдено');
    if (raw === 'custom') return sendPrompt('Пришлите время удаления напоминания: 0 15, 1 30, 6 или 10. Допустимо до 47 59; «нет» отключает удаление.');
    const original = writableCampaign(id);
    await applyReminderEdit(original, index, { deleteAfter: raw === 'none' ? null : parseDurationMinutes(raw) });
    state.mode = null;
    state.editReminder = null;
    await save();
    return showPlanItem(id, String(index));
  }
  if (data === 'button:add') return promptMode('button', 'Пришлите: ТЕКСТ КНОПКИ | https://t.me/ссылка\nНапример: ПРОГНОЗ | https://t.me/+...');
  if (data.startsWith('button:remove:')) {
    if (!state.draft) throw new Error('Черновик не найден');
    const index = Number(data.slice('button:remove:'.length));
    const buttons = [...postButtons(state.draft)];
    if (!Number.isInteger(index) || index < 0 || index >= buttons.length) throw new Error('Кнопка не найдена');
    buttons.splice(index, 1);
    state.draft.buttons = buttons;
    state.draft.url = buttons[0]?.url || null;
    state.draft.buttonText = buttons[0]?.text || null;
    markEdited();
    await save();
    return showDraft();
  }
  if (data === 'plan:list') return showPlanNetworks();
  if (data === 'plan:return') return showSavedContentPlan();
  if (data.startsWith('plan:network:')) {
    const key = data.slice('plan:network:'.length);
    if (!NETWORKS[key]?.some(id => allowedChannels().has(id))) throw new Error('У вас нет прав администратора в этой сетке');
    const sameNetwork = state.planNetwork === key;
    state.planNetwork = key;
    await save();
    return sameNetwork ? showSavedContentPlan() : showContentPlan();
  }
  if (data.startsWith('plan:day:')) {
    const [, , day, page] = data.split(':');
    return showContentPlan(day, Number(page) || 0);
  }
  if (data.startsWith('plan:calendar:')) {
    const [, , day, expanded] = data.split(':');
    return showContentPlan(day, state.planPage || 0, expanded === '1');
  }
  if (data.startsWith('plan:item:')) {
    const [, , id, item, day, rawPage] = data.split(':');
    if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
      state.planDay = day;
      state.planPage = Math.max(0, Number(rawPage) || 0);
      await save();
    }
    if (state.mode === 'post_delete_live') {
      state.mode = null;
      state.modeCampaignId = null;
      await save();
    }
    return showPlanItem(id, item);
  }
  if (data.startsWith('dup_delete:')) {
    if (!state.copyItem) throw new Error('Копия не выбрана');
    const value = data.slice('dup_delete:'.length);
    if (value === 'custom') {
      state.mode = 'copy_delete';
      await save();
      return sendPrompt('Пришлите таймер удаления копии: 0 20, 1, 1 30 или «нет».', {
        reply_markup: { inline_keyboard: [[{ text: '← К копии', callback_data: 'dup:edit' }]] }
      });
    }
    state.copyItem.deleteAfter = value === 'none' ? null : parseDurationMinutes(value);
    state.mode = null;
    await save();
    return showCopyEditor();
  }
  if (data.startsWith('dup:')) {
    const [, action, id, item] = data.split(':');
    if (action === 'start') {
      const source = visibleCampaign(id, true);
      if (item !== 'a' && (!Number.isInteger(Number(item)) || Number(item) < 0 || Number(item) >= (source.times?.length || 0) || reminderIsRemoved(source, Number(item)))) throw new Error('Напоминание не найдено');
      state.copyItem = { sourceId: id, item, networkKey: null, at: null,
        deleteAfter: item === 'a' ? source.postDeleteAfter ?? null : reminderDeleteAfterFor(source, Number(item)) };
      state.mode = null;
      await save();
      return showCopyNetworks();
    }
    if (!state.copyItem) throw new Error('Копия не выбрана');
    if (action === 'edit') { state.mode = null; await save(); return showCopyEditor(); }
    if (action === 'cancel') {
      state.copyItem = null;
      state.mode = null;
      await save();
      await clearPreviewMessages('copy');
      return showSavedContentPlan();
    }
    if (action === 'network') return showCopyNetworks();
    if (action === 'choose') {
      if (!NETWORKS[id]?.some(channel => allowedChannels().has(channel))) throw new Error('Нет прав администратора в этой сетке');
      const source = visibleCampaign(state.copyItem.sourceId);
      if (NETWORKS[id].some(channel => source.channelIds.includes(channel))) throw new Error('Выберите другую сетку для копии');
      state.copyItem.networkKey = id;
      await save();
      return showCopyEditor();
    }
    if (action === 'time' || action === 'delete') {
      state.mode = action === 'time' ? 'copy_time' : 'copy_delete';
      await save();
      return action === 'time'
        ? sendPrompt('Пришлите время выхода копии по Москве: 19, 1928 или 04.10 19:28.', { reply_markup: { inline_keyboard: [[{ text: '← К копии', callback_data: 'dup:edit' }]] } })
        : sendPrompt('Выберите таймер удаления копии или пришлите свой: 0 20, 1, 1 30; «нет» отключает удаление.', {
          reply_markup: timerKeyboard('dup_delete', 'dup:edit') });
    }
    if (action === 'preview') return previewItemCopy();
    if (action === 'schedule') return publishItemCopy(false);
    if (action === 'now') return publishItemCopy(true);
    throw new Error('Неизвестное действие с копией');
  }
  if (data.startsWith('post:delete:')) {
    const id = data.slice('post:delete:'.length);
    const visible = visibleCampaign(id, true);
    const jobs = state.jobs.filter(job => job.campaignId === id && job.kind === 'post' && visible.channelIds.includes(job.chatId));
    if (!visible.postManaged || !jobs.some(job => ['pending', 'sent', 'published'].includes(job.status))) throw new Error('Удаление этого поста уже нельзя изменить');
    const campaign = await writableCampaign(id);
    state.mode = 'post_delete_live';
    state.modeCampaignId = campaign.id;
    await save();
    return sendPrompt('Выберите таймер удаления поста или сразу пришлите время: 0 15, 1 30, 6, 10. Любой интервал до 47 59; «нет» отключает удаление.', {
      reply_markup: timerKeyboard(`post_delete_live:${campaign.id}`, `plan:item:${campaign.id}:a`)
    });
  }
  if (data.startsWith('post:now:')) {
    const id = data.slice('post:now:'.length);
    const campaign = writableCampaign(id);
    if (!campaign.postManaged) throw new Error('Этот пост публикуется через Posted');
    const jobs = state.jobs.filter(job => job.campaignId === id);
    if (!jobs.length || jobs.some(job => !['pending', 'canceled'].includes(job.status))) throw new Error('Этот пост уже начал выходить');
    const now = Date.now();
    moveCampaignSchedule(campaign, jobs, now);
    await save();
    await processJobs(id);
    await briefNotice(`Публикация поста запущена. Напоминания сдвинуты вслед за ним; проверьте статусы в контент-плане.`);
    return showContentPlan(moscowDay(now), 0);
  }
  if (data.startsWith('rem:')) {
    const [, action, id, rawIndex, field] = data.split(':');
    const campaign = visibleCampaign(id, true);
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0 || index >= campaign.times.length) throw new Error('Напоминание не найдено');
    if (reminderIsRemoved(campaign, index)) throw new Error('Это напоминание уже удалено');
    if (action === 'remove') return reply(`Удалить только напоминание №${index + 1} из серии ${id}? Будущие копии в каналах отменятся, уже опубликованные бот удалит. Реклама и остальные напоминания останутся.`, {
      reply_markup: { inline_keyboard: [
        [{ text: '🗑 Да, удалить эту напоминалку', callback_data: `rem:confirm_remove:${id}:${index}` }],
        [{ text: '← К напоминанию', callback_data: `plan:item:${id}:${index}` }]
      ] }
    });
    if (action === 'confirm_remove') {
      const scoped = await writableCampaign(id);
      const result = removeReminder(scoped, state.jobs, index);
      state.mode = null;
      state.editReminder = null;
      await save();
      await briefNotice(`Напоминание №${index + 1} удалено из серии: будущие копии отменены (${result.pending}), опубликованные поставлены на немедленное удаление (${result.published}).${result.uncertain ? ` Для ${result.uncertain} копий результат отправки неизвестен — проверьте их вручную.` : ''}`);
      return showSavedContentPlan();
    }
    if (action === 'edit') {
      state.mode = null;
      state.editReminder = null;
      await save();
      return showReminderEditor(id, index);
    }
    if (action === 'field') {
      const prompts = {
        text: 'Пришлите новую готовую напоминалку с выделениями и премиум-эмодзи. Матчи и коэффициент бот подставит из рекламы.',
        photo: 'Пришлите одно новое фото для этого напоминания.',
        button: 'Пришлите кнопку: СМОТРЕТЬ ПРОГНОЗ - https://t.me/ссылка',
        time: 'Пришлите новое московское время: 19, 1928 или 26.09 19:28. Напоминание можно поставить на любое будущее время после выхода рекламы. Время можно менять только до публикации.',
        delete: 'Пришлите таймер удаления: 0 30 — 30 минут, 1 — час, 1 30 — полтора часа; максимум 47 59. Чтобы не удалять, отправьте «нет».'
      };
      if (!Object.hasOwn(prompts, field)) throw new Error('Неизвестная настройка напоминания');
      if (field === 'time' && reminderJobs(campaign, index).some(job => job.status !== 'pending')) throw new Error('Время вышедшего напоминания изменить нельзя');
      const scoped = await writableCampaign(id);
      state.mode = `reminder_edit_${field}`;
      state.editReminder = { id: scoped.id, index };
      await save();
      return sendPrompt(field === 'delete' ? 'Выберите таймер удаления напоминания или сразу пришлите время: 0 15, 1 30, 6, 10. Любой интервал до 47 59; «нет» отключает удаление.' : prompts[field], {
        reply_markup: field === 'delete' ? timerKeyboard(`rem_delete:${scoped.id}:${index}`, `rem:edit:${scoped.id}:${index}`) :
          { inline_keyboard: [[{ text: '← Назад', callback_data: `rem:edit:${scoped.id}:${index}` }]] }
      });
    }
  }
  if (data.startsWith('plan:')) {
    const [, action, id] = data.split(':');
    const campaign = visibleCampaign(id, true);
    if (action === 'cancel') return showCampaign(id);
    if (action === 'view') return showCampaign(id);
    if (action === 'delete') return reply(`Удалить всю серию ${id} во всех каналах? Будущие публикации будут отменены, уже вышедшие сообщения ${campaign.postManaged ? 'рекламы и напоминаний' : 'напоминаний'} — удалены.`, {
      reply_markup: { inline_keyboard: [[{ text: '🗑 Да, удалить', callback_data: `plan:confirm_delete:${id}` }], [{ text: '← Назад', callback_data: `plan:view:${id}` }]] }
    });
    if (action === 'confirm_delete') return cancelCampaign(id);
    if (action === 'edit') {
      const scoped = await writableCampaign(id);
      state.draft = draftFromCampaign(scoped, true);
      state.mode = null;
      await save();
      return showDraft();
    }
    if (action === 'move') {
      const jobs = state.jobs.filter(j => j.campaignId === id);
      if (jobs.some(j => !['pending', 'canceled'].includes(j.status))) throw new Error('Перенести можно только серию, которая ещё не начала выходить');
      const scoped = await writableCampaign(id);
      state.mode = 'reschedule';
      state.modeCampaignId = scoped.id;
      await save();
      return sendPrompt('Пришлите новое время выхода рекламы: «19», «1928» или «25.09 18:00». Напоминания сдвинутся вместе с ней.');
    }
  }
  if (!data.startsWith('edit:')) throw new Error('Неизвестная кнопка');
  if (!state.draft) throw new Error('Этот черновик уже закрыт. Отправьте новый пост.');
  const action = data.slice('edit:'.length);
  if (action === 'content') return promptMode('replace_content', 'Пришлите новый текст или фото с подписью. Настройки времени и сетки сохранятся.');
  if (action === 'media') return promptMode('add_media', 'Пришлите одно фото. Я прикреплю его к черновику рекламы; карточку напоминания создам отдельно по названию матча.', {
    reply_markup: { inline_keyboard: [[{ text: '← К посту без медиа', callback_data: 'nav:back' }]] }
  });
  if (action === 'image_source') return replyDraftInfo('Для напоминаний по умолчанию используются ваши фото. Их можно загрузить сейчас или выбрать поиск в интернете. Результат проверьте через «Превью».', {
    reply_markup: { inline_keyboard: [
      [{ text: `${state.draft.imageSource === 'manual' ? '✅ ' : ''}Загрузить свои фото`, callback_data: 'source:manual' }],
      [{ text: `${state.draft.imageSource === 'internet' ? '✅ ' : ''}Взять фото из интернета`, callback_data: 'source:internet' }],
      [{ text: '← К черновику', callback_data: 'nav:back' }]
    ] }
  });
  if (action === 'time') {
    if (state.draft.editingCampaignId && state.jobs.some(j => j.campaignId === state.draft.editingCampaignId && ['sent', 'published', 'deleted'].includes(j.status))) throw new Error('Пост уже опубликован. Перенести время выхода после публикации нельзя');
    return promptMode('post_time', 'Когда опубликовать пост? Например: «19», «1928», «завтра 18:00» или «25.09 18:00». Время московское.');
  }
  if (action === 'end') {
    if (state.draft.editingCampaignId && state.jobs.some(j => j.campaignId === state.draft.editingCampaignId && ['sent', 'published', 'deleted'].includes(j.status))) throw new Error('После выхода серии конец рекламы изменить нельзя');
    return promptMode('ad_end', 'Когда заканчивается размещение рекламы? Например: «завтра 21:00» или «25.09 21:00». Последняя напоминалка успеет удалиться до конца размещения.');
  }
  if (action === 'delete') {
    state.mode = 'post_delete';
    await save();
    return sendPrompt('Выберите таймер удаления поста или сразу пришлите время: 0 15, 1 30, 6, 10. Любой интервал до 47 59; «нет» отключает удаление.', {
      reply_markup: timerKeyboard('delete', 'nav:back')
    });
  }
  if (action === 'reminder_delete') {
    state.mode = 'reminder_delete';
    await save();
    return sendPrompt('Выберите таймер удаления напоминаний или сразу пришлите время: 0 15, 1 30, 6, 10. Любой интервал до 47 59; «нет» отключает удаление.', {
      reply_markup: timerKeyboard('reminder_delete', 'nav:back')
    });
  }
  if (action === 'button') return promptMode('button', 'Отправьте кнопку одной строкой: СМОТРЕТЬ ПРОГНОЗ - https://t.me/+ссылка. Она сразу заменит текущую кнопку.');
  if (action === 'clear_buttons') {
    if (!state.draft) throw new Error('Черновик не найден');
    state.draft.buttons = [];
    state.draft.url = null;
    state.draft.buttonText = null;
    markEdited();
    await save();
    return showDraft();
  }
  if (action === 'odds') return promptMode('odds', 'Пришлите коэффициент, например 2,40 или 2.2+');
  if (action === 'matches') return promptMode('matches', 'Пришлите матчи через точку с запятой: Нидерланды — Германия; Норвегия — Дания');
  if (action === 'network') {
    assertChannelSelectionEditable(state.draft);
    const buttons = [];
    const first = NETWORKS['1'].filter(id => allowedChannels().has(id));
    const second = NETWORKS['2'].filter(id => allowedChannels().has(id));
    if (first.length) buttons.push({ text: `Сетка 1 (${first.length})`, callback_data: 'network:1' });
    if (second.length) buttons.push({ text: `Сетка 2 (${second.length})`, callback_data: 'network:2' });
    if (first.length && second.length) buttons.push({ text: 'Обе сетки', callback_data: 'network:both' });
    return reply('Выберите сетку:', { reply_markup: { inline_keyboard: [buttons] } });
  }
  if (action === 'copy') return showCopyChannels();
  if (action === 'reminders') {
    if (!state.draft) throw new Error('Черновик не найден');
    if (state.draft.editingCampaignId) throw new Error('Режим напоминаний существующей серии не меняется');
    state.draft.remindersEnabled = !state.draft.remindersEnabled;
    markEdited();
    await save();
    return showDraft();
  }
  if (action === 'preview') return preview();
  if (action === 'reroll_images') return preview({ rerollInternetImages: true });
  if (action === 'save') return saveCampaignEdits();
  if (action === 'discard') {
    state.draft = null;
    state.mode = null;
    await save();
    await clearDraftInfoMessages();
    await clearPreviewMessages();
    return reply('Создание напоминаний отменено.', { reply_markup: MENU });
  }
  if (action === 'defer') {
    if (state.draft.remindersEnabled === false) {
      if (!state.draft.postAt) return promptMode('post_only_time', 'Когда опубликовать пост? Введите московское время: 19, 1928, завтра 19 или 25.09 19:28.');
      return publish('plan');
    }
    if (state.draft.postAt && state.draft.adEnd) {
      if (!state.draft.previewedAt || state.draft.previewedAt < state.draft.editedAt) return briefNotice('Время задано. Нажмите «Превью», затем «Отложить» ещё раз.');
      return publish('plan');
    }
    return promptMode('schedule_start', 'Когда бот должен опубликовать рекламу? Введите московское время: 19, 1928, завтра 19 или 25.09 19:28. Обычно первая напоминалка выходит через 30 минут; если реклама удаляется раньше, время подстроится под её таймер.');
  }
  if (action === 'publish_now') {
    if (state.draft.editingCampaignId) throw new Error('Из редактора существующей серии нельзя опубликовать копию сразу');
    if (state.draft.remindersEnabled === false) return publish('now');
    if (!state.draft.adEnd) return promptMode('publish_now_end', 'Когда заканчивается размещение рекламы? Укажите московское время, например 21 или 25.09 21:30. После подготовки превью нажмите «Опубликовать сейчас» ещё раз.');
    if (state.draft.postAt) {
      state.draft.postAt = null;
      markEdited();
      await save();
    }
    if (!state.draft.previewedAt || state.draft.previewedAt < state.draft.editedAt) return preview();
    return publish('now');
  }
  throw new Error('Неизвестная кнопка редактора');
}

async function handleCommand(text) {
  const [rawCommand, ...args] = text.trim().split(/\s+/);
  const command = rawCommand.toLowerCase().split('@')[0];
  const value = args.join(' ').trim();
  if (command === '/start' || command === '/help') {
    await showMenu();
    await reply('Отправьте текст или фото поста — появится черновик. Выберите сетку и настройте кнопку. «Опубликовать сейчас» отправит пост сразу; «Отложить» спросит время. Если напоминания не нужны, выключите их в черновике. Для серии с напоминаниями нужны матч, коэффициент и конец размещения.');
  } else if (command === '/new') {
    state.mode = 'ad';
    await save();
    await sendPrompt('Пришлите текст или фото поста. Для серии с напоминаниями укажите матч и коэффициент; для обычного поста их можно будет выключить в черновике.');
  } else if (command === '/schedule') {
    if (!state.draft) throw new Error('Сначала /new');
    const schedule = parseScheduleCommand(text);
    Object.assign(state.draft, { postAt: schedule.start, adEnd: schedule.end, reminderDeleteAfter: schedule.deleteAfter,
      url: schedule.url, buttonText: schedule.buttonText, buttons: [{ text: schedule.buttonText, url: schedule.url }], remindersEnabled: true });
    markEdited();
    await save();
    await showDraft();
  } else if (command === '/time' || command === '/end') {
    if (!state.draft) throw new Error('Сначала пришлите пост');
    const at = parseFlexibleMoscow(value);
    if (command === '/time') state.draft.postAt = at;
    else state.draft.adEnd = at;
    markEdited();
    await save();
    await showDraft();
  } else if (command === '/delete') {
    if (!state.draft) throw new Error('Сначала пришлите пост');
    state.draft.reminderDeleteAfter = parseReminderDeleteMinutes(value);
    markEdited();
    await save();
    await showDraft();
  } else if (command === '/button') {
    if (!state.draft) throw new Error('Сначала пришлите пост');
    const button = parseButtonSpec(value);
    state.draft.buttons = [button];
    state.draft.url = button.url;
    state.draft.buttonText = button.text;
    markEdited();
    await save();
    await showDraft();
  } else if (command === '/network') {
    if (!state.draft) throw new Error('Сначала /new');
    assertChannelSelectionEditable(state.draft);
    if (!['1', '2', 'both'].includes(value)) throw new Error('Используйте /network 1, /network 2 или /network both');
    if (((value === '1' || value === 'both') && !NETWORKS['1'].some(id => allowedChannels().has(id))) || ((value === '2' || value === 'both') && !NETWORKS['2'].some(id => allowedChannels().has(id)))) throw new Error('В выбранной сетке нет доступных вам каналов');
    state.draft.networkKeys = value === 'both' ? ['1', '2'] : [value];
    state.draft.channelIds = [...new Set(state.draft.networkKeys.flatMap(k => NETWORKS[k]).filter(id => allowedChannels().has(id)))];
    markEdited();
    await save();
    await showDraft();
  } else if (command === '/matches') {
    if (!state.draft) throw new Error('Сначала /new');
    const matches = value.split(';').map(x => x.trim()).filter(Boolean);
    if (!matches.length || matches.length > 5) throw new Error('Укажите 1–5 матчей через ;');
    state.draft.matches = matches;
    markEdited();
    await save();
    await showDraft();
  } else if (command === '/odds') {
    if (!state.draft) throw new Error('Сначала /new');
    if (!/^\d+[.,]\d{1,3}\+?$/.test(value)) throw new Error('Пример: /odds 2,2+');
    state.draft.odds = value;
    markEdited();
    await save();
    await showDraft();
  } else if (command === '/photo') {
    if (!state.draft) throw new Error('Сначала /new');
    state.mode = 'photo';
    await save();
    await sendPrompt('Пришлите фотографию следующим сообщением.');
  } else if (command === '/preview') {
    await preview();
  } else if (command === '/publish') {
    await publish('plan');
  } else if (command === '/now') {
    if (!state.draft) throw new Error('Сначала пришлите пост');
    if (state.draft.remindersEnabled === false) await publish('now');
    else throw new Error('Для серии с напоминаниями нажмите «Опубликовать сейчас» в черновике: бот подготовит превью и расписание.');
  } else if (command === '/plan' || command === '/contentplan') {
    await showPlanNetworks();
  } else if (command === '/menu') {
    await showMenu();
  } else if (command === '/draft') {
    await showDraft();
  } else if (command === '/templates') {
    state.mode = null;
    state.editTemplateIndex = null;
    await save();
    await showTextTemplates();
  } else if (command === '/images') {
    await reply('Шаблоны картинок больше не используются. Для напоминаний откройте «Картинка» → «Загрузить свои фото» в черновике.');
  } else if (command === '/addimage') {
    await reply('Загрузка шаблонов картинок отключена. Для своего изображения выберите «Картинка» → «Загрузить свои фото» в черновике.');
  } else if (command === '/addtemplate' || command === '/importtemplates') {
    state.mode = command === '/addtemplate' ? 'template_add' : 'templates';
    state.editTemplateIndex = null;
    await save();
    await sendPrompt(command === '/addtemplate' ? 'Пришлите готовую напоминалку с выделениями. Матч и коэффициент бот определит сам.' : 'Пришлите готовые напоминалки одним или несколькими сообщениями. Для текстового файла разделяйте их строкой ---.',
      { reply_markup: { inline_keyboard: [[{ text: '← К списку шаблонов', callback_data: 'template:list:0' }]] } });
  } else if (command === '/importchannel') {
    state.mode = 'forward_templates';
    state.importAdded = 0;
    await save();
    await sendPrompt('Перешлите сюда готовые напоминания из вашего канала, можно несколько подряд. Я заменю старые матчи и коэффициент на переменные. Когда закончите, отправьте /done. Если пересылка запрещена, пришлите тексты копированием.');
  } else if (command === '/done') {
    state.mode = null;
    await save();
    await reply(`Загрузка закончена. Добавлено ${state.importAdded || 0}, всего в пуле ${state.templates.length} шаблонов. Проверьте одну серию через /preview.`);
  } else if (command === '/cleartemplates') {
    state.templates = [];
    state.nextTemplateIndex = 0;
    await save();
    await reply('Пул очищен. Добавьте шаблоны через /importtemplates или верните базовые через /defaulttemplates.');
  } else if (command === '/defaulttemplates') {
    state.templates = [...DEFAULT_TEMPLATES];
    state.nextTemplateIndex = 0;
    await save();
    await reply(`Загружено ${state.templates.length} базовых шаблона.`);
  } else if (command === '/status') {
    const visible = visibleCampaignsAndJobs(state.campaigns, state.jobs, allowedChannels());
    const active = visible.campaigns.filter(c => visible.jobs.some(j => j.campaignId === c.id && ['pending', 'sending', 'sent', 'deleting', 'uncertain'].includes(j.status)));
    await reply(short(active.length ? active.map(c => {
      const jobs = visible.jobs.filter(j => j.campaignId === c.id);
      const counts = Object.groupBy(jobs, j => j.status);
      return `${c.id}: ${(c.matches || []).join('; ') || c.sourceText?.slice(0, 80) || 'Пост'}\n${Object.entries(counts).map(([k, v]) => `${k}: ${v.length}`).join(', ')}`;
    }).join('\n\n') : 'Активных серий нет.'));
  } else if (command === '/cancel') {
    await cancelCampaign(value);
  } else {
    await reply('Неизвестная команда. Список: /help');
  }
}

async function handleMessage(message) {
  if (message.chat?.type !== 'private') return;
  const text = message.text || message.caption || '';
  if (text.startsWith('/')) return handleCommand(text);
  if (text === '➕ Новое напоминание' || text === '➕ Новый пост') return handleCommand('/new');
  if (text === '📅 Контент-план') return showPlanNetworks();
  if (text === '📚 Шаблоны текстов' || text === '📚 Шаблоны') return handleCommand('/templates');
  if (text === '🖼 Шаблоны картинок') return reply('Шаблоны картинок больше не используются. Новые изображения создаются через «Картинка» в черновике.');
  if (text === '❓ Помощь') return handleCommand('/help');
  if (state.mode === 'template_add' || state.mode === 'template_edit') {
    const item = messageToTemplate(text, message.entities || message.caption_entities || []);
    const editIndex = state.mode === 'template_edit' ? state.editTemplateIndex : null;
    if (editIndex !== null && (!Number.isInteger(editIndex) || editIndex < 0 || editIndex >= state.templates.length)) throw new Error('Редактируемый шаблон не найден');
    if (state.templates.some((existing, index) => templateIdentity(existing) === templateIdentity(item) && index !== editIndex)) throw new Error('Такой шаблон уже есть в пуле');
    const index = editIndex === null ? state.templates.length : editIndex;
    if (editIndex === null) state.templates.push(item);
    else state.templates[index] = item;
    state.mode = null;
    state.editTemplateIndex = null;
    await save();
    await reply(editIndex === null ? 'Шаблон добавлен.' : 'Шаблон обновлён. Уже отложенные серии не изменились.');
    await showTextTemplate(index);
  } else if (state.mode?.startsWith('reminder_edit_')) {
    const { id, index } = state.editReminder || {};
    const campaign = state.campaigns.find(item => item.id === id);
    if (!campaign || !Number.isInteger(index) || index < 0 || index >= campaign.times.length) throw new Error('Напоминание не найдено');
    assertCampaignAccess(campaign);
    const field = state.mode.slice('reminder_edit_'.length);
    let patch;
    if (field === 'text') {
      if (!text.trim()) throw new Error('Пришлите текст напоминания');
      const formatted = messageToTemplate(text, message.entities || message.caption_entities || []);
      const caption = renderTemplate(formatted, { matches: campaign.matches, odds: campaign.odds,
        sportIcon: sportIcon(campaign.sourceText), sourceText: campaign.sourceText });
      if (caption.length > (campaign.messageFormat === 'rich' ? 32768 : 1024)) throw new Error('Текст напоминания слишком длинный');
      validateCaptionRepetitions(campaign.times.map((_, i) => i === index ? caption : reminderCaptionFor(campaign, i)));
      patch = { caption };
    } else if (field === 'photo') {
      const photoId = message.photo?.at(-1)?.file_id;
      if (!photoId) throw new Error('Пришлите одно фото');
      const samePhotoCount = campaign.times.reduce((count, _, i) => count + Number((i === index ? photoId : reminderPhotoFor(campaign, i)) === photoId), 0);
      if (samePhotoCount > 2) throw new Error('Одно фото нельзя использовать больше двух раз в серии');
      patch = { photoId };
    } else if (field === 'button') {
      patch = { button: parseButtonSpec(text) };
    } else if (field === 'time') {
      if (reminderJobs(campaign, index).some(job => job.status !== 'pending')) throw new Error('Время вышедшего напоминания изменить нельзя');
      const at = parseFlexibleMoscow(text);
      validateReminderTime(campaign, index, at);
      patch = { at };
    } else if (field === 'delete') {
      patch = { deleteAfter: parseReminderDeleteMinutes(text) };
    } else throw new Error('Неизвестная настройка напоминания');
    await applyReminderEdit(campaign, index, patch, ['text', 'photo', 'button'].includes(field));
    state.mode = null;
    state.editReminder = null;
    await save();
    await showPlanItem(id, String(index));
  } else if (state.mode === 'post_delete_live') {
    const id = state.modeCampaignId;
    const campaign = state.campaigns.find(item => item.id === id);
    assertCampaignAccess(campaign);
    const jobs = state.jobs.filter(job => job.campaignId === id && job.kind === 'post');
    if (!campaign?.postManaged || !jobs.some(job => ['pending', 'sent', 'published'].includes(job.status))) throw new Error('Удаление этого поста уже нельзя изменить');
    const minutes = parsePostDeleteMinutes(text);
    setPostDeleteAfter(campaign, jobs, minutes);
    state.mode = null;
    state.modeCampaignId = null;
    await save();
    await showPlanItem(id, 'a');
  } else if (state.mode === 'ad') {
    createDraft(message);
    await save();
    await showDraft();
    if (!state.menuShown) await showMenu();
  } else if (state.mode === 'manual_photos') {
    if (!state.draft || state.draft.imageSource !== 'manual') throw new Error('Черновик со своими фото не найден');
    const photoId = message.photo?.at(-1)?.file_id;
    if (!photoId) throw new Error('Пришлите фото как фотографию, затем нажмите «Готово»');
    const limit = manualPhotoLimit(state.draft);
    state.draft.manualReminderPhotoIds ||= [];
    if (state.draft.manualReminderPhotoIds.length >= limit) throw new Error(`Для этой серии достаточно ${limit} фото. Нажмите «Готово» или очистите список.`);
    state.draft.manualReminderPhotoIds.push(photoId);
    state.draft.reminderPhotoIds = null;
    state.draft.reminderPhotoId = null;
    markEdited();
    await save();
    await sendPrompt(`Фото ${state.draft.manualReminderPhotoIds.length} из ${limit} добавлено. Пришлите ещё или нажмите «Готово».`, {
      reply_markup: { inline_keyboard: [[{ text: '✅ Готово', callback_data: 'manual:done' }, { text: '🗑 Очистить', callback_data: 'manual:reset' }]] }
    });
  } else if (state.mode === 'photo') {
    if (!message.photo) throw new Error('Пришлите фотографию');
    state.draft.photoId = message.photo.at(-1).file_id;
    if (!state.draft.mainMediaType) state.draft.mainMediaType = 'photo';
    markEdited();
    state.mode = null;
    await save();
    await showDraft();
  } else if (state.mode === 'schedule_start') {
    const start = parseFlexibleMoscow(text);
    if (start < Date.now() + MINUTE) throw new Error('Время выхода рекламы должно быть хотя бы через минуту');
    state.draft.postAt = start;
    markEdited();
    state.mode = 'schedule_end';
    await save();
    await sendPrompt('Когда заканчивается размещение рекламы? Введите московское время: 21, 2130, завтра 21 или 25.09 21:30. Последняя напоминалка успеет удалиться до конца размещения.');
  } else if (state.mode === 'schedule_end') {
    const end = parseFlexibleMoscow(text, Math.max(Date.now(), state.draft.postAt));
    scheduleTimes(state.draft.postAt, end, state.draft.reminderDeleteAfter, state.draft.postDeleteAfter);
    state.draft.adEnd = end;
    markEdited();
    state.mode = null;
    await save();
    await showDraft();
  } else if (state.mode === 'publish_now_end') {
    state.draft.adEnd = parseFlexibleMoscow(text);
    state.draft.postAt = null;
    markEdited();
    state.mode = null;
    await save();
    await preview();
  } else if (state.mode === 'copy_time' || state.mode === 'copy_delete') {
    if (!state.copyItem) throw new Error('Копия не выбрана');
    if (state.mode === 'copy_time') {
      const at = parseFlexibleMoscow(text);
      if (at < Date.now() + MINUTE) throw new Error('Время копии должно быть хотя бы через минуту');
      state.copyItem.at = at;
    } else state.copyItem.deleteAfter = parseReminderDeleteMinutes(text);
    state.mode = null;
    await save();
    await showCopyEditor();
  } else if (['post_time', 'post_only_time', 'ad_end', 'post_delete', 'reminder_delete', 'button', 'odds', 'matches', 'replace_content', 'add_media'].includes(state.mode)) {
    if (!state.draft) throw new Error('Черновик не найден');
    const mode = state.mode;
    if (mode === 'post_time' || mode === 'post_only_time') state.draft.postAt = parseFlexibleMoscow(text);
    else if (mode === 'ad_end') state.draft.adEnd = parseFlexibleMoscow(text);
    else if (mode === 'post_delete') state.draft.postDeleteAfter = parsePostDeleteMinutes(text);
    else if (mode === 'reminder_delete') state.draft.reminderDeleteAfter = parseReminderDeleteMinutes(text);
    else if (mode === 'button') {
      const button = parseButtonSpec(text);
      state.draft.buttons = [button];
      state.draft.url = button.url;
      state.draft.buttonText = button.text;
    } else if (mode === 'odds') {
      if (!/^\d+[.,]\d{1,3}\+?$/.test(text.trim())) throw new Error('Пример коэффициента: 2,40');
      state.draft.odds = text.trim();
    } else if (mode === 'matches') {
      const matches = text.split(';').map(x => x.trim()).filter(Boolean);
      if (!matches.length || matches.length > 5) throw new Error('Укажите от 1 до 5 матчей через ;');
      state.draft.matches = matches;
      state.draft.sportIcon = sportIcon(`${state.draft.sourceText || ''}\n${matches.join('\n')}`);
    } else if (mode === 'replace_content') {
      if (!text.trim() && !message.photo?.length && !message.video) throw new Error('Пришлите текст, фото или видео');
      state.draft.sourceText = text;
      state.draft.sourceEntities = message.entities || message.caption_entities || [];
      if (message.photo?.length) { state.draft.photoId = message.photo.at(-1).file_id; state.draft.mainMediaType = 'photo'; }
      if (message.video) { state.draft.videoId = message.video.file_id; state.draft.mainMediaType = 'video'; }
      const matches = extractMatches(text);
      const odds = extractOdds(text);
      if (matches.length) state.draft.matches = matches;
      if (odds) state.draft.odds = odds;
      state.draft.sportIcon = sportIcon(text);
    } else if (mode === 'add_media') {
      if (message.photo?.length) { state.draft.photoId = message.photo.at(-1).file_id; state.draft.mainMediaType = 'photo'; }
      else throw new Error('Пришлите одно фото');
    }
    markEdited();
    state.mode = null;
    await save();
    await showDraft();
  } else if (state.mode === 'reschedule') {
    const campaign = state.campaigns.find(c => c.id === state.modeCampaignId);
    if (!campaign) throw new Error('Пост не найден');
    assertCampaignAccess(campaign);
    const next = parseFlexibleMoscow(text);
    if (next < Date.now() + MINUTE) throw new Error('Новое время должно быть хотя бы через минуту');
    const jobs = state.jobs.filter(j => j.campaignId === campaign.id);
    if (jobs.some(j => !['pending', 'canceled'].includes(j.status))) throw new Error('Этот пост уже начал выходить');
    moveCampaignSchedule(campaign, jobs, next);
    state.mode = null;
    state.modeCampaignId = null;
    await save();
    await reply(`Пост ${campaign.id} перенесён на ${formatMoscow(next)} МСК. Напоминания сдвинуты вместе с ним.`);
    if (state.planDay) await showSavedContentPlan();
  } else if (state.mode === 'forward_templates') {
    if (!text.trim()) throw new Error('У пересланного поста нет текста');
    const template = messageToTemplate(text, message.entities || message.caption_entities || []);
    if (state.templates.some(existing => templateIdentity(existing) === templateIdentity(template))) {
      return;
    } else {
      state.templates.push(template);
      state.importAdded = (state.importAdded || 0) + 1;
      await save();
      if (state.importAdded % 5 === 0) await reply(`Из канала добавлено ${state.importAdded} шаблонов. Всего в пуле ${state.templates.length}.`);
    }
  } else if (state.mode === 'template' || state.mode === 'templates') {
    let input = text;
    if (message.document?.mime_type === 'text/plain') {
      const file = await telegram('getFile', { file_id: message.document.file_id });
      const response = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`);
      if (!response.ok) throw new Error('Не удалось скачать .txt файл');
      input = await response.text();
    }
    const items = (message.document?.mime_type === 'text/plain' ? input.split(/^\s*---\s*$/m) : [input]).filter(x => x.trim());
    if (!items.length || items.length > 50) throw new Error('В сообщении должно быть от 1 до 50 шаблонов');
    const templates = items.map(item => messageToTemplate(item, items.length === 1 && !message.document ? message.entities || message.caption_entities || [] : []));
    let added = 0;
    for (const item of templates) if (!state.templates.some(existing => templateIdentity(existing) === templateIdentity(item))) { state.templates.push(item); added++; }
    state.mode = null;
    await save();
    await reply(`Добавлено ${added}. Всего в пуле ${state.templates.length}. Для следующей порции снова отправьте /importtemplates.`);
  } else {
    createDraft(message);
    await save();
    await showDraft();
    if (!state.menuShown) await showMenu();
  }
}

async function notifyPublishedGroups(onlyCampaignId = null) {
  const campaigns = new Map(state.campaigns.map(campaign => [campaign.id, campaign]));
  const groups = new Map();
  for (const job of state.jobs) {
    if (!job.ownerNotificationPending || onlyCampaignId && job.campaignId !== onlyCampaignId) continue;
    const campaign = campaigns.get(job.campaignId);
    if (!campaign) continue;
    const key = publicationGroupKey(job, campaign, NETWORKS);
    if (!groups.has(key)) groups.set(key, { campaign, jobs: [] });
  }
  if (!groups.size) return;
  for (const job of state.jobs) {
    const campaign = campaigns.get(job.campaignId);
    if (!campaign) continue;
    groups.get(publicationGroupKey(job, campaign, NETWORKS))?.jobs.push(job);
  }
  for (const { campaign, jobs } of groups.values()) {
    const pending = jobs.filter(job => job.ownerNotificationPending);
    if (!pending.length || !publicationGroupReady(jobs)) continue;
    if (pending.some(job => (job.ownerNotificationRetryAt || 0) > Date.now())) continue;
    try {
      const published = jobs.filter(job => job.messageId && ['sent', 'published', 'deleted', 'failed_delete'].includes(job.status) && !job.ownerNotificationSkipped);
      const accessible = [];
      for (const job of published) {
        const member = await telegram('getChatMember', { chat_id: job.chatId, user_id: OWNER_ID });
        if (['creator', 'administrator'].includes(member.status)) accessible.push(job);
        else job.ownerNotificationSkipped = 'owner is not a channel administrator';
      }
      if (accessible.length) {
        const notice = await telegram('sendMessage', { chat_id: OWNER_ID,
          ...publicationGroupNotice(accessible, campaign, publicationNetworkKey(accessible[0], campaign, NETWORKS)) });
        state.publishedNoticeMessages ||= [];
        state.publishedNoticeMessages.push({ chatId: OWNER_ID, messageId: notice.message_id,
          at: Math.min(...accessible.map(job => job.at)) });
      }
      for (const job of pending) {
        job.ownerNotificationPending = false;
        job.ownerNotifiedAt = Date.now();
        job.ownerNotificationError = null;
      }
      await save();
    } catch (error) {
      for (const job of pending) {
        job.ownerNotificationAttempts = (job.ownerNotificationAttempts || 0) + 1;
        job.ownerNotificationError = error.message;
        job.ownerNotificationPending = !error.permanent;
        job.ownerNotificationRetryAt = Date.now() + (error.retryAfter || Math.min(2 ** job.ownerNotificationAttempts * 30, 600)) * 1000;
      }
      await save();
      console.error(`Не удалось отправить уведомление о публикации ${pending[0].id}: ${error.message}`);
    }
  }
  await cleanupPublishedNotices();
}

async function cleanupPublishedNotices() {
  const old = stalePublicationNotices(state.publishedNoticeMessages || []);
  if (!old.length) return;
  const removed = new Set();
  for (const notice of old) {
    if ((notice.retryAt || 0) > Date.now()) continue;
    try {
      await telegram('deleteMessage', { chat_id: notice.chatId || OWNER_ID, message_id: notice.messageId });
      removed.add(notice.messageId);
    } catch (error) {
      if (error.permanent || /message to delete not found/i.test(error.message || '')) removed.add(notice.messageId);
      else notice.retryAt = Date.now() + (error.retryAfter || 60) * 1000;
      console.warn(`Не удалось удалить старое уведомление ${notice.messageId}: ${error.message}`);
    }
  }
  state.publishedNoticeMessages = state.publishedNoticeMessages.filter(notice => !removed.has(notice.messageId));
  await save();
}

async function notifyFailedPost(job) {
  if (!job.failureNotificationPending || (job.failureNotificationRetryAt || 0) > Date.now()) return;
  try {
    await telegram('sendMessage', { chat_id: OWNER_ID,
      text: `⚠️ Реклама не вышла в канале «${CHANNEL_TITLES.get(String(job.chatId)) || job.chatId}» в ${formatMoscow(job.at)} МСК. ${job.lastError || 'Время публикации истекло'}. Откройте контент-план и проверьте серию.` });
    job.failureNotificationPending = false;
    job.failureNotifiedAt = Date.now();
    await save();
  } catch (error) {
    job.failureNotificationAttempts = (job.failureNotificationAttempts || 0) + 1;
    job.failureNotificationRetryAt = Date.now() + (error.retryAfter || Math.min(2 ** job.failureNotificationAttempts * 30, 600)) * 1000;
    await save();
    console.error(`Не удалось сообщить о пропущенной рекламе ${job.id}: ${error.message}`);
  }
}

async function processJobs(onlyCampaignId = null) {
  if (busy) return;
  busy = true;
  try {
    for (const job of state.jobs) {
      if (onlyCampaignId && job.campaignId !== onlyCampaignId) continue;
      const now = Date.now();
      if (job.kind === 'reminder' && job.status === 'pending') {
        const campaign = state.campaigns.find(c => c.id === job.campaignId);
        if (campaign && reminderIsRemoved(campaign, job.index)) {
          job.status = 'canceled';
          await save();
          continue;
        }
      }
      if (job.status === 'pending' && job.at <= now && (!job.retryAt || job.retryAt <= now)) {
        const campaign = state.campaigns.find(c => c.id === job.campaignId);
        if (!campaign) { job.status = 'failed'; await save(); continue; }
        if (now >= publicationDeadline(job, campaign)) {
          job.status = 'failed';
          job.lastError = `Время публикации истекло${job.lastError ? ` после ошибки: ${job.lastError}` : ''}`;
          if (job.kind === 'post') {
            job.failureNotificationPending = true;
            for (const reminder of state.jobs.filter(j => j.campaignId === job.campaignId && j.chatId === job.chatId && j.kind === 'reminder' && j.status === 'pending')) reminder.status = 'canceled';
          }
          await save();
          continue;
        }
        if (job.kind === 'reminder' && campaign.postManaged) {
          const original = state.jobs.find(item => item.campaignId === job.campaignId && item.chatId === job.chatId && item.kind === 'post');
          if (!original || ['failed', 'canceled', 'uncertain'].includes(original.status)) {
            job.status = 'canceled';
            await save();
            continue;
          }
          if (!['sent', 'published', 'deleted'].includes(original.status)) continue;
        }
        job.status = 'sending';
        await save();
        try {
          const keyboard = { inline_keyboard: [[reminderButtonFor(campaign, job.index)]] };
          const reminderPhotoId = reminderPhotoFor(campaign, job.index);
          const sent = job.kind === 'post' ? await sendOriginal(job.chatId, campaign) :
            campaign.messageFormat === 'rich' ? await telegram('sendRichMessage', { chat_id: job.chatId,
              rich_message: reminderRichMessage(reminderCaptionFor(campaign, job.index), reminderPhotoId), reply_markup: keyboard }) :
              await telegram('sendPhoto', { chat_id: job.chatId, photo: reminderPhotoId,
                caption: reminderCaptionFor(campaign, job.index), parse_mode: 'HTML', reply_markup: keyboard });
          job.messageId = sent.message_id;
          job.publishedAt = sent.date ? sent.date * 1000 : Date.now();
          job.notificationChat = { title: sent.chat?.title || CHANNEL_TITLES.get(String(job.chatId)) || String(job.chatId),
            username: sent.chat?.username || '' };
          job.ownerNotificationPending = true;
          job.mediaId = job.kind === 'post' ? (campaign.mainMediaType === 'video' ? campaign.videoId : campaign.photoId) : reminderPhotoId;
          job.syncedVersion = campaign.version || 1;
          const deleteAfter = job.kind === 'post' ? campaign.postDeleteAfter : reminderDeleteAfterFor(campaign, job.index);
          job.deleteAt = job.kind === 'reminder' && reminderIsRemoved(campaign, job.index) ? Date.now()
            : Number.isFinite(deleteAfter) ? job.at + deleteAfter * MINUTE : null;
          job.status = job.deleteAt ? 'sent' : 'published';
          await save();
        } catch (error) {
          job.attempts++;
          job.lastError = error.message;
          job.status = shouldRetryPublication(error, job, campaign, Date.now()) ? 'pending' : 'failed';
          job.retryAt = now + (error.retryAfter || Math.min(2 ** job.attempts * 30, 600)) * 1000;
          await save();
          console.error(error);
          if (job.status === 'failed') {
            if (job.kind === 'post') for (const reminder of state.jobs.filter(j => j.campaignId === job.campaignId && j.chatId === job.chatId && j.kind === 'reminder' && j.status === 'pending')) reminder.status = 'canceled';
            if (job.kind === 'post') job.failureNotificationPending = true;
            await save();
          }
        }
      }
      if (job.failureNotificationPending && job.kind === 'post') await notifyFailedPost(job);
      if (['sent', 'published'].includes(job.status) && job.messageId && (!job.syncRetryAt || job.syncRetryAt <= Date.now())) {
        const campaign = state.campaigns.find(c => c.id === job.campaignId);
        if (campaign && !(job.kind === 'reminder' && reminderIsRemoved(campaign, job.index))) await syncPublishedJob(job, campaign);
      }
      if (job.status === 'sent' && Number.isFinite(job.deleteAt) && job.deleteAt <= Date.now()) {
        job.status = 'deleting';
        await save();
        try {
          await telegram('deleteMessage', { chat_id: job.chatId, message_id: job.messageId });
          job.status = 'deleted';
          await save();
        } catch (error) {
          if (/message to delete not found/i.test(error.message || '')) {
            job.status = 'deleted';
            job.deleteAt = null;
            await save();
            continue;
          }
          job.lastError = error.message;
          job.status = error.permanent ? 'failed_delete' : 'sent';
          job.deleteAt = Date.now() + (error.retryAfter || 60) * 1000;
          await save();
          console.error(error);
          if (job.status === 'failed_delete') await replyError(`Не удалось удалить ${job.id}: ${error.message}`);
        }
      }
    }
    await notifyPublishedGroups(onlyCampaignId);
    await cleanupPublishedNotices();
  } finally { busy = false; }
}

for (const job of state.jobs) {
  if (job.status === 'sending') job.status = 'uncertain';
  if (job.status === 'deleting') job.status = 'sent';
}
await save();
const uncertain = state.jobs.filter(j => j.status === 'uncertain');
if (uncertain.length) await reply(`После перезапуска найдено ${uncertain.length} публикаций с неизвестным результатом. Проверьте канал вручную; они не будут отправлены повторно автоматически. ID: ${uncertain.map(j => j.id).join(', ')}`);

await telegram('setMyCommands', { commands: [
  { command: 'start', description: 'Открыть главное меню' },
  { command: 'new', description: 'Создать пост' },
  { command: 'plan', description: 'Контент-план' },
  { command: 'draft', description: 'Текущий черновик' },
  { command: 'templates', description: 'Пул напоминаний' },
  { command: 'preview', description: 'Предпросмотр серии' }
] }).catch(error => console.error('Не удалось настроить меню команд:', error.message));

setInterval(() => processJobs().catch(console.error), 5000);
processJobs().catch(console.error);
const sleepGuard = await preventWindowsIdleSleep(DIR);
if (sleepGuard) console.log('Автоматический сон Windows отключён, пока работает бот.');
console.log('Бот запущен. Сетки:', NETWORKS);

while (true) {
  try {
    const updates = await telegram('getUpdates', { offset: state.offset, timeout: 20, allowed_updates: ['message', 'callback_query'] });
    for (const update of updates) {
      const userId = update.message?.from?.id ?? update.callback_query?.from?.id;
      if (Number.isSafeInteger(userId) && userId > 0) {
        const access = await adminChannelsFor(userId);
        USER_CHANNELS.set(userId, access);
        if (!access.size) {
          if (update.callback_query) await telegram('answerCallbackQuery', { callback_query_id: update.callback_query.id,
            text: 'Нет доступа к подключённым каналам. Нужны права администратора.', show_alert: true }).catch(console.error);
          else if (update.message?.chat?.type === 'private') await telegram('sendMessage', { chat_id: userId,
            text: 'Нет доступа: у вас нет прав администратора ни в одном подключённом канале бота.' }).catch(console.error);
        } else {
        await runForUser(userId, async () => {
          try {
            const previousPromptId = state.promptMessageId;
            if (update.message) await handleMessage(update.message);
            else if (update.callback_query) await handleCallback(update.callback_query);
            if (previousPromptId === state.promptMessageId) await clearPrompt(previousPromptId);
          } catch (error) {
            console.error(error);
            await replyError(error.message).catch(console.error);
          }
        });
        }
      }
      state.offset = update.update_id + 1;
      await save();
    }
  } catch (error) {
    console.error('Связь с Telegram:', error.message);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}
