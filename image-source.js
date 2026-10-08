export function imageSettingsFor(record) {
  if (record.imageSource === 'internet') return {
    imageSource: 'internet',
    manualReminderPhotoIds: record.manualReminderPhotoIds || []
  };
  const uploaded = record.manualReminderPhotoIds?.filter(Boolean) || [];
  const cached = record.reminderPhotoIds?.length ? record.reminderPhotoIds : [record.reminderPhotoId];
  return {
    imageSource: 'manual',
    manualReminderPhotoIds: uploaded.length ? uploaded : [...new Set(cached.filter(Boolean))]
  };
}
