// Must be first — sets process.env before core/index.ts is evaluated.
import './load-env.js';

import cors from 'cors';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { AgentBridgeConnector } from '@aria/core';
import { claw, activateBraveSearch, setAgentMode } from './core/index.js';
import { GmailConnector, buildGmailAdapters } from './connectors/gmail.js';
import { buildProjectAdapters } from './connectors/tasks.js';
import { buildWorkspaceAdapters } from './connectors/workspace.js';
import { buildReminderAdapters } from './connectors/reminders.js';
import { buildReportAdapters } from './connectors/reports.js';
import { buildIdeasAdapters } from './connectors/ideas.js';
import { buildDocumentAdapters } from './connectors/documents.js';
import { startScheduler } from './proactive/scheduler.js';
import { authRouter } from './routes/auth.js';
import { workflowsRouter } from './routes/workflows.js';
import { agentsRouter } from './routes/agents.js';
import { chatRouter } from './routes/chat.js';
import { eventsRouter } from './routes/events.js';
import { memoryRouter } from './routes/memory.js';
import { uploadRouter } from './routes/upload.js';
import { downloadRouter } from './routes/download.js';
import { taskManagerRouter } from './routes/task-manager.js';
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

// ─── Wire Gmail connector (always registered — credentials checked at call time)
{
  const gmail = new GmailConnector();
  const gmailBridge = new AgentBridgeConnector();
  for (const adapter of buildGmailAdapters(gmail)) {
    gmailBridge.register(adapter.name, adapter);
  }
  claw.use(gmailBridge);
  const gmailReady = !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
  console.log(`[server] Gmail connector registered (gmail_send) — credentials ${gmailReady ? 'present ✓' : 'MISSING — add GMAIL_USER + GMAIL_APP_PASSWORD to .env'}`);
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
app.use('/api/aria/workflows', workflowsRouter);
app.use('/api/aria/agents', agentsRouter);
app.use('/api/aria/tasks', taskManagerRouter);

app.get('/health', (_req, res) => res.json({ ok: true }));

// Set agent mode (called by frontend when switching agents)
app.post('/api/aria/mode', (req, res) => {
  const { userId = 'user-1', mode } = req.body as { userId?: string; mode?: string };
  if (!mode) { res.status(400).json({ error: 'mode required' }); return; }
  setAgentMode(userId, mode);
  console.log(`[mode] ${userId} → ${mode}`);
  res.json({ ok: true, userId, mode });
});

// ─── OpenClaw settings API ────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from 'node:fs';

const ENV_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env');

function patchEnvFile(key: string, value: string): void {
  let raw = '';
  try { raw = readFileSync(ENV_FILE, 'utf8'); } catch { /* new file */ }
  const lines = raw.split('\n').filter(l => !l.startsWith(`${key}=`));
  lines.push(`${key}=${value}`);
  writeFileSync(ENV_FILE, lines.join('\n'));
}

const BRAIN_DEFAULTS: Record<string, string> = {
  claude:   'claude-haiku-4-5-20251001',
  deepseek: 'deepseek-chat',
  openai:   'gpt-4o-mini',
  groq:     'llama3-8b-8192',
  gemini:   'gemini-2.0-flash',
  ollama:   'llama3',
};

app.get('/api/aria/openclaw', (_req, res) => {
  res.json({
    brain:            process.env.ARIA_BRAIN    ?? 'claude',
    model:            process.env.ARIA_MODEL    ?? BRAIN_DEFAULTS['claude'],
    hasAnthropicKey:  !!process.env.ANTHROPIC_API_KEY,
    hasDeepseekKey:   !!process.env.DEEPSEEK_API_KEY,
    hasOpenaiKey:     !!process.env.OPENAI_API_KEY,
    hasGroqKey:       !!process.env.GROQ_API_KEY,
    hasGeminiKey:     !!process.env.GEMINI_API_KEY,
    hasBraveKey:      !!process.env.BRAVE_SEARCH_API_KEY,
    hasPerplexityKey: !!process.env.PERPLEXITY_API_KEY,
    hasGmailUser:     !!process.env.GMAIL_USER,
    hasGmailPass:     !!process.env.GMAIL_APP_PASSWORD,
    gmailUser:        process.env.GMAIL_USER ?? '',
    webSearch:        process.env.BRAVE_SEARCH_API_KEY ? 'brave' : process.env.PERPLEXITY_API_KEY ? 'perplexity' : 'none',
    brainDefaults:    BRAIN_DEFAULTS,
  });
});

app.post('/api/aria/openclaw', (req, res) => {
  const {
    brain, model,
    anthropicKey, deepseekKey, openaiKey, groqKey, geminiKey,
    braveKey, perplexityKey,
    gmailUser, gmailAppPassword,
  } = req.body as Record<string, string | undefined>;

  if (brain && BRAIN_DEFAULTS[brain]) {
    patchEnvFile('ARIA_BRAIN', brain);
    process.env.ARIA_BRAIN = brain;
  }
  if (model?.trim()) {
    patchEnvFile('ARIA_MODEL', model.trim());
    process.env.ARIA_MODEL = model.trim();
  }
  if (anthropicKey?.trim()) {
    patchEnvFile('ANTHROPIC_API_KEY', anthropicKey.trim());
    process.env.ANTHROPIC_API_KEY = anthropicKey.trim();
  }
  if (deepseekKey?.trim()) {
    patchEnvFile('DEEPSEEK_API_KEY', deepseekKey.trim());
    process.env.DEEPSEEK_API_KEY = deepseekKey.trim();
  }
  if (openaiKey?.trim()) {
    patchEnvFile('OPENAI_API_KEY', openaiKey.trim());
    process.env.OPENAI_API_KEY = openaiKey.trim();
  }
  if (groqKey?.trim()) {
    patchEnvFile('GROQ_API_KEY', groqKey.trim());
    process.env.GROQ_API_KEY = groqKey.trim();
  }
  if (geminiKey?.trim()) {
    patchEnvFile('GEMINI_API_KEY', geminiKey.trim());
    process.env.GEMINI_API_KEY = geminiKey.trim();
  }
  if (braveKey?.trim()) {
    patchEnvFile('BRAVE_SEARCH_API_KEY', braveKey.trim());
    process.env.BRAVE_SEARCH_API_KEY = braveKey.trim();
    activateBraveSearch();
  }
  if (perplexityKey?.trim()) {
    patchEnvFile('PERPLEXITY_API_KEY', perplexityKey.trim());
    process.env.PERPLEXITY_API_KEY = perplexityKey.trim();
  }
  if (gmailUser?.trim()) {
    patchEnvFile('GMAIL_USER', gmailUser.trim());
    process.env.GMAIL_USER = gmailUser.trim();
  }
  if (gmailAppPassword?.trim()) {
    patchEnvFile('GMAIL_APP_PASSWORD', gmailAppPassword.trim());
    process.env.GMAIL_APP_PASSWORD = gmailAppPassword.trim();
  }

  console.log('[settings] OpenClaw settings updated via web UI');
  res.json({ ok: true, brain: process.env.ARIA_BRAIN, model: process.env.ARIA_MODEL });
});

// ─── Status — which connectors are active ─────────────────────────────────────

app.get('/api/aria/status', (_req, res) => {
  const supabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
  const gmail    = !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
  const telegram = !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
  const brave    = !!process.env.BRAVE_SEARCH_API_KEY;
  const perplexity = !!process.env.PERPLEXITY_API_KEY;
  const n8n      = !!process.env.N8N_RESEARCH_WEBHOOK_URL;
  const openai   = !!process.env.OPENAI_API_KEY;

  res.json({
    brain: process.env.ARIA_BRAIN ?? 'claude',
    model: process.env.ARIA_MODEL ?? 'claude-haiku-4-5-20251001',
    uptime: process.uptime(),
    passwordProtected: !!process.env.ARIA_PASSWORD,
    connectors: [
      { key: 'core',      name: 'ARIA Core',        icon: 'hub',              active: true,     tools: ['chat', 'stream'],                          category: 'core' },
      { key: 'scheduler', name: 'Proactive Agent',  icon: 'schedule',         active: true,     tools: ['morning_briefing', 'reminders'],           category: 'core' },
      { key: 'memory',    name: 'Memory',           icon: 'memory',           active: supabase, tools: ['save_memory', 'recall'],                   category: 'core' },
      { key: 'tasks',     name: 'Task Manager',     icon: 'task_alt',         active: supabase, tools: ['add_task', 'list_tasks', 'complete_task'],  category: 'productivity' },
      { key: 'projects',  name: 'Projects',         icon: 'folder',           active: supabase, tools: ['create_project', 'list_projects'],          category: 'productivity' },
      { key: 'reminders', name: 'Reminders',        icon: 'alarm',            active: supabase, tools: ['set_reminder', 'list_reminders'],           category: 'productivity' },
      { key: 'ideas',     name: 'Ideas Vault',      icon: 'lightbulb',        active: supabase, tools: ['save_idea', 'list_ideas'],                  category: 'productivity' },
      { key: 'workspace', name: 'Workspace',        icon: 'corporate_fare',   active: supabase, tools: ['log_achievement', 'get_follow_ups'],        category: 'productivity' },
      { key: 'gmail',     name: 'Gmail',            icon: 'mail',             active: gmail,    tools: ['gmail_list', 'gmail_get', 'gmail_reply', 'gmail_send'], category: 'integrations' },
      { key: 'telegram',  name: 'Telegram',         icon: 'send',             active: telegram, tools: ['telegram_notify'],                          category: 'integrations' },
      { key: 'search',    name: 'Web Search',       icon: 'travel_explore',   active: brave || perplexity, tools: ['web_search'],                   category: 'intelligence', provider: brave ? 'Brave' : perplexity ? 'Perplexity' : null },
      { key: 'n8n',       name: 'n8n Research',     icon: 'account_tree',     active: n8n,      tools: ['research'],                               category: 'intelligence' },
      { key: 'documents', name: 'Documents',        icon: 'description',      active: supabase, tools: ['create_excel', 'create_pdf'],              category: 'outputs' },
      { key: 'reports',   name: 'Reports',          icon: 'analytics',        active: supabase, tools: ['generate_report'],                         category: 'outputs' },
      { key: 'openai',    name: 'Vector Memory',    icon: 'hub',              active: openai,   tools: ['embed', 'semantic_recall'],                category: 'intelligence' },
    ],
  });
});

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
