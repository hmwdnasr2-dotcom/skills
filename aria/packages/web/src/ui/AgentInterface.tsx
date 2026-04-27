import React, { useEffect, useRef, useState } from 'react';
import './agent.css';
import { MemoryPanel } from './MemoryPanel';

// ── Types ─────────────────────────────────────────────────────────────────────

type Mode = 'chat' | 'build' | 'research';
type StepState = 'waiting' | 'running' | 'done';

interface ThinkStep {
  id: string;
  icon: string;
  label: string;
  state: StepState;
}

interface Attachment {
  id: string;
  name: string;
  size: number;
  kind: 'text' | 'image' | 'binary' | 'other';
  content?: string;
  preview?: string;
  fileId?: string;
  uploading?: boolean;
  uploadError?: string;
}

interface AriaMessage {
  id: string;
  role: 'user' | 'aria' | 'system';
  content: string;
  steps?: ThinkStep[];
  attachments?: Attachment[];
  ts: number;
  collapsed?: boolean;
}

interface AgentInterfaceProps {
  userId: string;
  apiBase?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SLASH_COMMANDS = [
  { cmd: '/search',    icon: '🔍', desc: 'Search the web' },
  { cmd: '/analyze',   icon: '🔎', desc: 'Analyze file or context' },
  { cmd: '/summarize', icon: '📝', desc: 'Summarize current context' },
  { cmd: '/build',     icon: '🏗️',  desc: 'Create a structured plan' },
  { cmd: '/research',  icon: '🔬', desc: 'Deep-dive research mode' },
  { cmd: '/tasks',     icon: '✅', desc: 'Show open tasks' },
  { cmd: '/report',    icon: '📊', desc: 'Generate weekly report' },
  { cmd: '/memory',    icon: '🧠', desc: 'Show stored memory' },
  { cmd: '/help',      icon: '❓', desc: 'Show available commands' },
];

const SLASH_EXPANSIONS: Record<string, string> = {
  '/search':    'Search the web for: ',
  '/analyze':   'Analyze the following and give me key insights: ',
  '/summarize': 'Summarize this concisely: ',
  '/build':     'Create a detailed step-by-step plan for: ',
  '/research':  'Research and give me a comprehensive breakdown of: ',
  '/tasks':     'Show me all my open tasks',
  '/report':    'Generate my weekly report',
  '/memory':    'What do you remember about me?',
  '/help':      'What can you help me with? List all available commands and capabilities.',
};

const QUICK_ACTIONS = [
  { label: 'Analyze',      prompt: 'Analyze the following and give me key insights: ' },
  { label: 'Summarize',    prompt: 'Summarize this concisely: ' },
  { label: 'Build Plan',   prompt: 'Create a detailed step-by-step plan for: ' },
  { label: 'Daily Report', prompt: 'Generate my daily report for today' },
];

const MODE_PREFIXES: Record<Mode, string> = {
  chat:     '',
  build:    '[BUILD MODE] Use a structured, action-oriented format with clear steps. ',
  research: '[RESEARCH MODE] Give a thorough, analytical response with all relevant detail. ',
};

// ── Utilities ─────────────────────────────────────────────────────────────────

function uid() { return crypto.randomUUID(); }

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = (e) => resolve(e.target?.result as string ?? '');
    r.onerror = reject;
    r.readAsText(file);
  });
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = (e) => resolve(e.target?.result as string ?? '');
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

const BINARY_EXTS = new Set(['.xlsx', '.xls', '.pdf', '.docx']);

function fileIcon(att: Attachment): string {
  if (att.uploading)    return '⏳';
  if (att.uploadError)  return '❌';
  if (att.kind === 'image') return '🖼️';
  if (att.kind === 'text')  return '📄';
  const ext = att.name.toLowerCase().split('.').pop();
  if (ext === 'pdf')              return '📑';
  if (ext === 'xlsx' || ext === 'xls') return '📊';
  if (ext === 'docx')             return '📝';
  return '📎';
}

function needsTools(text: string) {
  return /task|project|follow.?up|achiev|report|contact|email|inbox|memory/i.test(text);
}

function buildSteps(text: string, hasFiles = false): ThinkStep[] {
  const steps: ThinkStep[] = [
    { id: 'think',  icon: '🧠', label: 'Thinking',        state: 'waiting' },
  ];
  if (hasFiles) {
    steps.push({ id: 'parse', icon: '📄', label: 'Reading document', state: 'waiting' });
  }
  steps.push({ id: 'memory', icon: '📂', label: 'Checking memory', state: 'waiting' });
  if (needsTools(text)) {
    steps.push({ id: 'tool', icon: '⚙️', label: 'Running tools', state: 'waiting' });
  }
  return steps;
}

// ── Simple markdown renderer ──────────────────────────────────────────────────

function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={i} className="md-code">{part.slice(1, -1)}</code>;
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let codeLines: string[] = [];
  let inCode = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCode) {
        nodes.push(
          <pre key={`code-${i}`} className="md-pre">
            <code>{codeLines.join('\n')}</code>
          </pre>
        );
        codeLines = [];
        inCode = false;
      } else {
        inCode = true;
      }
      i++; continue;
    }

    if (inCode) { codeLines.push(line); i++; continue; }

    if (line.startsWith('### ')) {
      nodes.push(<h4 key={i} className="md-h4">{line.slice(4)}</h4>);
    } else if (line.startsWith('## ')) {
      nodes.push(<h3 key={i} className="md-h3">{line.slice(3)}</h3>);
    } else if (line.startsWith('# ')) {
      nodes.push(<h2 key={i} className="md-h2">{line.slice(2)}</h2>);
    } else if (/^[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push(lines[i].slice(2)); i++;
      }
      nodes.push(
        <ul key={`ul-${i}`} className="md-ul">
          {items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
        </ul>
      );
      continue;
    } else if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\. /, '')); i++;
      }
      nodes.push(
        <ol key={`ol-${i}`} className="md-ol">
          {items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
        </ol>
      );
      continue;
    } else if (line.trim() === '') {
      if (nodes.length > 0) nodes.push(<div key={`gap-${i}`} className="md-gap" />);
    } else {
      nodes.push(<p key={i} className="md-p">{renderInline(line)}</p>);
    }
    i++;
  }

  return <>{nodes}</>;
}

// ── Main component ────────────────────────────────────────────────────────────

export function AgentInterface({ userId, apiBase = '' }: AgentInterfaceProps) {
  const [messages, setMessages] = useState<AriaMessage[]>([
    {
      id: 'welcome',
      role: 'aria',
      content: 'How can I help you today? Type `/help` to see all commands, or pick a quick action below.',
      ts: Date.now(),
    },
  ]);
  const [input, setInput]             = useState('');
  const [busy, setBusy]               = useState(false);
  const [mode, setMode]               = useState<Mode>('chat');
  const [showMemory, setShowMemory]   = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [thinkSteps, setThinkSteps]   = useState<ThinkStep[]>([]);
  const [slashOpen, setSlashOpen]     = useState(false);
  const [copiedId, setCopiedId]       = useState<string | null>(null);
  const [showSearch, setShowSearch]   = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);
  const fileRef    = useRef<HTMLInputElement>(null);
  const searchRef  = useRef<HTMLInputElement>(null);
  const timerRefs  = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [messages.length, thinkSteps.length]);

  // Proactive SSE push (briefings, nudges)
  useEffect(() => {
    const es = new EventSource(`${apiBase}/api/aria/events?userId=${encodeURIComponent(userId)}`);
    es.onmessage = (e) => {
      try {
        const { content } = JSON.parse(e.data) as { content?: string };
        if (content) addMessage({ role: 'aria', content });
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, [userId, apiBase]);

  useEffect(() => () => timerRefs.current.forEach(clearTimeout), []);

  // ── State helpers ────────────────────────────────────────────────────────────

  function addMessage(partial: Omit<AriaMessage, 'id' | 'ts'> & { id?: string }): string {
    const id = partial.id ?? uid();
    setMessages((prev) => [...prev, { ...partial, id, ts: Date.now() }]);
    return id;
  }

  function patchMessage(id: string, update: Partial<AriaMessage>) {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...update } : m)));
  }

  function schedule(fn: () => void, delay: number) {
    const t = setTimeout(fn, delay);
    timerRefs.current.push(t);
  }

  function clearTimers() {
    timerRefs.current.forEach(clearTimeout);
    timerRefs.current = [];
  }

  // ── Thinking animation ────────────────────────────────────────────────────────

  function startThinkAnimation(steps: ThinkStep[]) {
    const initial = steps.map((s, i) => ({
      ...s, state: (i === 0 ? 'running' : 'waiting') as StepState,
    }));
    setThinkSteps(initial);

    if (steps.length >= 2) {
      schedule(() => {
        setThinkSteps((prev) =>
          prev.map((s, i) => ({ ...s, state: (i === 0 ? 'done' : i === 1 ? 'running' : s.state) as StepState }))
        );
      }, 800);
    }
    if (steps.length >= 3) {
      schedule(() => {
        setThinkSteps((prev) =>
          prev.map((s, i) => ({ ...s, state: (i <= 1 ? 'done' : i === 2 ? 'running' : s.state) as StepState }))
        );
      }, 1600);
    }
  }

  function finishThinkAnimation() {
    clearTimers();
    setThinkSteps((prev) => prev.map((s) => ({ ...s, state: 'done' as StepState })));
    schedule(() => setThinkSteps([]), 700);
  }

  // ── Submit ────────────────────────────────────────────────────────────────────

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if ((!text && attachments.length === 0) || busy) return;

    setInput('');
    setSlashOpen(false);
    if (inputRef.current) inputRef.current.style.height = 'auto';

    // Resolve slash expansion
    let sendContent = text;
    for (const [slash, expansion] of Object.entries(SLASH_EXPANSIONS)) {
      if (text === slash || text.startsWith(slash + ' ')) {
        sendContent = expansion + text.slice(slash.length).trimStart();
        break;
      }
    }

    // Attach file text as context
    const fileContext = attachments
      .filter((a) => a.kind === 'text' && a.content)
      .map((a) => `\n\n[File: ${a.name}]\n${a.content}`)
      .join('');

    const fullMessage = MODE_PREFIXES[mode] + sendContent + fileContext;
    const fileIds = attachments.filter((a) => a.fileId).map((a) => a.fileId!);

    addMessage({
      role: 'user',
      content: text || '(attachment)',
      attachments: attachments.length > 0 ? [...attachments] : undefined,
    });
    setAttachments([]);
    setBusy(true);

    const steps = buildSteps(fullMessage, fileIds.length > 0);
    startThinkAnimation(steps);

    const pendingId = uid();
    addMessage({ id: pendingId, role: 'aria', content: '' });

    try {
      const res = await fetch(`${apiBase}/api/aria/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, message: fullMessage, ...(fileIds.length > 0 && { fileIds }) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { reply } = await res.json() as { reply?: string };

      finishThinkAnimation();
      patchMessage(pendingId, {
        content: reply || "I've noted that down.",
        steps: steps.map((s) => ({ ...s, state: 'done' as StepState })),
      });
    } catch (err) {
      finishThinkAnimation();
      patchMessage(pendingId, {
        content: `Connection error — ${(err as Error).message}. Is the server running?`,
      });
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  // ── Search ────────────────────────────────────────────────────────────────────

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    const q = searchQuery.trim();
    if (!q || busy) return;

    setSearchQuery('');
    setShowSearch(false);
    setBusy(true);

    addMessage({ role: 'user', content: `🔍 ${q}` });

    const steps: ThinkStep[] = [
      { id: 'search', icon: '🔍', label: 'Searching the web', state: 'waiting' },
    ];
    startThinkAnimation(steps);

    const pendingId = uid();
    addMessage({ id: pendingId, role: 'aria', content: '' });

    try {
      const res = await fetch(`${apiBase}/api/aria/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, message: `Search the web for: ${q}` }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { reply } = await res.json() as { reply?: string };
      finishThinkAnimation();
      patchMessage(pendingId, {
        content: reply || 'No results found.',
        steps: steps.map((s) => ({ ...s, state: 'done' as StepState })),
      });
    } catch (err) {
      finishThinkAnimation();
      patchMessage(pendingId, { content: `Search error — ${(err as Error).message}` });
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function toggleSearch() {
    setShowSearch((v) => {
      if (!v) setTimeout(() => searchRef.current?.focus(), 50);
      return !v;
    });
  }

  // ── File upload ───────────────────────────────────────────────────────────────

  async function uploadBinaryFile(file: File, attId: string) {
    const form = new FormData();
    form.append('files', file);
    form.append('sessionId', userId);
    try {
      const res = await fetch(`${apiBase}/api/aria/upload`, { method: 'POST', body: form });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const data = await res.json() as { files?: Array<{ fileId: string }> };
      const fileId = data.files?.[0]?.fileId;
      if (!fileId) throw new Error('No fileId returned');
      setAttachments((prev) => prev.map((a) => a.id === attId ? { ...a, uploading: false, fileId } : a));
    } catch (err) {
      setAttachments((prev) => prev.map((a) =>
        a.id === attId ? { ...a, uploading: false, uploadError: (err as Error).message } : a
      ));
    }
  }

  async function handleFileAttach(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (fileRef.current) fileRef.current.value = '';

    for (const file of files) {
      const ext = (file.name.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase();
      const att: Attachment = { id: uid(), name: file.name, size: file.size, kind: 'other' };

      if (BINARY_EXTS.has(ext)) {
        att.kind = 'binary';
        att.uploading = true;
        setAttachments((prev) => [...prev, att]);
        uploadBinaryFile(file, att.id);
        continue;
      }

      if (file.type.startsWith('image/')) {
        att.kind = 'image';
        att.preview = await readAsDataURL(file);
      } else if (
        file.type.startsWith('text/') ||
        /\.(md|txt|csv|json|ts|tsx|js|jsx|py|sh|sql|yaml|yml)$/i.test(file.name)
      ) {
        att.kind = 'text';
        att.content = await readAsText(file);
      }

      setAttachments((prev) => [...prev, att]);
    }
  }

  // ── Input handlers ────────────────────────────────────────────────────────────

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setInput(val);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
    setSlashOpen(val.startsWith('/') && !val.includes(' ') && val.length > 0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!slashOpen) handleSubmit();
    }
    if (e.key === 'Escape') setSlashOpen(false);
  }

  function selectSlash(cmd: string) {
    const expansion = SLASH_EXPANSIONS[cmd] ?? cmd + ' ';
    setInput(expansion);
    setSlashOpen(false);
    inputRef.current?.focus();
    requestAnimationFrame(() => {
      if (!inputRef.current) return;
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 200)}px`;
    });
  }

  function handleQuickAction(prompt: string) {
    setInput(prompt);
    inputRef.current?.focus();
    requestAnimationFrame(() => {
      if (!inputRef.current) return;
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 200)}px`;
    });
  }

  async function copyMessage(id: string, content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 2000);
    } catch { /* ignore */ }
  }

  function toggleCollapse(id: string) {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, collapsed: !m.collapsed } : m))
    );
  }

  const slashFilter = input.startsWith('/') ? input.slice(1).toLowerCase() : '';
  const filteredSlash = SLASH_COMMANDS.filter((c) => c.cmd.slice(1).startsWith(slashFilter));

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="agent-root">

      {/* ── Main column ──────────────────────────────────────────────────────── */}
      <div className="agent-main">

        {/* Header */}
        <header className="agent-header">
          <div className="agent-brand">
            <span className="agent-brand-dot" />
            <span className="agent-brand-name">ARIA</span>
          </div>

          <div className="agent-identity">
            <span className="agent-tag">🧠 Claude</span>
            <span className="agent-tag">⚙️ OpenClaw</span>
            <span className="agent-tag">📂 Supabase</span>
          </div>

          <div className="agent-mode-switch">
            {(['chat', 'build', 'research'] as Mode[]).map((m) => (
              <button
                key={m}
                className={`mode-btn${mode === m ? ' mode-btn--active' : ''}`}
                onClick={() => setMode(m)}
              >
                {m}
              </button>
            ))}
          </div>

          <button
            className={`memory-toggle${showSearch ? ' memory-toggle--active' : ''}`}
            onClick={toggleSearch}
            title="Web search"
          >
            🔍
          </button>

          <button
            className={`memory-toggle${showMemory ? ' memory-toggle--active' : ''}`}
            onClick={() => setShowMemory((v) => !v)}
            title="Memory panel"
          >
            🧠
          </button>
        </header>

        {/* Search bar */}
        {showSearch && (
          <div className="search-bar-wrap">
            <form className="search-bar-inner" onSubmit={handleSearch}>
              <input
                ref={searchRef}
                className="search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setShowSearch(false); }}
                placeholder="Search the web…"
                disabled={busy}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <button
                type="submit"
                className="search-submit"
                disabled={busy || !searchQuery.trim()}
              >
                Search
              </button>
              <button
                type="button"
                className="search-close"
                onClick={() => setShowSearch(false)}
                aria-label="Close search"
              >
                ×
              </button>
            </form>
          </div>
        )}

        {/* Message list */}
        <div className="agent-messages">
          {messages.map((msg) => (
            <MessageRow
              key={msg.id}
              msg={msg}
              copied={copiedId === msg.id}
              onCopy={() => copyMessage(msg.id, msg.content)}
              onToggleCollapse={() => toggleCollapse(msg.id)}
            />
          ))}

          {/* Live thinking indicator */}
          {thinkSteps.length > 0 && (
            <div className="think-bar">
              {thinkSteps.map((step) => (
                <div key={step.id} className={`think-step think-step--${step.state}`}>
                  <span className="think-step-icon">
                    {step.state === 'done' ? '✓' : step.icon}
                  </span>
                  <span className="think-step-label">{step.label}</span>
                  {step.state === 'running' && (
                    <span className="think-dots">
                      <span /><span /><span />
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Quick actions */}
        <div className="agent-quick-actions">
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a.label}
              className="quick-action-btn"
              onClick={() => handleQuickAction(a.prompt)}
              disabled={busy}
            >
              {a.label}
            </button>
          ))}
        </div>

        {/* Input area */}
        <div className="agent-input-wrap">

          {/* Attachment chips */}
          {attachments.length > 0 && (
            <div className="attach-previews">
              {attachments.map((a) => (
                <div key={a.id} className={`attach-chip${a.uploadError ? ' attach-chip--error' : ''}`}>
                  {a.kind === 'image' && a.preview
                    ? <img src={a.preview} alt={a.name} className="attach-img-thumb" />
                    : <span className="attach-icon">{fileIcon(a)}</span>
                  }
                  <span className="attach-name">{a.name}</span>
                  <span className="attach-size">
                    {a.uploading ? 'uploading…' : a.uploadError ? 'failed' : formatSize(a.size)}
                  </span>
                  <button
                    className="attach-remove"
                    onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                  >×</button>
                </div>
              ))}
            </div>
          )}

          {/* Slash autocomplete */}
          {slashOpen && filteredSlash.length > 0 && (
            <div className="slash-menu">
              {filteredSlash.map((c) => (
                <button
                  key={c.cmd}
                  className="slash-item"
                  onMouseDown={(e) => { e.preventDefault(); selectSlash(c.cmd); }}
                >
                  <span className="slash-icon">{c.icon}</span>
                  <span className="slash-cmd">{c.cmd}</span>
                  <span className="slash-desc">{c.desc}</span>
                </button>
              ))}
            </div>
          )}

          <form className="input-bar" onSubmit={handleSubmit}>
            <button
              type="button"
              className="input-icon-btn"
              onClick={() => fileRef.current?.click()}
              title="Attach file"
              disabled={busy}
            >
              📎
            </button>

            <button
              type="button"
              className="input-icon-btn"
              title="Voice input (coming soon)"
              disabled
            >
              🎤
            </button>

            <textarea
              ref={inputRef}
              className="input-field"
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Message ARIA…  or type / for commands"
              disabled={busy}
              rows={1}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="sentences"
              spellCheck={false}
            />

            <button
              type="submit"
              className="input-send"
              disabled={busy || (!input.trim() && attachments.length === 0) || attachments.some((a) => a.uploading)}
              aria-label="Send"
            >
              ↑
            </button>
          </form>

          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,.xlsx,.xls,.pdf,.docx,.txt,.md,.csv,.json,.ts,.tsx,.js,.jsx,.py,.sh,.sql"
            className="input-file-hidden"
            onChange={handleFileAttach}
          />
        </div>
      </div>

      {/* ── Memory panel ─────────────────────────────────────────────────────── */}
      {showMemory && (
        <>
          <MemoryPanel
            userId={userId}
            apiBase={apiBase}
            onClose={() => setShowMemory(false)}
          />
          <div className="memory-backdrop" onClick={() => setShowMemory(false)} />
        </>
      )}
    </div>
  );
}

// ── Message row component ─────────────────────────────────────────────────────

interface MessageRowProps {
  msg: AriaMessage;
  copied: boolean;
  onCopy: () => void;
  onToggleCollapse: () => void;
}

function MessageRow({ msg, copied, onCopy, onToggleCollapse }: MessageRowProps) {
  if (msg.role === 'system') {
    return <div className="msg-system">{msg.content}</div>;
  }

  const isUser = msg.role === 'user';

  return (
    <div className={`msg msg--${msg.role}`}>

      {!isUser && <div className="msg-label">ARIA</div>}

      {/* Attachments */}
      {msg.attachments && msg.attachments.length > 0 && (
        <div className="msg-attachments">
          {msg.attachments.map((a) =>
            a.kind === 'image' && a.preview ? (
              <div key={a.id} className="msg-attach-chip">
                <img src={a.preview} alt={a.name} className="msg-attach-img" />
              </div>
            ) : (
              <div key={a.id} className="msg-attach-chip">
                <span>{a.kind === 'text' ? '📄' : '📎'}</span>
                <span>{a.name}</span>
              </div>
            )
          )}
        </div>
      )}

      {/* Content */}
      {msg.content && (
        <div className={`msg-content${msg.collapsed ? ' msg-content--collapsed' : ''}`}>
          {isUser
            ? <div className="msg-bubble">{msg.content}</div>
            : (
              <div className="msg-prose">
                {msg.content
                  ? renderMarkdown(msg.content)
                  : <span className="msg-cursor">▌</span>
                }
              </div>
            )
          }
        </div>
      )}

      {/* Tool steps badge (shown after response) */}
      {!isUser && msg.steps && msg.steps.length > 0 && !msg.collapsed && (
        <div className="msg-steps">
          {msg.steps.map((s) => (
            <span key={s.id} className="msg-step-tag">
              {s.icon} {s.label}
            </span>
          ))}
        </div>
      )}

      {/* Copy / collapse actions */}
      {!isUser && msg.content && (
        <div className="msg-actions">
          <button className="msg-action-btn" onClick={onCopy}>
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          <button className="msg-action-btn" onClick={onToggleCollapse}>
            {msg.collapsed ? 'Expand' : 'Collapse'}
          </button>
        </div>
      )}
    </div>
  );
}
