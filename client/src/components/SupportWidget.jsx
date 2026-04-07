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
  } catch { /* storage full — ignore */ }
}

export default function SupportWidget() {
  const initialMsg = {
    role: 'assistant',
    content: 'Hi! I\'m OxSteed\'s AI assistant. How can I help you today?',
    ts: new Date().toISOString(),
  };

  const [open,      setOpen]      = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [messages,  setMessages]  = useState(() => loadHistory() || [initialMsg]);
  const [input,     setInput]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [copied,    setCopied]    = useState(null); // index of copied message
  const [unread,    setUnread]    = useState(0);
  const endRef    = useRef(null);
  const inputRef  = useRef(null);
  const atBottomRef = useRef(true);
  const scrollRef = useRef(null);

  // Persist history on change
  useEffect(() => {
    saveHistory(messages);
  }, [messages]);

  // Open via custom event (e.g. from other components)
  useEffect(() => {
    const handler = () => { setOpen(true); setMinimized(false); setUnread(0); };
    window.addEventListener('oxsteed:open-support', handler);
    return () => window.removeEventListener('oxsteed:open-support', handler);
  }, []);

  // Scroll to bottom when new message arrives (only if already near bottom)
  useEffect(() => {
    if (atBottomRef.current) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading]);

  // Track scroll position to decide if we should auto-scroll
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 80;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
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

  const send = useCallback(async (text) => {
    if (!text.trim() || loading) return;
    const userMsg = { role: 'user', content: text.trim(), ts: new Date().toISOString() };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput('');
    setLoading(true);
    atBottomRef.current = true;
    try {
      const { data } = await api.post('/chat/message', {
        messages: updated.map(m => ({ role: m.role, content: m.content })),
      });
      const reply = { role: 'assistant', content: data.reply, ts: new Date().toISOString() };
      setMessages(prev => [...prev, reply]);
      if (!open || minimized) setUnread(n => n + 1);
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I\'m having trouble right now. Please try again or email **support@oxsteed.com**.',
        ts: new Date().toISOString(),
        isError: true,
      }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [messages, loading, open, minimized]);

  const handleSubmit = (e) => {
    e.preventDefault();
    send(input);
  };

  const handleCopy = (content, idx) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(idx);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const handleClearChat = () => {
    const fresh = [{ ...initialMsg, ts: new Date().toISOString() }];
    setMessages(fresh);
    saveHistory(fresh);
  };

  const showSuggestions = messages.length <= 1 && !loading;

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => { setOpen(true); setMinimized(false); setUnread(0); }}
        aria-label="Open AI assistant"
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-full shadow-lg shadow-orange-500/30 font-semibold text-sm transition-all hover:scale-105 active:scale-95"
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

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-end p-4 sm:p-6 pointer-events-none"
          onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            className="pointer-events-auto bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm flex flex-col transition-all"
            style={{ maxHeight: minimized ? 'auto' : '82vh', minHeight: minimized ? 'auto' : undefined }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 rounded-t-2xl bg-gray-900">
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
                  <p className="font-semibold text-white text-sm leading-none">OxSteed AI</p>
                  <p className="text-[10px] text-green-400 mt-0.5">Online · usually instant</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 1 && (
                  <button
                    onClick={handleClearChat}
                    title="Clear conversation"
                    className="p-1.5 text-gray-500 hover:text-gray-300 transition rounded-lg hover:bg-gray-800"
                    aria-label="Clear chat"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                  </button>
                )}
                <button
                  onClick={() => setMinimized(m => !m)}
                  title={minimized ? 'Expand' : 'Minimize'}
                  className="p-1.5 text-gray-500 hover:text-gray-300 transition rounded-lg hover:bg-gray-800"
                  aria-label={minimized ? 'Expand chat' : 'Minimize chat'}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    {minimized
                      ? <><polyline points="6 9 12 15 18 9"/></>
                      : <><polyline points="18 15 12 9 6 15"/></>}
                  </svg>
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="p-1.5 text-gray-500 hover:text-white transition rounded-lg hover:bg-gray-800"
                  aria-label="Close chat"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
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
                  style={{ minHeight: '260px', maxHeight: '52vh' }}
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
                      <div className={`group relative max-w-[78%] ${m.role === 'user' ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                        <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                          m.role === 'user'
                            ? 'bg-orange-600 text-white rounded-br-sm'
                            : m.isError
                            ? 'bg-red-900/40 text-red-200 border border-red-800/50 rounded-bl-sm'
                            : 'bg-gray-800 text-gray-100 rounded-bl-sm'
                        }`}>
                          {m.content}
                        </div>
                        <div className={`flex items-center gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <span className="text-[10px] text-gray-600">{formatTime(m.ts)}</span>
                          {m.role === 'assistant' && !m.isError && (
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
                  <div className="px-4 pb-2 flex flex-wrap gap-1.5">
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

                {/* Input */}
                <form onSubmit={handleSubmit} className="flex items-end gap-2 px-4 py-3 border-t border-gray-800">
                  <div className="flex-1 relative">
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          send(input);
                        }
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
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  </button>
                </form>

                {/* Footer disclaimer */}
                <div className="px-4 pb-3 text-center">
                  <p className="text-[10px] text-gray-600">
                    AI responses may be inaccurate. For account issues, email{' '}
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
    </>
  );
}
