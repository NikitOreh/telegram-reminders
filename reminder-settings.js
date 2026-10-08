import { photoMayOmitCredit } from './photo-license.js';

export function reminderOverride(campaign, index) {
  return campaign.reminderOverrides?.[index] || {};
}

export function reminderIsRemoved(campaign, index) {
  return reminderOverride(campaign, index).removed === true;
}

export function reminderCaptionFor(campaign, index) {
  const override = reminderOverride(campaign, index);
  const caption = override.caption ?? campaign.captions[index];
  const credit = override.photoId ? null : campaign.reminderPhotoCredits?.[index];
  if (!credit || photoMayOmitCredit(credit.license)) return caption;
  const escape = value => String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const author = `<a href="${escape(credit.sourcePage)}">${escape(credit.artist)}</a>`;
  const license = credit.licenseUrl ? `<a href="${escape(credit.licenseUrl)}">${escape(credit.license)}</a>` : escape(credit.license);
  return `${caption}\n\n📷 ${author} · ${license} · кадрировано`;
}

export function reminderPhotoFor(campaign, index) {
  return reminderOverride(campaign, index).photoId || campaign.reminderPhotoIds?.[index] || campaign.reminderPhotoId || campaign.photoId;
}

export function reminderButtonFor(campaign, index) {
  return reminderOverride(campaign, index).button || { text: campaign.buttonText || campaign.schedule?.buttonText || 'ПРОГНОЗ',
    url: campaign.url || campaign.schedule?.url };
}

export function reminderTimeFor(campaign, index) {
  return reminderOverride(campaign, index).at ?? campaign.times[index];
}

export function validateReminderTime(campaign, index, at, now = Date.now()) {
  if (at < now + 60_000) throw new Error('Новое время должно быть хотя бы через минуту');
  if (!campaign.standaloneReminder && at <= campaign.postAt) throw new Error('Напоминание должно выйти после рекламы');
  if (campaign.times.some((_, i) => i !== index && !reminderIsRemoved(campaign, i) && reminderTimeFor(campaign, i) === at)) {
    throw new Error('На это время уже назначено другое напоминание серии');
  }
}

export function reminderDeleteAfterFor(campaign, index) {
  const override = reminderOverride(campaign, index);
  return Object.hasOwn(override, 'deleteAfter') ? override.deleteAfter : campaign.reminderDeleteAfter === undefined ? 30 : campaign.reminderDeleteAfter;
}

export function setReminderOverride(campaign, index, patch) {
  campaign.reminderOverrides ||= {};
  campaign.reminderOverrides[index] = { ...reminderOverride(campaign, index), ...patch };
}

export function removeReminder(campaign, jobs, index, now = Date.now()) {
  if (!Number.isInteger(index) || index < 0 || index >= campaign.times.length) throw new Error('Напоминание не найдено');
  if (reminderIsRemoved(campaign, index)) throw new Error('Это напоминание уже удалено');
  setReminderOverride(campaign, index, { removed: true });
  let pending = 0;
  let published = 0;
  let uncertain = 0;
  for (const job of jobs) {
    if (job.kind !== 'reminder' || job.index !== index || job.campaignId !== campaign.id) continue;
    if (['pending', 'failed'].includes(job.status)) {
      job.status = 'canceled';
      job.retryAt = null;
      pending++;
    } else if (['sent', 'published', 'failed_delete'].includes(job.status) || (job.status === 'uncertain' && job.messageId)) {
      job.status = 'sent';
      job.deleteAt = now;
      job.syncRetryAt = null;
      published++;
    } else if (job.status === 'uncertain' || job.status === 'sending') uncertain++;
  }
  return { pending, published, uncertain };
}

export function setPostDeleteAfter(campaign, jobs, minutes) {
  campaign.postDeleteAfter = minutes;
  for (const job of jobs) {
    if (job.kind !== 'post' || !['sent', 'published'].includes(job.status)) continue;
    job.deleteAt = minutes === null ? null : (job.publishedAt || job.at) + minutes * 60_000;
    job.status = minutes === null ? 'published' : 'sent';
  }
}

export function moveCampaignSchedule(campaign, jobs, nextPostAt) {
  const delta = nextPostAt - campaign.postAt;
  for (const job of jobs) if (job.status === 'pending') job.at += delta;
  campaign.postAt = nextPostAt;
  if (campaign.adEnd) campaign.adEnd += delta;
  if (campaign.times) campaign.times = campaign.times.map(at => at + delta);
  for (const override of Object.values(campaign.reminderOverrides || {})) if (Number.isFinite(override.at)) override.at += delta;
}

export function buildCampaignJobs(campaign) {
  const jobs = [];
  for (const chatId of campaign.channelIds) {
    if (campaign.postManaged) jobs.push({ id: `${campaign.id}:${chatId}:post`, campaignId: campaign.id,
      kind: 'post', chatId, at: campaign.postAt, deleteAt: null, status: 'pending', attempts: 0 });
    for (let index = 0; index < campaign.captions.length; index++) {
      if (reminderIsRemoved(campaign, index)) continue;
      jobs.push({ id: `${campaign.id}:${chatId}:reminder:${index}`, campaignId: campaign.id,
        kind: 'reminder', chatId, index, at: reminderTimeFor(campaign, index), deleteAt: null,
        status: 'pending', attempts: 0 });
    }
  }
  return jobs;
}
