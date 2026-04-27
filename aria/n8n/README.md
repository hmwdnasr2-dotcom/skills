# ARIA n8n Workflows

Five automation workflows that connect ARIA to Gmail, Supabase, and the web.

## Workflows

| File | Schedule | Purpose |
|------|----------|---------|
| `email-monitor.json` | Every 15 min | Fetch unread Gmail → summarise → send to ARIA |
| `daily-briefing.json` | Daily 7:00 AM | Tasks + follow-ups + emails → morning briefing |
| `follow-up-reminder.json` | Every hour | Overdue follow-ups → alert ARIA |
| `web-search-agent.json` | Webhook (on demand) | Receive query → DuckDuckGo → return results |
| `weekly-report.json` | Sunday 6:00 PM | Tasks + projects + achievements → weekly report |

---

## How to Import

1. Open your n8n instance
2. Go to **Workflows → Import from file**
3. Select each `.json` file from this folder
4. Activate each workflow after configuring credentials (see below)

---

## Credentials Required

### 1. Gmail OAuth2

Used by: `email-monitor`, `daily-briefing`

1. In n8n go to **Credentials → New → Gmail OAuth2 API**
2. Follow the Google OAuth setup:
   - Create a project at [console.cloud.google.com](https://console.cloud.google.com)
   - Enable the Gmail API
   - Create OAuth 2.0 credentials (Web application)
   - Set redirect URI to `https://YOUR_N8N_URL/rest/oauth2-credential/callback`
3. Copy the **Credential ID** from n8n
4. In each workflow node that uses Gmail, replace `REPLACE_WITH_GMAIL_CREDENTIAL_ID` with your ID

### 2. Supabase API

Used by: `daily-briefing`, `follow-up-reminder`, `weekly-report`

1. In n8n go to **Credentials → New → Supabase API**
2. Enter:
   - **Host**: your Supabase project URL (e.g. `https://xxxx.supabase.co`)
   - **Service Role Secret**: from Supabase → Settings → API → `service_role` key
3. Copy the **Credential ID** from n8n
4. In each workflow node that uses Supabase, replace `REPLACE_WITH_SUPABASE_CREDENTIAL_ID` with your ID

> Use the `service_role` key (not `anon`) so n8n can bypass RLS and read all rows.

---

## Web Search Webhook URL

After importing `web-search-agent.json` and activating it, n8n will give you a webhook URL like:

```
https://YOUR_N8N_URL/webhook/aria-search
```

To trigger a search from ARIA or any tool, POST:

```json
{
  "userId": "user-1",
  "query": "latest AI news"
}
```

---

## ARIA API Endpoint

All workflows send messages to:

```
POST http://188.245.242.236:4000/api/aria/chat
{
  "userId": "n8n-<workflow-name>",
  "message": "..."
}
```

ARIA processes each message and stores results in Supabase automatically via its existing connectors.

---

## Fixing the Git Conflict on the Server

Before running `git pull`, the server has a local change to `aria/packages/web/public/index.html`. Fix it with:

```bash
cd /root/skills
git checkout -- aria/packages/web/public/index.html
git pull
```

This discards the server's local version (it was the old UI) and pulls the new design from GitHub.
