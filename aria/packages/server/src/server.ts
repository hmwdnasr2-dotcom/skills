// Must be first — sets process.env before core/index.ts is evaluated.
import './load-env.js';

import cors from 'cors';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { AgentBridgeConnector } from '@aria/core';
import { claw } from './core/index.js';
import { GmailConnector, buildGmailAdapters } from './connectors/gmail.js';
import { buildProjectAdapters } from './connectors/tasks.js';
import { buildWorkspaceAdapters } from './connectors/workspace.js';
import { buildReminderAdapters } from './connectors/reminders.js';
import { buildReportAdapters } from './connectors/reports.js';
import { buildIdeasAdapters } from './connectors/ideas.js';
import { buildDocumentAdapters } from './connectors/documents.js';
import { startScheduler } from './proactive/scheduler.js';
import { authRouter } from './routes/auth.js';
import { chatRouter } from './routes/chat.js';
import { eventsRouter } from './routes/events.js';
import { memoryRouter } from './routes/memory.js';
import { uploadRouter } from './routes/upload.js';
import { downloadRouter } from './routes/download.js';
import { startTelegramPolling, telegramEnabled } from './services/telegram.js';

const app = express();
const PORT = Number(process.env.PORT ?? 4000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST  = path.resolve(__dirname, '../../web/dist');

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use((req, _res, next) => {
  if (!req.path.startsWith('/assets') && !req.path.startsWith('/api/aria/events')) {
    console.log(`[http] ${req.method} ${req.path}`);
  }
  next();
});

app.use(cors());
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

  const reminderBridge = new AgentBridgeConnector();
  for (const adapter of buildReminderAdapters()) {
    reminderBridge.register(adapter.name, adapter);
  }
  claw.use(reminderBridge);
  console.log('[server] Reminder tools registered (set_reminder, list_reminders, cancel_reminder)');

  const reportBridge = new AgentBridgeConnector();
  for (const adapter of buildReportAdapters()) {
    reportBridge.register(adapter.name, adapter);
  }
  claw.use(reportBridge);
  console.log('[server] Report tools registered (generate_report)');

  const workspaceBridge = new AgentBridgeConnector();
  for (const adapter of buildWorkspaceAdapters()) {
    workspaceBridge.register(adapter.name, adapter);
  }
  claw.use(workspaceBridge);
  console.log('[server] Workspace tools registered (follow-ups, achievements, daily logs)');

  const ideasBridge = new AgentBridgeConnector();
  for (const adapter of buildIdeasAdapters()) {
    ideasBridge.register(adapter.name, adapter);
  }
  claw.use(ideasBridge);
  console.log('[server] Ideas tools registered (save_idea, list_ideas)');

  const docsBridge = new AgentBridgeConnector();
  for (const adapter of buildDocumentAdapters()) {
    docsBridge.register(adapter.name, adapter);
  }
  claw.use(docsBridge);
  console.log('[server] Document tools registered (create_excel, create_pdf)');
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

app.get('/health', (_req, res) => res.json({ ok: true }));

// ─── Serve React frontend (must be after all API routes) ──────────────────────

app.use(express.static(WEB_DIST, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));
app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(WEB_DIST, 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  const key = process.env.ANTHROPIC_API_KEY ?? '';
  const keyInfo = key
    ? `set (${key.length} chars, starts: ${key.slice(0, 14)}...)`
    : 'NOT SET';
  console.log(`[server] ANTHROPIC_API_KEY: ${keyInfo}`);
  console.log(`[server] ARIA server listening on http://localhost:${PORT}`);
  console.log(`[server] Brain: ${process.env.ARIA_BRAIN ?? 'claude'} / ${process.env.ARIA_MODEL ?? 'default'}`);
  startScheduler();

  if (telegramEnabled()) {
    startTelegramPolling().catch((err) => console.error('[server] Telegram startup error:', err));
  } else {
    console.log('[server] Telegram disabled — set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID to enable');
  }
});
