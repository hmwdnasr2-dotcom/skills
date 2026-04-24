import React, { useEffect, useRef, useState } from 'react';
import './CommandLog.css';

interface LogEntry {
  id: string;
  speaker: 'ARIA' | 'YOU' | 'SYSTEM';
  content: string;
  isStreaming?: boolean;
}

interface CommandLogProps {
  userId: string;
  apiBase?: string;
}

function Message({ entry }: { entry: LogEntry }) {
  return (
    <div className={`log-line log-line--${entry.speaker.toLowerCase()}`}>
      {entry.speaker !== 'SYSTEM' && (
        <div className="log-speaker-label">
          {entry.speaker === 'YOU' ? 'You' : 'ARIA'}
        </div>
      )}
      <div className="log-bubble">
        {entry.content}
        {entry.isStreaming && <span className="cursor">▌</span>}
      </div>
    </div>
  );
}

export function CommandLog({ userId, apiBase = '' }: CommandLogProps) {
  const [entries, setEntries] = useState<LogEntry[]>([
    { id: 'welcome', speaker: 'ARIA', content: 'How can I help you today?' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  // Proactive SSE push (morning briefings, nudges, etc.)
  useEffect(() => {
    const es = new EventSource(
      `${apiBase}/api/aria/events?userId=${encodeURIComponent(userId)}`,
    );
    es.onmessage = (e) => {
      try {
        const { content } = JSON.parse(e.data) as { content?: string };
        if (content) append('ARIA', content);
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, [userId, apiBase]);

  function append(speaker: LogEntry['speaker'], content: string): string {
    const id = crypto.randomUUID();
    setEntries((prev) => [...prev, { id, speaker, content }]);
    return id;
  }

  function patch(id: string, update: Partial<LogEntry>) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...update } : e)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    setInput('');
    setBusy(true);
    append('YOU', text);

    const pendingId = crypto.randomUUID();
    setEntries((prev) => [
      ...prev,
      { id: pendingId, speaker: 'ARIA', content: '', isStreaming: true },
    ]);

    try {
      const res = await fetch(`${apiBase}/api/aria/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, message: text }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { reply } = await res.json() as { reply: string };
      patch(pendingId, { content: reply, isStreaming: false });
    } catch (err) {
      patch(pendingId, {
        content: `Something went wrong: ${(err as Error).message}`,
        isStreaming: false,
      });
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="log-root">
      <header className="log-header">
        <div className="log-header-dot" />
        <span className="log-header-title">ARIA</span>
        <span className="log-header-status">{busy ? 'thinking…' : 'ready'}</span>
      </header>

      <div className="log-entries">
        {entries.map((entry) => (
          <Message key={entry.id} entry={entry} />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="log-input-wrap">
        <form className="log-input-row" onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            className="log-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message ARIA…"
            disabled={busy}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="sentences"
            spellCheck={false}
            enterKeyHint="send"
          />
          <button
            type="submit"
            className="log-send"
            disabled={busy || !input.trim()}
            aria-label="Send"
          >
            ↑
          </button>
        </form>
      </div>
    </div>
  );
}
