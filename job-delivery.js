const MINUTE = 60_000;

export function publicationDeadline(job, campaign) {
  const deadlines = [];
  if (Number.isFinite(campaign.adEnd)) deadlines.push(campaign.adEnd);
  const deleteAfter = job.kind === 'post' ? campaign.postDeleteAfter :
    Object.hasOwn(campaign.reminderOverrides?.[job.index] || {}, 'deleteAfter')
      ? campaign.reminderOverrides[job.index].deleteAfter : campaign.reminderDeleteAfter ?? 30;
  if (Number.isFinite(deleteAfter)) deadlines.push(job.at + deleteAfter * MINUTE);
  return Math.min(...(deadlines.length ? deadlines : [job.at + 30 * MINUTE]));
}

export function shouldRetryPublication(error, job, campaign, now = Date.now()) {
  return !error.permanent && now < publicationDeadline(job, campaign);
}
