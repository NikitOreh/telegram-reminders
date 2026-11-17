import http from 'node:http';
import fs from 'node:fs/promises';

// HTTP responses contain no private bot or channel information.
export function createHealthMonitor({ now = () => Date.now(), staleAfter = 300000 } = {}) {
  let lastJobs = now();
  let lastPoll = now();
  let incidentUntil = 0;
  return {
    jobsSucceeded() { lastJobs = now(); },
    pollSucceeded() { lastPoll = now(); },
    incident() { incidentUntil = Math.max(incidentUntil, now() + 900000); },
    isHealthy({ diskFreeRatio = 1 } = {}) {
      const time = now();
      return time - lastJobs <= staleAfter && time - lastPoll <= staleAfter &&
        time >= incidentUntil && Number.isFinite(diskFreeRatio) && diskFreeRatio >= 0.05;
    }
  };
}

export function startHealthServer(monitor, directory, port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Некорректный HEALTH_PORT');
  const server = http.createServer(async (request, response) => {
    if (request.method !== 'GET' || request.url !== '/health') { response.writeHead(404).end(); return; }
    try {
      const disk = await fs.statfs(directory);
      const ok = monitor.isHealthy({ diskFreeRatio: Number(disk.bavail) / Number(disk.blocks) });
      response.writeHead(ok ? 200 : 503, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      response.end(ok ? 'ok' : 'unavailable');
    } catch {
      response.writeHead(503).end('unavailable');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => { server.off('error', reject); resolve(server); });
  });
}
