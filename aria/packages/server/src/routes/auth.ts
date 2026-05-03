import { Router } from 'express';
import { google } from 'googleapis';

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

    console.log('\n========================================');
    console.log('[auth] Gmail OAuth successful!');
    console.log('[auth] Add this to your .env file:');
    console.log(`GMAIL_REFRESH_TOKEN=${refresh}`);
    console.log('========================================\n');

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>
          body { font-family: monospace; background: #1c1c1c; color: #ececec;
                 padding: 32px; max-width: 640px; margin: 0 auto; }
          h2 { color: #d97706; }
          pre { background: #252525; padding: 16px; border-radius: 8px;
                word-break: break-all; white-space: pre-wrap; }
          p { color: #aaa; }
        </style>
      </head>
      <body>
        <h2>Gmail connected ✓</h2>
        <p>Add the following line to your <code>.env</code> file, then restart ARIA:</p>
        <pre>GMAIL_REFRESH_TOKEN=${refresh ?? '(no refresh token — re-authorise with prompt=consent)'}</pre>
        <p>The token is also printed in the server console.</p>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('[auth] OAuth token exchange failed:', err);
    res.status(500).send(`OAuth failed: ${(err as Error).message}`);
  }
});
