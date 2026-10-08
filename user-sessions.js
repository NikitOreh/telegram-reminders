import { AsyncLocalStorage } from 'node:async_hooks';

const SESSION_FIELDS = new Set(['draft', 'mode', 'modeCampaignId', 'editReminder',
  'editTemplateIndex', 'importAdded', 'menuShown', 'planNetwork', 'planDay', 'planPage', 'planCalendar', 'promptMessageId', 'draftInfoMessageIds', 'draftPreviewMessageIds', 'copyPreviewMessageIds', 'copyItem']);

export function parseOwnerIds(value) {
  const parts = String(value || '').split(',').map(item => item.trim());
  if (!parts.length || parts.some(item => !/^\d+$/.test(item))) {
    throw new Error('OWNER_ID: укажите числовые ID пользователей через запятую');
  }
  const ids = parts.map(Number);
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('OWNER_ID: один из ID пользователей некорректен');
  }
  return [...new Set(ids)];
}

export function createUserState(data, primaryId) {
  const context = new AsyncLocalStorage();
  data.userSessions ||= {};
  if (!Object.keys(data.userSessions).length) {
    data.userSessions[String(primaryId)] = Object.fromEntries(
      [...SESSION_FIELDS].filter(field => Object.hasOwn(data, field)).map(field => [field, data[field]])
    );
  }
  for (const field of SESSION_FIELDS) delete data[field];
  const currentUserId = () => context.getStore() ?? primaryId;
  const session = () => data.userSessions[String(currentUserId())] ||= {};
  const state = new Proxy(data, {
    get(target, property, receiver) {
      if (SESSION_FIELDS.has(property)) return session()[property];
      return Reflect.get(target, property, receiver);
    },
    set(target, property, value, receiver) {
      if (SESSION_FIELDS.has(property)) { session()[property] = value; return true; }
      return Reflect.set(target, property, value, receiver);
    }
  });
  return { state, rawState: data, currentUserId, runForUser: (id, fn) => context.run(id, fn) };
}
