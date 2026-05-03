import type { ParsedDocument, ParsedTask } from './fileParser.js';
import type { ReportData } from './reportGenerator.js';

// ── Report intent detection ────────────────────────────────────────────────────

export type ReportIntent = 'excel' | 'pdf' | 'pptx' | null;

const INTENT_PATTERNS: [NonNullable<ReportIntent>, RegExp][] = [
  ['pptx',  /\b(pptx|powerpoint|presentation|slide[s]?|deck)\b/i],
  ['excel', /\b(excel|xlsx|spreadsheet|xls)\b/i],
  ['pdf',   /\b(pdf|document report|export.*pdf|pdf.*export|generate.*report|create.*report|download.*report|report.*pdf)\b/i],
];

export function detectReportIntent(message: string): ReportIntent {
  for (const [type, rx] of INTENT_PATTERNS) {
    if (rx.test(message)) return type;
  }
  return null;
}

// ── Message building ───────────────────────────────────────────────────────────

type TextPart  = { type: 'text'; text: string };
type ImagePart = { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };
type Part = TextPart | ImagePart;

export interface BrainMessage {
  role: 'user';
  content: string | Part[];
}

function buildTextContext(docs: ParsedDocument[]): string {
  return docs.map((doc, i) => {
    const lines: string[] = [`[Attachment ${i + 1}: ${doc.fileName} (${doc.documentType})]`];
    if (doc.tasks.length > 0) {
      lines.push(`Tasks (${doc.tasks.length}):`);
      doc.tasks.slice(0, 20).forEach(t => {
        const meta = [
          t.owner    && `owner:${t.owner}`,
          t.deadline && `due:${t.deadline}`,
          t.status   && `status:${t.status}`,
        ].filter(Boolean).join(' ');
        lines.push(`  - ${t.title}${meta ? ` [${meta}]` : ''}`);
      });
    }
    if (doc.milestones.length > 0) lines.push(`Milestones: ${doc.milestones.slice(0, 5).join(', ')}`);
    if (doc.owners.length > 0)     lines.push(`Owners: ${doc.owners.slice(0, 10).join(', ')}`);
    if (doc.dates.length > 0)      lines.push(`Key dates: ${doc.dates.slice(0, 10).join(', ')}`);
    if (doc.rawText)               lines.push(`Content:\n${doc.rawText.slice(0, 3000)}`);
    return lines.join('\n');
  }).join('\n\n---\n\n');
}

export function buildMessages(message: string, docs: ParsedDocument[]): BrainMessage[] {
  const textDocs  = docs.filter(d => !d.isImage);
  const imageDocs = docs.filter(d =>  d.isImage);

  const fileContext = textDocs.length > 0 ? `\n\n${buildTextContext(textDocs)}` : '';

  if (imageDocs.length === 0) {
    return [{ role: 'user', content: message + fileContext }];
  }

  const parts: Part[] = [];
  if (message + fileContext) {
    parts.push({ type: 'text', text: message + fileContext });
  }
  for (const img of imageDocs) {
    parts.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.imageMimeType ?? 'image/jpeg',
        data: img.imageBase64!,
      },
    });
    parts.push({ type: 'text', text: `[Image: ${img.fileName}]` });
  }

  return [{ role: 'user', content: parts }];
}

// ── Report data extraction ─────────────────────────────────────────────────────

export function extractReportData(
  aiReply: string,
  docs: ParsedDocument[],
  userMessage: string,
): ReportData {
  const allTasks: ParsedTask[]  = docs.flatMap(d => d.tasks);
  const allMilestones: string[] = [...new Set(docs.flatMap(d => d.milestones))];

  function extractSection(text: string, keyword: string): string[] {
    const m = text.match(
      new RegExp(`(?:${keyword})[s]?[:\\s]*\\n([\\s\\S]+?)(?=\\n#+|\\n\\n[A-Z]|$)`, 'i')
    );
    if (!m) return [];
    return m[1]
      .split('\n')
      .map(l => l.replace(/^[-*•·\d.]+\s*/, '').replace(/\*\*/g, '').trim())
      .filter(l => l.length > 5)
      .slice(0, 6);
  }

  // Extract bullet points as insights — skip questions and offers
  function extractInsights(text: string): string[] {
    return text
      .split('\n')
      .filter(l => /^\s*[-*•·▸]|\s*\d+[).]\s/.test(l))
      .map(l => l.replace(/^\s*[-*•·▸\d).]+\s*/, '').trim())
      .filter(l =>
        l.length > 10 &&
        !l.endsWith('?') &&
        !l.endsWith(':') &&
        !/want me to|tell me|let me know|let's build|i can help|feel free|i'll:/i.test(l)
      )
      .slice(0, 8);
  }

  const risks           = extractSection(aiReply, 'risk|concern|challenge|issue|blocker');
  const recommendations = extractSection(aiReply, 'recommend|suggest|next step|action item|priority');
  const insights        = extractInsights(aiReply);

  // Use first substantive paragraph as summary
  const summary = aiReply
    .split('\n\n')
    .find(p => p.trim().length > 30 && !p.trim().startsWith('#') && !p.trim().startsWith('```'))
    ?? aiReply.slice(0, 400);

  // Smart title from message context
  const primaryDoc = docs[0];
  const title = primaryDoc
    ? primaryDoc.fileName.replace(/\.[^.]+$/, '')
    : inferTitle(userMessage);

  return {
    title,
    subtitle: userMessage.length > 80 ? userMessage.slice(0, 77) + '…' : userMessage,
    summary: summary.trim(),
    insights,
    tasks: allTasks,
    milestones: allMilestones,
    risks,
    recommendations,
    generatedAt: new Date().toLocaleString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }),
  };
}

function inferTitle(msg: string): string {
  const m = msg.toLowerCase();
  if (/open task|my task|todo/i.test(m))       return 'Open Tasks Report';
  if (/project/i.test(m))                       return 'Project Status Report';
  if (/email/i.test(m))                         return 'Email Activity Report';
  if (/reminder|deadline/i.test(m))             return 'Reminders & Deadlines';
  if (/performance|metric|kpi/i.test(m))        return 'Performance Report';
  if (/weekly/i.test(m))                        return 'Weekly Summary Report';
  if (/daily/i.test(m))                         return 'Daily Activity Report';
  if (/monthly/i.test(m))                       return 'Monthly Overview Report';
  const cleaned = msg.replace(/generate|create|make|write|pdf|report|for me/gi, '').trim();
  return cleaned.length > 6
    ? cleaned.slice(0, 1).toUpperCase() + cleaned.slice(1, 50)
    : 'Intelligence Report';
}
