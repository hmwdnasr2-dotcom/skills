import { fileRegistry } from '../routes/upload.js';
import { parseFile } from '../services/fileParser.js';
import type { ParsedDocument } from '../services/fileParser.js';

export async function processFiles(fileIds: string[]): Promise<ParsedDocument[]> {
  const results: ParsedDocument[] = [];

  for (const id of fileIds) {
    const record = fileRegistry.get(id);
    if (!record) {
      console.warn(`[fileHandler] fileId not found: ${id}`);
      continue;
    }
    try {
      const doc = await parseFile(record.storedPath, record.ext, record.originalName);
      results.push(doc);
    } catch (err) {
      console.warn(`[fileHandler] parse failed for ${record.originalName}:`, (err as Error).message);
    }
  }

  return results;
}
