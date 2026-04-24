import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env before any other imports touch process.env
const __dir = dirname(fileURLToPath(import.meta.url));
try {
  const envPath = resolve(__dir, '../../.env');
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (k && !(k in process.env)) process.env[k] = v;
  }
} catch {
  // no .env file — rely on real env vars
}

import express from 'express';
import { AgentBridgeConnector } from '@aria/core';
import { claw } from './core/index.js';
import { GmailConnector, buildGmailAdapters } from './connectors/gmail.js';
import { startScheduler } from './proactive/scheduler.js';
import { chatRouter } from './routes/chat.js';
import { eventsRouter } from './routes/events.js';

const app = express();
const PORT = Number(process.env.PORT ?? 4000);

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// ─── Wire Gmail connector ─────────────────────────────────────────────────────

if (
  process.env.GMAIL_CLIENT_ID &&
  process.env.GMAIL_CLIENT_SECRET &&
  process.env.GMAIL_REFRESH_TOKEN
) {
  const gmail = new GmailConnector();
  const gmailBridge = new AgentBridgeConnector();
  for (const adapter of buildGmailAdapters(gmail)) {
    gmailBridge.register(adapter.name, adapter);
  }
  claw.use(gmailBridge);
  console.log('[server] Gmail connector registered (gmail_list, gmail_get, gmail_send)');
} else {
  console.log('[server] Gmail connector skipped — GMAIL_* env vars not set');
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/api/aria/chat', chatRouter);
app.use('/api/aria/events', eventsRouter);

app.get('/health', (_req, res) => res.json({ ok: true }));

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[server] ARIA server listening on http://localhost:${PORT}`);
  startScheduler();
});
