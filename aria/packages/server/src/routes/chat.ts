import { Router } from 'express';
import { claw } from '../core/index.js';
import type { Message } from '@aria/core';
import { scheduleNudgeIfNeeded } from '../proactive/nudger.js';
import { fileRegistry } from './upload.js';
import { parseFile } from '../services/fileParser.js';
import {
  detectReportIntent,
  buildMessages,
  extractReportData,
} from '../services/aiWorkflow.js';
import {
  generateExcel,
  generatePDF,
  generatePPTX,
} from '../services/reportGenerator.js';
import type { ReportResult } from '../services/reportGenerator.js';
import type { ParsedDocument } from '../services/fileParser.js';

export const chatRouter = Router();

// POST /api/aria/chat — non-streaming reply
chatRouter.post('/', async (req, res) => {
  const {
    userId,
    message,
    fileIds,
  } = req.body as { userId?: string; message?: string; fileIds?: string[] };

  if (!userId || !message) {
    res.status(400).json({ error: 'userId and message are required' });
    return;
  }

  // ── Parse any attached files ─────────────────────────────────────────────────
  const parsedDocs: ParsedDocument[] = [];
  if (fileIds && fileIds.length > 0) {
    for (const fileId of fileIds) {
      const record = fileRegistry.get(fileId);
      if (!record) continue;
      try {
        const doc = await parseFile(record.storedPath, record.ext, record.originalName);
        parsedDocs.push(doc);
      } catch (err) {
        console.warn(`[chat] failed to parse ${record.originalName}:`, (err as Error).message);
      }
    }
  }

  // ── Build AI messages (text + optional Vision blocks) ────────────────────────
  const brainMessages = parsedDocs.length > 0
    ? buildMessages(message, parsedDocs)
    : [{ role: 'user' as const, content: message }];
  // BrainMessage.content may be Part[] for image uploads; cast is safe —
  // ClaudeBrain accepts vision content blocks at runtime.
  const clawMessages = brainMessages as unknown as Message[];

  try {
    const reply = await claw.run('chat', {
      userId,
      messages: clawMessages,
    });

    // ── Detect report intent and generate downloadable output ────────────────
    const downloads: ReportResult[] = [];
    const intent = detectReportIntent(message);

    if (intent && parsedDocs.length > 0) {
      try {
        const reportData = extractReportData(reply as string, parsedDocs, message);
        let result: ReportResult;
        if (intent === 'excel')     result = await generateExcel(reportData);
        else if (intent === 'pdf')  result = await generatePDF(reportData);
        else                        result = await generatePPTX(reportData);
        downloads.push(result);
      } catch (err) {
        console.warn('[chat] report generation failed:', (err as Error).message);
      }
    }

    // Fire-and-forget nudge check
    scheduleNudgeIfNeeded(userId, reply as string).catch(() => {});

    res.json({
      reply,
      downloads: downloads.length > 0 ? downloads : undefined,
    });
  } catch (err) {
    const e = err as Error & { cause?: unknown; status?: number };
    const cause = e.cause as Error & { status?: number; error?: unknown } | undefined;
    console.error('[chat] pipeline error:', e.message);
    console.error('[chat] root cause:', cause?.message ?? cause);
    console.error('[chat] cause detail:', JSON.stringify(cause?.error ?? ''));
    console.error('[chat] stack:', cause?.stack ?? e.stack);
    res.json({ reply: "I've noted that down." });
  }
});

// GET /api/aria/chat/stream?userId=…&message=… — SSE streaming reply
chatRouter.get('/stream', async (req, res) => {
  const userId  = req.query.userId  as string | undefined;
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
