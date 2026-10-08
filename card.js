import sharp from 'sharp';
import fs from 'node:fs/promises';
import opentype from 'opentype.js';

const fontBytes = await fs.readFile(new URL('./fonts/RussoOne-Regular.ttf', import.meta.url));
const displayFont = opentype.parse(fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength));

const escapeXml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);

export function splitMatch(match) {
  const parts = String(match || '').split(/\s+[—–-]\s+/).map(part => part.trim()).filter(Boolean);
  if (parts.length < 2) throw new Error('Не удалось определить две команды. Добавьте строку «Команда 1 — Команда 2» в текст рекламы.');
  return [parts[0], parts.slice(1).join(' — ')];
}

function lines(name) {
  const words = name.split(/\s+/);
  const result = [''];
  for (const word of words) {
    const last = result.length - 1;
    if ((result[last] + ' ' + word).trim().length > 17 && result[last]) result.push(word);
    else result[last] = `${result[last]} ${word}`.trim();
  }
  return result.slice(0, 3);
}

function teamText(name, x, color) {
  const rows = lines(name);
  const size = rows.some(row => row.length > 15) ? 42 : 49;
  const start = 533 - (rows.length - 1) * 31;
  return rows.map((row, index) => `<text x="${x}" y="${start + index * 65}" text-anchor="middle" font-size="${size}" font-weight="800" fill="${color}">${escapeXml(row)}</text>`).join('');
}

export async function makeMatchCard(match, sport = '⚽') {
  const [home, away] = splitMatch(match);
  const hockey = sport === '🏒';
  const label = hockey ? 'ХОККЕЙ · ПРОГНОЗ' : 'ФУТБОЛ · ПРОГНОЗ';
  const symbol = hockey
    ? '<ellipse cx="500" cy="759" rx="78" ry="20" fill="#f5f7fa"/><path d="M 170 760 L 385 715 M 830 760 L 615 715" stroke="#f5f7fa" stroke-width="13" stroke-linecap="round"/>'
    : '<circle cx="500" cy="762" r="53" fill="none" stroke="#f5f7fa" stroke-width="8"/><path d="M 500 715 L 527 743 L 518 779 L 482 779 L 473 743 Z M 447 752 L 473 743 M 527 743 L 553 752 M 483 779 L 470 808 M 518 779 L 530 808" fill="none" stroke="#f5f7fa" stroke-width="7"/>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#071424"/><stop offset=".52" stop-color="#132f46"/><stop offset="1" stop-color="#081320"/></linearGradient>
      <linearGradient id="left" x1="0" x2="1"><stop stop-color="#fa6845"/><stop offset="1" stop-color="#ffac54"/></linearGradient>
      <linearGradient id="right" x1="0" x2="1"><stop stop-color="#59b8ee"/><stop offset="1" stop-color="#a0e4ff"/></linearGradient>
      <radialGradient id="glow"><stop stop-color="#4ba1bf" stop-opacity=".28"/><stop offset="1" stop-color="#4ba1bf" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="1000" height="1000" fill="url(#bg)"/>
    <circle cx="500" cy="650" r="460" fill="url(#glow)"/>
    <path d="M 0 230 L 1000 90 M 0 860 L 1000 720" stroke="#ffffff" stroke-opacity=".08" stroke-width="2"/>
    <path d="M 0 300 L 1000 160 M 0 930 L 1000 790" stroke="#ffffff" stroke-opacity=".05" stroke-width="2"/>
    <rect x="56" y="58" width="888" height="884" rx="35" fill="none" stroke="#ffffff" stroke-opacity=".16" stroke-width="2"/>
    <path d="M 57 68 Q 57 57 69 57 H 295" stroke="#f78c54" stroke-width="8" fill="none"/>
    <text x="500" y="175" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="31" font-weight="700" letter-spacing="7" fill="#b9d3df">${label}</text>
    <text x="500" y="293" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="75" font-weight="900" fill="#ffffff">МАТЧ ДНЯ</text>
    <rect x="83" y="378" width="383" height="267" rx="24" fill="#fff" fill-opacity=".07" stroke="#ff9960" stroke-opacity=".6" stroke-width="2"/>
    <rect x="534" y="378" width="383" height="267" rx="24" fill="#fff" fill-opacity=".07" stroke="#77c7ef" stroke-opacity=".6" stroke-width="2"/>
    <path d="M 120 400 H 430" stroke="url(#left)" stroke-width="7" stroke-linecap="round"/>
    <path d="M 570 400 H 880" stroke="url(#right)" stroke-width="7" stroke-linecap="round"/>
    <g font-family="Arial, DejaVu Sans, sans-serif">${teamText(home, 275, '#ffe4ca')}${teamText(away, 725, '#d0f1ff')}</g>
    <circle cx="500" cy="510" r="57" fill="#071423" stroke="#e3f6ff" stroke-opacity=".7" stroke-width="3"/>
    <text x="500" y="528" text-anchor="middle" font-family="Arial, sans-serif" font-size="46" font-weight="900" fill="#ffffff">VS</text>
    <path d="M 155 758 H 375 M 625 758 H 845" stroke="#ffffff" stroke-opacity=".18" stroke-width="2"/>
    ${symbol}
    <text x="500" y="891" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="28" font-weight="700" letter-spacing="5" fill="#aecbd7">СМОТРЕТЬ ПРОГНОЗ ↓</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function cleanTeam(name) {
  return String(name).replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').replace(/\s+/g, ' ').trim();
}

function splitTeamRows(name, width, maxSize) {
  const full = cleanTeam(name).toLocaleUpperCase('ru-RU');
  if (!full) throw new Error('В названии команды не осталось букв');
  const chars = Array.from(full);
  if (!full.includes(' ') && chars.length > 8) {
    const middle = Math.floor(chars.length / 2);
    return [chars.slice(0, middle).join(''), chars.slice(middle).join('')];
  }
  if (displayFont.getAdvanceWidth(full, maxSize) <= width || displayFont.getAdvanceWidth(full, maxSize) <= width * maxSize / 58) return [full];
  const words = full.split(' ');
  if (words.length > 1) {
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const rows = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
      const widest = Math.max(...rows.map(row => displayFont.getAdvanceWidth(row, 1)));
      if (!best || widest < best.widest) best = { rows, widest };
    }
    return best.rows;
  }
  const middle = Math.floor(chars.length / 2);
  return [chars.slice(0, middle).join(''), chars.slice(middle).join('')];
}

function outlinedPath(text, x, y, size) {
  const glyphPath = displayFont.getPath(text, 0, 0, size);
  const box = glyphPath.getBoundingBox();
  const dx = x - (box.x1 + box.x2) / 2;
  const dy = y - (box.y1 + box.y2) / 2;
  const d = glyphPath.toPathData({ flipY: false, decimalPlaces: 2 });
  const transform = `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`;
  return `<path d="${d}" transform="${transform}" fill="none" stroke="#07101b" stroke-width="13" stroke-linejoin="round" opacity=".96"/>
    <path d="${d}" transform="${transform}" fill="#ffffff" stroke="#d8efff" stroke-width="1.3" stroke-linejoin="round"/>`;
}

function teamOverlay(name, x, y, width, maxSize = 78) {
  const rows = splitTeamRows(name, width, maxSize);
  const widestAtOne = Math.max(...rows.map(row => displayFont.getAdvanceWidth(row, 1)));
  const size = Math.max(36, Math.min(maxSize, Math.floor((width - 16) / widestAtOne)));
  const gap = size * 1.1;
  return rows.map((row, index) => outlinedPath(row, x, y + (index - (rows.length - 1) / 2) * gap, size)).join('');
}

function artColor(art, fallback) {
  return /^#[0-9a-f]{6}$/i.test(art?.color || '') ? art.color : fallback;
}

function badgeFrame(x, y, radius, color) {
  return `<circle cx="${x}" cy="${y}" r="${radius}" fill="#090e18" fill-opacity=".85" stroke="${color}" stroke-opacity=".85" stroke-width="5"/>
    <circle cx="${x}" cy="${y}" r="${radius - 10}" fill="${color}" fill-opacity=".12"/>`;
}

function namePlate(x, y, width, height, color) {
  return `<rect x="${x - width / 2}" y="${y - height / 2}" width="${width}" height="${height}" rx="26" fill="#080b13" fill-opacity=".91" stroke="${color}" stroke-opacity=".8" stroke-width="3"/>`;
}

async function badgeOverlay(art, x, y, size) {
  if (!art?.badge) return null;
  const input = await sharp(art.badge).resize(size, size, { fit: 'contain', background: '#00000000' }).png().toBuffer();
  return { input, left: Math.round(x - size / 2), top: Math.round(y - size / 2) };
}

function monogram(name) {
  return cleanTeam(name).toLocaleUpperCase('ru-RU').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2);
}

export async function makeAiMatchCard(image, match) {
  const [home, away] = splitMatch(match);
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1254" height="1254" viewBox="0 0 1254 1254">
    <defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#050912" stop-opacity="0"/><stop offset=".35" stop-color="#050912" stop-opacity=".72"/><stop offset="1" stop-color="#050912" stop-opacity=".97"/></linearGradient></defs>
    <rect x="0" y="860" width="1254" height="394" fill="url(#shade)"/>
    <path d="M 82 957 H 1172" stroke="#ffffff" stroke-opacity=".7" stroke-width="3"/>
    ${teamOverlay(home, 315, 1090, 490, 70)}
    ${outlinedPath('VS', 627, 1090, 60)}
    ${teamOverlay(away, 939, 1090, 490, 70)}
  </svg>`);
  return sharp(image).resize(1254, 1254, { fit: 'cover' }).composite([{ input: overlay }]).png().toBuffer();
}

export async function makeTemplateCard(match, templatePath, layout = 'two_circles', art = null, variantIndex = 0) {
  const [home, away] = splitMatch(match);
  let content;
  const hasBadges = Boolean(art?.home?.badge || art?.away?.badge);
  if (hasBadges) {
    const homeColor = artColor(art.home, '#E54A37');
    const awayColor = artColor(art.away, '#A073E8');
    let homeSpot, awaySpot, badgeSize;
    if (layout === 'single_circle') {
      homeSpot = { x: 930, y: 260 }; awaySpot = { x: 952, y: 920 }; badgeSize = 180;
      content = `${badgeFrame(homeSpot.x, homeSpot.y, 112, homeColor)}
        ${badgeFrame(awaySpot.x, awaySpot.y, 125, awayColor)}
        ${namePlate(930, 510, 555, 155, homeColor)}
        ${namePlate(952, 1165, 560, 145, awayColor)}
        ${teamOverlay(home, 930, 510, 510, 79)}
        ${outlinedPath('VS', 930, 675, 53)}
        ${teamOverlay(away, 952, 1165, 510, 68)}`;
    } else if (layout === 'two_boxes' || layout === 'two_circles') {
      const spotY = layout === 'two_boxes' ? 835 : 910;
      homeSpot = { x: 305, y: spotY }; awaySpot = { x: 952, y: spotY }; badgeSize = 185;
      content = `${badgeFrame(homeSpot.x, homeSpot.y, 117, homeColor)}
        ${badgeFrame(awaySpot.x, awaySpot.y, 117, awayColor)}
        ${namePlate(305, 1165, 520, 145, homeColor)}
        ${namePlate(952, 1165, 520, 145, awayColor)}
        ${teamOverlay(home, 305, 1165, 475, 68)}
        ${teamOverlay(away, 952, 1165, 475, 68)}`;
    } else throw new Error('Неизвестное расположение подписей на шаблоне');
    if (!art.home?.badge) content += outlinedPath(monogram(home), homeSpot.x, homeSpot.y, 96);
    if (!art.away?.badge) content += outlinedPath(monogram(away), awaySpot.x, awaySpot.y, 96);
    let base = sharp(templatePath).resize(1254, 1254, { fit: 'cover' });
    if (variantIndex) base = base.modulate({ hue: (variantIndex * 37) % 360 });
    const frame = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1254" height="1254" viewBox="0 0 1254 1254">${content}</svg>`);
    const logos = (await Promise.all([
      badgeOverlay(art.home, homeSpot.x, homeSpot.y, badgeSize),
      badgeOverlay(art.away, awaySpot.x, awaySpot.y, badgeSize)
    ])).filter(Boolean);
    return base.composite([{ input: frame }, ...logos]).png().toBuffer();
  }
  if (layout === 'single_circle') {
    content = `${teamOverlay(home, 930, 355, 500, 105)}
      ${outlinedPath('VS', 930, 705, 55)}
      ${teamOverlay(away, 952, 940, 320, 68)}`;
  } else if (layout === 'two_boxes' || layout === 'two_circles') {
    const y = layout === 'two_boxes' ? 865 : 940;
    const width = layout === 'two_boxes' ? 360 : 350;
    content = `${teamOverlay(home, 305, y, width)}${teamOverlay(away, 952, y, width)}`;
  } else throw new Error('Неизвестное расположение подписей на шаблоне');
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1254" height="1254" viewBox="0 0 1254 1254">${content}</svg>`);
  let base = sharp(templatePath).resize(1254, 1254, { fit: 'cover' });
  if (variantIndex) base = base.modulate({ hue: (variantIndex * 37) % 360 });
  return base.composite([{ input: overlay }]).png().toBuffer();
}
