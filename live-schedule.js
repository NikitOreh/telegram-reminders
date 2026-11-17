import { MINUTE, scheduleTimes } from './core.js';
import { buildCampaignJobs, reminderDeleteAfterFor, reminderIsRemoved, reminderTimeFor, setReminderOverride } from './reminder-settings.js';

const minutes = value => value === undefined ? 30 : value;

export function campaignHasStarted(campaign, jobs, now = Date.now()) {
  return campaign.postAt <= now || jobs.some(job => job.campaignId === campaign.id &&
    ['sent', 'published', 'deleted', 'sending', 'deleting', 'uncertain', 'failed_delete'].includes(job.status));
}

export function planLiveSchedule(campaign, jobs, draft, now = Date.now()) {
  if (draft.postAt !== campaign.postAt) throw new Error('После выхода рекламы нельзя менять время её начала. Измените «Конец рекламы».');
  const baseTimes = [...campaign.times];
  const plan = { baseTimes, baseEnd: campaign.adEnd, times: [...baseTimes], adEnd: draft.adEnd, cancelIndices: [], restoreIndices: [] };
  const changed = draft.adEnd !== campaign.adEnd || minutes(draft.reminderDeleteAfter) !== minutes(campaign.reminderDeleteAfter) ||
    (draft.postDeleteAfter ?? null) !== (campaign.postDeleteAfter ?? null);
  if (!changed) return plan;
  if (!Number.isFinite(draft.adEnd) || draft.adEnd <= campaign.postAt) throw new Error('Конец рекламы должен быть позже начала');
  if (draft.adEnd !== campaign.adEnd && draft.adEnd <= now) throw new Error('Новый конец рекламы должен быть в будущем');
  const desired = scheduleTimes(campaign.postAt, draft.adEnd, minutes(draft.reminderDeleteAfter), draft.postDeleteAfter ?? null);
  const desiredSet = new Set(desired);
  const effectiveEnd = draft.postDeleteAfter == null ? draft.adEnd : Math.min(draft.adEnd, campaign.postAt + draft.postDeleteAfter * MINUTE);
  const occupied = new Set(baseTimes);
  for (let index = 0; index < baseTimes.length; index++) {
    const at = reminderTimeFor(campaign, index);
    occupied.add(at);
    const override = campaign.reminderOverrides?.[index] || {};
    if (reminderIsRemoved(campaign, index) && !override.scheduleRemoved) continue;
    const related = jobs.filter(job => job.campaignId === campaign.id && job.kind === 'reminder' && job.index === index);
    // An index shared by channels must stay intact if any copy has started sending.
    if (at <= now || related.some(job => !['pending', 'canceled'].includes(job.status))) continue;
    const ttl = Object.hasOwn(override, 'deleteAfter') ? reminderDeleteAfterFor(campaign, index) : minutes(draft.reminderDeleteAfter);
    const fits = at + (ttl ?? 0) * MINUTE <= effectiveEnd;
    const wanted = fits && (Object.hasOwn(override, 'at') || desiredSet.has(at));
    if (override.scheduleRemoved && wanted && at >= now + MINUTE) plan.restoreIndices.push(index);
    else if (!wanted && !reminderIsRemoved(campaign, index)) plan.cancelIndices.push(index);
  }
  for (const at of desired) {
    if (at < now + MINUTE || occupied.has(at)) continue;
    plan.times.push(at);
    occupied.add(at);
  }
  if (plan.times.length > 48) throw new Error('В серии допускается не более 48 напоминаний с учётом уже созданных');
  return plan;
}

export function applyLiveSchedule(campaign, jobs, plan, now = Date.now()) {
  if (JSON.stringify(campaign.times) !== JSON.stringify(plan.baseTimes) || campaign.adEnd !== plan.baseEnd) {
    throw new Error('Серия уже изменена. Откройте её редактор заново.');
  }
  if (campaign.captions.length !== plan.times.length) throw new Error('Не подготовлены тексты дополнительных напоминаний');
  campaign.times = [...plan.times];
  campaign.adEnd = plan.adEnd;
  let canceled = 0;
  for (const index of plan.cancelIndices) {
    const related = jobs.filter(job => job.campaignId === campaign.id && job.kind === 'reminder' && job.index === index);
    if (related.some(job => !['pending', 'canceled'].includes(job.status))) continue;
    setReminderOverride(campaign, index, { removed: true, scheduleRemoved: true });
    for (const job of related) if (job.status === 'pending') { job.status = 'canceled'; job.retryAt = null; canceled++; }
  }
  const restored = new Set();
  for (const index of plan.restoreIndices) {
    if (!campaign.reminderOverrides?.[index]?.scheduleRemoved || reminderTimeFor(campaign, index) <= now) continue;
    setReminderOverride(campaign, index, { removed: false, scheduleRemoved: false });
    for (const job of jobs) {
      if (job.campaignId === campaign.id && job.kind === 'reminder' && job.index === index && job.status === 'canceled') {
        job.status = 'pending'; job.retryAt = null; restored.add(index);
      }
    }
  }
  // Preparation may cross a publication time. Never enqueue a new slot in the past.
  for (let index = plan.baseTimes.length; index < plan.times.length; index++) {
    if (plan.times[index] <= now) setReminderOverride(campaign, index, { removed: true });
  }
  const ids = new Set(jobs.map(job => job.id));
  const added = buildCampaignJobs(campaign).filter(job => job.kind === 'reminder' && job.index >= plan.baseTimes.length && !ids.has(job.id));
  jobs.push(...added);
  return { added: added.length, remindersAdded: new Set([...added.map(job => job.index), ...restored]).size, canceled };
}
