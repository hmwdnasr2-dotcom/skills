// Imported first in server.ts — resolves .env relative to this file's
// location so it works regardless of the process cwd (npm workspaces,
// direct tsx invocation, etc.)
import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dir, '../../../.env'), override: true }); // → aria/.env; override: true ensures .env always wins over stale PM2-cached env vars
