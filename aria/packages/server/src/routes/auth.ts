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

// Step 1 — show setup page (manual token paste — works without a domain)
authRouter.get('/gmail', (_req, res) => {
  const configured = !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET);
  const active     = !!(process.env.GMAIL_REFRESH_TOKEN);

  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Gmail Setup | ARIA</title>
  <style>
    body{font-family:system-ui,sans-serif;background:#0b1326;color:#dae2fd;padding:32px;max-width:640px;margin:0 auto}
    h1{color:#8083ff;font-size:22px;margin-bottom:4px}
    .sub{color:#908fa0;font-size:13px;margin-bottom:32px}
    .card{background:#171f33;border:1px solid rgba(144,143,160,.15);border-radius:14px;padding:24px;margin-bottom:20px}
    .card h2{font-size:15px;font-weight:700;margin:0 0 8px;color:#c0c1ff}
    .step{display:flex;gap:12px;margin-bottom:12px;font-size:13px;color:#c7c4d7;line-height:1.5}
    .num{background:#8083ff;color:#fff;border-radius:50%;width:22px;height:22px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;margin-top:1px}
    a{color:#8083ff}
    code{background:#222a3d;padding:2px 6px;border-radius:4px;font-size:12px;word-break:break-all}
    textarea{width:100%;box-sizing:border-box;background:#0b1326;border:1px solid rgba(144,143,160,.25);border-radius:8px;color:#dae2fd;padding:10px;font-family:monospace;font-size:12px;resize:vertical;min-height:80px;margin-top:8px}
    button{background:#8083ff;color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer;margin-top:12px}
    button:hover{background:#9496ff}
    .pill{display:inline-block;border-radius:99px;padding:3px 12px;font-size:12px;font-weight:600;margin-bottom:16px}
    .pill.ok{background:#1a2a10;color:#4ade80;border:1px solid #16a34a}
    .pill.warn{background:#2a1a10;color:#fb923c;border:1px solid #c2410c}
    #msg{margin-top:12px;font-size:13px;display:none}
  </style>
</head>
<body>
  <h1>Gmail Setup</h1>
  <p class="sub">Connect your Gmail account so ARIA can read and send emails.</p>

  ${active ? '<span class="pill ok">✓ Gmail active</span>' : '<span class="pill warn">⚠ Gmail not connected</span>'}
  ${!configured ? '<p style="color:#fb923c;font-size:13px">⚠ GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET are missing from .env — add them first.</p>' : ''}

  <div class="card">
    <h2>How to get your Refresh Token</h2>
    <div class="step"><span class="num">1</span><span>Go to <a href="https://developers.google.com/oauthplayground" target="_blank">developers.google.com/oauthplayground</a></span></div>
    <div class="step"><span class="num">2</span><span>Click the ⚙️ gear (top-right) → check <b>"Use your own OAuth credentials"</b> → enter your <b>Client ID</b> and <b>Client Secret</b></span></div>
    <div class="step"><span class="num">3</span><span>In the left panel, find <b>Gmail API v1</b> and select all three scopes:<br><code>gmail.modify</code> &nbsp;<code>gmail.compose</code> &nbsp;<code>gmail.send</code><br>Click <b>Authorize APIs</b></span></div>
    <div class="step"><span class="num">4</span><span>Click <b>Exchange authorization code for tokens</b> → copy the <b>Refresh token</b> value</span></div>
    <div class="step"><span class="num">5</span><span>Paste it below and click Save</span></div>
  </div>

  <div class="card">
    <h2>Paste Refresh Token</h2>
    <textarea id="token" placeholder="1//0g..."></textarea>
    <br>
    <button onclick="save()">Save &amp; Activate</button>
    <div id="msg"></div>
  </div>

  <script>
    async function save() {
      const token = document.getElementById('token').value.trim();
      if (!token) { alert('Paste your refresh token first.'); return; }
      const msg = document.getElementById('msg');
      msg.style.display = 'block';
      msg.style.color = '#908fa0';
      msg.textContent = 'Saving…';
      try {
        const r = await fetch('/api/auth/gmail/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: token }),
        });
        const d = await r.json();
        if (d.ok) {
          msg.style.color = '#4ade80';
          msg.textContent = '✓ Gmail activated — ARIA can now read and send emails.';
        } else {
          msg.style.color = '#fb923c';
          msg.textContent = 'Error: ' + (d.error || 'Unknown');
        }
      } catch(e) {
        msg.style.color = '#fb923c';
        msg.textContent = 'Request failed: ' + e.message;
      }
    }
  </script>
</body>
</html>`);
});

// Accept manually-pasted refresh token (from OAuth Playground)
authRouter.post('/gmail/token', (req, res) => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (!refreshToken?.trim()) {
    res.status(400).json({ ok: false, error: 'refreshToken is required' });
    return;
  }
  patchEnv('GMAIL_REFRESH_TOKEN', refreshToken.trim());
  process.env.GMAIL_REFRESH_TOKEN = refreshToken.trim();
  console.log('[auth] Gmail refresh token updated via manual paste — active immediately');
  res.json({ ok: true });
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
