import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { textContainsDate, imageContainsDate, parseOcrLayout, textOverlayDetected, imageHasDisallowedText, analyzeImageText } from './image-date.js';

test('даты на афишах: числа, месяцы на русском и английском, год и сезон', () => {
  for (const text of ['09.11.2026', '9/11', '09-11', '2026-11-09', '9 ноября', 'НОЯБРЬ 09',
    'NOV 9', '9 November', 'SEPTEMBER 12', '12 ФЕВРАЛЯ', '2025/26', '© 2024', 'Игра 1 мая']) {
    assert.equal(textContainsDate(text), true, text);
  }
});

test('счёт, номер игрока и часы игры не считаются датой', () => {
  for (const text of ['АК БАРС ТОРПЕДО', '2:1', '3-1', '19:30', '#97', 'KHL', '1st 12:32', '202', '19200']) {
    assert.equal(textContainsDate(text), false, text);
  }
});

test('решение принимается по тексту внутри изображения', async () => {
  const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: 'white' } }).png().toBuffer();
  assert.equal(await imageContainsDate(png, { skipCache: true, recognize: async () => '9 ноября 2026' }), true);
  assert.equal(await imageContainsDate(png, { skipCache: true, recognize: async () => 'АК БАРС 3:1 ТОРПЕДО' }), false);
});

test('ошибка OCR не считается разрешением использовать непроверенное фото', async () => {
  const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: 'white' } }).png().toBuffer();
  await assert.rejects(imageContainsDate(png, { skipCache: true, recognize: async () => { throw new Error('offline'); } }),
    error => error.visionService === true && /Проверка дат/.test(error.message));
});

test('новостной текст поверх фото отсеивается даже без даты', () => {
  const headline = '«Вашингтон» победил «Нью-Джерси» в матче НХЛ. Овечкин забросил 15-ю шайбу в сезоне';
  assert.equal(textContainsDate(headline), false);
  assert.equal(textOverlayDetected(headline), true);
  assert.equal(textOverlayDetected('Capitals defeated New Jersey in the NHL game. Ovechkin scored another goal.'), true);
  for (const text of ['МАТЧ!', 'АК БАРС ТОРПЕДО', 'CAPITALS 2:1 DEVILS 12:32', 'CITIZENS BANK', 'OVECHKIN 8']) {
    assert.equal(textOverlayDetected(text), false, text);
  }
});

test('OCR читает координаты слов, отбрасывает повреждённые строки', () => {
  const tsv = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n' +
    '5\t1\t1\t1\t1\t1\t20\t100\t60\t20\t94\tМАТЧ\n' +
    '5\t1\t1\t1\t1\t2\t90\t100\t80\t20\t88\tФОТО\n' +
    '4\t1\t1\t1\t1\t0\t20\t100\t150\t20\t-1\t\ninvalid';
  const result = parseOcrLayout(tsv);
  assert.equal(result.text, 'МАТЧ ФОТО');
  assert.equal(result.words.length, 2);
  assert.equal(result.words[0].left, 20);
});

test('крупный многострочный заголовок отличается от короткого логотипа и мелкой рекламы', () => {
  const words = [];
  for (const [row, text] of ['Большой красивый игровой момент', 'Все подробности смотрите внутри'].entries()) {
    for (const [column, token] of text.split(' ').entries()) words.push({
      text: token, left: 70 + column * 190, top: 240 + row * 50, width: 170, height: 28, confidence: 95
    });
  }
  assert.equal(textOverlayDetected('', { width: 1000, height: 600, words }), true);
  assert.equal(textOverlayDetected('', { width: 1000, height: 600, words: words.map(word => ({ ...word, height: 8 })) }), false);
  assert.equal(textOverlayDetected('', { width: 1000, height: 600, words: [{
    text: 'МАТЧ', left: 40, top: 25, width: 100, height: 30, confidence: 99
  }] }), false);
});

test('даты и новостные надписи проверяются одним распознаванием изображения', async () => {
  const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: 'white' } }).png().toBuffer();
  let calls = 0;
  const options = { skipCache: true, recognize: async () => {
    calls++;
    return 'Вашингтон победил Нью Джерси в матче НХЛ Овечкин забросил шайбу';
  } };
  assert.deepEqual(Object.fromEntries(Object.entries(await analyzeImageText(png, options)).filter(([key]) => key !== 'checkedAt')),
    { hasDate: false, hasTextOverlay: true });
  assert.equal(calls, 1);
  assert.equal(await imageHasDisallowedText(png, options), true);
  assert.equal(await imageHasDisallowedText(png, { skipCache: true, recognize: async () => '12.11.2026' }), true);
  assert.equal(await imageHasDisallowedText(png, { skipCache: true, recognize: async () => 'МАТЧ KHL 2:1' }), false);
});

test('разбитый OCR заголовка проверяется повторно на маске светлых букв', async () => {
  const png = await sharp({ create: { width: 480, height: 252, channels: 3, background: '#777' } }).png().toBuffer();
  let calls = 0;
  const result = await analyzeImageText(png, { skipCache: true, recognize: async () => {
    calls++;
    if (calls === 1) return { text: 'победи вечк', words: [
      { text: 'победи', left: 653, top: 446, width: 261, height: 61, confidence: 83 },
      { text: 'вечк', left: 647, top: 558, width: 159, height: 43, confidence: 92 }
    ] };
    return 'Вашингтон победил Нью Джерси в матче НХЛ Овечкин забросил шайбу';
  } });
  assert.equal(calls, 2);
  assert.equal(result.hasTextOverlay, true);
});
