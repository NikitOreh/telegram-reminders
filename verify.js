import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOwnerIds } from './user-sessions.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(dir, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }

const token = process.env.BOT_TOKEN || '';
let ownerIds;
try { ownerIds = parseOwnerIds(process.env.OWNER_ID); }
catch (error) { console.error(error.message); process.exit(1); }
const networks = [1, 2].map(n => (process.env[`NETWORK_${n}`] || '').split(',').map(x => x.trim()).filter(Boolean));
let failed = false;

if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
  console.error('BOT_TOKEN: неверный формат или поле пустое. Нужен токен из BotFather, не числовой ID бота.');
  process.exit(1);
}
if (!networks.some(x => x.length)) {
  console.error('Укажите хотя бы один канал в NETWORK_1 или NETWORK_2.');
  process.exit(1);
}

async function api(method, body = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000)
  });
  const result = await response.json();
  if (!result.ok) throw new Error(result.description || `HTTP ${response.status}`);
  return result.result;
}

let bot;
try {
  bot = await api('getMe');
  console.log(`BOT_TOKEN: действителен, бот @${bot.username} (ID ${bot.id}).`);
} catch (error) {
  console.error(`BOT_TOKEN: Telegram не подтвердил токен (${error.message}).`);
  process.exit(1);
}

for (const ownerId of ownerIds) {
  try {
    const owner = await api('getChat', { chat_id: ownerId });
    console.log(`OWNER_ID ${ownerId}: Telegram видит личный чат ${owner.id}.`);
  } catch {
    console.log(`OWNER_ID ${ownerId}: личный чат пока не подтверждён. Пользователю нужно написать боту /start.`);
  }
}

for (let i = 0; i < networks.length; i++) {
  if (!networks[i].length) {
    console.log(`Сетка ${i + 1}: пока без каналов.`);
    continue;
  }
  for (const channelId of networks[i]) {
    if (!/^-100\d+$/.test(channelId) && !/^@[A-Za-z0-9_]+$/.test(channelId)) {
      console.error(`Сетка ${i + 1}, ${channelId}: нужен числовой ID канала вида -100...`);
      failed = true;
      continue;
    }
    try {
      const chat = await api('getChat', { chat_id: channelId });
      if (chat.type !== 'channel') throw new Error('это не канал');
      const member = await api('getChatMember', { chat_id: channelId, user_id: bot.id });
      const admin = member.status === 'administrator' || member.status === 'creator';
      const post = member.status === 'creator' || member.can_post_messages === true;
      const remove = member.status === 'creator' || member.can_delete_messages === true;
      console.log(`Сетка ${i + 1}, «${chat.title}» (${chat.id}): администратор=${admin}, публикация=${post}, удаление=${remove}.`);
      if (!admin || !post || !remove) failed = true;
    } catch (error) {
      console.error(`Сетка ${i + 1}, ${channelId}: не удалось проверить канал (${error.message}).`);
      failed = true;
    }
  }
}

if (failed) process.exitCode = 1;
