import { Router } from 'express';
import { scheduleNudgeIfNeeded } from '../proactive/nudger.js';
import { runWorkflow } from '../core/workflow.js';
import { fileRegistry } from './upload.js';
import {
  detectReportIntent,
  extractReportData,
} from '../services/aiWorkflow.js';
import {
  generateExcel,
  generatePDF,
  generatePPTX,
} from '../services/reportGenerator.js';
import type { ReportResult } from '../services/reportGenerator.js';
import { reportRegistry } from './download.js';
import { processFiles } from '../core/fileHandler.js';

export const chatRouter = Router();

// POST /api/aria/chat
chatRouter.post('/', async (req, res) => {
  const {
    userId,
    message,
    fileIds,
    autoSave,
  } = req.body as {
    userId?:   string;
    message?:  string;
    fileIds?:  string[];
    autoSave?: boolean;
  };

  console.log(`[chat] ← userId="${userId}" message="${String(message).slice(0, 40)}"`);

  if (!userId || !message) {
    res.status(400).json({ error: 'userId and message are required' });
    return;
  }

  try {
    // ── Run full workflow (route → pre-fetch → context → claw → memory) ────────
    const { answer, intent, saved } = await runWorkflow(userId, message, fileIds, autoSave);

    // ── Generate downloadable report if requested ────────────────────────────
    const downloads: ReportResult[] = [];
    const reportIntent = detectReportIntent(message);

    if (reportIntent && fileIds?.length) {
      try {
        const docs = await processFiles(fileIds);
        if (docs.length > 0) {
          const reportData = extractReportData(answer, docs, message);
          let result: ReportResult;
          if (reportIntent === 'excel')    result = await generateExcel(reportData);
          else if (reportIntent === 'pdf') result = await generatePDF(reportData);
          else                             result = await generatePPTX(reportData);
          downloads.push(result);
        }
      } catch (err) {
        console.warn('[chat] report generation failed:', (err as Error).message);
      }
    }

    scheduleNudgeIfNeeded(userId, answer).catch(() => {});

    // Scan the answer for any download URLs produced by create_excel / create_pdf tool calls
    const urlMatches = [...answer.matchAll(/\/api\/aria\/download\/([a-f0-9-]{36})/g)];
    for (const m of urlMatches) {
      const fileId = m[1];
      if (reportRegistry.has(fileId) && !downloads.find(d => d.fileId === fileId)) {
        const rec = reportRegistry.get(fileId)!;
        downloads.push({ fileId: rec.fileId, fileName: rec.fileName, type: rec.type, size: rec.size, url: `/api/aria/download/${rec.fileId}` });
      }
    }

    res.json({
      reply:     answer,
      intent,
      saved,
      downloads: downloads.length > 0 ? downloads : undefined,
    });
  } catch (err) {
    const e = err as Error & { cause?: Error };
    console.error('[chat] error:', e.message, '| cause:', e.cause?.message);
    const hint = e.message?.includes('API key') || e.message?.includes('auth')
      ? ' Check your API key in .env.'
      : e.message?.includes('network') || e.message?.includes('ECONNREFUSED')
      ? ' Check server connectivity.'
      : '';
    res.status(500).json({ error: true, reply: `⚠️ ${e.message || 'Unknown error'}${hint}` });
  }
});

// GET /api/aria/chat/stream
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
    const { claw } = await import('../core/index.js');
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
