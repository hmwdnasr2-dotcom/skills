// Must be first — sets process.env before core/index.ts is evaluated.
import './load-env.js';

import cors from 'cors';
import express from 'express';
import { AgentBridgeConnector } from '@aria/core';
import { claw } from './core/index.js';
import { GmailConnector, buildGmailAdapters } from './connectors/gmail.js';
import { buildProjectAdapters } from './connectors/tasks.js';
import { buildWorkspaceAdapters } from './connectors/workspace.js';
import { startScheduler } from './proactive/scheduler.js';
import { authRouter } from './routes/auth.js';
import { chatRouter } from './routes/chat.js';
import { eventsRouter } from './routes/events.js';
import { memoryRouter } from './routes/memory.js';
import { uploadRouter } from './routes/upload.js';
import { downloadRouter } from './routes/download.js';

const app = express();
const PORT = Number(process.env.PORT ?? 4000);

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use(cors());          // Allow all origins — no exact-string matching
app.use(express.json({ limit: '10mb' }));

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

// ─── Wire task tools ──────────────────────────────────────────────────────────

if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
  const taskBridge = new AgentBridgeConnector();
  for (const adapter of buildProjectAdapters()) {
    taskBridge.register(adapter.name, adapter);
  }
  claw.use(taskBridge);
  console.log('[server] Task tools registered (add_task, list_tasks, complete_task, create_project, list_projects)');

  const workspaceBridge = new AgentBridgeConnector();
  for (const adapter of buildWorkspaceAdapters()) {
    workspaceBridge.register(adapter.name, adapter);
  }
  claw.use(workspaceBridge);
  console.log('[server] Workspace tools registered (follow-ups, achievements, daily logs, reports)');
} else {
  console.log('[server] Task tools skipped — SUPABASE_URL / SUPABASE_ANON_KEY not set');
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/api/aria/chat', chatRouter);
app.use('/api/aria/events', eventsRouter);
app.use('/api/aria/memory', memoryRouter);
app.use('/api/aria/upload', uploadRouter);
app.use('/api/aria/download', downloadRouter);
app.use('/api/auth', authRouter);

app.get('/', (_req, res) => res.json({ service: 'ARIA', status: 'ok' }));
app.get('/health', (_req, res) => res.json({ ok: true }));

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[server] ARIA server listening on http://localhost:${PORT}`);
  console.log(`[server] Brain: ${process.env.ARIA_BRAIN ?? 'claude'} / ${process.env.ARIA_MODEL ?? 'default'}`);
  startScheduler();
});
