import http from 'node:http';
import { compareCosts, formatCostAlert } from './cost.js';

const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
const billingTable = process.env.BILLING_TABLE;
const secret = JSON.parse(process.env.TELEGRAM_ALERT_SETTINGS || '{}');
const metricType = 'custom.googleapis.com/telegram_reminders/cost_increase';
const timeout = milliseconds => AbortSignal.timeout(milliseconds);

async function accessToken() {
  const response = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: { 'Metadata-Flavor': 'Google' }, signal: timeout(10000)
  });
  if (!response.ok) throw new Error(`Metadata token: HTTP ${response.status}`);
  return (await response.json()).access_token;
}

async function googleRequest(url, body) {
  const token = await accessToken();
  const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`,
    'content-type': 'application/json' }, body: JSON.stringify(body), signal: timeout(30000) });
  if (!response.ok) throw new Error(`Google API: HTTP ${response.status} ${String(await response.text()).slice(0, 500)}`);
  return response.status === 204 ? {} : response.json();
}

async function sendTelegram(text) {
  if (!secret.botToken || !/^\d+$/.test(String(secret.ownerId))) throw new Error('Telegram alert settings missing');
  const response = await fetch(`https://api.telegram.org/bot${secret.botToken}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: secret.ownerId, text: text.slice(0, 4000), disable_web_page_preview: true }),
    signal: timeout(15000)
  });
  if (!response.ok) throw new Error(`Telegram: HTTP ${response.status}`);
}

export function incidentText(payload) {
  const incident = payload?.incident;
  if (!incident || !['open', 'closed'].includes(incident.state)) return null;
  const title = incident.state === 'open' ? '🚨 Авария Google Cloud' : '✅ Ситуация восстановлена';
  return [title, incident.policy_name, incident.summary, incident.url].filter(Boolean).join('\n');
}

async function queryCosts() {
  if (!project || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project) ||
      !/^gcp_billing_export_v1_[A-F0-9_]+$/.test(billingTable || '')) throw new Error('Billing table configuration missing');
  // Free-tier and contractual credits reduce usage costs; promotional trial credit is payment, not a discount.
  const query = `WITH daily AS (
    SELECT DATE(usage_start_time, 'Europe/Moscow') AS day, currency,
      SUM(cost + COALESCE((SELECT SUM(c.amount) FROM UNNEST(credits) c WHERE c.type != 'PROMOTION'), 0)) AS amount,
      COUNT(*) AS records
    FROM \`${project}.bot_billing_alerts.${billingTable}\`
    WHERE project.id = @project AND DATE(usage_start_time, 'Europe/Moscow')
      BETWEEN DATE_SUB(CURRENT_DATE('Europe/Moscow'), INTERVAL 9 DAY) AND DATE_SUB(CURRENT_DATE('Europe/Moscow'), INTERVAL 2 DAY)
    GROUP BY day, currency
  ) SELECT CAST(day AS STRING), currency, amount, records FROM daily ORDER BY day`;
  const result = await googleRequest(`https://bigquery.googleapis.com/bigquery/v2/projects/${project}/queries`, {
    query, useLegacySql: false, location: 'US', timeoutMs: 20000, maximumBytesBilled: '1000000000',
    parameterMode: 'NAMED', queryParameters: [{ name: 'project', parameterType: { type: 'STRING' }, parameterValue: { value: project } }]
  });
  if (!result.jobComplete) throw new Error('Billing query has not completed; scheduler can retry');
  return (result.rows || []).map(row => ({ date: row.f[0].v, currency: row.f[1].v,
    cost: Number(row.f[2].v), hasData: Number(row.f[3].v) > 0 }));
}

async function writeCostMetric(increased) {
  await googleRequest(`https://monitoring.googleapis.com/v3/projects/${project}/timeSeries`, {
    timeSeries: [{ metric: { type: metricType }, resource: { type: 'global', labels: { project_id: project } },
      points: [{ interval: { endTime: new Date().toISOString() }, value: { int64Value: increased ? '1' : '0' } }] }]
  });
}

async function readBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1024 * 1024) throw new Error('Request too large');
  }
  return JSON.parse(body || '{}');
}

export async function handle(request, response) {
  try {
    if (request.method !== 'POST') { response.writeHead(405).end(); return; }
    if (request.url === '/incident') {
      const body = await readBody(request);
      const payload = JSON.parse(Buffer.from(body.message?.data || '', 'base64').toString('utf8') || '{}');
      const text = incidentText(payload);
      if (text) await sendTelegram(text);
      response.writeHead(204).end(); return;
    }
    if (request.url === '/cost') {
      const result = compareCosts(await queryCosts());
      if (result.status === 'insufficient_data') {
        console.log(JSON.stringify({ event: 'billing_history_incomplete' }));
        response.writeHead(204).end(); return;
      }
      await writeCostMetric(result.status === 'increase');
      if (result.status === 'increase') await sendTelegram(formatCostAlert(result));
      console.log(JSON.stringify({ event: 'billing_check', status: result.status, date: result.date }));
      response.writeHead(204).end(); return;
    }
    response.writeHead(404).end();
  } catch (error) {
    console.error(JSON.stringify({ event: 'alert_processing_failed', message: error.message }));
    response.writeHead(503).end();
  }
}

if (process.env.PORT) http.createServer(handle).listen(Number(process.env.PORT), '0.0.0.0');
