import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const CACHE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'internet-assets');
const VERSION = 2;
const MONTH = '(?:январ[ья]|феврал[ья]|март[а]?|апрел[ья]|ма[йя]|июн[ья]|июл[ья]|август[а]?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья]|янв|фев|мар|апр|июн|июл|авг|сен|сент|окт|ноя|дек|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

export function textContainsDate(text) {
  const clean = String(text || '').normalize('NFKC').toLowerCase().replace(/[–—]/g, '-');
  const day = '(?:0?[1-9]|[12][0-9]|3[01])';
  const month = '(?:0?[1-9]|1[0-2])';
  // A year or season printed on a poster also makes it dated. Match scores and clocks are allowed.
  return /(?<!\d)(?:19|20)\d{2}(?!\d)/u.test(clean) ||
    new RegExp(`(?<![\\p{L}\\d])(?:${day}\\s*[./]\\s*${month}|(?:0[1-9]|[12][0-9]|3[01])\\s*-\\s*(?:0[1-9]|1[0-2]))(?![\\p{L}\\d])`, 'u').test(clean) ||
    new RegExp(`(?<![\\p{L}\\d])(?:${day}\\s*[./-]?\\s*${MONTH}|${MONTH}\\.?\\s*${day})(?![\\p{L}\\d])`, 'u').test(clean);
}

export function parseOcrLayout(tsv) {
  const words = [];
  for (const line of String(tsv).split(/\r?\n/).slice(1)) {
    const fields = line.split('\t');
    if (fields.length < 12 || fields[0] !== '5') continue;
    const [left, top, width, height, confidence] = fields.slice(6, 11).map(Number);
    const text = fields.slice(11).join(' ').trim();
    if (!text || ![left, top, width, height, confidence].every(Number.isFinite) || width <= 0 || height <= 0) continue;
    words.push({ text, left, top, width, height, confidence });
  }
  return { text: words.filter(word => word.confidence >= 15).map(word => word.text).join(' '), words };
}

export function textOverlayDetected(text, layout) {
  const clean = String(text || '').normalize('NFKC');
  const tokens = clean.match(/[\p{L}]{2,}/gu) || [];
  // Editorial sentences are not team names, shirt sponsors or a match scoreboard.
  if (tokens.length >= 7 && tokens.join('').length >= 32 &&
    /победил|обыгра|проигра|забросил|забил|одержал|поражени|новост|подробност|\b(?:defeated|beats?|scored|victory|breaking|news)\b/iu.test(clean)) return true;
  if (!layout) return tokens.length >= 12 && tokens.join('').length >= 65;
  const { width, height, words = [] } = layout;
  if (!(width > 0 && height > 0)) return false;
  const lines = [];
  for (const word of words.filter(word => word.confidence >= 40 && /[\p{L}]{2}/u.test(word.text) &&
    word.height >= height * 0.028 && word.height <= height * 0.18 &&
    word.top + word.height / 2 >= height * 0.16 && word.top + word.height / 2 <= height * 0.92)
    .sort((a, b) => a.top - b.top)) {
    const center = word.top + word.height / 2;
    let line = lines.find(item => Math.abs(item.center - center) <= Math.min(item.height, word.height) * 0.55);
    if (!line) { line = { center, height: word.height, left: word.left, right: word.left + word.width, words: [] }; lines.push(line); }
    line.words.push(word.text);
    line.left = Math.min(line.left, word.left);
    line.right = Math.max(line.right, word.left + word.width);
    line.height = Math.max(line.height, word.height);
  }
  const headlines = lines.map(line => ({ ...line, letters: (line.words.join('').match(/\p{L}/gu) || []).length }))
    .filter(line => line.words.length >= 3 && line.letters >= 12).sort((a, b) => a.center - b.center);
  if (headlines.some(line => line.words.length >= 5 && line.letters >= 32 &&
    line.right - line.left >= width * 0.55 && line.height >= height * 0.045)) return true;
  return headlines.some((line, index) => headlines.slice(index + 1).some(other =>
    line.letters + other.letters >= 35 && other.center - line.center <= Math.max(line.height, other.height) * 3 &&
    Math.abs(line.left - other.left) <= width * 0.15));
}

export function recognizeImageLayout(image, { executable = process.env.TESSERACT_PATH || 'tesseract' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['stdin', 'stdout', '-l', 'eng+rus', '--psm', '11', 'tsv'],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, OMP_THREAD_LIMIT: '1' } });
    let text = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), 30_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { text += chunk; });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(parseOcrLayout(text));
      else reject(new Error(`Не удалось распознать текст изображения: ${stderr.slice(0, 200) || `код ${code}`}`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(image);
  });
}

export async function recognizeImageText(image, options) {
  return (await recognizeImageLayout(image, options)).text;
}

export async function analyzeImageText(image, { recognize = recognizeImageLayout, skipCache = false } = {}) {
  const key = createHash('sha256').update(image).update(`text:${VERSION}`).digest('hex');
  const cachePath = path.join(CACHE, `text-${key}.json`);
  if (!skipCache) {
    try {
      const result = JSON.parse(await fs.readFile(cachePath, 'utf8'));
      if (typeof result.hasDate === 'boolean' && typeof result.hasTextOverlay === 'boolean') return result;
    } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  }
  try {
    const { data: prepared, info } = await sharp(image).flatten({ background: '#fff' }).resize({ width: 1800 }).normalize().png().toBuffer({ resolveWithObject: true });
    const recognized = await recognize(prepared);
    const text = typeof recognized === 'string' ? recognized : recognized.text;
    const result = { hasDate: textContainsDate(text), hasTextOverlay: textOverlayDetected(text,
      typeof recognized === 'string' ? null : { ...info, words: recognized.words }), checkedAt: Date.now() };
    // White headlines on a dimmed photo can be fragmented by ordinary OCR.
    // Retry only suspicious large central fragments, isolating bright lettering.
    const fragments = (recognized.words || []).filter(word => word.confidence >= 55 &&
      (word.text.match(/\p{L}/gu) || []).length >= 3 && word.height >= info.height * 0.03 &&
      word.top + word.height / 2 >= info.height * 0.2 && word.top + word.height / 2 <= info.height * 0.88);
    if (!result.hasTextOverlay && (fragments.length >= 2 || fragments.some(word =>
      word.text.length >= 5 && word.width >= info.width * 0.12 && word.height >= info.height * 0.045))) {
      const mask = await sharp(image).flatten({ background: '#fff' }).resize({ width: 1800 })
        .greyscale().threshold(215).negate().png().toBuffer();
      const refined = await recognize(mask);
      const refinedText = typeof refined === 'string' ? refined : refined.text;
      result.hasDate ||= textContainsDate(refinedText);
      result.hasTextOverlay = textOverlayDetected(refinedText,
        typeof refined === 'string' ? null : { ...info, words: refined.words });
    }
    if (!skipCache) {
      await fs.mkdir(CACHE, { recursive: true });
      await fs.writeFile(cachePath, JSON.stringify(result), 'utf8');
    }
    return result;
  } catch (error) {
    const failure = new Error(`Проверка дат и надписей на картинках недоступна: ${error.message}`, { cause: error });
    failure.visionService = true;
    throw failure;
  }
}

export async function imageContainsDate(image, options) {
  return (await analyzeImageText(image, options)).hasDate;
}

export async function imageHasDisallowedText(image, options) {
  const result = await analyzeImageText(image, options);
  return result.hasDate || result.hasTextOverlay;
}
