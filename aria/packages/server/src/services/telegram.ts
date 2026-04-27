import { claw } from '../core/index.js';

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
    .replace(/```[\s\S]*?```/g, (m) => m)   // keep code blocks as-is
    .replace(/\*\*(.*?)\*\*/g, '*$1*')        // bold: ** → *
    .replace(/#{1,6}\s+(.+)/g, '*$1*')        // headings → bold
    .replace(/^[-•▸→]\s+/gm, '• ')           // normalise bullets
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
      const err = await res.text();
      console.warn('[telegram] sendMessage failed:', err);
    }
  } catch (err) {
    console.warn('[telegram] network error:', (err as Error).message);
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

  // Ignore bot commands except /start
  if (text.startsWith('/start')) {
    await sendTelegram(chatId, `Hello${msg.from?.first_name ? ` ${msg.from.first_name}` : ''}! I'm ARIA. Send me a message and I'll respond.`);
    console.log(`[telegram] /start from chat_id ${chatId}`);
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

async function poll(): Promise<void> {
  const url = `${API()}/getUpdates?offset=${lastOffset}&timeout=30&allowed_updates=["message"]`;
  try {
    const res  = await fetch(url, { signal: AbortSignal.timeout(35_000) });
    if (!res.ok) {
      console.warn('[telegram] getUpdates failed:', res.status);
      return;
    }
    const body = await res.json() as { ok: boolean; result: TelegramUpdate[] };
    if (!body.ok) return;

    for (const update of body.result) {
      lastOffset = update.update_id + 1;
      processUpdate(update).catch((err) => console.error('[telegram] processUpdate:', err));
    }
  } catch (err) {
    if ((err as Error).name !== 'TimeoutError') {
      console.warn('[telegram] poll error:', (err as Error).message);
    }
  }
}

export function startTelegramPolling(): void {
  if (pollingActive || !TOKEN()) return;
  pollingActive = true;
  console.log('[telegram] Polling started — bot ready for messages');

  (async function loop() {
    while (pollingActive) {
      await poll();
      // small gap between polls to avoid hammering on repeated errors
      await new Promise((r) => setTimeout(r, 500));
    }
  })().catch((err) => console.error('[telegram] polling loop crashed:', err));
}

export function stopTelegramPolling(): void {
  pollingActive = false;
}
