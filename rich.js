const escapeHtml = text => String(text).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
})[char]);

function tags(entity) {
  const names = { bold: 'b', italic: 'i', underline: 'u', strikethrough: 's', spoiler: 'tg-spoiler', code: 'code', pre: 'pre' };
  if (names[entity.type]) return [`<${names[entity.type]}>`, `</${names[entity.type]}>`];
  if (entity.type === 'text_link' && /^https?:\/\//i.test(entity.url || '')) return [`<a href="${escapeHtml(entity.url)}">`, '</a>'];
  if (entity.type === 'custom_emoji' && /^\d+$/.test(String(entity.custom_emoji_id || ''))) return [`<tg-emoji emoji-id="${entity.custom_emoji_id}">`, '</tg-emoji>'];
  return null;
}

export function entitiesToRichHtml(text, entities = []) {
  const supported = entities.map(entity => ({ ...entity, tags: tags(entity) }))
    .filter(entity => entity.tags && entity.offset >= 0 && entity.length > 0 && entity.offset + entity.length <= text.length);
  const points = [...new Set([0, text.length, ...supported.flatMap(entity => [entity.offset, entity.offset + entity.length])])].sort((a, b) => a - b);
  let html = '';
  let open = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    const active = supported.filter(entity => entity.offset <= start && entity.offset + entity.length >= end)
      .sort((a, b) => a.offset - b.offset || b.length - a.length);
    let shared = 0;
    while (shared < open.length && open[shared] === active[shared]) shared++;
    for (let j = open.length - 1; j >= shared; j--) html += open[j].tags[1];
    for (let j = shared; j < active.length; j++) html += active[j].tags[0];
    html += escapeHtml(text.slice(start, end)).replace(/\n/g, '<br>');
    open = active;
  }
  for (let j = open.length - 1; j >= 0; j--) html += open[j].tags[1];
  return html;
}

export function richWithQuotedPhoto(html, photoId) {
  return {
    html: `<p>${html}</p><blockquote><img src="tg://photo?id=quoted_photo"/></blockquote>`,
    media: [{ id: 'quoted_photo', media: { type: 'photo', media: photoId } }]
  };
}

export function reminderRichMessage(captionHtml, photoId) {
  return richWithQuotedPhoto(captionHtml.replace(/\n/g, '<br>'), photoId);
}

export function richPhotoFileId(message) {
  const walk = blocks => {
    for (const block of blocks || []) {
      if (block.type === 'photo') return block.photo?.at(-1)?.file_id;
      const nested = walk(block.blocks);
      if (nested) return nested;
    }
    return null;
  };
  return walk(message.rich_message?.blocks);
}
