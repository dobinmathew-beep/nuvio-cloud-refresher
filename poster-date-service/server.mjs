import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import posterHandler from './api/poster.mjs';
import healthHandler from './api/health.mjs';

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

  const posterMatch = url.pathname.match(/^\/poster\/(tt\d{7,10})\.jpg$/);
  if (posterMatch) {
    adaptedReq.query.id = posterMatch[1];
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
