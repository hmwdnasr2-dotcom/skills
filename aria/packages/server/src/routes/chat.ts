import { Router } from 'express';
import { claw } from '../core/index.js';
import { scheduleNudgeIfNeeded } from '../proactive/nudger.js';

interface Attachment {
  name: string;
  type: string;     // MIME type, e.g. "image/jpeg"
  dataUrl: string;  // "data:<mime>;base64,<data>"
}

/** Convert an attachment list into Anthropic-compatible content blocks. */
function buildContentBlocks(message: string, attachments: Attachment[]): unknown[] {
  const blocks: unknown[] = [];

  for (const att of attachments) {
    const commaIdx = att.dataUrl.indexOf(',');
    if (commaIdx === -1) continue;
    const data = att.dataUrl.slice(commaIdx + 1);
    const mimeType = att.type || att.dataUrl.slice(5, commaIdx).replace(';base64', '');

    if (mimeType.startsWith('image/')) {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: mimeType, data },
      });
    } else if (mimeType === 'application/pdf') {
      blocks.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data },
      });
    } else {
      // Text-based files (CSV, TXT, JSON, etc.) — decode and embed as text
      const text = Buffer.from(data, 'base64').toString('utf-8');
      blocks.push({ type: 'text', text: `[Attached file: ${att.name}]\n${text}` });
    }
  }

  if (message) {
    blocks.push({ type: 'text', text: message });
  }

  return blocks;
}

export const chatRouter = Router();

// POST /api/aria/chat — non-streaming reply
chatRouter.post('/', async (req, res) => {
  const { userId, message = '', attachments } = req.body as {
    userId?: string;
    message?: string;
    attachments?: Attachment[];
  };

  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;

  if (!userId || (!message.trim() && !hasAttachments)) {
    res.status(400).json({ error: 'userId and message or attachments are required' });
    return;
  }

  try {
    const userContent = hasAttachments
      ? buildContentBlocks(message, attachments!)
      : message;

    const reply = await claw.run('chat', {
      userId,
      messages: [{ role: 'user', content: userContent }],
    });

    // Fire-and-forget nudge check
    scheduleNudgeIfNeeded(userId, reply).catch(() => {});

    res.json({ reply });
  } catch (err) {
    const e = err as Error & { status?: number; error?: unknown };
    console.error('[chat] error:', e.message, JSON.stringify(e.error ?? ''));
    res.json({ reply: "I've noted that down." });
  }
});

// GET /api/aria/chat/stream?userId=…&message=… — SSE streaming reply
chatRouter.get('/stream', async (req, res) => {
  const userId = req.query.userId as string | undefined;
  const message = req.query.message as string | undefined;

  if (!userId || !message) {
    res.status(400).json({ error: 'userId and message are required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  try {
    for await (const token of claw.stream('chat', { userId, message })) {
      res.write(`data: ${JSON.stringify({ token })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
  } catch (err) {
    console.error('[chat/stream]', err);
    res.write(`data: ${JSON.stringify({ error: 'Stream failed' })}\n\n`);
  } finally {
    res.end();
  }
});
