import { claw } from '../core/index.js';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.env');

function updateEnvKey(name: string, value: string): void {
  let content = '';
  try { content = readFileSync(ENV_PATH, 'utf8'); } catch { content = ''; }
  const lines = content.split('\n').filter(l => !l.startsWith(`${name}=`));
  lines.push(`${name}=${value}`);
  writeFileSync(ENV_PATH, lines.join('\n'));
}

// ── Config ─────────────────────────────────────────────────────────────────────

const TOKEN   = () => process.env.TELEGRAM_BOT_TOKEN ?? '';
const CHAT_ID = () => process.env.TELEGRAM_CHAT_ID   ?? '';
const USER_ID = () => process.env.TELEGRAM_USER_ID   ?? process.env.ARIA_DEFAULT_USER ?? 'user-1';
const API     = () => `https://api.telegram.org/bot${TOKEN()}`;

export function telegramEnabled(): boolean {
  return Boolean(TOKEN() && CHAT_ID());
}

// ── Message formatting ─────────────────────────────────────────────────────────

function stripHeavyMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (m) => m)
    .replace(/\*\*(.*?)\*\*/g, '*$1*')
    .replace(/#{1,6}\s+(.+)/g, '*$1*')
    .replace(/^[-•▸→]\s+/gm, '• ')
    .trim();
}

// ── Send ───────────────────────────────────────────────────────────────────────

export async function sendTelegram(text: string): Promise<void>;
export async function sendTelegram(chatId: string | number, text: string): Promise<void>;
export async function sendTelegram(a: string | number, b?: string): Promise<void> {
  if (!TOKEN()) return;
  const chatId = b !== undefined ? String(a) : CHAT_ID();
  const text   = b !== undefined ? b : String(a);
  if (!chatId) return;

  try {
    const res = await fetch(`${API()}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:    chatId,
        text:       stripHeavyMarkdown(text),
        parse_mode: 'Markdown',
      }),
    });
    if (!res.ok) {
      console.warn('[telegram] sendMessage failed:', await res.text());
    }
  } catch (err) {
    console.warn('[telegram] network error:', (err as Error).message);
  }
}

// ── Verify bot token is valid ──────────────────────────────────────────────────

async function verifyBot(): Promise<boolean> {
  try {
    const res  = await fetch(`${API()}/getMe`);
    const body = await res.json() as { ok: boolean; result?: { username?: string } };
    if (body.ok) {
      console.log(`[telegram] Bot verified: @${body.result?.username}`);
      return true;
    }
    console.error('[telegram] getMe failed — check TELEGRAM_BOT_TOKEN:', JSON.stringify(body));
    return false;
  } catch (err) {
    console.error('[telegram] cannot reach Telegram API:', (err as Error).message);
    return false;
  }
}

// ── Polling loop (inbound messages → ARIA) ────────────────────────────────────

let pollingActive = false;
let lastOffset    = 0;

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { first_name?: string };
    text?: string;
  };
}

async function processUpdate(update: TelegramUpdate): Promise<void> {
  const msg = update.message;
  if (!msg?.text) return;

  const chatId = msg.chat.id;
  const text   = msg.text.trim();

  console.log(`[telegram] message from chat_id ${chatId}: ${text.slice(0, 60)}`);

  if (text.startsWith('/start')) {
    await sendTelegram(chatId, `Hello${msg.from?.first_name ? ` ${msg.from.first_name}` : ''}! I'm ARIA.\n\nCommands:\n/setkey sk-ant-... — update Anthropic API key\n/status — check server status`);
    return;
  }

  if (text.startsWith('/setkey ')) {
    const newKey = text.slice(8).trim().replace(/[\n\r\s]/g, '');
    if (!newKey.startsWith('sk-ant-') || newKey.length < 80) {
      await sendTelegram(chatId, '❌ Invalid key. Must start with sk-ant- and be ~108 chars.');
      return;
    }
    try {
      updateEnvKey('ANTHROPIC_API_KEY', newKey);
      await sendTelegram(chatId, `✅ Key saved (${newKey.length} chars). Restarting server...`);
      setTimeout(() => {
        try { execSync('pm2 restart aria-server --update-env'); } catch { /* pm2 may not be in PATH */ }
      }, 500);
    } catch (err) {
      await sendTelegram(chatId, `❌ Failed to save key: ${(err as Error).message}`);
    }
    return;
  }

  if (text === '/status') {
    const keySet = Boolean(process.env.ANTHROPIC_API_KEY);
    const keyLen = process.env.ANTHROPIC_API_KEY?.length ?? 0;
    await sendTelegram(chatId, `ARIA Status\n\nAPI key: ${keySet ? `✅ set (${keyLen} chars)` : '❌ missing'}\nTelegram: ✅ connected\nModel: ${process.env.ARIA_MODEL ?? 'claude-haiku-4-5-20251001'}`);
    return;
  }

  if (text.startsWith('/')) return;

  const userId = USER_ID();
  try {
    const reply = await claw.run('chat', {
      userId,
      messages: [{ role: 'user', content: text }],
    });
    await sendTelegram(chatId, String(reply ?? "I've noted that down."));
  } catch (err) {
    console.error('[telegram] chat error:', (err as Error).message);
    await sendTelegram(chatId, "Sorry, I hit an error. Please try again.");
  }
}

// Use POST + JSON body to avoid URL-encoding issues with allowed_updates
async function poll(): Promise<void> {
  try {
    const res = await fetch(`${API()}/getUpdates`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ offset: lastOffset, timeout: 30, allowed_updates: ['message'] }),
      signal:  AbortSignal.timeout(35_000),
    });

    if (!res.ok) {
      console.warn('[telegram] getUpdates HTTP error:', res.status, await res.text());
      return;
    }

    const body = await res.json() as { ok: boolean; result: TelegramUpdate[]; description?: string };
    if (!body.ok) {
      console.warn('[telegram] getUpdates not ok:', body.description);
      return;
    }

    for (const update of body.result) {
      lastOffset = update.update_id + 1;
      processUpdate(update).catch((err) => console.error('[telegram] processUpdate:', err));
    }
  } catch (err) {
    const name = (err as Error).name;
    if (name !== 'TimeoutError' && name !== 'AbortError') {
      console.warn('[telegram] poll error:', (err as Error).message);
    }
  }
}

export async function startTelegramPolling(): Promise<void> {
  if (pollingActive || !TOKEN()) return;

  const ok = await verifyBot();
  if (!ok) {
    console.error('[telegram] Polling NOT started — fix TELEGRAM_BOT_TOKEN first');
    return;
  }

  // Send a startup ping so you know it's live
  await sendTelegram('✅ ARIA is online and ready.');

  pollingActive = true;
  console.log('[telegram] Polling started — listening for messages');

  (async function loop() {
    while (pollingActive) {
      await poll();
      await new Promise((r) => setTimeout(r, 300));
    }
  })().catch((err) => console.error('[telegram] polling loop crashed:', err));
}

export function stopTelegramPolling(): void {
  pollingActive = false;
}
