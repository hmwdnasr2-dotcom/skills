import { useEffect, useState } from 'react';

interface Memory {
  id: string;
  content: string;
  created_at: string;
}

interface MemoryPanelProps {
  userId: string;
  apiBase: string;
  onClose: () => void;
}

export function MemoryPanel({ userId, apiBase, onClose }: MemoryPanelProps) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [newestId, setNewestId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${apiBase}/api/aria/memory?userId=${encodeURIComponent(userId)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { memories: data } = await res.json() as { memories: Memory[] };
        if (!cancelled) {
          setMemories(data);
          if (data.length > 0) setNewestId(data[0].id);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [userId, apiBase]);

  async function deleteMemory(id: string) {
    try {
      await fetch(`${apiBase}/api/aria/memory/${id}`, { method: 'DELETE' });
      setMemories((prev) => prev.filter((m) => m.id !== id));
    } catch { /* ignore */ }
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div className="memory-panel">
      <div className="mem-header">
        <span className="mem-title">🧠 Memory</span>
        <button className="mem-close" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="mem-list">
        {loading && <div className="mem-loading">Loading…</div>}

        {error && (
          <div className="mem-error">
            Failed to load: {error}
          </div>
        )}

        {!loading && !error && memories.length === 0 && (
          <div className="mem-empty">
            No memories stored yet.<br />
            ARIA learns as you chat.
          </div>
        )}

        {!loading && memories.map((m) => (
          <div
            key={m.id}
            className={`mem-item${m.id === newestId ? ' mem-item--new' : ''}`}
          >
            <div className="mem-content">
              {m.content}
              <span className="mem-date">{formatDate(m.created_at)}</span>
            </div>
            <button
              className="mem-delete"
              onClick={() => deleteMemory(m.id)}
              title="Delete memory"
              aria-label="Delete"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
