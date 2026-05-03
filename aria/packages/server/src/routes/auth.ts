import { Router } from 'express';
import { google } from 'googleapis';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dir, '../../../../.env'); // packages/server/src/routes → aria/.env

function patchEnv(key: string, value: string): void {
  if (!existsSync(ENV_PATH)) return;
  const raw = readFileSync(ENV_PATH, 'utf8');
  const escaped = value.replace(/\$/g, '\\$');
  const updated = raw.includes(`${key}=`)
    ? raw.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${escaped}`)
    : `${raw.trimEnd()}\n${key}=${escaped}\n`;
  writeFileSync(ENV_PATH, updated, 'utf8');
}

export const authRouter = Router();

// In-memory tester code store (lost on server restart; use Supabase for persistence if needed)
const testerCodes = new Map<string, { name: string; createdAt: Date }>();

function isAdmin(password: string | undefined): boolean {
  const expected = process.env.ARIA_PASSWORD;
  return !!(expected && password === expected);
}

authRouter.post('/login', (req, res) => {
  const { password } = req.body as { password?: string };
  const expected = process.env.ARIA_PASSWORD;

  if (!expected) {
    console.warn('[auth] ARIA_PASSWORD not set; login open to anyone');
    res.json({ ok: true, role: 'admin' });
    return;
  }

  if (password === expected) {
    res.json({ ok: true, role: 'admin' });
    return;
  }

  if (testerCodes.has(password || '')) {
    const info = testerCodes.get(password!)!;
    res.json({ ok: true, role: 'tester', name: info.name });
    return;
  }

  res.status(401).json({ ok: false, error: 'Incorrect password or access code' });
});

// Create tester code (admin only)
authRouter.post('/testers', (req, res) => {
  const { adminPassword, name, code } = req.body as { adminPassword?: string; name?: string; code?: string };
  if (!isAdmin(adminPassword)) {
    res.status(403).json({ error: 'Admin password required' });
    return;
  }
  const newCode = code?.trim() || Math.random().toString(36).slice(2, 10).toUpperCase();
  const displayName = name?.trim() || 'Tester';
  testerCodes.set(newCode, { name: displayName, createdAt: new Date() });
  console.log(`[auth] Tester code created: ${newCode} (${displayName})`);
  res.json({ ok: true, code: newCode, name: displayName });
});

// List tester codes (admin only — pass admin password as x-admin-password header)
authRouter.get('/testers', (req, res) => {
  const adminPassword = req.headers['x-admin-password'] as string | undefined;
  if (!isAdmin(adminPassword)) {
    res.status(403).json({ error: 'Admin password required' });
    return;
  }
  const testers = [...testerCodes.entries()].map(([code, info]) => ({
    code,
    name: info.name,
    createdAt: info.createdAt.toISOString(),
  }));
  res.json({ testers });
});

// Delete tester code (admin only)
authRouter.delete('/testers/:code', (req, res) => {
  const adminPassword = req.headers['x-admin-password'] as string | undefined;
  if (!isAdmin(adminPassword)) {
    res.status(403).json({ error: 'Admin password required' });
    return;
  }
  testerCodes.delete(req.params.code);
  res.json({ ok: true });
});

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',   // read + archive + labels
  'https://www.googleapis.com/auth/gmail.compose',  // create drafts
  'https://www.googleapis.com/auth/gmail.send',     // send
];

function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI ?? 'http://188.245.242.236:4000/api/auth/gmail/callback',
  );
}

// Step 1 — redirect user to Google's consent screen
authRouter.get('/gmail', (_req, res) => {
  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET) {
    res.status(500).send(
      'GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET must be set in .env before starting OAuth.',
    );
    return;
  }

  const url = oauthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',      // forces refresh_token to be returned even if previously granted
    scope: SCOPES,
  });

  res.redirect(url);
});

// Step 2 — Google redirects here with ?code=…
authRouter.get('/gmail/callback', async (req, res) => {
  const code = req.query.code as string | undefined;
  if (!code) {
    res.status(400).send('Missing code parameter.');
    return;
  }

  try {
    const { tokens } = await oauthClient().getToken(code);
    const refresh = tokens.refresh_token;

    if (!refresh) {
      res.status(400).send(
        'Google did not return a refresh_token. Visit <a href="/api/auth/gmail">/api/auth/gmail</a> again — it forces re-consent.',
      );
      return;
    }

    // Write to .env immediately so the token survives server restarts
    patchEnv('GMAIL_REFRESH_TOKEN', refresh);

    // Apply live — no restart needed (GmailConnector reads process.env per call)
    process.env.GMAIL_REFRESH_TOKEN = refresh;

    console.log('[auth] Gmail OAuth successful — token written to .env and active immediately');

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>
          body { font-family: system-ui, sans-serif; background: #0b1326; color: #dae2fd;
                 padding: 40px 32px; max-width: 540px; margin: 0 auto; }
          h2 { color: #8083ff; margin-bottom: 8px; }
          .pill { display:inline-block; background:#1a2a10; color:#4ade80; border:1px solid #16a34a;
                  border-radius:99px; padding:4px 14px; font-size:13px; margin-bottom:20px; }
          p { color: #c7c4d7; line-height:1.6; }
          a { color:#8083ff; }
        </style>
      </head>
      <body>
        <h2>Gmail connected</h2>
        <span class="pill">Active immediately — no restart needed</span>
        <p>ARIA can now read and send emails from your Gmail account.
           The refresh token has been saved to <code>.env</code> automatically.</p>
        <p><a href="/">← Back to ARIA</a></p>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('[auth] OAuth token exchange failed:', err);
    res.status(500).send(`OAuth failed: ${(err as Error).message}`);
  }
});
