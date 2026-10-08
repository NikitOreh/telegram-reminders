import { formatMoscow } from './core.js';
import { reminderCaptionFor, reminderIsRemoved, reminderTimeFor } from './reminder-settings.js';

const DAY = 86_400_000;

export function moscowDay(timestamp) {
  return formatMoscow(timestamp).slice(0, 10);
}

export function shiftMoscowDay(day, offset) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Некорректная дата контент-плана');
  const timestamp = Date.parse(`${day}T00:00:00+03:00`);
  if (!Number.isFinite(timestamp) || moscowDay(timestamp) !== day) throw new Error('Некорректная дата контент-плана');
  return moscowDay(timestamp + offset * DAY);
}

export function contentPlanEntries(campaigns, jobs, day) {
  const entries = [];
  for (const campaign of campaigns) {
    if (!campaign.standaloneReminder && Number.isFinite(campaign.postAt) && moscowDay(campaign.postAt) === day) {
      const postJobs = jobs.filter(job => job.campaignId === campaign.id && job.kind === 'post');
      entries.push({ kind: 'ad', campaign, at: campaign.postAt,
        status: campaign.postManaged ? aggregateStatus(postJobs) : 'external', index: null });
    }
    const times = campaign.times || [];
    for (let index = 0; index < times.length; index++) {
      if (reminderIsRemoved(campaign, index)) continue;
      const at = reminderTimeFor(campaign, index);
      if (!Number.isFinite(at) || moscowDay(at) !== day) continue;
      const related = jobs.filter(job => job.campaignId === campaign.id && job.kind === 'reminder' && job.index === index);
      entries.push({ kind: 'reminder', campaign, at, index, status: aggregateStatus(related) });
    }
  }
  return entries.sort((a, b) => a.at - b.at || (a.kind === 'ad' ? -1 : 1));
}

function aggregateStatus(jobs) {
  const statuses = jobs.map(job => job.status);
  return statuses.some(value => value === 'failed' || value === 'uncertain') ? 'failed'
    : statuses.length && statuses.every(value => value === 'canceled') ? 'canceled'
    : statuses.length && statuses.every(value => value === 'deleted') ? 'deleted'
    : statuses.some(value => ['sent', 'published', 'deleting', 'deleted'].includes(value)) ? 'sent' : 'pending';
}

export function deletionLabel(minutes) {
  if (!minutes) return '—';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}ч${rest ? ` ${rest}м` : ''}` : `${rest}м`;
}

export function planEntryTitle(entry) {
  const text = entry.kind === 'ad' ? entry.campaign.sourceText : reminderCaptionFor(entry.campaign, entry.index);
  const plain = String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const characters = Array.from(plain);
  return characters.length > 21 ? `${characters.slice(0, 20).join('')}…` : plain || entry.campaign.matches?.[0] || 'Без названия';
}
