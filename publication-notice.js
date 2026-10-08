import { formatMoscow } from './core.js';

function publicationExcerpt(job, campaign) {
  const match = campaign.matches?.filter(Boolean).join('; ');
  const source = job.kind === 'post' ? campaign.sourceText : match || campaign.sourceText;
  return Array.from(String(source || '').replace(/<[^>]+>/g, '').split(/\r?\n/).map(line => line.trim()).find(Boolean) || '')
    .slice(0, 100).join('');
}

export function publishedMessageLink(chatId, messageId, username = '') {
  if (!Number.isSafeInteger(Number(messageId)) || Number(messageId) <= 0) return null;
  if (/^[a-zA-Z][\w]{4,31}$/.test(username)) return `https://t.me/${username}/${messageId}`;
  const privateId = String(chatId).match(/^-100(\d+)$/)?.[1];
  return privateId ? `https://t.me/c/${privateId}/${messageId}` : null;
}

export function publicationNotice(job, campaign, chat = {}) {
  const kind = job.kind === 'post' ? 'Реклама опубликована' : 'Напоминание опубликовано';
  const title = chat.title || String(job.chatId);
  const excerpt = publicationExcerpt(job, campaign);
  const link = publishedMessageLink(job.chatId, job.messageId, chat.username);
  return {
    text: `✅ ${kind}\nКанал: ${title}\nВремя: ${formatMoscow(job.publishedAt || Date.now())} МСК${excerpt ? `\n${excerpt}` : ''}`,
    reply_markup: link ? { inline_keyboard: [[{ text: 'Открыть пост', url: link }]] } : undefined
  };
}

export function publicationNetworkKey(job, campaign, networks) {
  const keys = campaign.networkKeys?.length ? campaign.networkKeys.map(String) : Object.keys(networks);
  return keys.find(key => (networks[key] || []).map(String).includes(String(job.chatId))) || `channel:${job.chatId}`;
}

export function publicationGroupKey(job, campaign, networks) {
  return `${job.campaignId}:${job.kind}:${job.index ?? ''}:${job.at}:${publicationNetworkKey(job, campaign, networks)}`;
}

export function publicationGroupReady(jobs) {
  return jobs.length > 0 && jobs.every(job => !['pending', 'sending'].includes(job.status));
}

export function stalePublicationNotices(notices) {
  if (!notices?.length) return [];
  const latest = Math.max(...notices.map(notice => notice.at));
  return notices.filter(notice => notice.at < latest);
}

export function publicationGroupNotice(jobs, campaign, networkKey) {
  if (!jobs.length) throw new Error('Нет опубликованных каналов для уведомления');
  const first = jobs[0];
  const kind = first.kind === 'post' ? 'Реклама опубликована' : 'Напоминание опубликовано';
  const times = jobs.map(job => job.publishedAt || job.at);
  const firstTime = formatMoscow(Math.min(...times));
  const lastTime = formatMoscow(Math.max(...times));
  const time = firstTime === lastTime ? firstTime : `${firstTime} — ${lastTime.slice(11)}`;
  const excerpt = publicationExcerpt(first, campaign);
  const channels = jobs.map(job => job.notificationChat?.title || String(job.chatId));
  const buttons = jobs.map(job => {
    const link = publishedMessageLink(job.chatId, job.messageId, job.notificationChat?.username);
    return link ? [{ text: `Открыть: ${(job.notificationChat?.title || String(job.chatId)).slice(0, 40)}`, url: link }] : null;
  }).filter(Boolean);
  return {
    text: `✅ ${kind} в сетке ${networkKey}\nВремя: ${time} МСК\nКаналы:\n${channels.map(title => `• ${title}`).join('\n')}${excerpt ? `\n\n${excerpt}` : ''}`,
    reply_markup: buttons.length ? { inline_keyboard: buttons } : undefined
  };
}
