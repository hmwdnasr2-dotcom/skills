import fs from 'fs';
import path from 'path';
import type { ParsedDocument, ParsedTask } from './fileParser.js';
import { reportRegistry } from '../routes/download.js';

const REPORT_DIR = '/tmp/aria-generated';
fs.mkdirSync(REPORT_DIR, { recursive: true });

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReportData {
  title: string;
  subtitle?: string;
  summary: string;
  insights: string[];
  tasks: ParsedTask[];
  milestones: string[];
  risks: string[];
  recommendations: string[];
  generatedAt: string;
}

export interface ReportResult {
  fileId: string;
  fileName: string;
  type: 'xlsx' | 'pdf' | 'pptx';
  size: number;
  url: string;
}

// ── Color palette ─────────────────────────────────────────────────────────────

const NAVY   = '#1a1d2e';
const INDIGO = '#4f52d9';
const ACCENT = '#8083ff';
const DARK   = '#1a1d2e';
const MID    = '#3d4166';
const GRAY   = '#6b6f8a';
const LIGHT  = '#c7c4d7';
const PAGE_BG = '#ffffff';
const STRIPE  = '#f4f6fb';
const LINE    = '#e2e6f0';
const GREEN  = '#16a34a';
const RED    = '#dc2626';
const AMBER  = '#d97706';
const BLUE   = '#2563eb';

// Fallback used by Excel/PPTX (no hash prefix)
const TERRA  = 'c96442';
const CREAM  = 'f5f4ed';
const IVORY  = 'faf9f5';
const DARK_P = '141413';
const GRAY_P = '5e5d59';

// ── Task helpers ──────────────────────────────────────────────────────────────

function taskStats(tasks: ParsedTask[]) {
  const total   = tasks.length;
  const done    = tasks.filter(t => /complet|done|finish/i.test(t.status ?? '')).length;
  const blocked = tasks.filter(t => /block|stuck|hold/i.test(t.status ?? '')).length;
  const open    = total - done - blocked;
  const overdue = tasks.filter(t => {
    if (!t.deadline) return false;
    const d = new Date(t.deadline);
    return !isNaN(d.getTime()) && d < new Date() && !/complet|done/i.test(t.status ?? '');
  }).length;
  return { total, done, open, blocked, overdue };
}

function statusChip(status: string): { bg: string; fg: string } {
  if (/complet|done|finish/i.test(status))  return { bg: '#dcfce7', fg: '#15803d' };
  if (/progress|active|ongoing/i.test(status)) return { bg: '#dbeafe', fg: '#1d4ed8' };
  if (/block|stuck|hold/i.test(status))     return { bg: '#fee2e2', fg: '#b91c1c' };
  if (/cancel/i.test(status))               return { bg: '#f3f4f6', fg: '#6b7280' };
  return { bg: '#fef3c7', fg: '#b45309' };
}

// ── Strip markdown for plain PDF text ─────────────────────────────────────────

function stripMd(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .trim();
}

// ── Excel ─────────────────────────────────────────────────────────────────────

export async function generateExcel(
  data: ReportData,
  doc?: ParsedDocument,
): Promise<ReportResult> {
  const xlsx = await import('xlsx');
  const wb = xlsx.utils.book_new();

  const summaryAoa = [
    ['ARIA Intelligence Report', ''],
    ['', ''],
    ['Title',     data.title],
    ['Generated', data.generatedAt],
    ['', ''],
    ['Executive Summary', ''],
    [data.summary, ''],
    ['', ''],
    ['Key Insights', ''],
    ...data.insights.map(i => ['•', i]),
    ['', ''],
    ['Risks & Blockers', ''],
    ...data.risks.map(r => ['[!]', r]),
    ['', ''],
    ['Recommendations', ''],
    ...data.recommendations.map(r => ['>>', r]),
  ];
  const wsSummary = xlsx.utils.aoa_to_sheet(summaryAoa);
  wsSummary['!cols'] = [{ wch: 22 }, { wch: 90 }];
  xlsx.utils.book_append_sheet(wb, wsSummary, 'Summary');

  const taskHeaders = ['#', 'Task', 'Owner', 'Due Date', 'Status', 'Priority', 'Dependencies'];
  const taskRows: (string | number)[][] = data.tasks.map((t, i) => [
    i + 1,
    t.title,
    t.owner        ?? '',
    t.deadline     ?? '',
    t.status       ?? 'Not started',
    t.priority     ?? 'Medium',
    t.dependencies ?? '',
  ]);
  const wsTasks = xlsx.utils.aoa_to_sheet([taskHeaders, ...taskRows]);
  wsTasks['!cols'] = [
    { wch: 4 }, { wch: 42 }, { wch: 20 },
    { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 20 },
  ];
  xlsx.utils.book_append_sheet(wb, wsTasks, 'Tasks');

  if (doc?.dates?.length || data.milestones.length) {
    const dates = doc?.dates ?? [];
    const timelineHeaders = ['Milestone / Event', 'Date'];
    const timelineRows = data.milestones.map((m, i) => [m, dates[i] ?? '']);
    const wsTimeline = xlsx.utils.aoa_to_sheet([timelineHeaders, ...timelineRows]);
    wsTimeline['!cols'] = [{ wch: 44 }, { wch: 18 }];
    xlsx.utils.book_append_sheet(wb, wsTimeline, 'Timeline');
  }

  if (doc?.tableData && doc.tableData.length > 0) {
    const wsRaw = xlsx.utils.json_to_sheet(doc.tableData);
    xlsx.utils.book_append_sheet(wb, wsRaw, 'Source Data');
  }

  const fileId   = crypto.randomUUID();
  const fileName = `ARIA_Report_${Date.now()}.xlsx`;
  const filePath = path.join(REPORT_DIR, `${fileId}.xlsx`);
  xlsx.writeFile(wb, filePath);
  const size = fs.statSync(filePath).size;

  reportRegistry.set(fileId, { fileId, fileName, filePath, type: 'xlsx', size, createdAt: new Date().toISOString() });
  return { fileId, fileName, type: 'xlsx', size, url: `/api/aria/download/${fileId}` };
}

// ── PDF ───────────────────────────────────────────────────────────────────────

export async function generatePDF(data: ReportData): Promise<ReportResult> {
  const PDFDocumentMod = await import('pdfkit');
  const PDFDocument = (PDFDocumentMod as any).default ?? PDFDocumentMod;

  const fileId   = crypto.randomUUID();
  const fileName = `ARIA_Report_${Date.now()}.pdf`;
  const filePath = path.join(REPORT_DIR, `${fileId}.pdf`);

  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 0,
      size: 'A4',
      bufferPages: true,
      info: {
        Title: data.title,
        Author: 'ARIA Intelligence',
        Subject: data.subtitle ?? '',
        Creator: 'ARIA Agent Orchestrator',
      },
    });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    stream.on('finish', resolve);
    stream.on('error', reject);

    const W  = doc.page.width;  // 595.28
    const H  = doc.page.height; // 841.89
    const M  = 48;              // margin
    const CW = W - M * 2;       // content width

    // ── HEADER ──────────────────────────────────────────────────────────────
    doc.rect(0, 0, W, 92).fill(NAVY);
    doc.rect(0, 88, W, 4).fill(INDIGO);

    // ARIA wordmark
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(30)
       .text('ARIA', M, 24, { lineBreak: false });

    // Accent dot after wordmark
    doc.circle(M + 65, 34, 4).fill(ACCENT);

    // Report type label
    doc.fillColor(LIGHT).font('Helvetica').fontSize(10)
       .text('Intelligence Report', M, 29, { width: CW, align: 'right', lineBreak: false });

    // Date
    doc.fillColor(GRAY).fontSize(8.5)
       .text(data.generatedAt, M, 58, { width: CW, align: 'right', lineBreak: false });

    // ── TITLE BLOCK ──────────────────────────────────────────────────────────
    let y = 112;

    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(20)
       .text(data.title, M, y, { width: CW });
    y = doc.y + 4;

    if (data.subtitle && data.subtitle !== data.title) {
      doc.fillColor(GRAY).font('Helvetica').fontSize(10.5)
         .text(data.subtitle, M, y, { width: CW });
      y = doc.y + 8;
    }

    doc.rect(M, y, CW, 1).fill(LINE);
    y += 16;

    // ── STATS CARDS (when tasks present) ────────────────────────────────────
    if (data.tasks.length > 0) {
      const stats = taskStats(data.tasks);
      const cards = [
        { label: 'Total',     value: stats.total,   color: INDIGO },
        { label: 'Open',      value: stats.open,    color: AMBER  },
        { label: 'Completed', value: stats.done,    color: GREEN  },
        { label: 'Overdue',   value: stats.overdue, color: stats.overdue > 0 ? RED : GRAY },
      ];
      const bw = (CW - 9) / 4;
      const bh = 54;

      cards.forEach((c, i) => {
        const bx = M + i * (bw + 3);
        doc.rect(bx, y, bw, bh).fill(STRIPE);
        doc.rect(bx, y, 3, bh).fill(c.color);
        doc.fillColor(c.color).font('Helvetica-Bold').fontSize(26)
           .text(String(c.value), bx + 10, y + 6, { width: bw - 14, lineBreak: false });
        doc.fillColor(GRAY).font('Helvetica').fontSize(7.5)
           .text(c.label.toUpperCase(), bx + 10, y + 36, { width: bw - 14, lineBreak: false });
      });

      y += bh + 20;
    }

    // ── SECTION HELPER ───────────────────────────────────────────────────────
    function sectionHeader(title: string, color: string) {
      if (y > H - 180) { doc.addPage(); y = M; }
      doc.rect(M, y, 3, 16).fill(color);
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(12.5)
         .text(title, M + 11, y + 1, { lineBreak: false });
      y += 26;
    }

    // ── EXECUTIVE SUMMARY ────────────────────────────────────────────────────
    sectionHeader('Executive Summary', ACCENT);

    const summaryText = stripMd(data.summary);
    const sumBoxH = doc.heightOfString(summaryText, { width: CW - 26, fontSize: 10.5 }) + 22;
    doc.rect(M, y, CW, sumBoxH).fill(STRIPE);
    doc.rect(M, y, 3, sumBoxH).fill(INDIGO);
    doc.fillColor(MID).font('Helvetica').fontSize(10.5)
       .text(summaryText, M + 14, y + 11, { width: CW - 26, lineGap: 2 });
    y = doc.y + 18;

    // ── KEY INSIGHTS ─────────────────────────────────────────────────────────
    if (data.insights.length > 0) {
      sectionHeader('Key Insights', ACCENT);
      data.insights.forEach(ins => {
        if (y + 20 > H - 60) { doc.addPage(); y = M; }
        doc.circle(M + 5, y + 5, 3).fill(INDIGO);
        doc.fillColor(MID).font('Helvetica').fontSize(10.5)
           .text(stripMd(ins), M + 16, y, { width: CW - 20, lineGap: 1.5 });
        y = doc.y + 6;
      });
      y += 6;
    }

    // ── TASK TABLE ───────────────────────────────────────────────────────────
    if (data.tasks.length > 0) {
      sectionHeader('Task Overview', ACCENT);

      const cols = [
        { label: 'Task',     w: 210 },
        { label: 'Owner',    w: 88  },
        { label: 'Due',      w: 78  },
        { label: 'Status',   w: 75  },
        { label: 'Priority', w: 64  },
      ];
      const ROW_H = 22;

      // Header row
      doc.rect(M, y, CW, ROW_H).fill(NAVY);
      let cx = M + 8;
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
      cols.forEach(col => {
        doc.text(col.label, cx, y + 7, { width: col.w - 8, lineBreak: false });
        cx += col.w;
      });
      y += ROW_H;

      doc.font('Helvetica').fontSize(8.5);
      data.tasks.slice(0, 25).forEach((t, idx) => {
        if (y + ROW_H > H - 60) { doc.addPage(); y = M; }

        doc.rect(M, y, CW, ROW_H).fill(idx % 2 === 0 ? PAGE_BG : STRIPE);
        doc.rect(M, y + ROW_H - 0.5, CW, 0.5).fill(LINE);

        cx = M + 8;
        // Task
        doc.fillColor(DARK).text(t.title.slice(0, 40), cx, y + 7, { width: cols[0].w - 8, lineBreak: false });
        cx += cols[0].w;
        // Owner
        doc.fillColor(GRAY).text((t.owner ?? '—').slice(0, 14), cx, y + 7, { width: cols[1].w - 8, lineBreak: false });
        cx += cols[1].w;
        // Due
        doc.text((t.deadline ?? '—').slice(0, 12), cx, y + 7, { width: cols[2].w - 8, lineBreak: false });
        cx += cols[2].w;
        // Status badge
        const status = (t.status ?? 'Pending').slice(0, 12);
        const chip = statusChip(status);
        const bw = Math.min(60, cols[3].w - 10);
        doc.rect(cx, y + 5, bw, 12).fill(chip.bg);
        doc.fillColor(chip.fg).font('Helvetica-Bold').fontSize(7)
           .text(status, cx + 3, y + 8, { width: bw - 6, lineBreak: false });
        doc.font('Helvetica').fontSize(8.5);
        cx += cols[3].w;
        // Priority
        const pri = t.priority ?? 'Medium';
        const priColor = /high/i.test(pri) ? RED : /low/i.test(pri) ? GREEN : AMBER;
        doc.fillColor(priColor).text(pri, cx, y + 7, { width: cols[4].w - 8, lineBreak: false });
        y += ROW_H;
      });
      y += 20;
    }

    // ── MILESTONES ───────────────────────────────────────────────────────────
    if (data.milestones.length > 0) {
      sectionHeader('Key Milestones', ACCENT);
      data.milestones.slice(0, 8).forEach(m => {
        if (y + 18 > H - 60) { doc.addPage(); y = M; }
        doc.rect(M, y + 3, 10, 10).fill(STRIPE);
        doc.fillColor(INDIGO).font('Helvetica-Bold').fontSize(8).text('+', M + 2.5, y + 5, { lineBreak: false });
        doc.fillColor(MID).font('Helvetica').fontSize(10.5)
           .text(stripMd(m), M + 18, y, { width: CW - 22, lineGap: 1 });
        y = doc.y + 6;
      });
      y += 6;
    }

    // ── RISKS ────────────────────────────────────────────────────────────────
    const realRisks = data.risks.filter(r => !/no specific risk|no risk identified/i.test(r));
    if (realRisks.length > 0) {
      sectionHeader('Risks & Blockers', RED);
      realRisks.slice(0, 6).forEach(r => {
        if (y + 18 > H - 60) { doc.addPage(); y = M; }
        doc.rect(M, y, 18, 16).fill('#fff1f1');
        doc.fillColor(RED).font('Helvetica-Bold').fontSize(9).text('!', M + 6, y + 4, { lineBreak: false });
        doc.fillColor(MID).font('Helvetica').fontSize(10.5)
           .text(stripMd(r), M + 24, y, { width: CW - 28, lineGap: 1 });
        y = doc.y + 8;
      });
      y += 4;
    }

    // ── RECOMMENDATIONS ──────────────────────────────────────────────────────
    const realRecs = data.recommendations.filter(r => !/review document for action/i.test(r));
    if (realRecs.length > 0) {
      sectionHeader('Recommendations', GREEN);
      realRecs.slice(0, 6).forEach((r, i) => {
        if (y + 18 > H - 60) { doc.addPage(); y = M; }
        doc.rect(M, y, 18, 16).fill('#f0fdf4');
        doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(9)
           .text(String(i + 1), M + 5, y + 4, { lineBreak: false });
        doc.fillColor(MID).font('Helvetica').fontSize(10.5)
           .text(stripMd(r), M + 24, y, { width: CW - 28, lineGap: 1 });
        y = doc.y + 8;
      });
    }

    // ── PAGE FOOTERS ─────────────────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.rect(0, H - 30, W, 30).fill(STRIPE);
      doc.rect(0, H - 31, W, 1).fill(LINE);
      doc.fillColor(GRAY).font('Helvetica').fontSize(8)
         .text(`ARIA Intelligence  ·  ${data.generatedAt}`, M, H - 18, {
           width: CW / 2, lineBreak: false,
         });
      doc.text(`Page ${i + 1} of ${range.count}`, M, H - 18, {
        width: CW, align: 'right', lineBreak: false,
      });
    }

    doc.end();
  });

  const size = fs.statSync(filePath).size;
  reportRegistry.set(fileId, { fileId, fileName, filePath, type: 'pdf', size, createdAt: new Date().toISOString() });
  return { fileId, fileName, type: 'pdf', size, url: `/api/aria/download/${fileId}` };
}

// ── PowerPoint ────────────────────────────────────────────────────────────────

export async function generatePPTX(data: ReportData): Promise<ReportResult> {
  const PptxMod = await import('pptxgenjs');
  const PptxGenJS = (PptxMod as any).default ?? PptxMod;
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';

  const s1 = pptx.addSlide();
  s1.background = { color: DARK_P.replace('#','') };
  s1.addText('ARIA', { x: 0.6, y: 0.6, w: 5, h: 1.1, fontSize: 52, bold: true, color: 'FFFFFF', fontFace: 'Georgia' });
  s1.addText(data.title, { x: 0.6, y: 1.9, w: 9, h: 0.9, fontSize: 26, color: 'FFFFFF', fontFace: 'Georgia', wrap: true });
  if (data.subtitle) {
    s1.addText(data.subtitle, { x: 0.6, y: 2.9, w: 9, h: 0.5, fontSize: 13, color: 'c7c4d7' });
  }
  s1.addText(data.generatedAt, { x: 0.6, y: 7.0, w: 9, h: 0.3, fontSize: 9, color: '6b6f8a', align: 'right' });

  const s2 = pptx.addSlide();
  s2.background = { color: 'FFFFFF' };
  addSlideTitle(pptx, s2, 'Executive Summary');
  s2.addText(stripMd(data.summary), {
    x: 0.6, y: 1.6, w: 9, h: 4.5, fontSize: 14, color: GRAY_P, valign: 'top', wrap: true,
  });

  if (data.tasks.length > 0) {
    const s3 = pptx.addSlide();
    s3.background = { color: 'FFFFFF' };
    addSlideTitle(pptx, s3, 'Project Tasks');
    const taskTableRows = [
      makeHeaderRow(['Task', 'Owner', 'Due Date', 'Status', 'Priority']),
      ...data.tasks.slice(0, 14).map((t, i) =>
        makeDataRow([
          t.title.slice(0, 42), t.owner ?? '—', t.deadline ?? '—',
          t.status ?? 'Pending', t.priority ?? 'Medium',
        ], i % 2 === 1)
      ),
    ];
    s3.addTable(taskTableRows, {
      x: 0.6, y: 1.6, w: 9.2, h: 5.2,
      fontSize: 9,
      border: { type: 'solid', color: 'E8E6DC', pt: 0.5 },
      color: GRAY_P,
    });
  }

  if (data.milestones.length > 0) {
    const s4 = pptx.addSlide();
    s4.background = { color: 'FFFFFF' };
    addSlideTitle(pptx, s4, 'Key Milestones');
    data.milestones.slice(0, 8).forEach((m, i) => {
      const yp = 1.65 + i * 0.72;
      s4.addShape(pptx.ShapeType.ellipse, { x: 0.55, y: yp + 0.08, w: 0.28, h: 0.28, fill: { color: TERRA } });
      s4.addText(m, { x: 1.05, y: yp, w: 8.5, h: 0.5, fontSize: 13, color: GRAY_P });
    });
  }

  if (data.risks.filter(r => !/no specific risk/i.test(r)).length > 0) {
    const s5 = pptx.addSlide();
    s5.background = { color: 'FFFFFF' };
    addSlideTitle(pptx, s5, 'Risks & Blockers');
    data.risks.slice(0, 7).forEach((r, i) => {
      s5.addText(`⚠  ${r}`, { x: 0.6, y: 1.65 + i * 0.82, w: 9.2, h: 0.65, fontSize: 13, color: 'b53333' });
    });
  }

  const s6 = pptx.addSlide();
  s6.background = { color: TERRA };
  s6.addText('Next Steps', { x: 0.6, y: 0.5, w: 9, h: 0.9, fontSize: 30, bold: true, color: 'FFFFFF', fontFace: 'Georgia' });
  data.recommendations.filter(r => !/review document/i.test(r)).slice(0, 5).forEach((r, i) => {
    s6.addText(`${i + 1}.  ${r}`, { x: 0.6, y: 1.6 + i * 0.95, w: 9, h: 0.75, fontSize: 14, color: 'FFFFFF' });
  });
  s6.addText('Generated by ARIA', { x: 0.6, y: 7.1, w: 9, h: 0.3, fontSize: 9, color: 'FFD5C5', align: 'right' });

  const fileId   = crypto.randomUUID();
  const fileName = `ARIA_Presentation_${Date.now()}.pptx`;
  const filePath = path.join(REPORT_DIR, `${fileId}.pptx`);

  await pptx.writeFile({ fileName: filePath });
  const size = fs.statSync(filePath).size;

  reportRegistry.set(fileId, { fileId, fileName, filePath, type: 'pptx', size, createdAt: new Date().toISOString() });
  return { fileId, fileName, type: 'pptx', size, url: `/api/aria/download/${fileId}` };
}

// ── PowerPoint helpers ────────────────────────────────────────────────────────

function addSlideTitle(pptx: any, slide: any, text: string) {
  slide.addText(text, {
    x: 0.6, y: 0.4, w: 9, h: 0.8, fontSize: 26, bold: true, color: DARK_P, fontFace: 'Georgia',
  });
  slide.addShape(pptx.ShapeType.line, {
    x: 0.6, y: 1.3, w: 9.2, h: 0, line: { color: TERRA, width: 2 },
  });
}

function makeHeaderRow(cells: string[]) {
  return cells.map(text => ({
    text, options: { bold: true, fill: { color: CREAM }, color: DARK_P, fontSize: 9 },
  }));
}

function makeDataRow(cells: string[], shade: boolean) {
  return cells.map(text => ({
    text, options: { fill: { color: shade ? IVORY : 'FFFFFF' }, color: GRAY_P, fontSize: 9 },
  }));
}
