import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { DollarSign, X, Send, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';

/**
 * Floating financial-advisor chat panel.
 *
 * Props:
 *   isOpen   - boolean controlling visibility
 *   onClose  - called when user dismisses the panel
 */
export default function FinancialAdvisorPanel({ isOpen, onClose }) {
  const { t } = useTranslation();
  const [messages, setMessages]     = useState([]);
  const [input, setInput]           = useState('');
  const [sending, setSending]       = useState(false);
  const [window_, setWindow_]       = useState('1m');
  const [disclaimerOpen, setDisclaimerOpen] = useState(true);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setMessages([]);
      setDisclaimerOpen(true);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    const userMsg = { role: 'user', content: text };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput('');
    setSending(true);

    try {
      const lang = localStorage.getItem('oxs:language') || 'en';
      const { getFinancialAdvice } = await import('../api/chat');
      const data = await getFinancialAdvice(
        nextHistory.map(m => ({ role: m.role, content: m.content })),
        window_,
        lang
      );
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      const errText = err?.response?.status === 401
        ? t('financialAdvisor.authRequired')
        : t('financialAdvisor.error');
      setMessages(prev => [...prev, { role: 'error', content: errText }]);
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-0 end-4 sm:end-6 z-50 w-full max-w-sm flex flex-col shadow-2xl rounded-t-2xl overflow-hidden bg-gray-900 border border-gray-700">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-emerald-900/60 border-b border-emerald-800/60 flex-shrink-0">
        <DollarSign className="w-4 h-4 text-emerald-400 flex-shrink-0" aria-hidden="true" />
        <span className="text-sm font-semibold text-white flex-1">
          {t('financialAdvisor.title')}
        </span>
        {/* Window selector */}
        <select
          value={window_}
          onChange={e => setWindow_(e.target.value)}
          className="text-xs bg-gray-800 border border-gray-600 rounded px-1.5 py-1 text-gray-300 focus:outline-none"
          aria-label={t('financialAdvisor.windowLabel')}
        >
          <option value="1m">{t('financialAdvisor.windows.oneMonth')}</option>
          <option value="3m">{t('financialAdvisor.windows.threeMonths')}</option>
          <option value="6m">{t('financialAdvisor.windows.sixMonths')}</option>
          <option value="1y">{t('financialAdvisor.windows.oneYear')}</option>
        </select>
        <button
          onClick={onClose}
          className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 transition"
          aria-label={t('common.close')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Disclaimer banner */}
      <div className="flex-shrink-0">
        <button
          onClick={() => setDisclaimerOpen(v => !v)}
          className="w-full flex items-center gap-2 px-4 py-2 bg-amber-900/30 border-b border-amber-800/30 hover:bg-amber-900/40 transition text-start"
          aria-expanded={disclaimerOpen}
        >
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" aria-hidden="true" />
          <span className="text-xs text-amber-300 font-medium flex-1">
            {t('financialAdvisor.disclaimerTitle')}
          </span>
          {disclaimerOpen
            ? <ChevronUp className="w-3.5 h-3.5 text-amber-400" />
            : <ChevronDown className="w-3.5 h-3.5 text-amber-400" />}
        </button>
        {disclaimerOpen && (
          <div className="px-4 py-3 bg-amber-950/20 border-b border-amber-800/20 text-xs text-amber-200/80 leading-relaxed">
            <p>
              {t('financialAdvisor.disclaimerBody')}
            </p>
          </div>
        )}
      </div>

      {/* Message thread */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 max-h-80 min-h-[160px]">
        {messages.length === 0 && (
          <p className="text-xs text-gray-500 text-center mt-4">
            {t('financialAdvisor.emptyPrompt')}
          </p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'error' ? (
              <div className="max-w-[85%] px-3 py-2 rounded-2xl bg-red-900/40 border border-red-800/50 text-xs text-red-300 leading-relaxed">
                {msg.content}
              </div>
            ) : msg.role === 'user' ? (
              <div className="max-w-[85%] px-3.5 py-2 rounded-2xl rounded-br-sm bg-emerald-700 text-white text-sm leading-relaxed">
                {msg.content}
              </div>
            ) : (
              <div className="max-w-[85%] flex flex-col gap-1">
                <div className="px-3.5 py-2.5 rounded-2xl rounded-tl-sm bg-gray-800 border border-gray-700 text-sm text-gray-100 leading-relaxed whitespace-pre-wrap">
                  {msg.content}
                </div>
                <p className="text-[10px] text-amber-400/70 px-1">
                  {t('financialAdvisor.notAdviceTag')}
                </p>
              </div>
            )}
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="px-3.5 py-2.5 rounded-2xl rounded-tl-sm bg-gray-800 border border-gray-700 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="flex gap-2 px-3 py-3 border-t border-gray-800 flex-shrink-0">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={t('financialAdvisor.inputPlaceholder')}
          maxLength={800}
          disabled={sending}
          className="flex-1 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          className="w-9 h-9 flex-shrink-0 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white flex items-center justify-center transition"
          aria-label={t('messages.sendMessage')}
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
