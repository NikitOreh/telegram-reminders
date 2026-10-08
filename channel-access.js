export function visibleChannels(campaign, allowedChannels) {
  return (campaign.channelIds || []).filter(id => allowedChannels.has(String(id)));
}

export function visibleCampaignsAndJobs(campaigns, jobs, allowedChannels) {
  const visible = campaigns.flatMap(campaign => {
    const channelIds = visibleChannels(campaign, allowedChannels);
    return channelIds.length ? [{ ...campaign, channelIds }] : [];
  });
  const ids = new Set(visible.map(campaign => campaign.id));
  return { campaigns: visible, jobs: jobs.filter(job => ids.has(job.campaignId) && allowedChannels.has(String(job.chatId))) };
}
