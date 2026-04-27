import fs from 'fs';
import path from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ParsedTask {
  title: string;
  owner?: string;
  deadline?: string;
  status?: string;
  priority?: string;
  dependencies?: string;
}

export interface ParsedDocument {
  documentType: 'project_plan' | 'report' | 'spreadsheet' | 'document' | 'image' | 'data' | 'unknown';
  fileName: string;
  rawText: string;
  sections: string[];
  tasks: ParsedTask[];
  dates: string[];
  owners: string[];
  milestones: string[];
  tableData?: Record<string, unknown>[];
  sheets?: Record<string, Record<string, unknown>[]>;
  isImage?: boolean;
  imageBase64?: string;
  imageMimeType?: string;
}

// ── Column name heuristics ────────────────────────────────────────────────────

const TASK_COLS    = ['task', 'activity', 'item', 'name', 'description', 'work', 'deliverable'];
const OWNER_COLS   = ['owner', 'assignee', 'assigned', 'responsible', 'who', 'lead', 'contact', 'person'];
const DATE_COLS    = ['date', 'due', 'deadline', 'end', 'finish', 'target', 'delivery', 'complete', 'eta'];
const STATUS_COLS  = ['status', 'state', 'progress', 'phase', 'stage'];
const PRIORITY_COLS = ['priority', 'importance', 'urgency', 'level', 'rank'];
const DEP_COLS     = ['depend', 'prerequisite', 'blocker', 'after', 'requires'];

function detectCol(headers: string[], patterns: string[]): number {
  return headers.findIndex(h =>
    patterns.some(p => h.toLowerCase().replace(/[^a-z]/g, '').includes(p))
  );
}

// ── Router ────────────────────────────────────────────────────────────────────

export async function parseFile(
  filePath: string,
  ext: string,
  fileName: string,
): Promise<ParsedDocument> {
  switch (ext) {
    case '.xlsx': case '.xls': return parseExcel(filePath, fileName);
    case '.pdf':               return parsePDF(filePath, fileName);
    case '.csv':               return parseCSV(filePath, fileName);
    case '.docx':              return parseWord(filePath, fileName);
    case '.txt':               return parseText(filePath, fileName);
    case '.png': case '.jpg': case '.jpeg':
      return parseImage(filePath, ext, fileName);
    default:
      throw new Error(`Unsupported file type: ${ext}`);
  }
}

// ── Excel ─────────────────────────────────────────────────────────────────────

async function parseExcel(filePath: string, fileName: string): Promise<ParsedDocument> {
  const xlsx = await import('xlsx');
  const wb = xlsx.readFile(filePath, { cellDates: true });

  const sheets: Record<string, Record<string, unknown>[]> = {};
  const allTasks: ParsedTask[] = [];
  const allDates: string[] = [];
  const allOwners: string[] = [];
  const allMilestones: string[] = [];
  const rawLines: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const json = xlsx.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
    sheets[sheetName] = json;
    if (json.length === 0) continue;

    const headers = Object.keys(json[0]);
    rawLines.push(`\n[Sheet: ${sheetName}]`);
    rawLines.push(headers.join(' | '));

    const taskIdx    = detectCol(headers, TASK_COLS);
    const ownerIdx   = detectCol(headers, OWNER_COLS);
    const dateIdx    = detectCol(headers, DATE_COLS);
    const statusIdx  = detectCol(headers, STATUS_COLS);
    const priorityIdx = detectCol(headers, PRIORITY_COLS);
    const depIdx     = detectCol(headers, DEP_COLS);

    for (const row of json) {
      const vals = headers.map(h => {
        const v = row[h];
        if (v instanceof Date) return v.toLocaleDateString();
        return String(v ?? '');
      });
      rawLines.push(vals.join(' | '));

      const title = taskIdx >= 0
        ? String(row[headers[taskIdx]] ?? '').trim()
        : vals.find(v => v.trim()) ?? '';

      if (!title) continue;

      const owner    = ownerIdx    >= 0 ? String(row[headers[ownerIdx]] ?? '').trim()    : undefined;
      const deadline = dateIdx     >= 0 ? String(row[headers[dateIdx]] ?? '').trim()     : undefined;
      const status   = statusIdx   >= 0 ? String(row[headers[statusIdx]] ?? '').trim()   : undefined;
      const priority = priorityIdx >= 0 ? String(row[headers[priorityIdx]] ?? '').trim() : undefined;
      const deps     = depIdx      >= 0 ? String(row[headers[depIdx]] ?? '').trim()      : undefined;

      if (owner)    allOwners.push(owner);
      if (deadline) allDates.push(deadline);

      const rowText = vals.join(' ').toLowerCase();
      if (/milestone|launch|go.?live|release|deadline|kickoff|phase/i.test(rowText)) {
        allMilestones.push(title);
      }

      allTasks.push({ title, owner, deadline, status, priority, dependencies: deps });
    }
  }

  const docType =
    allTasks.length > 3  ? 'project_plan' :
    allDates.length > 5  ? 'spreadsheet'  : 'data';

  return {
    documentType: docType,
    fileName,
    rawText: rawLines.join('\n').slice(0, 8000),
    sections: wb.SheetNames,
    tasks: allTasks,
    dates: [...new Set(allDates)],
    owners: [...new Set(allOwners)],
    milestones: allMilestones,
    tableData: sheets[wb.SheetNames[0]],
    sheets,
  };
}

// ── PDF ───────────────────────────────────────────────────────────────────────

async function parsePDF(filePath: string, fileName: string): Promise<ParsedDocument> {
  // pdf-parse is CJS; dynamic import with .default handles both
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — pdf-parse has no TS declarations
  const pdfParseMod = await import('pdf-parse');
  const pdfParse = (pdfParseMod as any).default ?? pdfParseMod;
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  const text: string = data.text ?? '';

  return parseRawText(text, fileName, 'document');
}

// ── Word ──────────────────────────────────────────────────────────────────────

async function parseWord(filePath: string, fileName: string): Promise<ParsedDocument> {
  const mammoth = await import('mammoth');
  const result = await (mammoth as any).extractRawText({ path: filePath });
  return parseRawText(result.value ?? '', fileName, 'document');
}

// ── Text ──────────────────────────────────────────────────────────────────────

async function parseText(filePath: string, fileName: string): Promise<ParsedDocument> {
  const text = fs.readFileSync(filePath, 'utf-8');
  return parseRawText(text, fileName, 'document');
}

// ── CSV ───────────────────────────────────────────────────────────────────────

async function parseCSV(filePath: string, fileName: string): Promise<ParsedDocument> {
  const xlsx = await import('xlsx');
  const wb = xlsx.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = xlsx.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

  if (json.length === 0) {
    return {
      documentType: 'data', fileName, rawText: '', sections: [],
      tasks: [], dates: [], owners: [], milestones: [],
    };
  }

  const headers = Object.keys(json[0]);
  const taskIdx    = detectCol(headers, TASK_COLS);
  const ownerIdx   = detectCol(headers, OWNER_COLS);
  const dateIdx    = detectCol(headers, DATE_COLS);
  const statusIdx  = detectCol(headers, STATUS_COLS);
  const priorityIdx = detectCol(headers, PRIORITY_COLS);

  const tasks: ParsedTask[] = json.map(row => ({
    title:    (taskIdx    >= 0 ? String(row[headers[taskIdx]] ?? '')    : String(Object.values(row)[0] ?? '')).trim(),
    owner:    ownerIdx    >= 0 ? String(row[headers[ownerIdx]] ?? '').trim()    || undefined : undefined,
    deadline: dateIdx     >= 0 ? String(row[headers[dateIdx]] ?? '').trim()     || undefined : undefined,
    status:   statusIdx   >= 0 ? String(row[headers[statusIdx]] ?? '').trim()   || undefined : undefined,
    priority: priorityIdx >= 0 ? String(row[headers[priorityIdx]] ?? '').trim() || undefined : undefined,
  })).filter(t => t.title);

  const rawText = [
    headers.join(', '),
    ...json.map(row => Object.values(row).map(String).join(', ')),
  ].join('\n').slice(0, 6000);

  return {
    documentType: 'data',
    fileName,
    rawText,
    sections: [],
    tasks,
    dates: [...new Set(tasks.map(t => t.deadline).filter(Boolean) as string[])],
    owners: [...new Set(tasks.map(t => t.owner).filter(Boolean) as string[])],
    milestones: [],
    tableData: json,
  };
}

// ── Image ─────────────────────────────────────────────────────────────────────

async function parseImage(filePath: string, ext: string, fileName: string): Promise<ParsedDocument> {
  const buffer = fs.readFileSync(filePath);
  const mimeMap: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  };
  return {
    documentType: 'image',
    fileName,
    rawText: '',
    sections: [],
    tasks: [],
    dates: [],
    owners: [],
    milestones: [],
    isImage: true,
    imageBase64: buffer.toString('base64'),
    imageMimeType: mimeMap[ext] ?? 'image/jpeg',
  };
}

// ── Shared text analyzer ──────────────────────────────────────────────────────

function parseRawText(
  text: string,
  fileName: string,
  docType: ParsedDocument['documentType'],
): ParsedDocument {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Dates: common patterns
  const dateRx = /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b|\bQ[1-4]\s+\d{4}\b/gi;
  const dates = [...new Set(text.match(dateRx) ?? [])];

  // Headings: all-caps or short leading-uppercase lines
  const sections = lines
    .filter(l => l.length < 100 && (/^[A-Z][A-Z\s\d:]{3,}$/.test(l) || /^\d+\.\s+[A-Z]/.test(l)))
    .slice(0, 30);

  // Bullet / numbered list items as tasks
  const taskLines = lines.filter(l => /^[-•→▸*]\s|^\d+\.\s/.test(l));
  const tasks: ParsedTask[] = taskLines.map(l => ({
    title: l.replace(/^[-•→▸*\d.]+\s+/, '').trim(),
  })).filter(t => t.title.length > 3);

  // Owners: "Owner: Name" or "Assigned to Name" patterns
  const ownerRx = /(?:owner|assignee|responsible|lead|contact|by)[\s:]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g;
  const owners = [...new Set([...text.matchAll(ownerRx)].map(m => m[1]))];

  const milestones = lines
    .filter(l => /milestone|launch|go.?live|release|kickoff|phase \d/i.test(l))
    .slice(0, 10);

  const detectedType =
    tasks.length > 3  ? 'project_plan' :
    sections.length > 2 ? 'report'     : docType;

  return {
    documentType: detectedType,
    fileName,
    rawText: text.slice(0, 8000),
    sections,
    tasks,
    dates,
    owners,
    milestones,
  };
}
