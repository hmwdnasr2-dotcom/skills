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
      .map(l => l.replace(/^[-*•\d.]+\s*/, '').trim())
      .filter(l => l.length > 5)
      .slice(0, 6);
  }

  const risks           = extractSection(aiReply, 'risk|concern|challenge|issue');
  const recommendations = extractSection(aiReply, 'recommend|suggest|next step|action item');

  const summary = aiReply
    .split('\n\n')
    .find(p => p.trim().length > 20 && !p.startsWith('#')) ?? aiReply.slice(0, 300);

  const primaryDoc = docs[0];
  const title = primaryDoc
    ? primaryDoc.fileName.replace(/\.[^.]+$/, '')
    : userMessage.slice(0, 60);

  return {
    title,
    subtitle: userMessage.slice(0, 80),
    summary: summary.trim(),
    tasks: allTasks,
    milestones: allMilestones,
    risks:           risks.length           > 0 ? risks           : ['No specific risks identified'],
    recommendations: recommendations.length > 0 ? recommendations : ['Review document for action items'],
    generatedAt: new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
  };
}
