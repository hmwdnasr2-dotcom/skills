import React, { useEffect, useRef, useState } from 'react';
import './CommandLog.css';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LogEntry {
  id: string;
  timestamp: Date;
  speaker: 'ARIA' | 'YOU' | 'SYSTEM';
  content: string;
  isStreaming?: boolean;
}

interface CommandLogProps {
  userId: string;
  /** Base URL for the ARIA server. Defaults to same origin via Vite proxy. */
  apiBase?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// ─── LogLine component ────────────────────────────────────────────────────────

function LogLine({ entry }: { entry: LogEntry }) {
  return (
    <div className={`log-line log-line--${entry.speaker.toLowerCase()}`}>
      <span className="log-ts">[{formatTime(entry.timestamp)}]</span>
      <span className="log-speaker">{entry.speaker.padEnd(6)}</span>
      <span className="log-content">
        {entry.content}
        {entry.isStreaming && <span className="cursor">▌</span>}
      </span>
    </div>
  );
}

// ─── CommandLog component ─────────────────────────────────────────────────────

export function CommandLog({ userId, apiBase = '' }: CommandLogProps) {
  const [entries, setEntries] = useState<LogEntry[]>([
    {
      id: 'welcome',
      timestamp: new Date(),
      speaker: 'ARIA',
      content: 'ARIA online. Type a message to begin.',
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  // Subscribe to proactive SSE push from server
  useEffect(() => {
    const url = `${apiBase}/api/aria/events?userId=${encodeURIComponent(userId)}`;
    const es = new EventSource(url);

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as { content: string };
        if (data.content) appendEntry('ARIA', data.content);
      } catch {
        // ignore malformed messages
      }
    };

    es.onerror = () => {
      appendEntry('SYSTEM', 'Event stream disconnected. Reconnecting…');
    };

    return () => es.close();
  }, [userId, apiBase]);

  function appendEntry(speaker: LogEntry['speaker'], content: string): string {
    const id = crypto.randomUUID();
    setEntries((prev) => [
      ...prev,
      { id, timestamp: new Date(), speaker, content },
    ]);
    return id;
  }

  function updateEntry(id: string, patch: Partial<LogEntry>) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    setInput('');
    setBusy(true);
    appendEntry('YOU', text);

    // Show a streaming placeholder
    const streamingId = crypto.randomUUID();
    setEntries((prev) => [
      ...prev,
      {
        id: streamingId,
        timestamp: new Date(),
        speaker: 'ARIA',
        content: '',
        isStreaming: true,
      },
    ]);

    try {
      const url =
        `${apiBase}/api/aria/chat/stream` +
        `?userId=${encodeURIComponent(userId)}` +
        `&message=${encodeURIComponent(text)}`;
      const es = new EventSource(url);

      let accumulated = '';

      await new Promise<void>((resolve, reject) => {
        es.onmessage = (ev) => {
          if (ev.data === '[DONE]') {
            es.close();
            resolve();
            return;
          }
          try {
            const { token, error } = JSON.parse(ev.data) as {
              token?: string;
              error?: string;
            };
            if (error) { es.close(); reject(new Error(error)); return; }
            if (token) {
              accumulated += token;
              updateEntry(streamingId, { content: accumulated });
            }
          } catch {
            // skip
          }
        };
        es.onerror = () => { es.close(); reject(new Error('Stream error')); };
      });

      updateEntry(streamingId, { isStreaming: false });
    } catch (err) {
      updateEntry(streamingId, {
        content: `Error: ${(err as Error).message}`,
        isStreaming: false,
      });
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
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
          ref={inputRef}
          className="log-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="type a message…"
          disabled={busy}
          autoFocus
          autoComplete="off"
          spellCheck={false}
        />
      </form>
    </div>
  );
}
