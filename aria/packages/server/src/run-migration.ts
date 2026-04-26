/**
 * Run migration 006 via the Supabase Session Pooler using pg.
 * The project REST API subdomain is DNS-blocked, but
 * aws-0-*.pooler.supabase.com resolves and Supavisor accepts
 * the service role JWT as the PostgreSQL password.
 *
 * Usage:  npx tsx src/run-migration.ts
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pkg from 'pg';
const { Client } = pkg;

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env from aria/.env
const envPath = resolve(__dirname, '../../../.env');
const envText = readFileSync(envPath, 'utf-8');
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2];
}

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
}

const projectRef = SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
if (!projectRef) throw new Error(`Cannot parse project ref from ${SUPABASE_URL}`);

const migrationPath = resolve(__dirname, '../../../supabase/migrations/006_correct_schema.sql');
const sql = readFileSync(migrationPath, 'utf-8');

const POOLER_REGIONS = [
  'aws-0-us-east-1',
  'aws-0-us-west-1',
  'aws-0-eu-west-1',
  'aws-0-ap-southeast-1',
];

async function tryConnect(host: string): Promise<boolean> {
  const client = new Client({
    host,
    port: 5432,
    database: 'postgres',
    user: `postgres.${projectRef}`,
    password: SUPABASE_SERVICE_ROLE_KEY,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });

  try {
    console.log(`Trying ${host}...`);
    await client.connect();
    console.log(`  Connected! Running migration...`);
    await client.query(sql);
    console.log(`  ✓ Migration applied.`);
    await client.end();
    return true;
  } catch (e) {
    const msg = (e as Error).message;
    console.log(`  ✗ ${msg}`);
    try { await client.end(); } catch {}
    return false;
  }
}

(async () => {
  console.log(`Project ref: ${projectRef}`);
  console.log(`Migration:   ${migrationPath}\n`);

  for (const region of POOLER_REGIONS) {
    const host = `${region}.pooler.supabase.com`;
    const ok = await tryConnect(host);
    if (ok) {
      console.log('\nDone — tables are ready.');
      process.exit(0);
    }
  }

  console.log('\n✗ Could not connect via any pooler region.');
  console.log('  Please run aria/supabase/migrations/006_correct_schema.sql in the Supabase SQL Editor.');
  process.exit(1);
})();
