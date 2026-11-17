import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
process.env.BILLING_TABLE = 'gcp_billing_export_v1_AAAAAA_BBBBBB_CCCCCC';
process.env.TELEGRAM_ALERT_SETTINGS = JSON.stringify({ botToken: '123:fake', ownerId: '1234' });
const { handle } = await import('./server.js');

async function request(path, body) {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = 'POST'; req.url = path;
  const res = { status: null, writeHead(status) { this.status = status; return this; }, end() {} };
  await handle(req, res);
  return res.status;
}

test('увеличение расходов записывает метрику и сообщает владельцу', async () => {
  const calls = [];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('metadata.google.internal')) return { ok: true, json: async () => ({ access_token: 'fake' }) };
    if (url.includes('/queries')) {
      const rows = Array.from({ length: 8 }, (_, i) => ({ f: [{ v: `2026-11-${String(i + 1).padStart(2, '0')}` },
        { v: 'USD' }, { v: i === 7 ? '1.5' : '1' }, { v: '1' }] }));
      return { ok: true, status: 200, json: async () => ({ jobComplete: true, rows }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  try {
    assert.equal(await request('/cost', {}), 204);
    const metric = calls.find(call => call.url.includes('/timeSeries'));
    assert.equal(JSON.parse(metric.options.body).timeSeries[0].points[0].value.int64Value, '1');
    const telegram = calls.find(call => call.url.includes('api.telegram.org'));
    const message = JSON.parse(telegram.options.body);
    assert.equal(message.chat_id, '1234');
    assert.match(message.text, /\+50\.0%/);
  } finally { globalThis.fetch = oldFetch; }
});

test('событие Monitoring доставляется в Telegram', async () => {
  const oldFetch = globalThis.fetch;
  let text;
  globalThis.fetch = async (_url, options) => { text = JSON.parse(options.body).text; return { ok: true, status: 200 }; };
  try {
    const event = { incident: { state: 'open', policy_name: 'Сервер недоступен' } };
    assert.equal(await request('/incident', { message: { data: Buffer.from(JSON.stringify(event)).toString('base64') } }), 204);
    assert.match(text, /Сервер недоступен/);
  } finally { globalThis.fetch = oldFetch; }
});
