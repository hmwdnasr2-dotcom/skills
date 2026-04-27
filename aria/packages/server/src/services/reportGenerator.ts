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

// ── Colors (shared) ───────────────────────────────────────────────────────────

const TERRA  = 'c96442';
const DARK   = '141413';
const GRAY   = '5e5d59';
const STONE  = '87867f';
const CREAM  = 'f5f4ed';
const IVORY  = 'faf9f5';
const RED    = 'b53333';
const GREEN  = '3d9e6e';

// ── Excel ─────────────────────────────────────────────────────────────────────

export async function generateExcel(
  data: ReportData,
  doc?: ParsedDocument,
): Promise<ReportResult> {
  const xlsx = await import('xlsx');
  const wb = xlsx.utils.book_new();

  // ── Summary sheet ──
  const summaryAoa = [
    ['ARIA Project Report', ''],
    ['', ''],
    ['Title',     data.title],
    ['Generated', data.generatedAt],
    ['', ''],
    ['Executive Summary', ''],
    [data.summary, ''],
    ['', ''],
    ['Key Milestones', ''],
    ...data.milestones.map(m => ['•', m]),
    ['', ''],
    ['Risks & Blockers', ''],
    ...data.risks.map(r => ['⚠', r]),
    ['', ''],
    ['Recommendations', ''],
    ...data.recommendations.map(r => ['→', r]),
  ];
  const wsSummary = xlsx.utils.aoa_to_sheet(summaryAoa);
  wsSummary['!cols'] = [{ wch: 22 }, { wch: 90 }];
  xlsx.utils.book_append_sheet(wb, wsSummary, 'Summary');

  // ── Tasks sheet ──
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

  // ── Timeline sheet ──
  const dates = doc?.dates ?? [];
  const milestones = data.milestones;
  if (dates.length > 0 || milestones.length > 0) {
    const timelineHeaders = ['Milestone / Event', 'Date'];
    const timelineRows = milestones.map((m, i) => [m, dates[i] ?? '']);
    if (dates.length > milestones.length) {
      for (let i = milestones.length; i < dates.length; i++) {
        timelineRows.push([`Checkpoint ${i + 1}`, dates[i]]);
      }
    }
    const wsTimeline = xlsx.utils.aoa_to_sheet([timelineHeaders, ...timelineRows]);
    wsTimeline['!cols'] = [{ wch: 44 }, { wch: 18 }];
    xlsx.utils.book_append_sheet(wb, wsTimeline, 'Timeline');
  }

  // ── Source data sheet ──
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
    const doc    = new PDFDocument({ margin: 60, size: 'A4', bufferPages: true });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    stream.on('finish', resolve);
    stream.on('error', reject);

    // ── Title header band ──
    doc.rect(0, 0, doc.page.width, 170).fill('#c96442');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(36)
       .text('ARIA', 60, 55);
    doc.font('Helvetica').fontSize(13).text('Intelligence Report', 60, 98);
    doc.fontSize(10).fillColor('#FFD5C5').text(data.generatedAt, 60, 120);

    // ── Title below banner ──
    doc.fillColor('#141413').font('Helvetica-Bold').fontSize(20)
       .text(data.title, 60, 190);
    if (data.subtitle) {
      doc.font('Helvetica').fontSize(12).fillColor('#5e5d59').text(data.subtitle, 60, 216);
    }

    // ── Divider ──
    const divY = data.subtitle ? 240 : 218;
    doc.moveTo(60, divY).lineTo(doc.page.width - 60, divY).lineWidth(1).stroke('#e8e6dc');

    // ── Executive summary ──
    const sumY = divY + 18;
    doc.fillColor('#141413').font('Helvetica-Bold').fontSize(13).text('Executive Summary', 60, sumY);
    doc.font('Helvetica').fontSize(11).fillColor('#5e5d59')
       .text(data.summary, 60, sumY + 22, { width: doc.page.width - 120, align: 'left' });

    doc.moveDown(1.5);

    // ── Tasks table ──
    if (data.tasks.length > 0) {
      doc.fillColor('#141413').font('Helvetica-Bold').fontSize(13).text('Task Overview');
      doc.moveDown(0.4);

      const tableTop  = doc.y;
      const colW      = [180, 90, 90, 85, 60];
      const hdrs      = ['Task', 'Owner', 'Due Date', 'Status', 'Priority'];
      const rowHeight = 20;

      // Header row
      doc.rect(60, tableTop, doc.page.width - 120, rowHeight).fill('#f5f4ed');
      doc.fillColor('#141413').font('Helvetica-Bold').fontSize(8.5);
      let cx = 60;
      hdrs.forEach((h, i) => { doc.text(h, cx + 4, tableTop + 6, { width: colW[i] - 8 }); cx += colW[i]; });

      let ry = tableTop + rowHeight;
      doc.font('Helvetica').fontSize(8.5);
      data.tasks.slice(0, 25).forEach((t, idx) => {
        if (ry + rowHeight > doc.page.height - 80) { doc.addPage(); ry = 60; }
        if (idx % 2 === 1) doc.rect(60, ry, doc.page.width - 120, rowHeight).fill('#faf9f5');
        doc.fillColor('#5e5d59');
        cx = 60;
        [
          t.title.slice(0, 35),
          (t.owner ?? '').slice(0, 15),
          t.deadline ?? '',
          t.status ?? 'Pending',
          t.priority ?? 'Medium',
        ].forEach((cell, i) => {
          doc.text(cell, cx + 4, ry + 6, { width: colW[i] - 8 });
          cx += colW[i];
        });
        ry += rowHeight;
      });

      doc.y = ry + 12;
    }

    // ── Milestones ──
    if (data.milestones.length > 0) {
      if (doc.y > doc.page.height - 180) doc.addPage();
      doc.fillColor('#141413').font('Helvetica-Bold').fontSize(13).text('Key Milestones');
      doc.moveDown(0.3);
      data.milestones.slice(0, 8).forEach(m => {
        doc.fillColor('#c96442').font('Helvetica-Bold').fontSize(11).text('●  ', { continued: true });
        doc.fillColor('#5e5d59').font('Helvetica').text(m);
      });
      doc.moveDown(0.8);
    }

    // ── Risks ──
    if (data.risks.length > 0) {
      if (doc.y > doc.page.height - 160) doc.addPage();
      doc.fillColor('#141413').font('Helvetica-Bold').fontSize(13).text('Risks & Blockers');
      doc.moveDown(0.3);
      data.risks.slice(0, 6).forEach(r => {
        doc.fillColor('#b53333').font('Helvetica-Bold').fontSize(11).text('⚠  ', { continued: true });
        doc.fillColor('#5e5d59').font('Helvetica').text(r);
      });
      doc.moveDown(0.8);
    }

    // ── Recommendations ──
    if (data.recommendations.length > 0) {
      if (doc.y > doc.page.height - 160) doc.addPage();
      doc.fillColor('#141413').font('Helvetica-Bold').fontSize(13).text('Recommendations');
      doc.moveDown(0.3);
      data.recommendations.slice(0, 6).forEach(r => {
        doc.fillColor('#3d9e6e').font('Helvetica-Bold').fontSize(11).text('→  ', { continued: true });
        doc.fillColor('#5e5d59').font('Helvetica').text(r);
      });
    }

    // ── Page footers ──
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.fontSize(8).fillColor('#87867f')
         .text(
           `Generated by ARIA  •  ${data.generatedAt}  •  Page ${i + 1} of ${range.count}`,
           60, doc.page.height - 36,
           { align: 'center', width: doc.page.width - 120 },
         );
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

  // ── Slide 1: Title ──
  const s1 = pptx.addSlide();
  s1.background = { color: TERRA };
  s1.addText('ARIA', { x: 0.6, y: 0.7, w: 5, h: 1.1, fontSize: 52, bold: true, color: 'FFFFFF', fontFace: 'Georgia' });
  s1.addText(data.title, { x: 0.6, y: 1.9, w: 9, h: 0.9, fontSize: 26, color: 'FFFFFF', fontFace: 'Georgia', wrap: true });
  if (data.subtitle) {
    s1.addText(data.subtitle, { x: 0.6, y: 2.9, w: 9, h: 0.5, fontSize: 13, color: 'FFD5C5' });
  }
  s1.addText(data.generatedAt, { x: 0.6, y: 7.0, w: 9, h: 0.3, fontSize: 9, color: 'FFD5C5', align: 'right' });

  // ── Slide 2: Executive Summary ──
  const s2 = pptx.addSlide();
  s2.background = { color: 'FFFFFF' };
  addSlideTitle(pptx, s2, 'Executive Summary');
  s2.addText(data.summary, {
    x: 0.6, y: 1.6, w: 9, h: 4.5, fontSize: 14, color: GRAY, valign: 'top', wrap: true,
  });

  // ── Slide 3: Tasks ──
  const s3 = pptx.addSlide();
  s3.background = { color: 'FFFFFF' };
  addSlideTitle(pptx, s3, 'Project Tasks');

  const taskTableRows = [
    makeHeaderRow(['Task', 'Owner', 'Due Date', 'Status', 'Priority']),
    ...data.tasks.slice(0, 14).map((t, i) =>
      makeDataRow([
        t.title.slice(0, 42),
        t.owner ?? '—',
        t.deadline ?? '—',
        t.status ?? 'Pending',
        t.priority ?? 'Medium',
      ], i % 2 === 1)
    ),
  ];
  s3.addTable(taskTableRows, {
    x: 0.6, y: 1.6, w: 9.2, h: 5.2,
    fontSize: 9,
    border: { type: 'solid', color: 'E8E6DC', pt: 0.5 },
    color: GRAY,
  });

  // ── Slide 4: Milestones ──
  if (data.milestones.length > 0) {
    const s4 = pptx.addSlide();
    s4.background = { color: 'FFFFFF' };
    addSlideTitle(pptx, s4, 'Key Milestones');
    data.milestones.slice(0, 8).forEach((m, i) => {
      const y = 1.65 + i * 0.72;
      s4.addShape(pptx.ShapeType.ellipse, { x: 0.55, y: y + 0.08, w: 0.28, h: 0.28, fill: { color: TERRA } });
      s4.addText(m, { x: 1.05, y, w: 8.5, h: 0.5, fontSize: 13, color: GRAY });
    });
  }

  // ── Slide 5: Risks ──
  if (data.risks.length > 0) {
    const s5 = pptx.addSlide();
    s5.background = { color: 'FFFFFF' };
    addSlideTitle(pptx, s5, 'Risks & Blockers');
    data.risks.slice(0, 7).forEach((r, i) => {
      s5.addText(`⚠  ${r}`, { x: 0.6, y: 1.65 + i * 0.82, w: 9.2, h: 0.65, fontSize: 13, color: RED });
    });
  }

  // ── Slide 6: Next Steps ──
  const s6 = pptx.addSlide();
  s6.background = { color: TERRA };
  s6.addText('Next Steps', { x: 0.6, y: 0.5, w: 9, h: 0.9, fontSize: 30, bold: true, color: 'FFFFFF', fontFace: 'Georgia' });
  data.recommendations.slice(0, 5).forEach((r, i) => {
    s6.addText(`${i + 1}.  ${r}`, {
      x: 0.6, y: 1.6 + i * 0.95, w: 9, h: 0.75, fontSize: 14, color: 'FFFFFF',
    });
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
    x: 0.6, y: 0.4, w: 9, h: 0.8,
    fontSize: 26, bold: true, color: DARK, fontFace: 'Georgia',
  });
  slide.addShape(pptx.ShapeType.line, {
    x: 0.6, y: 1.3, w: 9.2, h: 0,
    line: { color: TERRA, width: 2 },
  });
}

function makeHeaderRow(cells: string[]) {
  return cells.map(text => ({
    text,
    options: { bold: true, fill: { color: CREAM }, color: DARK, fontSize: 9 },
  }));
}

function makeDataRow(cells: string[], shade: boolean) {
  return cells.map(text => ({
    text,
    options: { fill: { color: shade ? IVORY : 'FFFFFF' }, color: GRAY, fontSize: 9 },
  }));
}
