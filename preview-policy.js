export function previewIsCurrent(draft) {
  return Boolean(draft?.previewedAt && draft.previewedAt >= draft.editedAt);
}

// Once previewed, any later edits can be prepared automatically at save time.
// Existing scheduled series already passed preparation when they were created.
export function shouldPreparePreview(draft) {
  return Boolean(draft && (draft.previewedAt || draft.editingCampaignId) && !previewIsCurrent(draft));
}
