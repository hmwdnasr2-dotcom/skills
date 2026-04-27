import { Router } from 'express';
import fs from 'fs';
import path from 'path';

export interface ReportRecord {
  fileId: string;
  fileName: string;
  filePath: string;
  type: 'xlsx' | 'pdf' | 'pptx';
  size: number;
  createdAt: string;
}

// Shared in-memory registry populated by reportGenerator
export const reportRegistry = new Map<string, ReportRecord>();

const MIME: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export const downloadRouter = Router();

downloadRouter.get('/:fileId', (req, res) => {
  const { fileId } = req.params;
  const record = reportRegistry.get(fileId);

  if (!record) {
    res.status(404).json({ error: 'File not found or expired' });
    return;
  }

  if (!fs.existsSync(record.filePath)) {
    reportRegistry.delete(fileId);
    res.status(404).json({ error: 'File has expired' });
    return;
  }

  res.setHeader('Content-Type', MIME[record.type] ?? 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${record.fileName}"`);
  res.setHeader('Content-Length', record.size);
  fs.createReadStream(record.filePath).pipe(res);
});
