# ARIA — Project Brief

ARIA (Autonomous Relationship & Intelligence Assistant) is a self-hosted personal AI built on a custom orchestration engine called OpenClaw that routes any request — tasks, email, research, code, coaching — through the right tools and brain provider. It runs 24/7 on a VPS, accessible via a React web interface and a Telegram bot.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Clients                                                │
│  ┌──────────────────┐   ┌─────────────────────────┐    │
│  │  React Web UI    │   │  Telegram Bot (polling) │    │
│  │  (port 4000)     │   │  /researcher /coach...  │    │
│  └────────┬─────────┘   └────────────┬────────────┘    │
└───────────┼────────────────────────── ┼ ────────────────┘
            │ HTTP/SSE                  │ runWorkflow()
            ▼                           ▼
┌───────────────────────────────────────────────────────┐
│  Express Server  (packages/server)                    │
│                                                       │
│  Routes                                               │
│  POST /api/aria/chat  →  runWorkflow()                │
│  GET  /api/aria/chat/stream  →  claw.stream()         │
│  GET  /api/aria/events  →  SSE push                   │
│  GET/DELETE /api/aria/memory                          │
│  POST /api/aria/upload  (multer, /tmp/aria-uploads)   │
│  GET  /api/aria/download/:id                          │
│  GET/POST /api/auth                                   │
│                                                       │
│  Workflow (core/workflow.ts)                          │
│  1. Route query → needs_search? needs_files?          │
│  2. Parallel: fetch files + web search                │
│  3. Build context messages                            │
│  4. claw.run('chat', ctx)  →  answer                  │
│  5. Auto-save to ideas vault (if triggered)           │
│                                                       │
│  OpenClaw (packages/core)                             │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │  LiveBrain   │  │  Memory      │  │  Bridges    │ │
│  │  (proxy)     │  │  Stack       │  │  (tools)    │ │
│  │  Claude ─┐  │  │  short-term  │  │  tasks      │ │
│  │  DeepSeek┤  │  │  long-term   │  │  reminders  │ │
│  │  Gemini  ┤  │  │  working     │  │  gmail      │ │
│  │  Groq    ┤  │  └──────────────┘  │  workspace  │ │
│  │  Ollama  ┤  │                    │  ideas      │ │
│  │  OpenAI ─┘  │                    │  reports    │ │
│  └──────────────┘                   │  web_search │ │
│                                     └─────────────┘ │
└───────────────────────────────────────────────────────┘
            │
            ▼
┌───────────────────────────────────────────────────────┐
│  Supabase (Postgres)                                  │
│  aria_memory  aria_tasks  aria_projects               │
│  aria_reminders  aria_follow_ups  aria_achievements   │
│  aria_daily_logs  aria_ideas                          │
└───────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js ≥20, ES modules |
| Language | TypeScript (strict) |
| AI orchestration | OpenClaw (`packages/core`) — custom engine |
| HTTP server | Express 4 |
| Frontend | React 18 + Vite + TypeScript |
| Database | Supabase (Postgres) |
| File storage | Local `/tmp/aria-uploads` (UUID-prefixed) |
| Scheduling | node-cron |
| Messaging | Telegram Bot API (long polling) |
| Build | tsx (dev), tsc (prod) |
| Process manager | PM2 |

---

## Brain Providers

Configured via `ARIA_BRAIN` + `ARIA_MODEL` env vars. Hot-swappable at runtime via Telegram commands.

| Brain | Env var | Switch command |
|---|---|---|
| Claude (default) | `ANTHROPIC_API_KEY` | `/setkey <key>` |
| DeepSeek | `DEEPSEEK_API_KEY` | `/setdeepseek <key>` |
| Gemini | `GEMINI_API_KEY` | — |
| Groq | `GROQ_API_KEY` | — |
| Ollama | — (local) | — |
| OpenAI | `OPENAI_API_KEY` | — |

---

## Agent Modes

Switched via Telegram commands. Mode persists per userId until changed.

| Command | Behavior |
|---|---|
| `/aria` | Default Chief of Staff mode |
| `/researcher` | Mandatory web_search before every answer; cites sources |
| `/strategist` | First-principles + second-order effects + clear recommendation |
| `/developer` | Working code, architecture decisions, security/perf callouts |
| `/coach` | Sharp questions, pattern reflection, one action per response |

Auto-routing is also active in default mode — ARIA shifts reasoning style based on query intent without announcement.

---

## Tools (AI-callable)

### Task & Project Management
| Tool | Description |
|---|---|
| `add_task` | Create task with due date, priority, project link |
| `list_tasks` | Filter by status, project, show overdue |
| `complete_task` | Mark done |
| `update_task_status` | Change to todo / in_progress / cancelled |
| `create_project` | New project with goal, deadline, priority |
| `list_projects` | Filter by status |
| `update_project` | Change status, record outcome |

### Workspace
| Tool | Description |
|---|---|
| `add_follow_up` | Track who you're waiting on |
| `list_follow_ups` | Pending follow-ups with overdue flag |
| `complete_follow_up` | Mark done |
| `log_achievement` | Record wins (work/personal/learning/health) |
| `log_daily` | End-of-day summary with mood |

### Reminders
| Tool | Description |
|---|---|
| `set_reminder` | Schedule by ISO 8601 datetime or natural language |
| `list_reminders` | Upcoming reminders |
| `cancel_reminder` | Delete by ID prefix |

### Ideas Vault
| Tool | Description |
|---|---|
| `save_idea` | Save with title, content, category, tags |
| `list_ideas` | Retrieve with category/search filters |

### Email (Gmail)
| Tool | Description |
|---|---|
| `gmail_list` | Search inbox (supports Gmail query syntax) |
| `gmail_get` | Fetch full message by ID |
| `gmail_send` | Send email (requires explicit user intent) |
| `gmail_draft` | Save draft, supports reply threads |

### Reports
| Tool | Description |
|---|---|
| `generate_report` | Productivity report: hourly / daily / weekly / monthly / quarterly / yearly |

### Web Search
| Tool | Description |
|---|---|
| `web_search` | Brave Search or Perplexity (whichever key is set) |

---

## Proactive Features

| Feature | Schedule | Channel |
|---|---|---|
| Morning briefing | 07:00 daily | Telegram |
| Due reminders | Every minute | Telegram |
| Daily report | 20:00 daily | Telegram |
| Weekly report | Sunday 09:00 | Telegram |
| Monthly/quarterly/yearly report | 1st of period | Telegram |

---

## File Analysis

Upload via web UI (drag-and-drop) or Telegram (send any file). Supported formats:

- **Excel** (`.xlsx`, `.xls`) — parsed via `xlsx`
- **PDF** (`.pdf`) — extracted via `pdf-parse`
- **Word** (`.docx`) — extracted via `mammoth`
- **CSV** (`.csv`) — raw text parsed by ARIA
- **Images** (`.png`, `.jpg`, `.jpeg`) — sent to vision model
- **Text** (`.txt`) — raw content

Files are temporarily stored in `/tmp/aria-uploads` and referenced by UUID. Report generation (Excel, PDF, PPTX) uses `xlsx`, `pdfkit`, `pptxgenjs`.

---

## Memory

Three-layer memory stack per userId:

1. **Working memory** — current conversation context
2. **Short-term memory** — recent interactions (session)
3. **Long-term memory** — persisted to `aria_memory` in Supabase; retrieved by similarity on each request

Memory entries are browsable and deletable via `GET/DELETE /api/aria/memory`.

---

## API Surface

```
POST   /api/aria/chat              Chat (JSON, sync)
GET    /api/aria/chat/stream       Chat (SSE streaming)
GET    /api/aria/events            Push events (SSE)
GET    /api/aria/memory?userId=    Fetch memory entries
DELETE /api/aria/memory/:id        Delete memory entry
POST   /api/aria/upload            Upload files (multipart, field: files)
GET    /api/aria/download/:id      Download generated report
GET/POST /api/auth                 Auth endpoints
GET    /health                     Health check → {ok:true}
```

---

## Key Environment Variables

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_URL=https://...supabase.co
SUPABASE_ANON_KEY=eyJ...

# Server
PORT=4000
ARIA_BRAIN=claude            # claude | deepseek | gemini | groq | ollama | openai
ARIA_MODEL=claude-opus-4-5   # model ID for chosen brain
ARIA_DEFAULT_USER=default

# Telegram (for mobile + proactive features)
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
TELEGRAM_USER_ID=...

# Optional integrations
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...
BRAVE_SEARCH_API_KEY=BSA...
PERPLEXITY_API_KEY=pplx-...
OPENAI_API_KEY=sk-...        # only needed for OpenAI embeddings
```

---

## Monorepo Layout

```
aria/
├── package.json              # root workspace
├── packages/
│   ├── core/                 # @aria/core — OpenClaw engine
│   │   └── src/
│   │       ├── index.ts      # exports: OpenClaw, Brain adapters, Memory, Bridges
│   │       └── bridge/adapters/  # perplexity, brave, n8n, langchain, crewai…
│   ├── server/               # Node.js API server
│   │   └── src/
│   │       ├── server.ts     # Express app entry
│   │       ├── load-env.ts   # dotenv loader
│   │       ├── core/
│   │       │   ├── index.ts  # ARIA_SYSTEM prompt + brain init
│   │       │   ├── workflow.ts  # runWorkflow()
│   │       │   └── fileHandler.ts
│   │       ├── connectors/   # tool adapters (tasks, gmail, reminders…)
│   │       ├── routes/       # Express routers
│   │       ├── services/     # telegram, reportGenerator, aiWorkflow…
│   │       └── proactive/    # scheduler, nudger
│   └── web/                  # React frontend
│       ├── index.html
│       ├── vite.config.ts
│       └── src/
│           ├── App.tsx
│           └── ui/
│               ├── AgentInterface.tsx
│               └── agent.css
└── supabase/
    └── migrations/           # SQL schema files
```
