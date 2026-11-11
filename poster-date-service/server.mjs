import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import posterHandler from './api/poster.mjs';
import healthHandler from './api/health.mjs';
import { runImageKitMaintenance } from './lib/imagekit-storage.mjs';

const port = Number(process.env.PORT || 10000);
const publicIndex = resolve(process.cwd(), 'public/index.html');

function responseAdapter(res) {
  return {
    get statusCode() { return res.statusCode; },
    set statusCode(value) { res.statusCode = value; },
    setHeader(name, value) { res.setHeader(name, value); },
    end(body) { res.end(body); }
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const adaptedReq = { method: req.method, url: req.url, query: Object.fromEntries(url.searchParams) };
  const adaptedRes = responseAdapter(res);

  if (url.pathname === '/' && req.method === 'GET') {
    try {
      const html = await readFile(publicIndex);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(html);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Service homepage unavailable');
    }
  }

  if (url.pathname === '/health') return healthHandler(adaptedReq, adaptedRes);

  // Safe, fixed maintenance action: no user-supplied IDs or paths are accepted.
  // A six-hour in-process cooldown prevents repeated public triggering.
  if (url.pathname === '/maintenance') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Allow': 'POST', 'Cache-Control': 'no-store' });
      return res.end('Method not allowed');
    }
    try {
      const report = await runImageKitMaintenance();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(report));
    } catch (error) {
      console.error('ImageKit maintenance failed:', error.message);
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ status: 'maintenance-failed', error: error.message }));
    }
  }

  // Xperience may probe the literal template before substituting an IMDb ID.
  // Serve a real, stable BetterPosters sample image for that one validation request.
  const templateProbe = /^\/poster\/(?:\{imdb_id\}|%7Bimdb_id%7D)\.jpg$/i.test(url.pathname);
  const posterMatch = url.pathname.match(/^\/poster\/(tt\d{7,10})\.jpg$/i);
  if (templateProbe || posterMatch) {
    adaptedReq.query.id = templateProbe ? 'tt0111161' : posterMatch[1];
    adaptedReq.probe = templateProbe;
    return posterHandler(adaptedReq, adaptedRes);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end('Not found');
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Great Indian Upcoming Poster Service listening on port ${port}`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
