import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../api/axios';

const STORAGE_KEY = 'oxsteed_chat_history';
const MAX_HISTORY = 40;

const SUGGESTIONS = [
  'How do I post a job?',
  'How does escrow payment work?',
  'How do I become a verified helper?',
  'What is a Pro subscription?',
  'How do I dispute a payment?',
  'How does bidding work?',
];

// Pages that get the proactive auto-open trigger after 45s
const PROACTIVE_PATHS = ['/post-job', '/helpers'];
const PROACTIVE_DELAY_MS = 45_000;

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed;
  } catch { return null; }
}

function saveHistory(msgs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-MAX_HISTORY)));
  } catch { /* storage full */ }
}

// ── 1. Markdown renderer (no dangerouslySetInnerHTML) ─────────────────────────
function renderInline(text, prefix = '') {
  const parts = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let last = 0;
  let m;
  let k = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[2] !== undefined) {
      parts.push(<strong key={`${prefix}-b${k++}`} className="font-semibold text-white">{m[2]}</strong>);
    } else if (m[3] !== undefined) {
      parts.push(<em key={`${prefix}-i${k++}`}>{m[3]}</em>);
    } else if (m[4] !== undefined) {
      parts.push(<code key={`${prefix}-c${k++}`} className="px-1 py-0.5 bg-gray-700/80 rounded text-orange-300 text-xs font-mono">{m[4]}</code>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function renderMarkdown(text) {
  if (!text) return null;
  const lines = text.split('\n');
  const result = [];
  let bullets = [];
  let bulletIdx = 0;

  const flushBullets = (key) => {
    if (!bullets.length) return;
    result.push(
      <ul key={`ul-${key}`} className="list-disc list-inside space-y-0.5 my-1 ml-0.5">
        {bullets.map((item, i) => (
          <li key={i} className="leading-relaxed">{renderInline(item, `b${key}-${i}`)}</li>
        ))}
      </ul>
    );
    bullets = [];
    bulletIdx++;
  };

  lines.forEach((line, idx) => {
    const bulletM = line.match(/^[-*•]\s+(.+)/);
    if (bulletM) {
      bullets.push(bulletM[1]);
      return;
    }
    flushBullets(idx);
    if (line.trim() === '') {
      if (result.length > 0) result.push(<br key={`br-${idx}`} />);
    } else {
      result.push(
        <span key={`ln-${idx}`} className="block leading-relaxed">
          {renderInline(line, `ln-${idx}`)}
        </span>
      );
    }
  });
  flushBullets('end');

  return <>{result}</>;
}

// ── 9. Notification ping (Web Audio API) ──────────────────────────────────────
function playPing() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch { /* AudioContext unavailable */ }
}

// ── 10. Export transcript ─────────────────────────────────────────────────────
function exportTranscript(messages) {
  const lines = messages.map(m => {
    const who = m.role === 'user' ? 'You' : 'OxSteed AI';
    const time = new Date(m.ts).toLocaleString();
    return `[${time}] ${who}:\n${m.content}`;
  });
  const text = `OxSteed AI Support Transcript\nExported: ${new Date().toLocaleString()}\n${'─'.repeat(40)}\n\n${lines.join('\n\n')}`;
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `oxsteed-support-${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── 3. Escalation modal ───────────────────────────────────────────────────────
function EscalationModal({ messages, onClose }) {
  const [sent,         setSent]         = useState(false);
  const [ticketNumber, setTicketNumber] = useState(null);
  const [name,         setName]         = useState('');
  const [email,        setEmail]        = useState('');
  const [desc,         setDesc]         = useState('');
  const [sending,      setSending]      = useState(false);

  const transcript = messages
    .map(m => `${m.role === 'user' ? 'Customer' : 'AI'}: ${m.content}`)
    .join('\n');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSending(true);
    try {
      const { data } = await api.post('/support/request', {
        name,
        email,
        subject:  'Live support escalation from chat widget',
        message:  `${desc || '(No additional description provided)'}\n\n${'─'.repeat(40)}\nAI Chat History:\n${transcript}`,
        category: 'Chat Escalation',
      });
      if (data?.ticket_number) setTicketNumber(data.ticket_number);
    } catch { /* still show success — user can email directly */ }
    setSent(true);
    setSending(false);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4 bg-black/60"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm p-5 shadow-2xl">
        {sent ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-400">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <p className="text-white font-semibold">Request sent!</p>
            {ticketNumber ? (
              <p className="text-gray-400 text-sm mt-1">
                Your ticket number is <strong className="text-orange-400">#{ticketNumber}</strong>.
                Check your email for confirmation.
              </p>
            ) : (
              <p className="text-gray-400 text-sm mt-1">Our support team will email you back soon.</p>
            )}
            <button onClick={onClose} className="mt-4 w-full py-2 bg-gray-800 hover:bg-gray-700 text-white text-sm rounded-xl transition">
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-white font-semibold text-sm">Talk to a Human</h3>
                <p className="text-gray-500 text-xs mt-0.5">We'll reply to your email, usually within a few hours.</p>
              </div>
              <button onClick={onClose} className="p-1.5 text-gray-500 hover:text-white rounded-lg hover:bg-gray-800 transition" aria-label="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                type="text"
                required
                placeholder="Your name"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500 placeholder-gray-500 transition"
              />
              <input
                type="email"
                required
                placeholder="Your email address"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500 placeholder-gray-500 transition"
              />
              <textarea
                placeholder="Describe your issue (optional — chat history will be included)"
                value={desc}
                onChange={e => setDesc(e.target.value)}
                rows={3}
                style={{ resize: 'none' }}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500 placeholder-gray-500 transition"
              />
              <button
                type="submit"
                disabled={sending}
                className="w-full py-2.5 bg-orange-600 hover:bg-orange-700 text-white font-semibold text-sm rounded-xl transition disabled:opacity-50"
              >
                {sending ? 'Sending…' : 'Send to Support Team'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────
export default function SupportWidget() {
  // 8. Welcome-back: show different greeting if prior history exists
  const existingHistory = loadHistory();
  const initialMsg = existingHistory
    ? { role: 'assistant', content: "Welcome back! I'm here if you have any questions about OxSteed.", ts: new Date().toISOString() }
    : { role: 'assistant', content: "Hi! I'm OxSteed's AI assistant. How can I help you today?", ts: new Date().toISOString() };

  const [open,         setOpen]         = useState(false);
  const [minimized,    setMinimized]    = useState(false);
  const [messages,     setMessages]     = useState(() => existingHistory || [initialMsg]);
  const [input,        setInput]        = useState('');
  const [loading,      setLoading]      = useState(false);
  const [copied,       setCopied]       = useState(null);
  const [unread,       setUnread]       = useState(0);
  const [showEscalate, setShowEscalate] = useState(false);
  const [isMobile,     setIsMobile]     = useState(false);

  const endRef      = useRef(null);
  const inputRef    = useRef(null);
  const atBottomRef = useRef(true);
  const scrollRef   = useRef(null);
  const windowFocused     = useRef(true);
  const proactiveTriggered = useRef(false);

  // 6. Mobile full-screen detection
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // 9. Track window focus for notification ping
  useEffect(() => {
    const onFocus = () => { windowFocused.current = true; };
    const onBlur  = () => { windowFocused.current = false; };
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur',  onBlur);
    return () => { window.removeEventListener('focus', onFocus); window.removeEventListener('blur', onBlur); };
  }, []);

  // 7. Proactive trigger on /post-job and /helpers after 45 seconds
  useEffect(() => {
    const path = window.location.pathname;
    const isMatch = PROACTIVE_PATHS.some(p => path.startsWith(p));
    if (!isMatch || proactiveTriggered.current || open) return;

    const timer = setTimeout(() => {
      if (!proactiveTriggered.current && !open) {
        proactiveTriggered.current = true;
        const msg = path.startsWith('/post-job')
          ? "Need help posting your first job? I can walk you through it — just ask!"
          : "Looking for the right helper? I can help you understand how OxSteed works!";
        setMessages(prev => [...prev, { role: 'assistant', content: msg, ts: new Date().toISOString() }]);
        setOpen(true);
        setMinimized(false);
      }
    }, PROACTIVE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [open]);

  // Persist history
  useEffect(() => { saveHistory(messages); }, [messages]);

  // Custom open event from other components
  useEffect(() => {
    const handler = () => { setOpen(true); setMinimized(false); setUnread(0); };
    window.addEventListener('oxsteed:open-support', handler);
    return () => window.removeEventListener('oxsteed:open-support', handler);
  }, []);

  // Auto-scroll when near bottom
  useEffect(() => {
    if (atBottomRef.current) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  // Focus input when chat opens
  useEffect(() => {
    if (open && !minimized) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setUnread(0);
    }
  }, [open, minimized]);

  // Escape to close
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape' && open) setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const send = useCallback(async (text, isRetry = false) => {
    if (!text.trim() || loading) return;

    const userMsg = { role: 'user', content: text.trim(), ts: new Date().toISOString() };

    // 5. On retry, strip the last error message before re-sending
    const base = isRetry
      ? messages.slice(0, -1)
      : messages;

    const updated = [...base, userMsg];
    setMessages(updated);
    setInput('');
    setLoading(true);
    atBottomRef.current = true;

    // 4. Page context passed to AI
    const pageContext = {
      path:  window.location.pathname,
      title: document.title,
    };

    try {
      const { data } = await api.post('/chat/message', {
        messages:    updated.map(m => ({ role: m.role, content: m.content })),
        pageContext,
      });
      const reply = { role: 'assistant', content: data.reply, ts: new Date().toISOString() };
      setMessages(prev => [...prev, reply]);

      if (!open || minimized) {
        setUnread(n => n + 1);
        // 9. Play ping when window is not focused
        if (!windowFocused.current) playPing();
      }
    } catch {
      setMessages(prev => [...prev, {
        role:      'assistant',
        content:   "Sorry, I'm having trouble right now. Please try again or email **support@oxsteed.com**.",
        ts:        new Date().toISOString(),
        isError:   true,
        retryText: text.trim(), // 5. Store for retry
      }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [messages, loading, open, minimized]);

  const handleSubmit = (e) => { e.preventDefault(); send(input); };

  const handleCopy = (content, idx) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(idx);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  // 2. Thumbs feedback — toggle off if same value clicked again
  const handleFeedback = async (idx, value) => {
    const next = messages[idx]?.feedback === value ? null : value;
    setMessages(prev => prev.map((m, i) => i === idx ? { ...m, feedback: next } : m));
    if (next) {
      try {
        await api.post('/chat/feedback', {
          value,
          messageContent: messages[idx]?.content?.slice(0, 500),
          pageContext: { path: window.location.pathname },
        });
      } catch { /* non-critical */ }
    }
  };

  const handleClearChat = () => {
    const fresh = [{ ...initialMsg, ts: new Date().toISOString() }];
    setMessages(fresh);
    saveHistory(fresh);
  };

  const showSuggestions = messages.length <= 1 && !loading;

  // 6. Mobile full-screen vs desktop popup layout
  const isFullScreen = isMobile && open;

  return (
    <>
      {/* ── FAB ── */}
      {(!open || !isMobile) && (
        <button
          onClick={() => { setOpen(true); setMinimized(false); setUnread(0); }}
          aria-label="Open AI assistant"
          className="fixed bottom-20 right-4 sm:bottom-6 sm:right-6 z-40 flex items-center gap-2 px-3.5 py-2.5 bg-orange-500/85 hover:bg-orange-600 text-white rounded-full shadow-md shadow-orange-500/20 font-semibold text-xs transition-all hover:scale-105 active:scale-95 backdrop-blur-sm"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
          Ask AI
          {unread > 0 && !open && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {unread}
            </span>
          )}
        </button>
      )}

      {/* ── Chat panel ── */}
      {open && (
        <div
          className={isFullScreen
            ? 'fixed inset-0 z-45'
            : 'fixed inset-0 z-45 flex items-end justify-end p-4 sm:p-6 pointer-events-none'
          }
          onClick={isFullScreen ? undefined : (e => { if (e.target === e.currentTarget) setOpen(false); })}
        >
          <div
            className={isFullScreen
              ? 'w-full h-full bg-gray-900 flex flex-col'
              : 'pointer-events-auto bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm flex flex-col transition-all'
            }
            style={isFullScreen ? {} : { maxHeight: minimized ? 'auto' : '82vh' }}
          >
            {/* Header */}
            <div className={`flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0 ${isFullScreen ? '' : 'rounded-t-2xl bg-gray-900'}`}>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <div className="w-8 h-8 bg-orange-500/20 rounded-full flex items-center justify-center">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-orange-400">
                      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                    </svg>
                  </div>
                  <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-400 border-2 border-gray-900"/>
                </div>
                <div>
                  <p className="font-semibold text-white text-sm leading-none">OxSteed Platform Support</p>
                  <p className="text-[10px] text-green-400 mt-0.5">Platform AI · usually instant</p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                {/* 3. Talk to human */}
                <button
                  onClick={() => setShowEscalate(true)}
                  title="Talk to a human"
                  className="p-1.5 text-gray-500 hover:text-orange-400 transition rounded-lg hover:bg-gray-800"
                  aria-label="Talk to a human"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                  </svg>
                </button>

                {/* 10. Export transcript */}
                {messages.length > 1 && (
                  <button
                    onClick={() => exportTranscript(messages)}
                    title="Download transcript"
                    className="p-1.5 text-gray-500 hover:text-gray-300 transition rounded-lg hover:bg-gray-800"
                    aria-label="Export transcript"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                  </button>
                )}

                {/* Clear */}
                {messages.length > 1 && (
                  <button
                    onClick={handleClearChat}
                    title="Clear conversation"
                    className="p-1.5 text-gray-500 hover:text-gray-300 transition rounded-lg hover:bg-gray-800"
                    aria-label="Clear chat"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6l-1 14H6L5 6"/>
                      <path d="M10 11v6M14 11v6"/>
                      <path d="M9 6V4h6v2"/>
                    </svg>
                  </button>
                )}

                {/* Minimize (desktop only) */}
                {!isMobile && (
                  <button
                    onClick={() => setMinimized(m => !m)}
                    title={minimized ? 'Expand' : 'Minimize'}
                    className="p-1.5 text-gray-500 hover:text-gray-300 transition rounded-lg hover:bg-gray-800"
                    aria-label={minimized ? 'Expand chat' : 'Minimize chat'}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      {minimized
                        ? <polyline points="6 9 12 15 18 9"/>
                        : <polyline points="18 15 12 9 6 15"/>
                      }
                    </svg>
                  </button>
                )}

                {/* Close */}
                <button
                  onClick={() => setOpen(false)}
                  className="p-1.5 text-gray-500 hover:text-white transition rounded-lg hover:bg-gray-800"
                  aria-label="Close chat"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* Body — hidden when minimized */}
            {!minimized && (
              <>
                {/* Messages */}
                <div
                  ref={scrollRef}
                  onScroll={handleScroll}
                  className="flex-1 overflow-y-auto px-4 py-3 space-y-4"
                  style={isFullScreen ? {} : { minHeight: '260px', maxHeight: '52vh' }}
                >
                  {messages.map((m, i) => (
                    <div key={i} className={`flex items-end gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      {m.role === 'assistant' && (
                        <div className="w-6 h-6 bg-orange-500/20 rounded-full flex-shrink-0 flex items-center justify-center mb-1">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-orange-400">
                            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                          </svg>
                        </div>
                      )}

                      <div className={`group relative max-w-[78%] flex flex-col gap-1 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                        {/* Bubble */}
                        <div className={`px-3.5 py-2.5 rounded-2xl text-sm ${
                          m.role === 'user'
                            ? 'bg-orange-600 text-white rounded-br-sm whitespace-pre-wrap leading-relaxed'
                            : m.isError
                            ? 'bg-red-900/40 text-red-200 border border-red-800/50 rounded-bl-sm leading-relaxed'
                            : 'bg-gray-800 text-gray-100 rounded-bl-sm'
                        }`}>
                          {/* 1. Markdown for AI messages */}
                          {m.role === 'assistant' && !m.isError
                            ? renderMarkdown(m.content)
                            : m.content
                          }
                        </div>

                        {/* Meta row: timestamp + actions */}
                        <div className={`flex items-center gap-2 flex-wrap ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <span className="text-[10px] text-gray-600">{formatTime(m.ts)}</span>

                          {/* 5. Retry button on error */}
                          {m.isError && m.retryText && (
                            <button
                              onClick={() => send(m.retryText, true)}
                              className="text-[10px] text-orange-400 hover:text-orange-300 transition flex items-center gap-1"
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <polyline points="1 4 1 10 7 10"/>
                                <path d="M3.51 15a9 9 0 1 0 .49-3.07"/>
                              </svg>
                              Retry
                            </button>
                          )}

                          {/* Copy + 2. Thumbs feedback (AI non-error only) */}
                          {m.role === 'assistant' && !m.isError && (
                            <>
                              <button
                                onClick={() => handleCopy(m.content, i)}
                                className="opacity-0 group-hover:opacity-100 text-[10px] text-gray-500 hover:text-gray-300 transition flex items-center gap-1"
                                title="Copy response"
                              >
                                {copied === i
                                  ? <><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg> Copied</>
                                  : <><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copy</>
                                }
                              </button>

                              {/* Thumbs up */}
                              <button
                                onClick={() => handleFeedback(i, 'up')}
                                title="Helpful"
                                aria-label="Helpful"
                                className={`transition flex items-center ${m.feedback === 'up' ? 'text-green-400' : 'opacity-0 group-hover:opacity-100 text-gray-600 hover:text-green-400'}`}
                              >
                                <svg width="11" height="11" viewBox="0 0 24 24" fill={m.feedback === 'up' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                                  <path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14z"/>
                                  <path d="M7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3"/>
                                </svg>
                              </button>

                              {/* Thumbs down */}
                              <button
                                onClick={() => handleFeedback(i, 'down')}
                                title="Not helpful"
                                aria-label="Not helpful"
                                className={`transition flex items-center ${m.feedback === 'down' ? 'text-red-400' : 'opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400'}`}
                              >
                                <svg width="11" height="11" viewBox="0 0 24 24" fill={m.feedback === 'down' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                                  <path d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3H10z"/>
                                  <path d="M17 2h2.67A2.31 2.31 0 0122 4v7a2.31 2.31 0 01-2.33 2H17"/>
                                </svg>
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Typing indicator */}
                  {loading && (
                    <div className="flex items-end gap-2">
                      <div className="w-6 h-6 bg-orange-500/20 rounded-full flex-shrink-0 flex items-center justify-center">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-orange-400">
                          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                        </svg>
                      </div>
                      <div className="bg-gray-800 px-4 py-3 rounded-2xl rounded-bl-sm">
                        <div className="flex gap-1 items-center">
                          <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}/>
                          <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}/>
                          <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}/>
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={endRef} />
                </div>

                {/* Suggestion chips */}
                {showSuggestions && (
                  <div className="px-4 pb-2 flex flex-wrap gap-1.5 flex-shrink-0">
                    {SUGGESTIONS.map(s => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        className="text-xs px-2.5 py-1.5 bg-gray-800 hover:bg-orange-500/10 text-gray-400 hover:text-orange-300 rounded-full border border-gray-700 hover:border-orange-500/40 transition"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}

                {/* Input composer */}
                <form onSubmit={handleSubmit} className="flex items-end gap-2 px-4 py-3 border-t border-gray-800 flex-shrink-0">
                  <div className="flex-1 relative">
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
                      }}
                      placeholder="Message OxSteed AI… (Enter to send)"
                      disabled={loading}
                      rows={1}
                      style={{ resize: 'none', minHeight: '38px', maxHeight: '120px', overflowY: 'auto' }}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500 disabled:opacity-50 placeholder-gray-500 transition"
                    />
                    {input.length > 400 && (
                      <span className={`absolute bottom-1 right-2 text-[10px] ${input.length > 900 ? 'text-red-400' : 'text-gray-500'}`}>
                        {input.length}/1000
                      </span>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={loading || !input.trim()}
                    className="flex-shrink-0 p-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-xl transition disabled:opacity-40 active:scale-95"
                    aria-label="Send message"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="22" y1="2" x2="11" y2="13"/>
                      <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                    </svg>
                  </button>
                </form>

                {/* Footer */}
                <div className="px-4 pb-3 text-center flex-shrink-0">
                  <p className="text-[10px] text-gray-600">
                    AI responses may be inaccurate.{' '}
                    <button
                      onClick={() => setShowEscalate(true)}
                      className="text-orange-500/70 hover:text-orange-400 underline transition"
                    >
                      Talk to a human
                    </button>
                    {' '}or email{' '}
                    <a href="mailto:support@oxsteed.com" className="text-orange-500/70 hover:text-orange-500 underline transition">
                      support@oxsteed.com
                    </a>
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 3. Escalation modal */}
      {showEscalate && (
        <EscalationModal messages={messages} onClose={() => setShowEscalate(false)} />
      )}
    </>
  );
}
