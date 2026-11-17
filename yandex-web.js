const AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36';

function decodeAttribute(value) {
  return value.replace(/&(?:quot|amp|apos|lt|gt);|&#(?:x[0-9a-f]+|\d+);/gi, entity => {
    const known = { '&quot;': '"', '&amp;': '&', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    if (known[entity.toLowerCase()]) return known[entity.toLowerCase()];
    const code = entity.toLowerCase().startsWith('&#x') ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10);
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

export function parseYandexWebImages(html) {
  const images = new Map();
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.origUrl === 'string' && value.origUrl.startsWith('https://')) {
      images.set(value.origUrl, { url: value.origUrl, title: value.snippet?.title || value.alt || '',
        pageUrl: value.snippet?.url || '', width: Number(value.origWidth || value.width || 0),
        height: Number(value.origHeight || value.height || 0) });
    }
    for (const child of Object.values(value)) visit(child);
  }
  for (const match of html.matchAll(/\b[\w-]+\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const attribute = decodeAttribute(match[1] ?? match[2]);
    if (!attribute.includes('origUrl')) continue;
    try { visit(JSON.parse(attribute)); } catch { /* Other HTML attributes are not image metadata. */ }
  }
  return [...images.values()];
}

export async function searchYandexWebImages(query, { fetcher = fetch } = {}) {
  const url = new URL('https://yandex.ru/images/search');
  url.searchParams.set('text', query);
  const response = await fetcher(url, { signal: AbortSignal.timeout(20_000),
    headers: { 'user-agent': AGENT }, redirect: 'follow' });
  if (!response.ok) throw new Error(`Поиск Яндекс.Картинок: HTTP ${response.status}`);
  if (/captcha/i.test(response.url || '')) throw new Error('Яндекс запросил капчу. Загрузите свои фото или повторите позже.');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 6_000_000) throw new Error('Ответ Яндекс.Картинок слишком большой');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
  const html = Buffer.concat(chunks).toString('utf8');
  if (/CheckboxCaptcha|SmartCaptcha|showcaptcha/i.test(html)) throw new Error('Яндекс запросил капчу. Загрузите свои фото или повторите позже.');
  const images = parseYandexWebImages(html);
  if (!images.length) throw new Error('Яндекс не вернул изображения в ожидаемом формате. Загрузите свои фото или повторите позже.');
  return images;
}
