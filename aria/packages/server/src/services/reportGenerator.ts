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

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripMd(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .trim();
}

function isConversational(text: string): boolean {
  return /want me to|tell me what|let me know|let's build|feel free|i can help|shall i|should i/i.test(text)
    || text.trim().endsWith('?')
    || text.trim().endsWith("I'll:");
}

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

function statusColor(status: string): string {
  if (/complet|done|finish/i.test(status))   return '#2e7d32';
  if (/progress|active|ongoing/i.test(status)) return '#1565c0';
  if (/block|stuck|hold/i.test(status))      return '#c62828';
  return '#e65100';
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
    i + 1, t.title, t.owner ?? '', t.deadline ?? '',
    t.status ?? 'Not started', t.priority ?? 'Medium', t.dependencies ?? '',
  ]);
  const wsTasks = xlsx.utils.aoa_to_sheet([taskHeaders, ...taskRows]);
  wsTasks['!cols'] = [
    { wch: 4 }, { wch: 42 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 20 },
  ];
  xlsx.utils.book_append_sheet(wb, wsTasks, 'Tasks');

  if (doc?.dates?.length || data.milestones.length) {
    const dates = doc?.dates ?? [];
    const wsTimeline = xlsx.utils.aoa_to_sheet([
      ['Milestone / Event', 'Date'],
      ...data.milestones.map((m, i) => [m, dates[i] ?? '']),
    ]);
    wsTimeline['!cols'] = [{ wch: 44 }, { wch: 18 }];
    xlsx.utils.book_append_sheet(wb, wsTimeline, 'Timeline');
  }

  if (doc?.tableData?.length) {
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(doc.tableData), 'Source Data');
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
    const doc = new PDFDocument({ margin: 0, size: 'A4', bufferPages: true });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    stream.on('finish', resolve);
    stream.on('error', reject);

    const W  = doc.page.width;   // 595
    const H  = doc.page.height;  // 842
    const M  = 56;
    const CW = W - M * 2;

    // Palette — matches the image (professional blue report style)
    const BLUE    = '#1565c0';
    const TEXT    = '#1a1a1a';
    const BODY    = '#333333';
    const MUTED   = '#666666';
    const SUBTEXT = '#888888';
    const GLITE   = '#e8f0fe';
    const GLINE   = '#d0d0d0';
    const GREEN   = '#2e7d32';
    const RED     = '#c62828';
    const AMBER   = '#e65100';

    let y = M;
    let secN = 0;
    let subN = 0;

    function newPageIfNeeded(needed = 120) {
      if (y + needed > H - 50) { doc.addPage(); y = M; }
    }

    // ── Page header (only first page) ────────────────────────────────────────
    // Top blue stripe
    doc.rect(0, 0, W, 6).fill(BLUE);
    y = 20;

    // ARIA wordmark + date
    doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(16)
       .text('ARIA', M, y, { lineBreak: false });
    doc.fillColor(SUBTEXT).font('Helvetica').fontSize(8.5)
       .text(data.generatedAt, M, y + 3, { width: CW, align: 'right', lineBreak: false });
    y += 20;

    // Bold title
    doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(16)
       .text(data.title, M, y, { width: CW });
    y = doc.y + 3;

    if (data.subtitle && data.subtitle !== data.title) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(9.5)
         .text(data.subtitle, M, y, { width: CW });
      y = doc.y + 3;
    }

    // Title underline
    doc.rect(M, y, CW, 1.5).fill(BLUE);
    y += 14;

    // ── Layout helpers ────────────────────────────────────────────────────────

    function sectionHeading(title: string) {
      newPageIfNeeded(60);
      secN++;
      subN = 0;
      doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(13)
         .text(`${secN}. ${title}`, M, y, { width: CW });
      y = doc.y + 3;
      doc.rect(M, y, CW, 1.5).fill(BLUE);
      y += 10;
    }

    function subHeading(title: string) {
      newPageIfNeeded(50);
      subN++;
      doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(11)
         .text(`${secN}.${subN} ${title}`, M, y, { width: CW });
      y = doc.y + 6;
    }

    function prose(text: string) {
      newPageIfNeeded(30);
      doc.fillColor(BODY).font('Helvetica').fontSize(10)
         .text(stripMd(text), M, y, { width: CW, align: 'justify', lineGap: 1.5 });
      y = doc.y + 10;
    }

    // Bullet with optional bold lead: **Bold part** rest of text
    function bulletItem(raw: string) {
      newPageIfNeeded(24);
      const boldMatch = raw.match(/^\*\*(.+?)\*\*\s*[–—-]?\s*([\s\S]*)/);
      if (boldMatch) {
        const lead = boldMatch[1].trim();
        const rest = boldMatch[2].trim();
        doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(10)
           .text(`• ${lead} – `, M, y, { continued: true, width: CW });
        doc.font('Helvetica').fillColor(BODY)
           .text(rest, { align: 'justify' });
      } else {
        doc.fillColor(BODY).font('Helvetica').fontSize(10)
           .text(`• ${stripMd(raw)}`, M, y, { width: CW, align: 'justify' });
      }
      y = doc.y + 3;
    }

    // Two-column table (Achievement / Status style from image)
    function table2(header: [string, string], rows: [string, string][]) {
      const C1 = 160;
      const C2 = CW - C1;
      const PAD = 7;
      const HROW = 20;

      newPageIfNeeded(HROW * (Math.min(rows.length, 5) + 2));

      // Header row
      doc.rect(M, y, CW, HROW).fill(BLUE);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9)
         .text(header[0], M + PAD, y + 6, { width: C1 - PAD, lineBreak: false });
      doc.text(header[1], M + C1 + PAD, y + 6, { width: C2 - PAD * 2, lineBreak: false });
      y += HROW;

      rows.forEach((row, i) => {
        const h1 = doc.heightOfString(row[0], { width: C1 - PAD * 2, fontSize: 9 });
        const h2 = doc.heightOfString(row[1], { width: C2 - PAD * 2, fontSize: 9 });
        const rh = Math.max(HROW, Math.max(h1, h2) + PAD * 2);

        newPageIfNeeded(rh + 4);

        if (i % 2 === 1) doc.rect(M, y, CW, rh).fill('#f5f7ff');
        // Bottom border
        doc.rect(M, y + rh - 0.5, CW, 0.5).fill(GLINE);
        // Vertical divider
        doc.rect(M + C1, y, 0.5, rh).fill(GLINE);

        doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(9)
           .text(row[0], M + PAD, y + PAD, { width: C1 - PAD * 2 });
        doc.fillColor(BODY).font('Helvetica').fontSize(9)
           .text(row[1], M + C1 + PAD, y + PAD, { width: C2 - PAD * 2 });
        y += rh;
      });

      doc.rect(M, y, CW, 0.5).fill(GLINE);
      y += 14;
    }

    // Task table
    function taskTable(tasks: ParsedTask[]) {
      const cols = [
        { h: 'Task',     w: 200 },
        { h: 'Owner',    w: 83  },
        { h: 'Due Date', w: 73  },
        { h: 'Status',   w: 68  },
        { h: 'Priority', w: 59  },
      ];
      const PAD = 5;
      const HROW = 20;

      newPageIfNeeded(HROW * 3);

      doc.rect(M, y, CW, HROW).fill(BLUE);
      let cx = M + PAD;
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8.5);
      cols.forEach(c => {
        doc.text(c.h, cx, y + 6, { width: c.w - PAD, lineBreak: false });
        cx += c.w;
      });
      y += HROW;

      tasks.slice(0, 30).forEach((t, i) => {
        newPageIfNeeded(HROW);
        if (i % 2 === 1) doc.rect(M, y, CW, HROW).fill('#f5f7ff');
        doc.rect(M, y + HROW - 0.5, CW, 0.5).fill(GLINE);

        cx = M + PAD;
        const sc = statusColor(t.status ?? '');

        doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(8.5)
           .text(t.title.slice(0, 40), cx, y + 6, { width: cols[0].w - PAD, lineBreak: false });
        cx += cols[0].w;

        doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
           .text(t.owner ?? '—', cx, y + 6, { width: cols[1].w - PAD, lineBreak: false });
        cx += cols[1].w;

        doc.text(t.deadline ?? '—', cx, y + 6, { width: cols[2].w - PAD, lineBreak: false });
        cx += cols[2].w;

        doc.fillColor(sc).font('Helvetica-Bold').fontSize(8.5)
           .text((t.status ?? 'Pending').slice(0, 12), cx, y + 6, { width: cols[3].w - PAD, lineBreak: false });
        cx += cols[3].w;

        const pc = /high/i.test(t.priority ?? '') ? RED : /low/i.test(t.priority ?? '') ? GREEN : AMBER;
        doc.fillColor(pc).font('Helvetica-Bold').fontSize(8.5)
           .text(t.priority ?? 'Medium', cx, y + 6, { width: cols[4].w - PAD, lineBreak: false });

        y += HROW;
      });

      doc.rect(M, y, CW, 0.5).fill(GLINE);
      y += 14;
    }

    // ── SECTION 1: Executive Summary ─────────────────────────────────────────
    sectionHeading('Executive Summary');

    // 1.1 Summary prose
    subHeading('Management Summary');
    prose(data.summary);

    // 1.2 Key Takeaways (bullet list with bold leads from AI insights)
    const cleanInsights = data.insights.filter(i => !isConversational(i) && i.length > 12);
    if (cleanInsights.length > 0) {
      subHeading('Key Takeaways');
      cleanInsights.forEach(ins => bulletItem(ins));
      y += 6;
    }

    // 1.3 Status Overview table (when tasks exist)
    if (data.tasks.length > 0) {
      const stats = taskStats(data.tasks);
      subHeading('Status Overview');
      const rows: [string, string][] = [
        ['Total Tasks',       String(stats.total)],
        ['Open / In Progress', String(stats.open)],
        ['Completed',         String(stats.done)],
        ['Blocked',           String(stats.blocked)],
        ['Overdue',           String(stats.overdue)],
      ];
      if (data.milestones.length > 0) rows.push(['Milestones Tracked', String(data.milestones.length)]);
      table2(['Metric', 'Value'], rows);
    }

    // ── SECTION 2: Task Details ───────────────────────────────────────────────
    if (data.tasks.length > 0) {
      sectionHeading('Task Overview');
      taskTable(data.tasks);
    }

    // ── SECTION 3: Key Milestones ─────────────────────────────────────────────
    if (data.milestones.length > 0) {
      sectionHeading('Key Milestones');
      table2(
        ['Milestone', 'Description'],
        data.milestones.slice(0, 12).map((m, i): [string, string] => [
          `Milestone ${i + 1}`, stripMd(m),
        ])
      );
    }

    // ── SECTION 4: Risks & Blockers ───────────────────────────────────────────
    const realRisks = data.risks.filter(r =>
      !/no specific risk|no risk identified/i.test(r) && !isConversational(r)
    );
    if (realRisks.length > 0) {
      sectionHeading('Risks & Blockers');
      realRisks.slice(0, 8).forEach(r => bulletItem(r));
      y += 4;
    }

    // ── SECTION 5: Recommendations ───────────────────────────────────────────
    const realRecs = data.recommendations.filter(r =>
      !/review document for action/i.test(r) && !isConversational(r) && r.length > 12
    );
    if (realRecs.length > 0) {
      sectionHeading('Recommendations & Next Steps');
      realRecs.slice(0, 8).forEach((r, i) => {
        newPageIfNeeded(24);
        doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(10)
           .text(`${i + 1}.`, M, y, { lineBreak: false, width: 18 });
        doc.fillColor(BODY).font('Helvetica').fontSize(10)
           .text(stripMd(r), M + 20, y, { width: CW - 20, align: 'justify' });
        y = doc.y + 6;
      });
    }

    // ── PAGE FOOTERS ─────────────────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      // Top stripe on continuation pages
      if (i > 0) {
        doc.rect(0, 0, W, 6).fill(BLUE);
      }
      // Footer rule
      doc.rect(M, H - 30, CW, 0.5).fill(GLINE);
      doc.fillColor(SUBTEXT).font('Helvetica').fontSize(7.5)
         .text('ARIA Intelligence Report  ·  Confidential', M, H - 22, {
           width: CW / 2, lineBreak: false,
         });
      doc.text(`Page ${i + 1} of ${range.count}`, M, H - 22, {
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

  const BLUE_P = '1565c0';
  const DARK_P = '1a1a1a';
  const GRAY_P = '555555';
  const LITE_P = 'e8f0fe';

  const s1 = pptx.addSlide();
  s1.background = { color: BLUE_P };
  s1.addText('ARIA', { x: 0.6, y: 0.6, w: 5, h: 1.0, fontSize: 44, bold: true, color: 'FFFFFF' });
  s1.addText(data.title, { x: 0.6, y: 1.8, w: 9, h: 0.9, fontSize: 24, color: 'FFFFFF', wrap: true });
  if (data.subtitle) {
    s1.addText(data.subtitle, { x: 0.6, y: 2.8, w: 9, h: 0.5, fontSize: 12, color: 'b3c6e6' });
  }
  s1.addText(data.generatedAt, { x: 0.6, y: 7.0, w: 9, h: 0.3, fontSize: 9, color: 'b3c6e6', align: 'right' });

  const s2 = pptx.addSlide();
  s2.background = { color: 'FFFFFF' };
  addSlideTitle(pptx, s2, '1. Executive Summary', BLUE_P);
  s2.addText(stripMd(data.summary), {
    x: 0.6, y: 1.6, w: 9, h: 4.5, fontSize: 13, color: GRAY_P, valign: 'top', wrap: true,
  });

  if (data.tasks.length > 0) {
    const s3 = pptx.addSlide();
    s3.background = { color: 'FFFFFF' };
    addSlideTitle(pptx, s3, '2. Task Overview', BLUE_P);
    const taskRows = [
      makeHeaderRow(['Task', 'Owner', 'Due Date', 'Status', 'Priority'], BLUE_P),
      ...data.tasks.slice(0, 14).map((t, i) =>
        makeDataRow([
          t.title.slice(0, 42), t.owner ?? '—', t.deadline ?? '—',
          t.status ?? 'Pending', t.priority ?? 'Medium',
        ], i % 2 === 1, LITE_P)
      ),
    ];
    s3.addTable(taskRows, {
      x: 0.6, y: 1.6, w: 9.2, h: 5.2, fontSize: 9,
      border: { type: 'solid', color: 'd0d0d0', pt: 0.5 },
      color: DARK_P,
    });
  }

  const cleanRecs = data.recommendations.filter(r => !isConversational(r) && r.length > 12);
  if (cleanRecs.length > 0) {
    const s4 = pptx.addSlide();
    s4.background = { color: BLUE_P };
    s4.addText('Recommendations & Next Steps', {
      x: 0.6, y: 0.5, w: 9, h: 0.9, fontSize: 28, bold: true, color: 'FFFFFF',
    });
    cleanRecs.slice(0, 5).forEach((r, i) => {
      s4.addText(`${i + 1}.  ${r}`, {
        x: 0.6, y: 1.6 + i * 0.95, w: 9, h: 0.75, fontSize: 14, color: 'FFFFFF',
      });
    });
    s4.addText('Generated by ARIA', { x: 0.6, y: 7.1, w: 9, h: 0.3, fontSize: 9, color: 'b3c6e6', align: 'right' });
  }

  const fileId   = crypto.randomUUID();
  const fileName = `ARIA_Presentation_${Date.now()}.pptx`;
  const filePath = path.join(REPORT_DIR, `${fileId}.pptx`);
  await pptx.writeFile({ fileName: filePath });
  const size = fs.statSync(filePath).size;
  reportRegistry.set(fileId, { fileId, fileName, filePath, type: 'pptx', size, createdAt: new Date().toISOString() });
  return { fileId, fileName, type: 'pptx', size, url: `/api/aria/download/${fileId}` };
}

// ── PowerPoint helpers ────────────────────────────────────────────────────────

function addSlideTitle(pptx: any, slide: any, text: string, color: string) {
  slide.addText(text, {
    x: 0.6, y: 0.35, w: 9, h: 0.75, fontSize: 22, bold: true, color,
  });
  slide.addShape(pptx.ShapeType.line, {
    x: 0.6, y: 1.2, w: 9.2, h: 0, line: { color, width: 2 },
  });
}

function makeHeaderRow(cells: string[], bg: string) {
  return cells.map(text => ({
    text, options: { bold: true, fill: { color: bg }, color: 'FFFFFF', fontSize: 9 },
  }));
}

function makeDataRow(cells: string[], shade: boolean, liteBg: string) {
  return cells.map(text => ({
    text, options: { fill: { color: shade ? liteBg : 'FFFFFF' }, color: '333333', fontSize: 9 },
  }));
}
