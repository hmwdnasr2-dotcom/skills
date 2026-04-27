import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const UPLOAD_DIR = '/tmp/aria-uploads';
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_EXT = new Set([
  '.xlsx', '.xls', '.pdf', '.csv', '.docx', '.txt',
  '.png', '.jpg', '.jpeg',
]);

export interface FileRecord {
  fileId: string;
  originalName: string;
  size: number;
  mimeType: string;
  ext: string;
  storedPath: string;
  uploadedAt: string;
  sessionId: string;
}

// Shared in-memory registry (also used by chat route to resolve fileIds)
export const fileRegistry = new Map<string, FileRecord>();

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => {
    const fileId = crypto.randomUUID();
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${fileId}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXT.has(ext)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${ext}. Allowed: xlsx, pdf, csv, docx, txt, png, jpg`));
  },
});

export const uploadRouter = Router();

uploadRouter.post('/', upload.array('files', 10), (req, res) => {
  const files = req.files as Express.Multer.File[];
  const sessionId = (req.body.sessionId as string) || 'default';

  if (!files || files.length === 0) {
    res.status(400).json({ error: 'No files uploaded' });
    return;
  }

  const uploaded = files.map(file => {
    const ext = path.extname(file.originalname).toLowerCase();
    const fileId = path.basename(file.filename, ext);
    const record: FileRecord = {
      fileId,
      originalName: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
      ext,
      storedPath: file.path,
      uploadedAt: new Date().toISOString(),
      sessionId,
    };
    fileRegistry.set(fileId, record);
    return {
      fileId,
      name: file.originalname,
      size: file.size,
      type: ext.replace('.', ''),
      uploadedAt: record.uploadedAt,
    };
  });

  res.json({ files: uploaded });
});

// Error handler for multer (file type / size errors)
uploadRouter.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(400).json({ error: err.message });
});

import express from 'express';
