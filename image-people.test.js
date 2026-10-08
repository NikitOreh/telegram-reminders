import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { imageShowsSportPeople, runLocalPersonDetector } from './image-people.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const referencePhotos = [
  'photo_2026-10-05_22-32-19.jpg',
  'photo_2026-10-05_17-59-27.jpg',
  'photo_2026-10-05_23-12-26.jpg'
];
const localPhotosAvailable = referencePhotos.every(name => existsSync(path.join(ROOT, 'reference-images', name)));
const photoTestOptions = { skip: localPhotosAvailable ? false : 'Локальные фото не включены в репозиторий' };

test('локальная проверка отсеивает кадр без людей', photoTestOptions, async () => {
  const image = await fs.readFile(path.join(ROOT, 'reference-images', 'photo_2026-10-05_22-32-19.jpg'));
  assert.equal(await runLocalPersonDetector(image), false);
  const flags = await fs.readFile(path.join(ROOT, 'reference-images', 'photo_2026-10-05_17-59-27.jpg'));
  assert.equal(await runLocalPersonDetector(flags), false);
});

test('локальная проверка принимает кадр с игроками', photoTestOptions, async () => {
  const image = await fs.readFile(path.join(ROOT, 'reference-images', 'photo_2026-10-05_23-12-26.jpg'));
  assert.equal(await imageShowsSportPeople(image, '⚽', { skipCache: true }), true);
});
