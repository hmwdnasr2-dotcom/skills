import { Router } from 'express';
import { claw } from '../core/index.js';
import { scheduleNudgeIfNeeded } from '../proactive/nudger.js';

export const chatRouter = Router();

// POST /api/aria/chat — non-streaming reply
chatRouter.post('/', async (req, res) => {
  const { userId, message } = req.body as { userId?: string; message?: string };

  if (!userId || !message) {
    res.status(400).json({ error: 'userId and message are required' });
    return;
  }

  try {
    const reply = await claw.run('chat', {
      userId,
      messages: [{ role: 'user', content: message }],
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
