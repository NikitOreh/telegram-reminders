import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(dir, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const token = process.env.BOT_TOKEN;
if (!token || token.includes('replace-me')) {
  console.error('Сначала впишите BOT_TOKEN в файл .env');
  process.exit(1);
}

console.log('Ожидаю сообщения. Напишите своему боту /start и опубликуйте по одному новому сообщению в каждом закрытом канале после добавления бота администратором.');
console.log('Скопируйте показанные ID в .env. Для завершения нажмите Ctrl+C. Токен не выводится.');

let offset;
const shown = new Set();
while (true) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ offset, timeout: 20, allowed_updates: ['message', 'channel_post'] }),
      signal: AbortSignal.timeout(25_000)
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.description || `HTTP ${response.status}`);
    for (const update of data.result) {
      offset = update.update_id + 1;
      const privateMessage = update.message;
      if (privateMessage?.chat?.type === 'private' && privateMessage.from?.id) {
        const id = privateMessage.from.id;
        const key = `user:${id}`;
        if (!shown.has(key)) {
          shown.add(key);
          const name = [privateMessage.from.first_name, privateMessage.from.last_name, privateMessage.from.username ? `@${privateMessage.from.username}` : ''].filter(Boolean).join(' ');
          console.log(`OWNER_ID=${id}    (${name})`);
        }
      }
      const channel = update.channel_post?.chat;
      if (channel?.type === 'channel') {
        const key = `channel:${channel.id}`;
        if (!shown.has(key)) {
          shown.add(key);
          console.log(`${channel.title || 'Канал'}: ${channel.id}`);
        }
      }
    }
  } catch (error) {
    console.error(`Не удалось получить обновления: ${error.message}`);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}
