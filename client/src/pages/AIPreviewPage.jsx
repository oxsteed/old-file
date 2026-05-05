/**
 * AI transparency preview + sandbox chat (same /api/chat/profile-message as public profile).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import api from '../api/axios';


function Section({ title, children, className = '' }) {
  return (
    <div className={`bg-gray-900/50 border border-gray-700/40 rounded-2xl p-5 ${className}`}>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">{title}</h3>
      {children}
    </div>
  );
}

function Badge({ text, color = 'gray' }) {
  const colors = {
    green:  'bg-green-500/15 text-green-400 border-green-500/30',
    orange: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    gray:   'bg-gray-700/40 text-gray-400 border-gray-600/30',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${colors[color] || colors.gray}`}>
      {text}
    </span>
  );
}

function ContextCards({ ctx, t }) {
  if (!ctx) return null;
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-white">{ctx.name}</span>
        {ctx.location && <span className="text-gray-400">{ctx.location}</span>}
        <Badge
          text={ctx.isAvailableNow ? t('aiPreview.badgeAvailable') : t('aiPreview.badgeUnavailable')}
          color={ctx.isAvailableNow ? 'green' : 'gray'}
        />
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-600 mb-1">{t('aiPreview.availabilityLabel')}</p>
        <pre className="text-xs text-gray-300 whitespace-pre-wrap font-sans bg-black/30 rounded-lg p-3 border border-gray-800">{ctx.availabilitySummary}</pre>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-600 mb-1">{t('aiPreview.skillsLabel')}</p>
        <ul className="list-disc list-inside text-gray-300 space-y-0.5">
          {(ctx.skills || []).map(s => (
            <li key={s.skill_name}>{s.skill_name}{s.hourly_rate != null ? ` — $${parseFloat(s.hourly_rate).toFixed(0)}/hr` : ''}</li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-600 mb-1">{t('aiPreview.faqsLabel')}</p>
        {(ctx.faqs || []).length
          ? (ctx.faqs || []).map(f => (
            <div key={f.id} className="mb-2 border-l-2 border-orange-500/40 pl-3">
              <p className="font-medium text-gray-200">{f.question}</p>
              <p className="text-gray-400 text-xs mt-0.5">{f.answer}</p>
            </div>
          ))
          : <p className="text-gray-600 italic">{t('aiPreview.noFAQs')}</p>}
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-600 mb-1">{t('aiPreview.productsLabel')}</p>
        {(ctx.products || []).length
          ? (ctx.products || []).map(p => (
            <div key={p.id} className="text-gray-300 text-xs mb-1">
              {p.name} — ${((p.price_cents || 0) / 100).toFixed(2)}
            </div>
          ))
          : <p className="text-gray-600 italic">{t('aiPreview.noProducts')}</p>}
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-600 mb-1">{t('aiPreview.knowledgeLabel')}</p>
        {ctx.aiKnowledge
          ? <pre className="text-xs text-gray-300 whitespace-pre-wrap font-sans bg-black/30 rounded-lg p-3 border border-gray-800 max-h-48 overflow-y-auto">{ctx.aiKnowledge}</pre>
          : <p className="text-gray-600 italic">{t('aiPreview.noKnowledge')}</p>}
      </div>
    </div>
  );
}

export default function AIPreviewPage({ profileType = 'helper' }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { id: routeBizId } = useParams();
  const businessId = profileType === 'business' ? routeBizId : null;

  const [rawContext, setRawContext] = useState(null);
  const [promptPreview, setPromptPreview] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [threadId, setThreadId] = useState(null);
  const bottomRef = useRef(null);

  const loadContext = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const path = profileType === 'helper'
        ? `/chat/profile-context/helper/${user.id}`
        : `/chat/profile-context/business/${businessId}`;
      const { data } = await api.get(path);
      setRawContext(data.rawContext);
      setPromptPreview(data.promptPreview || '');
    } catch {
      setError(t('aiPreview.loadError'));
    } finally {
      setLoading(false);
    }
  }, [profileType, user?.id, businessId, t]);

  useEffect(() => {
    if (user?.id && (profileType === 'helper' || businessId)) loadContext();
  }, [loadContext, user?.id, profileType, businessId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function sendSandbox() {
    const text = input.trim();
    if (!text || sending) return;
    const uid = profileType === 'helper' ? user?.id : null;
    if (profileType === 'helper' && !uid) return;

    const userMsg = { role: 'user', content: text };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput('');
    setSending(true);
    try {
      const body = {
        helperId: profileType === 'helper' ? uid : user.id,
        businessId: profileType === 'business' ? businessId : undefined,
        destination: 'helper',
        messages: nextHistory,
        ...(threadId ? { threadId } : {}),
        language: localStorage.getItem('oxs:language') || 'en',
      };
      const { data } = await api.post('/chat/profile-message', body);
      if (data.type !== 'ai') {
        setError(t('aiPreview.loadError'));
        return;
      }
      if (data.threadId) setThreadId(data.threadId);
      setMessages(m => [...m, { role: 'assistant', content: data.reply || '' }]);
    } catch {
      setError(t('aiPreview.loadError'));
      setMessages(m => m.slice(0, -1));
    } finally {
      setSending(false);
    }
  }

  const editLink = profileType === 'helper'
    ? '/helper-dashboard?tab=ai'
    : `/business-hub?biz=${businessId}&tab=ai`;

  if (!user) {
    return (
      <PageShell>
        <p className="text-gray-400 p-8">{t('auth.signIn')}</p>
      </PageShell>
    );
  }

  if (profileType === 'business' && !businessId) {
    return (
      <PageShell>
        <p className="text-gray-400 p-8">Invalid business.</p>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageMeta title={t('aiPreview.title')} />
      <div className="max-w-5xl mx-auto px-4 py-8 text-white">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold">{t('aiPreview.title')}</h1>
            <p className="text-sm text-gray-400 mt-1">{t('aiPreview.subtitle')}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={loadContext} className="px-4 py-2 rounded-lg bg-gray-800 border border-gray-600 text-sm">
              {t('aiPreview.refreshBtn')}
            </button>
            <Link to={editLink} className="px-4 py-2 rounded-lg bg-orange-500 text-gray-950 text-sm font-semibold">
              {t('aiPreview.editKnowledgeBtn')}
            </Link>
          </div>
        </div>

        {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
        {loading && <p className="text-gray-500">{t('common.loading')}</p>}

        {!loading && rawContext && (
          <div className="space-y-6">
            <Section title={t('aiPreview.sectionContext')}>
              <ContextCards ctx={rawContext} t={t} />
            </Section>

            <Section title={t('aiPreview.sectionPrompt')}>
              <pre className="text-xs text-gray-400 whitespace-pre-wrap font-mono max-h-64 overflow-y-auto bg-black/40 p-3 rounded-lg border border-gray-800">{promptPreview}</pre>
              <p className="text-xs text-gray-500 mt-2">{t('aiPreview.promptTruncated')}</p>
            </Section>

            <Section title={t('aiPreview.sectionSandbox')}>
              <p className="text-xs text-gray-500 mb-3">{t('aiPreview.sandboxDisclaimer')}</p>
              <div className="bg-black/30 rounded-xl border border-gray-800 p-4 min-h-[160px] max-h-72 overflow-y-auto mb-3 space-y-2">
                {messages.map((m, i) => (
                  <div key={i} className={`text-sm ${m.role === 'user' ? 'text-orange-200' : 'text-gray-300'}`}>
                    <span className="font-semibold text-gray-500">{m.role === 'user' ? t('aiPreview.sandboxYou') : t('aiPreview.sandboxAI')}: </span>
                    {m.content}
                  </div>
                ))}
                {sending && <p className="text-xs text-gray-500">{t('aiPreview.sandboxThinking')}</p>}
                <div ref={bottomRef} />
              </div>
              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendSandbox())}
                  placeholder={t('aiPreview.sandboxPlaceholder')}
                  className="flex-1 rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-sm"
                />
                <button type="button" onClick={sendSandbox} disabled={sending} className="px-4 py-2 rounded-lg bg-orange-500 text-gray-950 text-sm font-semibold disabled:opacity-50">
                  {t('aiPreview.sandboxSend')}
                </button>
                <button
                  type="button"
                  onClick={() => { setMessages([]); setThreadId(null); }}
                  className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-600 text-sm"
                >
                  {t('aiPreview.sandboxClear')}
                </button>
              </div>
            </Section>
          </div>
        )}
      </div>
    </PageShell>
  );
}
