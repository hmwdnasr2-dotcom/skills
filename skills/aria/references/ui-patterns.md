# UI Patterns — Command Log & Proactive Surfacing

ARIA uses a specific anti-Telegram-bot design philosophy:

- **Command-log aesthetic**: output looks like a terminal/audit log, not chat bubbles
- **No sidebar**: there is no navigation chrome — the conversation *is* the interface
- **No bubble chat**: messages are not styled as left/right speech bubbles
- **Proactive surfacing**: ARIA pushes morning briefings and follow-up nudges without
  being asked

---

## Command-log UI

### Visual language

```
[09:14]  ARIA   Morning briefing ready. 3 tasks pending, 1 meeting at 10:00.
[09:14]  ARIA   ─────────────────────────────────────────────────────────────
[09:14]  ARIA   ▸ Draft reply to Sarah's email re: Q3 budget (overdue 2d)
[09:14]  ARIA   ▸ Review pull request #421 before standup
[09:14]  ARIA   ▸ Call dentist — you flagged this on Monday
[09:17]  YOU    Let's draft the email to Sarah
[09:17]  ARIA   Pulling context on the Q3 budget thread…
[09:17]  ARIA   Draft ready. Review below.
```

Key rules:
- Left-aligned monospace or monospace-style font
- Timestamps on every row
- Speaker label (`ARIA` / `YOU`) instead of bubble placement
- Thin dividers (`─────`) to group related log entries
- `▸` bullet for proactive action items
- No rounded corners on message containers
- System events (tool calls, memory loads) can appear as muted log lines

### React component

```tsx
// src/ui/CommandLog.tsx
import React, { useEffect, useRef, useState } from 'react';
import type { OpenClaw } from 'openclaw';

interface LogEntry {
  id: string;
  timestamp: Date;
  speaker: 'ARIA' | 'YOU' | 'SYSTEM';
  content: string;
  isStreaming?: boolean;
}

interface CommandLogProps {
  userId: string;
  claw: OpenClaw;
}

export function CommandLog({ userId, claw }: CommandLogProps) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  // Subscribe to proactive events pushed from the server
  useEffect(() => {
    const es = new EventSource(`/api/aria/events?userId=${userId}`);
    es.onmessage = (e) => {
      const data = JSON.parse(e.data) as { content: string };
      appendEntry('ARIA', data.content);
    };
    return () => es.close();
  }, [userId]);

  function appendEntry(speaker: LogEntry['speaker'], content: string) {
    setEntries((prev) => [
      ...prev,
      { id: crypto.randomUUID(), timestamp: new Date(), speaker, content },
    ]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || busy) return;

    const userText = input.trim();
    setInput('');
    appendEntry('YOU', userText);
    setBusy(true);

    // Stream the reply token by token
    const streamingId = crypto.randomUUID();
    setEntries((prev) => [
      ...prev,
      { id: streamingId, timestamp: new Date(), speaker: 'ARIA', content: '', isStreaming: true },
    ]);

    let accumulated = '';
    for await (const token of claw.stream('chat', { userId, message: userText })) {
      accumulated += token;
      setEntries((prev) =>
        prev.map((e) => (e.id === streamingId ? { ...e, content: accumulated } : e)),
      );
    }

    setEntries((prev) =>
      prev.map((e) => (e.id === streamingId ? { ...e, isStreaming: false } : e)),
    );
    setBusy(false);
  }

  return (
    <div className="log-root">
      <div className="log-entries">
        {entries.map((entry) => (
          <LogLine key={entry.id} entry={entry} />
        ))}
        <div ref={bottomRef} />
      </div>

      <form className="log-input-row" onSubmit={handleSubmit}>
        <span className="log-prompt">{'>'}</span>
        <input
          className="log-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="type a message…"
          disabled={busy}
          autoFocus
        />
      </form>
    </div>
  );
}

function LogLine({ entry }: { entry: LogEntry }) {
  const ts = entry.timestamp.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return (
    <div className={`log-line log-line--${entry.speaker.toLowerCase()}`}>
      <span className="log-ts">[{ts}]</span>
      <span className="log-speaker">{entry.speaker.padEnd(6)}</span>
      <span className="log-content">
        {entry.content}
        {entry.isStreaming && <span className="cursor">▌</span>}
      </span>
    </div>
  );
}
```

### CSS (Tailwind-free baseline)

```css
/* src/ui/CommandLog.css */
.log-root {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #0d0d0d;
  color: #d4d4d4;
  font-family: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
}

.log-entries {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px;
}

.log-line {
  display: flex;
  gap: 12px;
  padding: 2px 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.log-ts     { color: #555; flex-shrink: 0; }
.log-speaker { font-weight: 600; flex-shrink: 0; min-width: 52px; }
.log-line--aria .log-speaker    { color: #7ec8e3; }
.log-line--you .log-speaker     { color: #c8e37e; }
.log-line--system .log-speaker  { color: #888; }
.log-line--system               { opacity: 0.6; }

.log-content { flex: 1; }
.cursor { animation: blink 1s step-end infinite; }
@keyframes blink { 0%, 100% { opacity: 1 } 50% { opacity: 0 } }

.log-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  border-top: 1px solid #222;
  background: #0d0d0d;
}

.log-prompt { color: #7ec8e3; font-weight: bold; }

.log-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: #d4d4d4;
  font-family: inherit;
  font-size: inherit;
  caret-color: #7ec8e3;
}
```

---

## Proactive surfacing

ARIA should push content to the user on a schedule — without the user initiating a
message. There are two mechanisms: **briefings** (rich, scheduled) and **nudges**
(lightweight reminders).

### Scheduler (briefings)

```typescript
// src/proactive/scheduler.ts
import cron from 'node-cron';
import { claw } from '../core';
import { pushToCommandLog } from './push';

export function startScheduler(userIds: string[]) {
  // Morning briefing at 07:00 local time per user
  cron.schedule('0 7 * * *', async () => {
    for (const userId of userIds) {
      try {
        const briefing = await claw.run('morning-briefing', { userId, messages: [] });
        await pushToCommandLog(userId, briefing);
      } catch (err) {
        console.error(`Briefing failed for ${userId}:`, err);
      }
    }
  });
}
```

**morning-briefing pipeline:**

```typescript
claw.pipeline('morning-briefing', async (ctx) => {
  await ctx.memory.load(ctx.userId);
  const memories = await ctx.memory.recall(ctx.userId, 'tasks commitments deadlines', 10);
  const memBlock = memories.map((m) => m.content).join('\n');

  const reply = await ctx.brain.chat([
    {
      role: 'system',
      content: `You are ARIA. Generate a concise morning briefing for the user.
Format it as a command-log list with ▸ bullets.
Draw only from the memory context provided — do not invent items.
Be direct. 3-5 items maximum. Include any overdue items first.`,
    },
    {
      role: 'user',
      content: `Memory context:\n${memBlock || 'No prior context.'}\n\nGenerate morning briefing.`,
    },
  ]);

  return reply.content;
});
```

### Nudger (follow-up reminders)

```typescript
// src/proactive/nudger.ts
import { claw } from '../core';
import { pushToCommandLog } from './push';

/**
 * Called after any conversation turn to schedule a follow-up nudge if the
 * brain flagged an action item.
 */
export async function scheduleNudgeIfNeeded(userId: string, reply: string) {
  // Ask the brain whether a follow-up is warranted
  const check = await claw.run('nudge-check', {
    userId,
    messages: [
      {
        role: 'user',
        content: `Does this reply contain a commitment or action item that needs a follow-up reminder? Reply with JSON: { "needed": boolean, "delayMs": number, "reminder": string }\n\n${reply}`,
      },
    ],
  });

  let parsed: { needed: boolean; delayMs: number; reminder: string };
  try {
    parsed = JSON.parse(check);
  } catch {
    return; // brain didn't produce valid JSON — skip
  }

  if (!parsed.needed) return;

  setTimeout(async () => {
    await pushToCommandLog(userId, `▸ Follow-up: ${parsed.reminder}`);
  }, parsed.delayMs);
}
```

### Server-sent events push endpoint

The `pushToCommandLog` function writes to a per-user SSE channel that the
`CommandLog` UI subscribes to.

```typescript
// src/proactive/push.ts
import type { Response } from 'express';

const clients = new Map<string, Response>();

/** Register a client's SSE response stream. */
export function registerSseClient(userId: string, res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  clients.set(userId, res);
  res.on('close', () => clients.delete(userId));
}

/** Push a message to the user's command log. */
export async function pushToCommandLog(userId: string, content: string) {
  const res = clients.get(userId);
  if (res) {
    res.write(`data: ${JSON.stringify({ content })}\n\n`);
  }
  // Optionally: persist to Supabase for replay when the user reconnects
}
```

**Express route:**
```typescript
app.get('/api/aria/events', (req, res) => {
  const userId = req.query.userId as string;
  if (!userId) return res.status(400).send('userId required');
  registerSseClient(userId, res);
});
```

---

## Design rules checklist

Before shipping any UI work, verify:

- [ ] No speech bubbles — messages are log lines, not rounded chat cards
- [ ] No sidebar or navigation panel — the log fills the full viewport
- [ ] Timestamps visible on every log line
- [ ] Speaker label (`ARIA` / `YOU`) is text, not an avatar or icon
- [ ] Monospace font throughout
- [ ] ARIA-initiated entries (briefings, nudges) appear without user action
- [ ] Input field at bottom, no send button needed — Enter submits
- [ ] Streaming reply rendered token-by-token with a blinking cursor
- [ ] System events (e.g. "loading memory…") appear as muted log lines, not alerts
