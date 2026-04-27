import { claw, setAgentMode, activateBraveSearch } from '../core/index.js';
import { runWorkflow } from '../core/workflow.js';
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

interface TelegramDocument {
  file_id:   string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { first_name?: string };
    text?: string;
    caption?: string;
    document?: TelegramDocument;
    photo?: Array<{ file_id: string; file_size?: number }>;
  };
}

const SUPPORTED_MIME: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-excel':                                          '.xls',
  'application/pdf':                                                    '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'text/csv':                                                           '.csv',
  'text/plain':                                                         '.txt',
};

async function downloadTelegramFile(fileId: string): Promise<{ buffer: Buffer; fileName: string; ext: string } | null> {
  try {
    const infoRes  = await fetch(`${API()}/getFile?file_id=${fileId}`);
    const infoBody = await infoRes.json() as { ok: boolean; result?: { file_path?: string } };
    if (!infoBody.ok || !infoBody.result?.file_path) return null;

    const filePath = infoBody.result.file_path;
    const ext      = '.' + filePath.split('.').pop()!.toLowerCase();
    const fileRes  = await fetch(`https://api.telegram.org/file/bot${TOKEN()}/${filePath}`);
    if (!fileRes.ok) return null;

    const buffer   = Buffer.from(await fileRes.arrayBuffer());
    const fileName = filePath.split('/').pop() ?? `file${ext}`;
    return { buffer, fileName, ext };
  } catch {
    return null;
  }
}

async function uploadToAria(buffer: Buffer, fileName: string): Promise<string | null> {
  try {
    const form = new FormData();
    form.append('files', new Blob([buffer]), fileName);   // field name must be 'files'

    const port = process.env.PORT ?? '4000';
    const res  = await fetch(`http://localhost:${port}/api/aria/upload`, {
      method: 'POST',
      body:   form,
    });
    if (!res.ok) {
      console.warn('[telegram] upload failed:', res.status, await res.text());
      return null;
    }
    const data = await res.json() as { files?: Array<{ fileId: string }> };
    return data.files?.[0]?.fileId ?? null;
  } catch (err) {
    console.warn('[telegram] uploadToAria error:', (err as Error).message);
    return null;
  }
}

async function processUpdate(update: TelegramUpdate): Promise<void> {
  const msg = update.message;
  if (!msg) return;

  const chatId = msg.chat.id;

  // ── Handle file/document uploads ─────────────────────────────────────────
  const doc = msg.document;
  if (doc) {
    const mime = doc.mime_type ?? '';
    if (!Object.keys(SUPPORTED_MIME).some(m => mime.startsWith(m.split('/')[0])) && !SUPPORTED_MIME[mime]) {
      // still try — let fileParser decide
    }
    await sendTelegram(chatId, '📄 Got it — reading your file...');

    const downloaded = await downloadTelegramFile(doc.file_id);
    if (!downloaded) {
      await sendTelegram(chatId, '❌ Could not download the file. Try again.');
      return;
    }

    const fileId = await uploadToAria(downloaded.buffer, downloaded.fileName);
    if (!fileId) {
      await sendTelegram(chatId, '❌ Could not process the file. Make sure it is Excel, PDF, Word, or CSV.');
      return;
    }

    const caption = msg.caption?.trim() || 'Analyse this file and summarise the key insights.';
    const userId  = USER_ID();
    try {
      const { answer } = await runWorkflow(userId, caption, [fileId]);
      await sendTelegram(chatId, answer);
    } catch (err) {
      const e = err as Error & { cause?: Error };
      await sendTelegram(chatId, `❌ Error: ${e.cause?.message ?? e.message}`);
    }
    return;
  }

  if (!msg.text) return;

  const text = msg.text.trim();

  console.log(`[telegram] message from chat_id ${chatId}: ${text.slice(0, 60)}`);

  if (text.startsWith('/start')) {
    const brain = process.env.ARIA_BRAIN ?? 'claude';
    await sendTelegram(chatId, `Hello${msg.from?.first_name ? ` ${msg.from.first_name}` : ''}! I'm ARIA — your full personal AI.\n\nAgent modes:\n/aria — Chief of Staff (default)\n/researcher — search + synthesize\n/strategist — frameworks + decisions\n/developer — code + architecture\n/coach — clarity + accountability\n\nSystem:\n/setkey sk-ant-... — set Anthropic key\n/setdeepseek sk-... — switch to DeepSeek\n/setbrave BSA... — enable web search (Brave)\n/testkey — verify API key\n/status — server info\n/debug — full diagnostic`);
    return;
  }

  if (text.startsWith('/setkey ')) {
    const newKey = text.slice(8).trim().replace(/[\n\r\s]/g, '');
    if (!newKey.startsWith('sk-ant-') || newKey.length < 80) {
      await sendTelegram(chatId, '❌ Invalid Anthropic key. Must start with sk-ant- and be ~108 chars.');
      return;
    }
    try {
      updateEnvKey('ANTHROPIC_API_KEY', newKey);
      updateEnvKey('ARIA_BRAIN', 'claude');
      updateEnvKey('ARIA_MODEL', 'claude-haiku-4-5-20251001');
      process.env.ANTHROPIC_API_KEY = newKey;
      process.env.ARIA_BRAIN = 'claude';
      process.env.ARIA_MODEL = 'claude-haiku-4-5-20251001';
      await sendTelegram(chatId, `✅ Anthropic key active (${newKey.length} chars). Run /testkey to verify.`);
    } catch (err) {
      await sendTelegram(chatId, `❌ Failed to save key: ${(err as Error).message}`);
    }
    return;
  }

  if (text.startsWith('/setdeepseek ')) {
    const newKey = text.slice(13).trim().replace(/[\n\r\s]/g, '');
    if (!newKey.startsWith('sk-') || newKey.length < 20) {
      await sendTelegram(chatId, '❌ Invalid DeepSeek key. Must start with sk- and be at least 20 chars.');
      return;
    }
    try {
      updateEnvKey('DEEPSEEK_API_KEY', newKey);
      updateEnvKey('ARIA_BRAIN', 'deepseek');
      updateEnvKey('ARIA_MODEL', 'deepseek-chat');
      process.env.DEEPSEEK_API_KEY = newKey;
      process.env.ARIA_BRAIN = 'deepseek';
      process.env.ARIA_MODEL = 'deepseek-chat';
      await sendTelegram(chatId, `✅ Switched to DeepSeek! Key saved (${newKey.length} chars). Run /testkey to verify.`);
    } catch (err) {
      await sendTelegram(chatId, `❌ Failed: ${(err as Error).message}`);
    }
    return;
  }

  if (text.startsWith('/setbrave ')) {
    const newKey = text.slice(10).trim().replace(/[\n\r\s]/g, '');
    if (newKey.length < 20) {
      await sendTelegram(chatId, '❌ Invalid Brave Search key. Get one at brave.com/search/api/');
      return;
    }
    try {
      updateEnvKey('BRAVE_SEARCH_API_KEY', newKey);
      process.env.BRAVE_SEARCH_API_KEY = newKey;
      activateBraveSearch();
      await sendTelegram(chatId, `✅ Brave Search key saved (${newKey.length} chars). web_search is now active — no restart needed.`);
    } catch (err) {
      await sendTelegram(chatId, `❌ Failed: ${(err as Error).message}`);
    }
    return;
  }

  if (text === '/testkey') {
    const brain = process.env.ARIA_BRAIN ?? 'claude';
    if (brain === 'deepseek') {
      const key = process.env.DEEPSEEK_API_KEY ?? '';
      if (!key) { await sendTelegram(chatId, '❌ No DEEPSEEK_API_KEY set.'); return; }
      await sendTelegram(chatId, `🔍 Testing DeepSeek key (${key.length} chars)...`);
      try {
        const res = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'deepseek-chat', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }),
        });
        const data = await res.json() as { error?: { message?: string } };
        if (res.ok) await sendTelegram(chatId, '✅ DeepSeek key valid! API responding.');
        else await sendTelegram(chatId, `❌ DeepSeek error ${res.status}: ${data.error?.message ?? JSON.stringify(data)}`);
      } catch (err) { await sendTelegram(chatId, `❌ Network error: ${(err as Error).message}`); }
      return;
    }
    // Default: Claude
    const key = process.env.ANTHROPIC_API_KEY ?? '';
    if (!key) { await sendTelegram(chatId, '❌ No ANTHROPIC_API_KEY set.'); return; }
    await sendTelegram(chatId, `🔍 Testing Anthropic key (${key.length} chars, starts: ${key.slice(0, 14)}...)...`);
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }),
      });
      const data = await res.json() as { type?: string; error?: { type?: string; message?: string } };
      if (res.ok) {
        await sendTelegram(chatId, `✅ Anthropic key valid!`);
      } else {
        await sendTelegram(chatId, `❌ API error ${res.status}: ${data.error?.message ?? JSON.stringify(data)}`);
      }
    } catch (err) {
      await sendTelegram(chatId, `❌ Network error: ${(err as Error).message}`);
    }
    return;
  }

  // ── Agent mode switching (/researcher /strategist /developer /coach /aria) ──
  const AGENT_MODES: Record<string, string> = {
    aria:        '👔 Chief of Staff mode — I handle everything.',
    researcher:  '🔍 Researcher mode — I search before I answer. Ask me anything.',
    strategist:  '♟ Strategist mode — frameworks, decisions, second-order thinking.',
    developer:   '💻 Developer mode — working code, architecture, no hand-waving.',
    coach:       '🎯 Coach mode — sharp questions, one action at the end.',
  };

  if (text.startsWith('/')) {
    const cmd = text.slice(1).split(' ')[0].toLowerCase();
    if (cmd in AGENT_MODES) {
      setAgentMode(USER_ID(), cmd);
      await sendTelegram(chatId, AGENT_MODES[cmd]);
      return;
    }
  }

  if (text === '/status') {
    const brain     = process.env.ARIA_BRAIN ?? 'claude';
    const model     = process.env.ARIA_MODEL ?? (brain === 'deepseek' ? 'deepseek-chat' : 'claude-haiku-4-5-20251001');
    const key       = brain === 'deepseek' ? process.env.DEEPSEEK_API_KEY : process.env.ANTHROPIC_API_KEY;
    const keyInfo   = key ? `✅ set (${key.length} chars)` : '❌ missing';
    const searchKey = process.env.BRAVE_SEARCH_API_KEY;
    const searchInfo = searchKey ? `✅ Brave Search (${searchKey.length} chars)` : '❌ not set — send /setbrave <key>';
    await sendTelegram(chatId, `ARIA Status\n\nBrain: ${brain}\nModel: ${model}\nAPI key: ${keyInfo}\nWeb search: ${searchInfo}\nTelegram: ✅ connected`);
    return;
  }

  if (text === '/debug') {
    const brain = process.env.ARIA_BRAIN ?? 'claude';
    const model = process.env.ARIA_MODEL ?? 'default';
    const dsKey = process.env.DEEPSEEK_API_KEY ?? '';
    const anKey = process.env.ANTHROPIC_API_KEY ?? '';
    const keyInfo = brain === 'deepseek'
      ? (dsKey ? `DeepSeek key: ${dsKey.length} chars` : 'DeepSeek key: MISSING')
      : (anKey ? `Anthropic key: ${anKey.length} chars` : 'Anthropic key: MISSING');

    await sendTelegram(chatId, `🔍 Debug starting...\nBrain: ${brain}\nModel: ${model}\n${keyInfo}`);

    // Step 1: direct API call
    try {
      if (brain === 'deepseek') {
        const res = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${dsKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'deepseek-chat', max_tokens: 30, messages: [{ role: 'user', content: 'say hi' }] }),
        });
        const data = await res.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
        if (res.ok) {
          await sendTelegram(chatId, `✅ Direct API: "${data.choices?.[0]?.message?.content ?? '(empty)'}"`);
        } else {
          await sendTelegram(chatId, `❌ Direct API error ${res.status}: ${data.error?.message}`);
          return;
        }
      } else {
        await sendTelegram(chatId, `ℹ️ Run /testkey for Anthropic key check`);
      }
    } catch (err) {
      await sendTelegram(chatId, `❌ Direct API network error: ${(err as Error).message}`);
      return;
    }

    // Step 2: through claw pipeline (NO tools context — minimal)
    await sendTelegram(chatId, `⏳ Testing claw pipeline...`);
    try {
      const reply = await claw.run('chat', {
        userId: USER_ID(),
        messages: [{ role: 'user', content: 'just say hello in one word' }],
      });
      await sendTelegram(chatId, `Pipeline replied: "${String(reply).slice(0, 200)}"`);
    } catch (err) {
      const e = err as Error & { cause?: Error };
      const root = e.cause?.message ?? e.message;
      await sendTelegram(chatId, `❌ Pipeline error: ${root}`);
    }
    return;
  }

  if (text.startsWith('/')) return;

  const userId = USER_ID();
  try {
    const { answer } = await runWorkflow(userId, text);
    await sendTelegram(chatId, answer);
  } catch (err) {
    const e = err as Error & { cause?: Error };
    const root = e.cause?.message ?? e.message;
    console.error('[telegram] chat error:', e.message, '| cause:', e.cause?.message);
    await sendTelegram(chatId, `❌ Error: ${root}`);
  }
}

// Use POST + JSON body to avoid URL-encoding issues with allowed_updates
async function poll(): Promise<void> {
  try {
    const res = await fetch(`${API()}/getUpdates`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ offset: lastOffset, timeout: 30, allowed_updates: ['message', 'channel_post'] }),
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
