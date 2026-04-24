// Must be first — ESM evaluates imports in order, so this sets process.env
// before core/index.ts constructs the brain.
import 'dotenv/config';

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
  console.log(`[server] Brain: ${process.env.ARIA_BRAIN ?? 'claude'} / ${process.env.ARIA_MODEL ?? 'default'}`);
  startScheduler();
});
