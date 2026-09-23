// CI smoke for the dashboard server. Uses Fastify's inject() — no real socket, no
// network. Tests the API, the write-token guard, the SSRF guard (IP literals only, so
// no DNS), and static serving. Exits non-zero on failure.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function assert(cond, msg) {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}

const work = mkdtempSync(join(tmpdir(), 'ws-srv-'));
process.env.DB_PATH = join(work, 'scanner.db');
process.env.SCREENSHOT_DIR = join(work, 'screenshots');
process.env.WRITE_TOKEN = 'testtoken';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;

const { buildServer } = await import('../src/server.js');
const { closeDb } = await import('../src/db/db.js');
const app = await buildServer();
const TOK = { 'x-write-token': 'testtoken' };

try {
  // status starts empty
  let r = await app.inject({ method: 'GET', url: '/api/status' });
  assert(r.statusCode === 200 && Array.isArray(r.json()), 'GET /api/status ok');

  // config reports token requirement
  r = await app.inject({ method: 'GET', url: '/api/config' });
  assert(r.json().writeTokenRequired === true, 'config reports token required');

  // mutation without token -> 401
  r = await app.inject({ method: 'POST', url: '/api/apps', payload: { name: 'X', url: 'http://10.0.0.5/' } });
  assert(r.statusCode === 401, 'POST without token -> 401');

  // valid private-IP app with token -> 201
  r = await app.inject({
    method: 'POST',
    url: '/api/apps',
    headers: TOK,
    payload: { name: 'LAN App', url: 'http://10.0.0.5/dash', is_rich_dashboard: true, sections: ['A', 'B'] },
  });
  assert(r.statusCode === 201, `private IP allowed (got ${r.statusCode})`);
  const appId = r.json().id;
  assert(r.json().url === 'http://10.0.0.5/dash', 'url stored');

  // SSRF: loopback + metadata blocked
  r = await app.inject({ method: 'POST', url: '/api/apps', headers: TOK, payload: { name: 'lo', url: 'http://127.0.0.1/' } });
  assert(r.statusCode === 400, 'loopback blocked');
  r = await app.inject({ method: 'POST', url: '/api/apps', headers: TOK, payload: { name: 'meta', url: 'http://169.254.169.254/' } });
  assert(r.statusCode === 400, 'metadata address blocked');

  // list, update, delete
  r = await app.inject({ method: 'GET', url: '/api/apps' });
  assert(r.json().length === 1, 'one app listed');

  r = await app.inject({ method: 'PUT', url: `/api/apps/${appId}`, headers: TOK, payload: { name: 'Renamed' } });
  assert(r.statusCode === 200 && r.json().name === 'Renamed', 'update ok');

  // run-now requires token
  r = await app.inject({ method: 'POST', url: '/api/run-now' });
  assert(r.statusCode === 401, 'run-now without token -> 401');

  r = await app.inject({ method: 'DELETE', url: `/api/apps/${appId}`, headers: TOK });
  assert(r.statusCode === 200, 'delete ok');
  r = await app.inject({ method: 'GET', url: '/api/apps' });
  assert(r.json().length === 0, 'deleted app hidden');

  // static serving
  r = await app.inject({ method: 'GET', url: '/' });
  assert(r.statusCode === 200 && r.payload.includes('Five Star Sentinel'), 'index.html served');
  r = await app.inject({ method: 'GET', url: '/styles.css' });
  assert(r.statusCode === 200, 'styles.css served');

  // path traversal must not escape the screenshots root
  r = await app.inject({ method: 'GET', url: '/screenshots/..%2f..%2fpackage.json' });
  assert(r.statusCode !== 200, 'path traversal blocked');

  console.log('SERVER SMOKE PASSED');
} finally {
  await app.close();
  closeDb(); // release the SQLite file handle so Windows can unlink it
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // best-effort temp cleanup; a leftover lock must not fail CI
  }
}
