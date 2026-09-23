// Always-on dashboard service (docs/ARCHITECTURE.md §1, §6). Serves the status page,
// the settings API (add/edit/delete apps), screenshots, and the "Run now" trigger.
// NEVER launches a browser itself — "Run now" spawns src/scan.js as a detached child
// (docs/BUILD-RULES.md rule 1). Reads the DB; the scan worker writes it.
//
// Security: mutations require the write token (when WRITE_TOKEN is set) sent as the
// custom header x-write-token — a custom-header requirement is also the CSRF guard,
// since a cross-site form cannot set custom headers. URLs pass the SSRF guard on add
// and edit. Bind to the internal interface + a subnet firewall rule (see DEPLOYMENT).

import 'dotenv/config';

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';

import { createApp, deleteApp, getApp, listApps, updateApp } from './db/apps.js';
import { getAppHistory, getLatestStatuses } from './db/results.js';
import { getDb } from './db/db.js';
import { screenshotRoot } from './storage/screenshots.js';
import { assertUrlAllowed } from './security/ssrf.js';
import { spawnScan } from './scan/spawnScan.js';
import { startScheduler } from './scan/scheduler.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, '..', 'public');

/** Require the write token on mutations, but only when one is configured. */
function requireToken(req, reply, done) {
  const token = process.env.WRITE_TOKEN;
  if (!token) return done(); // not configured: open (dev / trusted-LAN-only)
  if (req.headers['x-write-token'] === token) return done();
  reply.code(401).send({ error: 'invalid or missing write token' });
}

export async function buildServer() {
  getDb(); // open + migrate up front

  const ssDir = screenshotRoot();
  mkdirSync(ssDir, { recursive: true }); // @fastify/static needs the root to exist

  const app = Fastify({ logger: false, bodyLimit: 1_000_000 });

  app.setErrorHandler((err, _req, reply) => {
    const code =
      typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600
        ? err.statusCode
        : 500;
    reply.code(code).send({ error: err.message || 'internal error' });
  });

  // Audit log (docs/BUILD-RULES.md rule 19): every mutation with source IP, time, and
  // result. Goes to the service log (captured by NSSM in production).
  app.addHook('onResponse', (req, reply, done) => {
    if (req.method !== 'GET') {
      // eslint-disable-next-line no-console
      console.log(
        `[audit] ${new Date().toISOString()} ${req.ip} ${req.method} ${req.url} -> ${reply.statusCode}`,
      );
    }
    done();
  });

  // Static: the SPA and its assets, plus screenshots on a separate prefix.
  await app.register(fastifyStatic, { root: PUBLIC_DIR, prefix: '/' });
  await app.register(fastifyStatic, {
    root: ssDir,
    prefix: '/screenshots/',
    decorateReply: false,
  });

  // --- read endpoints (open) ---
  app.get('/api/status', async () => getLatestStatuses());
  app.get('/api/apps', async () => listApps());
  app.get('/api/apps/:id/history', async (req) =>
    getAppHistory(Number(req.params.id), 50),
  );
  app.get('/api/config', async () => ({ writeTokenRequired: !!process.env.WRITE_TOKEN }));

  // --- mutations (token-guarded) ---
  app.post('/api/apps', { preHandler: requireToken }, async (req, reply) => {
    const body = req.body || {};
    await assertUrlAllowed(body.url); // SSRF guard; throws 400 on a blocked URL
    return reply.code(201).send(createApp(body));
  });

  app.put('/api/apps/:id', { preHandler: requireToken }, async (req, reply) => {
    const body = req.body || {};
    if (body.url !== undefined) await assertUrlAllowed(body.url);
    if (!getApp(Number(req.params.id))) return reply.code(404).send({ error: 'not found' });
    return updateApp(Number(req.params.id), body);
  });

  app.delete('/api/apps/:id', { preHandler: requireToken }, async (req, reply) => {
    if (!deleteApp(Number(req.params.id))) return reply.code(404).send({ error: 'not found' });
    return { deleted: true };
  });

  // Run a scan now by spawning the short-lived worker (single-flight lock guards overlap).
  app.post('/api/run-now', { preHandler: requireToken }, async (_req, reply) => {
    spawnScan('manual');
    return reply.code(202).send({ started: true });
  });

  return app;
}

async function start() {
  const port = Number(process.env.PORT || 8080);
  const host = process.env.BIND_HOST || '0.0.0.0';
  const app = await buildServer();
  try {
    await app.listen({ port, host });
    // eslint-disable-next-line no-console
    console.log(`Five Star Sentinel dashboard listening on http://${host}:${port}`);
    if (!process.env.WRITE_TOKEN) {
      console.warn('WARNING: WRITE_TOKEN is not set — settings mutations are UNPROTECTED.');
    }
    // Start the in-process scheduler (7am/7pm + startup catch-up).
    startScheduler();
  } catch (e) {
    console.error('failed to start server:', e);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  start();
}
