import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle,
  Clock,
  Download,
  FileText,
  Mail,
  MessageSquare,
  Paperclip,
  Pencil,
  Phone,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  Users,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import io from 'socket.io-client';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import api from '../api/axios';
import PageMeta from '../components/PageMeta';
import { realtimeNamespaceUrl } from '../lib/realtime';
import { useAuth } from '../hooks/useAuth';
import './SupportEscalationPage.css';

const OXSTEED_SUPPORT_PHONE = '+1 (937) 408-5169';
const OXSTEED_SUPPORT_EMAIL = 'support@oxsteed.com';

function ConversationReviewForm({ t, review, rating, setRating, comment, setComment, busy, onSubmit }) {
  if (review) {
    return <div className="mb-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4"><p className="font-semibold text-emerald-200">{t('support.escalation.reviewThanks', { defaultValue: 'Thanks for your feedback.' })}</p><p className="mt-1 text-sm text-slate-300">{t('support.escalation.reviewSaved', { defaultValue: 'Your review has been saved.' })}</p></div>;
  }
  return <form onSubmit={onSubmit} className="mb-5 rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
    <p className="font-semibold text-white">{t('support.escalation.reviewTitle', { defaultValue: 'How did we do?' })}</p>
    <p className="mt-1 text-sm text-slate-400">{t('support.escalation.reviewBody', { defaultValue: 'Please rate your support experience.' })}</p>
    <div className="mt-3 flex gap-1" role="radiogroup" aria-label={t('support.escalation.reviewTitle', { defaultValue: 'How did we do?' })}>
      {[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" onClick={() => setRating(value)} aria-label={`${value} / 5`} aria-pressed={rating === value} className={`rounded-lg p-1 transition ${value <= rating ? 'text-orange-300' : 'text-slate-600 hover:text-orange-200'}`}><Star size={22} fill="currentColor" /></button>)}
    </div>
    <textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={1000} rows={2} className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" placeholder={t('support.escalation.reviewPlaceholder', { defaultValue: 'Optional feedback' })} />
    <button type="submit" disabled={busy || !rating} className="mt-3 rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? t('support.escalation.savingReview', { defaultValue: 'Saving…' }) : t('support.escalation.submitReview', { defaultValue: 'Submit review' })}</button>
  </form>;
}

function PublicGuestSupport({ t }) {
  const [step, setStep] = useState('start');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [code, setCode] = useState('');
  const [conversationId, setConversationId] = useState(sessionStorage.getItem('oxs:guest-support-id') || '');
  const [token, setToken] = useState(sessionStorage.getItem('oxs:guest-support-token') || '');
  const [messages, setMessages] = useState([]);
  const [reply, setReply] = useState('');
  const [replyFile, setReplyFile] = useState(null);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingContent, setEditingContent] = useState('');
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState('');
  const [review, setReview] = useState(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [conversationStatus, setConversationStatus] = useState('');
  const [agentTyping, setAgentTyping] = useState(false);
  const [reopenBusy, setReopenBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [waiting, setWaiting] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [showNewMessages, setShowNewMessages] = useState(false);
  const messageListRef = useRef(null);
  const messagesEndRef = useRef(null);
  const socketRef = useRef(null);
  const typingTimerRef = useRef(null);
  const stickToBottomRef = useRef(true);

  const load = useCallback(async () => {
    if (!conversationId || !token) return;
    const response = await api.get(`/support/public/conversations/${conversationId}`, { headers: { Authorization: `Guest ${token}` } });
    setMessages(normalizeSupportMessages(response.data.data?.messages || []));
    setConversationStatus(response.data.data?.status || '');
    setReview(response.data.data?.review || null);
    const state = response.data.data?.waiting;
    if (state) setWaiting({ ...state, localDeadline: Date.now() + state.remainingSeconds * 1000 });
  }, [conversationId, token]);

  useEffect(() => { if (token) { setStep('chat'); load().catch(() => setError(t('support.escalation.sessionExpired', { defaultValue: 'This support session has expired. Please start a new request.' }))); } }, [token, load, t]);

  useEffect(() => {
    if (!token || !conversationId) return undefined;
    const poll = window.setInterval(() => load().catch(() => {}), 5000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(poll); window.clearInterval(clock); };
  }, [token, conversationId, load]);

  useEffect(() => {
    if (!token || !conversationId) return undefined;
    const socket = io(realtimeNamespaceUrl('support'), { transports: ['websocket', 'polling'], auth: { guestToken: token, conversationId } });
    socketRef.current = socket;
    socket.on('connect', () => {
      socket.emit('customer:join', { visitorName: name, visitorEmail: email });
      socket.emit('ticket:join', { ticketId: conversationId });
      load().catch(() => {});
    });
    socket.on('ticket:assigned', () => load().catch(() => {}));
    socket.on('message:new', (data) => {
      if (data.ticketId === conversationId) load().catch(() => {});
    });
    socket.on('message:updated', (data) => {
      if (data.ticketId === conversationId) load().catch(() => {});
    });
    socket.on('messages:read', (data) => {
      if (data.ticketId !== conversationId) return;
      setMessages((previous) => previous.map((item) => item.sender.type === 'customer'
        ? { ...item, readByRecipient: true, readAt: data.readAt || new Date().toISOString() }
        : item));
    });
    socket.on('agent:typing-indicator', (data) => {
      if (data.ticketId === conversationId) setAgentTyping(Boolean(data.isTyping));
    });
    socket.on('ticket:status-changed', (data) => {
      if (data.ticketId === conversationId) setConversationStatus(data.status || '');
    });
    return () => socket.disconnect();
  }, [conversationId, email, name, token, load]);

  useEffect(() => {
    if (step === 'chat') {
      if (stickToBottomRef.current) {
        messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight, behavior: 'smooth' });
        setShowNewMessages(false);
      } else if (messages.length > 0) {
        setShowNewMessages(true);
      }
      socketRef.current?.emit('ticket:read', { ticketId: conversationId });
    }
  }, [conversationId, messages, step]);

  useEffect(() => () => {
    window.clearTimeout(typingTimerRef.current);
    socketRef.current?.emit('customer:typing', { ticketId: conversationId, isTyping: false });
  }, [conversationId]);

  const start = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await api.post('/support/public/conversations', { visitorName: name, visitorEmail: email, message });
      setConversationId(response.data.conversationId); sessionStorage.setItem('oxs:guest-support-id', response.data.conversationId); setStep('verify');
    } catch (err) { setError(err.response?.data?.error || t('support.escalation.ticketError', { defaultValue: 'Could not start support.' })); }
    finally { setBusy(false); }
  };

  const verify = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await api.post(`/support/public/conversations/${conversationId}/verify`, { visitorEmail: email, code });
      setToken(response.data.guestToken); sessionStorage.setItem('oxs:guest-support-token', response.data.guestToken); setStep('chat');
    } catch (err) { setError(err.response?.data?.error || t('support.escalation.invalidCode', { defaultValue: 'That code is invalid or expired.' })); }
    finally { setBusy(false); }
  };

  const resend = async () => {
    setBusy(true); setError('');
    try { await api.post(`/support/public/conversations/${conversationId}/resend-code`, { visitorEmail: email }); }
    catch (err) { setError(err.response?.data?.error || t('support.escalation.resendFailed', { defaultValue: 'Could not resend the code yet.' })); }
    finally { setBusy(false); }
  };

  const send = async (event) => {
    event.preventDefault(); const content = reply.trim(); if (!content && !replyFile) return; if (['resolved', 'closed'].includes(conversationStatus)) return; setBusy(true); setError('');
    try {
      const body = new FormData();
      if (content) body.append('message', content);
      if (replyFile) body.append('file', replyFile);
      await api.post(`/support/public/conversations/${conversationId}/messages`, body, { headers: { Authorization: `Guest ${token}` } });
      setReply(''); setReplyFile(null); await load();
    }
    catch (err) { setError(err.response?.data?.error || t('support.escalation.ticketError', { defaultValue: 'Could not send your message.' })); }
    finally { setBusy(false); }
  };

  const handleReplyChange = (event) => {
    const value = event.target.value;
    setReply(value);
    if (!conversationId || ['resolved', 'closed'].includes(conversationStatus)) return;
    socketRef.current?.emit('customer:typing', { ticketId: conversationId, isTyping: Boolean(value.trim()) });
    window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => {
      socketRef.current?.emit('customer:typing', { ticketId: conversationId, isTyping: false });
    }, 1500);
  };

  const download = async () => {
    if (!conversationId || !token) return;
    setDownloadBusy(true);
    try {
      const response = await api.get(`/support/public/conversations/${conversationId}/download`, {
        headers: { Authorization: `Guest ${token}` },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `oxsteed-support-${conversationId.slice(0, 8)}.txt`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.response?.data?.error || t('support.escalation.downloadError', { defaultValue: 'Could not download this conversation.' }));
    } finally { setDownloadBusy(false); }
  };

  const editMessage = async (messageId) => {
    const content = editingContent.trim();
    if (!content) return;
    setBusy(true); setError('');
    try {
      await api.put(`/support/public/conversations/${conversationId}/messages/${messageId}`, { content }, { headers: { Authorization: `Guest ${token}` } });
      setEditingMessageId(null); setEditingContent(''); await load();
    } catch (err) {
      setError(err.response?.data?.error || t('support.escalation.editError', { defaultValue: 'This message can no longer be edited.' }));
    } finally { setBusy(false); }
  };

  const submitReview = async (event) => {
    event.preventDefault();
    if (!reviewRating) return;
    setReviewBusy(true); setError('');
    try {
      const response = await api.post(`/support/public/conversations/${conversationId}/review`, { rating: reviewRating, comment: reviewComment }, { headers: { Authorization: `Guest ${token}` } });
      setReview(response.data.data); setReviewComment('');
    } catch (err) {
      setError(err.response?.data?.error || t('support.escalation.reviewError', { defaultValue: 'Could not save your review.' }));
    } finally { setReviewBusy(false); }
  };

  const reopen = async () => {
    if (conversationStatus !== 'resolved' || reopenBusy) return;
    setReopenBusy(true); setError('');
    try {
      await api.post(`/support/public/conversations/${conversationId}/reopen`, {}, { headers: { Authorization: `Guest ${token}` } });
      await load();
    } catch (err) {
      setError(err.response?.data?.error || t('support.escalation.reopenError', { defaultValue: 'Could not reopen this conversation.' }));
    } finally { setReopenBusy(false); }
  };

  const shell = (children) => (
    <>
      <Navbar />
      <main className="flex-1 support-escalation-page guest-support-page" dir={document.documentElement.dir || 'ltr'}>
        <div className="max-w-6xl mx-auto px-4 py-8 md:py-10">
          <header className="guest-support-banner mb-6 rounded-[28px] border p-6 md:p-8">
            <div className="flex items-center gap-3 text-orange-300 mb-3">
              <ShieldCheck size={24} aria-hidden="true" />
              <span className="text-sm font-bold uppercase tracking-widest">
                {t('support.escalation.brandName', { defaultValue: 'OxSteed Support' })}
              </span>
            </div>
            <p className="text-slate-300 text-lg leading-7">
              {t('support.escalation.guestBody', { defaultValue: 'Start a secure support conversation without signing in.' })}
            </p>
          </header>
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
            <div className="min-w-0">
              {step === 'chat' && waiting && (
                <section className="guest-support-banner rounded-3xl border p-6 mb-4 text-white">
                  <h2 className="text-xl font-semibold" role="status">
                    {waiting.state === 'connected' ? t('support.liveWait.connected')
                      : waiting.state === 'closed' ? t('support.liveWait.closed')
                        : waiting.state === 'waiting' && waiting.localDeadline > now
                          ? t('support.liveWait.title') : t('support.liveWait.unavailable')}
                  </h2>
                  {waiting.state === 'waiting' && waiting.localDeadline > now ? (
                    <>
                      <div className="text-4xl font-bold tabular-nums text-orange-300 my-3" role="timer" aria-label={t('support.liveWait.title')}>
                        {Math.floor(Math.max(0, Math.ceil((waiting.localDeadline - now) / 1000)) / 60)}:{String(Math.max(0, Math.ceil((waiting.localDeadline - now) / 1000)) % 60).padStart(2, '0')}
                      </div>
                      <p className="text-slate-300">{t('support.liveWait.body')}</p>
                    </>
                  ) : waiting.state !== 'connected' && waiting.state !== 'closed' && (
                    <p className="mt-3 text-slate-300">{t('support.liveWait.fallback')}</p>
                  )}
                </section>
              )}
              {children}
            </div>
            <aside className="grid gap-4">
              <section className="guest-support-banner rounded-3xl border p-6">
                <h2 className="text-white font-semibold text-lg mb-3">
                  {t('support.escalation.directContactTitle', { defaultValue: 'Need a faster response?' })}
                </h2>
                <p className="text-slate-300 text-sm leading-6">
                  {t('support.escalation.directContactBody', { defaultValue: 'When no specialist is available, call or text OxSteed Support directly.' })}
                </p>
                <a href="tel:+19374085169" className="block my-4 text-orange-300 text-lg font-semibold" dir="ltr">{OXSTEED_SUPPORT_PHONE}</a>
                <div className="grid grid-cols-2 gap-3">
                  <a href="tel:+19374085169" className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-600 px-3 py-3 text-white font-semibold hover:bg-orange-700">
                    <Phone size={17} aria-hidden="true" />{t('support.escalation.callSupport', { defaultValue: 'Call' })}
                  </a>
                  <a href="sms:+19374085169" className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-3 py-3 text-white font-semibold hover:border-orange-500">
                    <MessageSquare size={17} aria-hidden="true" />{t('support.escalation.textSupport', { defaultValue: 'Text' })}
                  </a>
                </div>
                <a href={`mailto:${OXSTEED_SUPPORT_EMAIL}`} className="mt-4 flex items-center gap-2 text-slate-300 text-sm break-all"><Mail size={16} aria-hidden="true" />{OXSTEED_SUPPORT_EMAIL}</a>
              </section>
              <section className="guest-support-banner rounded-3xl border p-6">
                <h2 className="text-white font-semibold mb-3">{t('support.escalation.includeTitle')}</h2>
                <ul className="text-slate-300 text-sm leading-7 list-disc ps-5">
                  <li>{t('support.escalation.includeWhat')}</li>
                  <li>{t('support.escalation.includeIds')}</li>
                  <li>{t('support.escalation.includeWhy')}</li>
                </ul>
              </section>
            </aside>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
  if (step === 'chat') return shell(
    <section className="rounded-[28px] border border-slate-700 bg-slate-900 p-6 text-white">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-3xl font-bold">{t('support.escalation.liveTitle', { defaultValue: 'OxSteed Support' })}</h1><p className="mt-2 text-slate-300">{t('support.escalation.guestChatBody', { defaultValue: 'Your verified support conversation is open.' })}</p></div>
        <div className="flex flex-wrap gap-2">
          {conversationStatus === 'resolved' && <button type="button" onClick={reopen} disabled={reopenBusy} className="inline-flex items-center gap-2 rounded-xl border border-orange-500/40 px-3 py-2 text-sm text-orange-200 hover:border-orange-400 disabled:opacity-50">{reopenBusy ? t('support.escalation.reopening', { defaultValue: 'Reopening…' }) : t('support.escalation.reopen', { defaultValue: 'Reopen conversation' })}</button>}
          <button type="button" onClick={download} disabled={downloadBusy} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:border-orange-500 disabled:opacity-50"><Download size={16} />{downloadBusy ? t('support.escalation.downloading', { defaultValue: 'Preparing…' }) : t('support.escalation.download', { defaultValue: 'Download' })}</button>
        </div>
      </div>
      <div
        ref={messageListRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 96;
          stickToBottomRef.current = nearBottom;
          if (nearBottom) setShowNewMessages(false);
        }}
        className="my-6 max-h-[420px] space-y-3 overflow-y-auto"
      >
        {showNewMessages && <button type="button" onClick={() => { stickToBottomRef.current = true; setShowNewMessages(false); messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight, behavior: 'smooth' }); }} className="sticky top-2 z-10 mx-auto block rounded-full border border-orange-500/40 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-orange-200 shadow-lg">{t('support.escalation.newMessages', { defaultValue: 'New messages' })} ↓</button>}
        {messages.map((item) => {
          const isCustomer = item.sender?.type === 'customer';
          const canEdit = isCustomer && item.content && !['resolved', 'closed'].includes(conversationStatus) && Date.now() - new Date(item.timestamp).getTime() < 15 * 60 * 1000;
          return <div key={item.id || `${item.timestamp}-${item.content}`} className={`rounded-2xl px-4 py-3 ${isCustomer ? 'ml-8 bg-orange-600' : 'bg-slate-800'}`}>
            {item.attachmentUrl && <img src={item.attachmentUrl} alt={item.attachmentName || 'Support attachment'} className="mb-2 max-h-64 max-w-full rounded-xl object-contain" />}
            {editingMessageId === item.id ? <div className="space-y-2"><textarea value={editingContent} onChange={(event) => setEditingContent(event.target.value)} maxLength={5000} rows={3} className="w-full rounded-xl bg-slate-900 px-3 py-2 text-white" /><div className="flex gap-2"><button type="button" onClick={() => editMessage(item.id)} disabled={busy || !editingContent.trim()} className="rounded-lg bg-white/20 px-3 py-1.5 text-xs font-semibold">{t('common.save', { defaultValue: 'Save' })}</button><button type="button" onClick={() => setEditingMessageId(null)} className="rounded-lg px-3 py-1.5 text-xs text-white/70">{t('common.cancel', { defaultValue: 'Cancel' })}</button></div></div> : <>{item.content && <p className="whitespace-pre-wrap">{item.content}</p>}{item.editedAt && <span className="mt-2 block text-xs opacity-70">{t('support.escalation.edited', { defaultValue: 'Edited' })}</span>}{canEdit && <button type="button" onClick={() => { setEditingMessageId(item.id); setEditingContent(item.content); }} className="mt-2 inline-flex items-center gap-1 text-xs text-white/75 hover:text-white"><Pencil size={12} />{t('support.escalation.edit', { defaultValue: 'Edit' })}</button>}</>}
            {item.readByRecipient && isCustomer && <span className="mt-2 block text-right text-[11px] opacity-70">{t('support.escalation.read', { defaultValue: 'Read' })}</span>}
          </div>;
        })}
        <div ref={messagesEndRef} />
      </div>
      {['resolved', 'closed'].includes(conversationStatus) && <ConversationReviewForm t={t} review={review} rating={reviewRating} setRating={setReviewRating} comment={reviewComment} setComment={setReviewComment} busy={reviewBusy} onSubmit={submitReview} />}
      {error && <p className="mb-3 text-red-300">{error}</p>}
      {agentTyping && <p className="mb-2 text-xs text-slate-400" role="status">{t('support.escalation.agentTyping', { defaultValue: 'A support agent is typing…' })}</p>}
      {replyFile && <p className="mb-2 text-sm text-orange-200">{replyFile.name}</p>}
      <form onSubmit={send} className="flex gap-2"><label className="cursor-pointer rounded-xl border border-slate-700 px-3 py-3 hover:border-orange-500" title={t('support.escalation.attachImage', { defaultValue: 'Attach image' })}><Paperclip size={18} /><input type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" onChange={(e) => setReplyFile(e.target.files?.[0] || null)} /></label><input value={reply} onChange={handleReplyChange} maxLength={5000} disabled={['resolved', 'closed'].includes(conversationStatus)} className="min-w-0 flex-1 rounded-xl bg-slate-800 px-4 py-3 disabled:opacity-50" placeholder={t('support.escalation.messagePlaceholder', { defaultValue: 'Write a message...' })} /><button disabled={busy || ['resolved', 'closed'].includes(conversationStatus) || (!reply.trim() && !replyFile)} className="rounded-xl bg-orange-600 px-4 py-3 disabled:opacity-50"><Send size={18} /></button></form>
    </section>
  );
  if (step === 'verify') return shell(<section className="rounded-[28px] border border-slate-700 bg-slate-900 p-6 text-white"><h1 className="text-3xl font-bold">{t('support.escalation.verifyTitle', { defaultValue: 'Check your email' })}</h1><p className="mt-2 text-slate-300">{t('support.escalation.verifyBody', { defaultValue: 'Enter the six-digit code we sent to your email address.' })}</p><form onSubmit={verify} className="mt-6 space-y-4"><input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" maxLength={6} required className="w-full rounded-xl bg-slate-800 px-4 py-3" placeholder="000000" />{error && <p className="text-red-300">{error}</p>}<button disabled={busy || code.length !== 6} className="w-full rounded-xl bg-orange-600 py-3 font-semibold disabled:opacity-50">{t('support.escalation.verifyButton', { defaultValue: 'Verify and continue' })}</button><button type="button" onClick={resend} disabled={busy} className="w-full rounded-xl border border-slate-700 py-3 text-slate-200 disabled:opacity-50">{t('support.escalation.resendCode', { defaultValue: 'Resend code' })}</button></form></section>);
  return shell(<section className="rounded-[28px] border border-slate-700 bg-slate-900 p-6 text-white"><h1 className="text-3xl font-bold">{t('support.escalation.guestTitle', { defaultValue: 'Talk to OxSteed Support' })}</h1><p className="mt-2 text-slate-300">{t('support.escalation.guestBody', { defaultValue: 'Start a secure support conversation without signing in.' })}</p><form onSubmit={start} className="mt-6 space-y-4"><input required value={name} onChange={(e) => setName(e.target.value)} maxLength={255} className="w-full rounded-xl bg-slate-800 px-4 py-3" placeholder={t('support.escalation.namePlaceholder', { defaultValue: 'Your name' })} /><input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320} className="w-full rounded-xl bg-slate-800 px-4 py-3" placeholder={t('support.escalation.emailPlaceholder', { defaultValue: 'Email address' })} /><textarea required value={message} onChange={(e) => setMessage(e.target.value)} maxLength={5000} rows={6} className="w-full rounded-xl bg-slate-800 px-4 py-3" placeholder={t('support.escalation.messagePlaceholder', { defaultValue: 'How can we help?' })} />{error && <p className="text-red-300">{error}</p>}<button disabled={busy} className="w-full rounded-xl bg-orange-600 py-3 font-semibold disabled:opacity-50">{t('support.escalation.startButton', { defaultValue: 'Start support conversation' })}</button></form></section>);
}

function normalizeSupportMessages(messages = []) {
  return messages.map((message) => ({
    id: message.id,
    sender: { type: message.is_agent ? 'agent' : 'customer' },
    content: message.content,
    attachmentUrl: message.attachment_url || message.attachmentUrl,
    attachmentName: message.attachment_name || message.attachmentName,
    editedAt: message.edited_at || message.editedAt,
    editCount: message.edit_count || message.editCount || 0,
    readByRecipient: Boolean(message.read_by_recipient || message.readByRecipient),
    readAt: message.read_at || message.readAt,
    messageType: message.message_type || message.messageType,
    timestamp: message.created_at,
  }));
}

function localizeWaitingState(waiting) {
  if (!waiting) return null;
  return {
    ...waiting,
    localDeadline: Date.now() + Number(waiting.remainingSeconds || 0) * 1000,
  };
}

export default function SupportEscalationPage() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-slate-950" />;
  return user
    ? <AuthenticatedSupportEscalationPage user={user} />
    : <PublicGuestSupport t={t} />;
}

function AuthenticatedSupportEscalationPage({ user }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [phase, setPhase] = useState('checking'); // 'checking' | 'live-chat' | 'ticket' | 'success'
  const [agentsOnline, setAgentsOnline] = useState(0);
  const [ticketId, setTicketId] = useState(null);
  const [liveMessages, setLiveMessages] = useState([]);
  const [liveInput, setLiveInput] = useState('');
  const [liveFile, setLiveFile] = useState(null);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingContent, setEditingContent] = useState('');
  const [liveSending, setLiveSending] = useState(false);
  const [conversationStatus, setConversationStatus] = useState('');
  const [review, setReview] = useState(null);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [agentTyping, setAgentTyping] = useState(false);
  const [reopenBusy, setReopenBusy] = useState(false);
  const [assignedAgent, setAssignedAgent] = useState(null);
  const [connectionState, setConnectionState] = useState('checking');
  const [waiting, setWaiting] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [showNewMessages, setShowNewMessages] = useState(false);
  const profileName = user?.name || [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() || user?.email || '';
  const profileEmail = user?.email || '';
  const [visitorName, setVisitorName] = useState(profileName);
  const [visitorEmail, setVisitorEmail] = useState(profileEmail);
  const [ticketMessage, setTicketMessage] = useState('');
  const [ticketSubmitting, setTicketSubmitting] = useState(false);
  const [successTicketId, setSuccessTicketId] = useState(null);

  const socketRef = useRef(null);
  const messageListRef = useRef(null);
  const messagesEndRef = useRef(null);
  const ticketIdRef = useRef(null);
  const typingTimerRef = useRef(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    ticketIdRef.current = ticketId;
  }, [ticketId]);

  useEffect(() => {
    let active = true;
    const socket = io(realtimeNamespaceUrl('support'), {
      transports: ['websocket', 'polling'],
      reconnection: true,
      auth: { token: localStorage.getItem('accessToken') },
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('customer:join', {
        userId: user.id,
        visitorEmail: profileEmail,
        visitorName: profileName,
      });
      if (ticketIdRef.current) {
        socket.emit('ticket:join', {
          ticketId: ticketIdRef.current,
          userId: localStorage.getItem('userId'),
        });
      }
    });

    const handleAssignment = (data) => {
      if (data.ticketId !== ticketIdRef.current) return;
      setAssignedAgent({ id: data.agentId, name: data.agentName || t('support.escalation.specialistFallback') });
      setConnectionState('connected');
    };

    socket.on('ticket:assigned', handleAssignment);
    socket.on('agent:assigned', handleAssignment);
    socket.on('agent:joined', handleAssignment);
    socket.on('message:new', (data) => {
      const { ticketId: messageTicketId, sender, content, timestamp, attachmentUrl, attachmentName, messageType } = data;
      if (messageTicketId !== ticketIdRef.current || sender.type !== 'agent') return;
      setLiveMessages((previous) => {
        const duplicate = previous.some((message) => (
          message.sender.type === 'agent'
          && message.content === content
          && message.timestamp === timestamp
        ));
        if (duplicate) return previous;
        return [
          ...previous,
          {
            id: data.messageId || `agent-${Date.now()}`,
            sender,
            content,
            attachmentUrl,
            attachmentName,
            messageType,
            timestamp,
          },
        ];
      });
    });
    socket.on('message:updated', (data) => {
      if (data.ticketId !== ticketIdRef.current) return;
      setLiveMessages((previous) => previous.map((message) => message.id === data.messageId ? {
        ...message,
        content: data.content,
        attachmentUrl: data.attachmentUrl,
        attachmentName: data.attachmentName,
        editedAt: data.editedAt,
        editCount: data.editCount,
      } : message));
    });
    socket.on('ticket:read', (data) => {
      if (data.ticketId !== ticketIdRef.current) return;
      setLiveMessages((previous) => previous.map((message) => message.sender.type === 'agent'
        ? { ...message, readByRecipient: true, readAt: data.readAt || new Date().toISOString() }
        : message));
    });
    socket.on('agent:typing-indicator', (data) => {
      if (data.ticketId === ticketIdRef.current) setAgentTyping(Boolean(data.isTyping));
    });
    socket.on('ticket:status-changed', (data) => {
      if (data.ticketId === ticketIdRef.current) setConversationStatus(data.status || '');
    });

    const connect = async () => {
      try {
        const statusResponse = await api.get('/support-routing/status');
        if (!active) return;
        const onlineCount = statusResponse.data.liveAvailableAgents ?? statusResponse.data.agents ?? 0;
        setAgentsOnline(onlineCount);
        setConnectionState('connecting');
        const response = await api.post('/support-routing/connect');
        if (!active) return;

        const nextTicketId = response.data.ticketId;
        ticketIdRef.current = nextTicketId;
        setTicketId(nextTicketId);
        setAssignedAgent(response.data.assignedAgent || null);
        setLiveMessages(normalizeSupportMessages(response.data.messages));
        setConversationStatus(response.data.status || '');
        setReview(response.data.review || null);
        const connected = response.data.routedTo === 'agent';
        const nextWaiting = localizeWaitingState(response.data.waiting);
        setWaiting(connected ? null : nextWaiting);
        if (!connected) setAgentsOnline(0);
        setConnectionState(connected ? 'connected' : 'queued');
        setPhase(connected || nextWaiting?.state === 'waiting' ? 'live-chat' : 'ticket');
        socket.emit('ticket:join', {
          ticketId: nextTicketId,
          userId: user.id,
        });
      } catch (err) {
        console.error('Failed to establish live support session:', err);
        if (active) {
          // The availability check is only a snapshot. If connection fails,
          // never leave its old count beside the ticket fallback state.
          setAgentsOnline(0);
          setWaiting(null);
          setConnectionState('failed');
          setPhase('ticket');
        }
      }
    };

    connect();
    return () => {
      active = false;
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [profileEmail, profileName, t, user.id]);

  useEffect(() => {
    if (phase !== 'live-chat' || connectionState !== 'queued') return undefined;
    let active = true;
    let connecting = false;
    const retryLiveRouting = async () => {
      if (connecting) return;
      try {
        const statusResponse = await api.get('/support-routing/status');
        if (!active) return;
        const available = statusResponse.data.liveAvailableAgents ?? statusResponse.data.agents ?? 0;
        setAgentsOnline(available);
        if (available < 1) return;
        connecting = true;
        const response = await api.post('/support-routing/connect');
        if (!active) return;
        if (response.data.routedTo !== 'agent') {
          setAgentsOnline(0);
          return;
        }
        const nextTicketId = response.data.ticketId;
        ticketIdRef.current = nextTicketId;
        setTicketId(nextTicketId);
        setAssignedAgent(response.data.assignedAgent || null);
        setLiveMessages(normalizeSupportMessages(response.data.messages));
        setConversationStatus(response.data.status || '');
        setReview(response.data.review || null);
        setWaiting(null);
        setConnectionState('connected');
        setPhase('live-chat');
        socketRef.current?.emit('ticket:join', { ticketId: nextTicketId, userId: user.id });
      } catch (err) {
        console.error('Live support retry failed:', err);
      } finally {
        connecting = false;
      }
    };
    retryLiveRouting();
    const timer = window.setInterval(retryLiveRouting, 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [connectionState, phase, user.id]);

  useEffect(() => {
    if (connectionState !== 'queued' || !waiting?.localDeadline) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [connectionState, waiting?.localDeadline]);

  useEffect(() => {
    if (connectionState !== 'queued' || !waiting?.localDeadline || waiting.localDeadline > now) return;
    setAgentsOnline(0);
    setConnectionState('unavailable');
    setPhase('ticket');
  }, [connectionState, now, waiting?.localDeadline]);

  useEffect(() => {
    if (!ticketId) return undefined;

    let active = true;
    const syncConversation = async () => {
      try {
        const response = await api.get(`/support/conversations/${ticketId}`);
        if (!active) return;
        const conversation = response.data.data;
        setLiveMessages(normalizeSupportMessages(conversation.messages));
        setConversationStatus(conversation.status || '');
        setReview(conversation.review || null);
        if (conversation.agent_id) {
          setAssignedAgent({
            id: conversation.agent_id,
            name: conversation.agent_name || t('support.escalation.specialistFallback'),
          });
          setWaiting(null);
          setConnectionState('connected');
        } else if (conversation.status === 'waiting_for_agent') {
          const expiresAt = conversation.live_wait_expires_at
            ? new Date(conversation.live_wait_expires_at).getTime()
            : Date.now();
          setWaiting({
            state: conversation.live_wait_ended_at || expiresAt <= Date.now() ? 'message' : 'waiting',
            remainingSeconds: Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)),
            expiresAt: conversation.live_wait_expires_at,
            localDeadline: expiresAt,
          });
          setConnectionState('queued');
        }
      } catch (err) {
        console.error('Failed to refresh support conversation:', err);
      }
    };

    const intervalId = window.setInterval(syncConversation, 10000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [ticketId]);

  useEffect(() => {
    if (stickToBottomRef.current) {
      messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight, behavior: 'smooth' });
      setShowNewMessages(false);
    } else if (liveMessages.length > 0) {
      setShowNewMessages(true);
    }
    if (ticketId) socketRef.current?.emit('ticket:read', { ticketId });
  }, [liveMessages, ticketId]);

  useEffect(() => {
    stickToBottomRef.current = true;
  }, [ticketId]);

  useEffect(() => () => {
    window.clearTimeout(typingTimerRef.current);
    socketRef.current?.emit('customer:typing', { ticketId: ticketIdRef.current, isTyping: false });
  }, [ticketId]);

  const handleSendLiveMessage = useCallback(async () => {
    const content = liveInput.trim();
    if ((!content && !liveFile) || !ticketId || ['resolved', 'closed'].includes(conversationStatus)) return;

    setLiveSending(true);
    try {
      const body = new FormData();
      if (content) body.append('message', content);
      if (liveFile) body.append('file', liveFile);
      const response = await api.post(`/support/conversations/${ticketId}/message`, body);

      setLiveMessages((prev) => [
        ...prev,
        {
          id: response.data.data?.id || `customer-${Date.now()}`,
          sender: { type: 'customer' },
          content,
          attachmentUrl: response.data.data?.attachment_url,
          attachmentName: response.data.data?.attachment_name,
          messageType: response.data.data?.message_type || 'text',
          editedAt: response.data.data?.edited_at,
          timestamp: response.data.data?.created_at || new Date().toISOString(),
        },
      ]);
      setLiveInput('');
      setLiveFile(null);
    } catch (err) {
      console.error('Live support message failed:', err);
      toast.error(t('support.escalation.ticketError', { defaultValue: 'Could not send your support message.' }));
    } finally {
      setLiveSending(false);
    }
  }, [conversationStatus, liveFile, liveInput, ticketId, t]);

  const downloadConversation = async () => {
    if (!ticketId) return;
    setDownloadBusy(true);
    try {
      const response = await api.get(`/support/conversations/${ticketId}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `oxsteed-support-${ticketId.slice(0, 8)}.txt`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err.response?.data?.error || t('support.escalation.downloadError', { defaultValue: 'Could not download this conversation.' }));
    } finally { setDownloadBusy(false); }
  };

  const editCustomerMessage = async (messageId) => {
    const content = editingContent.trim();
    if (!content || !ticketId) return;
    setLiveSending(true);
    try {
      await api.put(`/support/conversations/${ticketId}/messages/${messageId}`, { content });
      setLiveMessages((previous) => previous.map((message) => message.id === messageId ? {
        ...message,
        content,
        editedAt: new Date().toISOString(),
        editCount: (message.editCount || 0) + 1,
      } : message));
      setEditingMessageId(null); setEditingContent('');
    } catch (err) {
      toast.error(err.response?.data?.error || t('support.escalation.editError', { defaultValue: 'This message can no longer be edited.' }));
    } finally { setLiveSending(false); }
  };

  const handleLiveInputChange = (event) => {
    const value = event.target.value;
    setLiveInput(value);
    if (!ticketId || ['resolved', 'closed'].includes(conversationStatus)) return;
    socketRef.current?.emit('customer:typing', { ticketId, isTyping: Boolean(value.trim()) });
    window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => {
      socketRef.current?.emit('customer:typing', { ticketId, isTyping: false });
    }, 1500);
  };

  const reopenConversation = async () => {
    if (!ticketId || conversationStatus !== 'resolved' || reopenBusy) return;
    setReopenBusy(true);
    try {
      const response = await api.post(`/support/conversations/${ticketId}/reopen`);
      setConversationStatus(response.data.data?.status || 'open');
      setWaiting(null);
    } catch (err) {
      toast.error(err.response?.data?.error || t('support.escalation.reopenError', { defaultValue: 'Could not reopen this conversation.' }));
    } finally { setReopenBusy(false); }
  };

  const submitConversationReview = async (event) => {
    event.preventDefault();
    if (!ticketId || !reviewRating) return;
    setReviewBusy(true);
    try {
      const response = await api.post(`/support/conversations/${ticketId}/review`, { rating: reviewRating, comment: reviewComment });
      setReview(response.data.data); setReviewComment('');
    } catch (err) {
      toast.error(err.response?.data?.error || t('support.escalation.reviewError', { defaultValue: 'Could not save your review.' }));
    } finally { setReviewBusy(false); }
  };

  const handleSubmitTicket = async (event) => {
    event.preventDefault();
    if (!visitorName.trim() || !visitorEmail.trim() || !ticketMessage.trim()) {
      toast.error(t('support.escalation.ticketError', { defaultValue: 'Please complete the required escalation fields.' }));
      return;
    }

    setTicketSubmitting(true);
    try {
      const response = ticketId
        ? await api.post(`/support/conversations/${ticketId}/message`, { message: ticketMessage })
        : await api.post('/support-routing/conversations', {
          customerId: user.id,
          visitorEmail,
          visitorName,
          message: ticketMessage,
          category: 'support_request',
          priority: 'normal',
        });

      localStorage.setItem('oxs:visitorName', visitorName);
      localStorage.setItem('oxs:visitorEmail', visitorEmail);

      setSuccessTicketId(ticketId || response.data.ticketId);
      setPhase('success');
    } catch (err) {
      console.error('Ticket error:', err);
      toast.error(t('support.escalation.ticketError'));
    } finally {
      setTicketSubmitting(false);
    }
  };

  const waitRemainingSeconds = waiting?.localDeadline
    ? Math.max(0, Math.ceil((waiting.localDeadline - now) / 1000))
    : 0;

  const handleClose = () => {
    if (socketRef.current) socketRef.current.disconnect();
    navigate(-1);
  };

  const supportModeLabel = connectionState === 'connected'
    ? t('support.escalation.connected', { defaultValue: 'Connected' })
    : connectionState === 'queued'
      ? t('support.escalation.queued', { defaultValue: 'Queued' })
      : t('support.escalation.matching', { defaultValue: 'Matching' });
  const supportPartyName = assignedAgent?.name
    || (connectionState === 'queued'
      ? t('support.escalation.queueName', { defaultValue: 'Support queue' })
      : t('support.escalation.agentWaiting'));
  const supportConnectionText = connectionState === 'connected'
    ? t('support.escalation.connectedStatus', { defaultValue: 'Conversation ready' })
    : connectionState === 'queued'
      ? t('support.escalation.queuedStatus', { defaultValue: 'Waiting for the next available specialist' })
      : t('support.escalation.preparingStatus', { defaultValue: 'Preparing your secure conversation' });
  const emptyConversationText = connectionState === 'queued'
    ? t('support.escalation.queuedDescription', { defaultValue: 'Send your issue now. It will be waiting for the specialist who accepts your conversation.' })
    : t('support.escalation.readyDescription', { defaultValue: 'Send the first message so the specialist sees the issue context immediately.' });

  const PageFrame = ({ children }) => (
    <div
      className="min-h-[calc(100vh-140px)]"
      style={{
        background:
          'radial-gradient(circle at top left, rgba(249,115,22,0.12), transparent 24%), radial-gradient(circle at top right, rgba(59,130,246,0.12), transparent 22%), linear-gradient(180deg, #07101c 0%, #040811 100%)',
      }}
    >
      <div className="max-w-6xl mx-auto px-4 py-8 md:py-10">{children}</div>
    </div>
  );

  const Hero = ({ eyebrow, title, body, right }) => (
    <section
      className="rounded-[28px] border p-6 md:p-8 shadow-2xl mb-6"
      style={{
        borderColor: 'rgba(148,163,184,0.16)',
        background:
          'linear-gradient(180deg, rgba(15,23,42,0.92), rgba(8,13,23,0.96))',
      }}
    >
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.25fr)_320px] gap-6 items-start">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-[0.12em] mb-4 text-orange-300 bg-orange-500/10 border border-orange-500/20">
            <Sparkles size={13} />
            {eyebrow}
          </div>
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-white mb-3">{title}</h1>
          <p className="text-slate-300 text-base md:text-lg leading-7 max-w-3xl">{body}</p>
        </div>
        {right}
      </div>
    </section>
  );

  const SideCard = ({ icon: Icon, title, children, tint = 'text-slate-300' }) => (
    <div className="rounded-3xl border p-5" style={{ borderColor: 'rgba(148,163,184,0.16)', background: 'rgba(15,23,42,0.72)' }}>
      <div className={`flex items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] mb-3 ${tint}`}>
        <Icon size={14} />
        {title}
      </div>
      {children}
    </div>
  );

  const StatPill = ({ icon: Icon, label, value }) => (
    <div className="rounded-2xl border px-4 py-3" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(255,255,255,0.03)' }}>
      <div className="flex items-center gap-2 text-slate-400 text-[11px] font-bold uppercase tracking-[0.08em]">
        <Icon size={13} />
        {label}
      </div>
      <div className="text-white font-bold text-xl mt-1">{value}</div>
    </div>
  );

  return (
    <>
      <PageMeta
        title={t('support.escalation.pageTitle')}
        description={t('support.escalation.pageDesc')}
      />
      <Navbar />

      <main className="flex-1 support-escalation-page">
        {phase === 'checking' && (
          <PageFrame>
            <Hero
              eyebrow={t('support.escalation.eyebrow')}
              title={t('support.escalation.checking', { defaultValue: 'Checking specialist availability' })}
              body={t('support.escalation.checkingDesc', { defaultValue: 'We are checking whether a live support specialist is available right now or whether we should route this into a priority support ticket.' })}
              right={(
                <div className="rounded-3xl border p-5" style={{ borderColor: 'rgba(148,163,184,0.16)', background: 'rgba(255,255,255,0.03)' }}>
                  <div className="w-16 h-16 bg-orange-500/20 rounded-full flex items-center justify-center mb-4">
                    <div className="w-10 h-10 border-4 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
                  </div>
                  <p className="text-white font-semibold">{t('support.escalation.routingTitle')}</p>
                  <p className="text-slate-400 text-sm mt-2 leading-6">
                    {t('support.escalation.routingBody')}
                  </p>
                </div>
              )}
            />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatPill icon={Users} label={t('support.escalation.availableForLiveChat', { defaultValue: 'Available for live chat' })} value={agentsOnline} />
              <StatPill icon={Clock} label={t('support.escalation.escalationMode')} value={t('support.escalation.autoRoute')} />
              <StatPill icon={ShieldCheck} label={t('support.escalation.coverage')} value={t('support.escalation.liveOrTicket')} />
            </div>
          </PageFrame>
        )}

        {phase === 'live-chat' && (
          <PageFrame>
            <Hero
              eyebrow={connectionState === 'queued' ? t('support.liveWait.title') : t('support.escalation.liveEyebrow')}
              title={connectionState === 'queued' ? t('support.liveWait.title') : t('support.escalation.liveTitle')}
              body={connectionState === 'queued' ? t('support.liveWait.body') : t('support.escalation.liveBody')}
              right={(
                <div className="grid gap-3">
                  <StatPill icon={Users} label={t('support.escalation.availableForLiveChat', { defaultValue: 'Available for live chat' })} value={agentsOnline} />
                  <StatPill icon={MessageSquare} label={t('support.escalation.conversationType')} value={t('support.escalation.liveChat')} />
                  <StatPill icon={ShieldCheck} label={t('support.escalation.supportMode')} value={supportModeLabel} />
                </div>
              )}
            />

            {connectionState === 'queued' && (
              <section className="mb-6 rounded-3xl border border-orange-500/25 bg-orange-500/10 p-5 text-white" role="status">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">{t('support.liveWait.title')}</h2>
                    <p className="mt-1 text-sm text-slate-300">{t('support.liveWait.body')}</p>
                  </div>
                  <div className="text-3xl font-bold tabular-nums text-orange-300" role="timer" aria-label={t('support.liveWait.title')}>
                    {Math.floor(waitRemainingSeconds / 60)}:{String(waitRemainingSeconds % 60).padStart(2, '0')}
                  </div>
                </div>
              </section>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
              <section className="rounded-[28px] border overflow-hidden shadow-2xl" style={{ borderColor: 'rgba(148,163,184,0.16)', background: 'rgba(15,23,42,0.82)' }}>
                <div className="px-6 py-4 border-b border-slate-700/70 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${connectionState === 'connected' ? 'bg-green-400' : 'bg-orange-400 animate-pulse'}`} />
                    <div>
                      <p className="text-white font-semibold">
                        {supportPartyName}
                      </p>
                      <p className="text-slate-400 text-xs">
                        {supportConnectionText}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {conversationStatus === 'resolved' && <button type="button" onClick={reopenConversation} disabled={reopenBusy} className="inline-flex items-center gap-2 rounded-xl border border-orange-500/40 px-3 py-2 text-sm text-orange-200 hover:border-orange-400 disabled:opacity-50">{reopenBusy ? t('support.escalation.reopening', { defaultValue: 'Reopening…' }) : t('support.escalation.reopen', { defaultValue: 'Reopen conversation' })}</button>}
                    <button type="button" onClick={downloadConversation} disabled={downloadBusy || !ticketId} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:border-orange-500 disabled:opacity-50">
                      <Download size={16} />{downloadBusy ? t('support.escalation.downloading', { defaultValue: 'Preparing…' }) : t('support.escalation.download', { defaultValue: 'Download' })}
                    </button>
                  </div>
                  <button
                    onClick={handleClose}
                    className="p-2 text-slate-500 hover:text-white rounded-xl hover:bg-slate-800 transition"
                    aria-label={t('common.close')}
                  >
                    <X size={20} />
                  </button>
                </div>

                <div
                  ref={messageListRef}
                  onScroll={(event) => {
                    const element = event.currentTarget;
                    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
                    stickToBottomRef.current = nearBottom;
                    if (nearBottom) setShowNewMessages(false);
                  }}
                  className="h-[520px] overflow-y-auto px-6 py-5 space-y-4 bg-slate-950/30"
                >
                  {showNewMessages && <button type="button" onClick={() => { stickToBottomRef.current = true; setShowNewMessages(false); messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight, behavior: 'smooth' }); }} className="sticky top-2 z-10 mx-auto block rounded-full border border-orange-500/40 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-orange-200 shadow-lg">{t('support.escalation.newMessages', { defaultValue: 'New messages' })} ↓</button>}
                  {liveMessages.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-center">
                      <div>
                        <p className="text-slate-300 font-medium">{t('support.escalation.noMessages')}</p>
                        <p className="text-slate-500 text-sm mt-2">{emptyConversationText}</p>
                        {ticketId && (
                          <p className="text-slate-600 text-xs mt-3">#{ticketId}</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    liveMessages.map((msg, idx) => {
                      const isCustomerMessage = msg.sender.type === 'customer';
                      const canEdit = isCustomerMessage && msg.content && !['resolved', 'closed'].includes(conversationStatus)
                        && Date.now() - new Date(msg.timestamp).getTime() < 15 * 60 * 1000;
                      return <div key={msg.id || idx} className={`flex ${isCustomerMessage ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-md px-4 py-3 rounded-2xl ${
                            msg.sender.type === 'customer'
                              ? 'bg-orange-600 text-white'
                              : msg.sender.type === 'system'
                              ? 'bg-slate-800 text-slate-300 italic'
                              : 'bg-slate-800 text-slate-100'
                          }`}
                        >
                          {msg.attachmentUrl && <img src={msg.attachmentUrl} alt={msg.attachmentName || 'Support attachment'} className="mb-2 max-h-64 max-w-full rounded-xl object-contain" />}
                          {editingMessageId === msg.id ? <div className="space-y-2"><textarea value={editingContent} onChange={(event) => setEditingContent(event.target.value)} maxLength={5000} rows={3} className="w-full rounded-xl bg-slate-900 px-3 py-2 text-white" /><div className="flex gap-2"><button type="button" onClick={() => editCustomerMessage(msg.id)} disabled={liveSending || !editingContent.trim()} className="rounded-lg bg-white/20 px-3 py-1.5 text-xs font-semibold">{t('common.save', { defaultValue: 'Save' })}</button><button type="button" onClick={() => setEditingMessageId(null)} className="rounded-lg px-3 py-1.5 text-xs text-white/70">{t('common.cancel', { defaultValue: 'Cancel' })}</button></div></div> : <>{msg.content && <p className="break-words leading-6 whitespace-pre-wrap">{msg.content}</p>}{msg.editedAt && <span className="mt-2 block text-xs opacity-70">{t('support.escalation.edited', { defaultValue: 'Edited' })}</span>}{canEdit && <button type="button" onClick={() => { setEditingMessageId(msg.id); setEditingContent(msg.content); }} className="mt-2 inline-flex items-center gap-1 text-xs opacity-75 hover:opacity-100"><Pencil size={12} />{t('support.escalation.edit', { defaultValue: 'Edit' })}</button>}</>}
                          {msg.readByRecipient && msg.sender.type === 'customer' && <span className="mt-2 block text-right text-[11px] opacity-70">{t('support.escalation.read', { defaultValue: 'Read' })}</span>}
                          {msg.timestamp && (
                            <span className="text-xs opacity-70 mt-2 block">
                              {new Date(msg.timestamp).toLocaleTimeString(i18n.language || 'en', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          )}
                        </div>
                      </div>;
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {['resolved', 'closed'].includes(conversationStatus) && <div className="px-6 pt-4"><ConversationReviewForm t={t} review={review} rating={reviewRating} setRating={setReviewRating} comment={reviewComment} setComment={setReviewComment} busy={reviewBusy} onSubmit={submitConversationReview} /></div>}
                {agentTyping && <p className="px-6 pt-3 text-xs text-slate-400" role="status">{t('support.escalation.agentTyping', { defaultValue: 'A support agent is typing…' })}</p>}
                {liveFile && <div className="px-6 pt-3 text-sm text-orange-200">{liveFile.name}</div>}
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleSendLiveMessage();
                  }}
                  className="px-6 py-4 border-t border-slate-700/70 flex gap-3 bg-slate-900/70"
                >
                  <label className="cursor-pointer rounded-2xl border border-slate-700 px-3 py-3 text-slate-300 hover:border-orange-500" title={t('support.escalation.attachImage', { defaultValue: 'Attach image' })}>
                    <Paperclip size={20} />
                    <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" onChange={(event) => setLiveFile(event.target.files?.[0] || null)} />
                  </label>
                  <input
                    type="text"
                    value={liveInput}
                    onChange={handleLiveInputChange}
                    placeholder={t('support.escalation.messagePlaceholder')}
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 transition"
                    disabled={liveSending || !ticketId || ['resolved', 'closed'].includes(conversationStatus)}
                  />
                  <button
                    type="submit"
                    disabled={liveSending || !ticketId || ['resolved', 'closed'].includes(conversationStatus) || (!liveInput.trim() && !liveFile)}
                    className="bg-orange-600 hover:bg-orange-700 text-white p-3 rounded-2xl transition disabled:opacity-50 flex-shrink-0"
                    aria-label={t('common.send')}
                  >
                    <Send size={20} />
                  </button>
                </form>
              </section>

              <div className="grid gap-4">
                <SideCard icon={ShieldCheck} title={t('support.escalation.bestUseTitle')} tint="text-orange-300">
                  <ul className="text-slate-300 text-sm leading-7 pl-5 list-disc">
                    <li>{t('support.escalation.bestUsePayment')}</li>
                    <li>{t('support.escalation.bestUseSafety')}</li>
                    <li>{t('support.escalation.bestUseUrgent')}</li>
                  </ul>
                </SideCard>

                <SideCard icon={FileText} title={t('support.escalation.fasterTitle')} tint="text-sky-300">
                  <ul className="text-slate-400 text-sm leading-7 pl-5 list-disc">
                    <li>{t('support.escalation.fasterIssue')}</li>
                    <li>{t('support.escalation.fasterIdentifiers')}</li>
                    <li>{t('support.escalation.fasterHistory')}</li>
                  </ul>
                </SideCard>
              </div>
            </div>
          </PageFrame>
        )}

        {phase === 'ticket' && (
          <PageFrame>
            <Hero
              eyebrow={t('support.escalation.ticketEyebrow')}
              title={t('support.escalation.noAgentsTitle')}
              body={t('support.escalation.noAgentsMessage')}
              right={(
                <div className="grid gap-3">
                  <StatPill icon={Users} label={t('support.escalation.availableForLiveChat', { defaultValue: 'Available for live chat' })} value={agentsOnline} />
                  <StatPill icon={Clock} label={t('support.escalation.routingMode')} value={t('support.escalation.ticketFallback')} />
                  <StatPill icon={Mail} label={t('support.escalation.responseChannel')} value={t('support.escalation.emailUpdates')} />
                </div>
              )}
            />

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
              <section className="rounded-[28px] border p-6 md:p-8 shadow-2xl" style={{ borderColor: 'rgba(148,163,184,0.16)', background: 'rgba(15,23,42,0.82)' }}>
                <div className="flex items-start gap-4 p-5 rounded-3xl border mb-6" style={{ borderColor: 'rgba(249,115,22,0.24)', background: 'rgba(249,115,22,0.08)' }}>
                  <AlertCircle className="text-orange-400 flex-shrink-0 mt-1" size={24} />
                  <div>
                    <h2 className="text-white font-semibold text-lg mb-2">{t('support.escalation.ticketFormTitle')}</h2>
                    <p className="text-slate-300 leading-7">{t('support.escalation.ticketCTA')}</p>
                  </div>
                </div>

                <form onSubmit={handleSubmitTicket} className="space-y-5">
                  <div>
                    <label className="block text-slate-300 text-sm font-medium mb-2">
                      {t('support.escalation.nameLabel')} <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={visitorName}
                      readOnly
                      placeholder={t('support.escalation.namePlaceholder')}
                      className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 transition"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 text-sm font-medium mb-2">
                      {t('support.escalation.emailLabel')} <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      value={visitorEmail}
                      readOnly
                      placeholder={t('support.escalation.emailPlaceholder')}
                      className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 transition"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 text-sm font-medium mb-2">
                      {t('support.escalation.messageLabel')} <span className="text-red-400">*</span>
                    </label>
                    <textarea
                      required
                      value={ticketMessage}
                      onChange={(event) => setTicketMessage(event.target.value)}
                      maxLength={5000}
                      placeholder={t('support.escalation.messagePlaceholder')}
                      rows={7}
                      className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 transition resize-none"
                    />
                    <p className="text-slate-500 text-xs mt-2">
                      {ticketMessage.length}/5000 {t('common.characters')}
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={ticketSubmitting}
                    className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3.5 rounded-2xl transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {ticketSubmitting ? (
                      <>
                        <span className="inline-block animate-spin mr-2">⏳</span>
                        {t('common.sending')}
                      </>
                    ) : (
                      t('support.escalation.submitButton')
                    )}
                  </button>
                </form>

                <button
                  onClick={handleClose}
                  className="w-full mt-4 px-4 py-3 text-slate-400 hover:text-slate-200 rounded-2xl border border-slate-700 hover:border-slate-600 transition"
                >
                  {t('common.close')}
                </button>
              </section>

              <div className="grid gap-4">
                <SideCard icon={Phone} title={t('support.escalation.directContactTitle', { defaultValue: 'Need a faster response?' })} tint="text-orange-300">
                  <p className="text-slate-300 text-sm leading-6">
                    {t('support.escalation.directContactBody', { defaultValue: 'When no specialist is available, call or text OxSteed Support directly.' })}
                  </p>
                  <div className="grid grid-cols-2 gap-2 mt-4">
                    <a
                      href="tel:+19374085169"
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-600 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-700"
                    >
                      <Phone size={15} />
                      {t('support.escalation.callSupport', { defaultValue: 'Call' })}
                    </a>
                    <a
                      href="sms:+19374085169"
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-3 py-2.5 text-sm font-semibold text-white transition hover:border-orange-500"
                    >
                      <MessageSquare size={15} />
                      {t('support.escalation.textSupport', { defaultValue: 'Text' })}
                    </a>
                  </div>
                  <a href="tel:+19374085169" className="block mt-3 text-center text-orange-300 text-sm font-semibold hover:text-orange-200">
                    {OXSTEED_SUPPORT_PHONE}
                  </a>
                </SideCard>
                <SideCard icon={ShieldCheck} title={t('support.escalation.afterSubmitTitle')} tint="text-orange-300">
                  <ul className="text-slate-300 text-sm leading-7 pl-5 list-disc">
                    <li>{t('support.escalation.afterSubmitTracked')}</li>
                    <li>{t('support.escalation.afterSubmitEmail')}</li>
                    <li>{t('support.escalation.afterSubmitIdentifier')}</li>
                  </ul>
                </SideCard>

                <SideCard icon={FileText} title={t('support.escalation.includeTitle')} tint="text-sky-300">
                  <ul className="text-slate-400 text-sm leading-7 pl-5 list-disc">
                    <li>{t('support.escalation.includeWhat')}</li>
                    <li>{t('support.escalation.includeIds')}</li>
                    <li>{t('support.escalation.includeWhy')}</li>
                  </ul>
                </SideCard>
              </div>
            </div>
          </PageFrame>
        )}

        {phase === 'success' && (
          <PageFrame>
            <div className="max-w-2xl mx-auto">
              <section
                className="rounded-[32px] border p-8 text-center shadow-2xl"
                style={{
                  borderColor: 'rgba(52,211,153,0.22)',
                  background:
                    'radial-gradient(circle at top, rgba(52,211,153,0.12), transparent 24%), linear-gradient(180deg, rgba(15,23,42,0.92), rgba(8,13,23,0.96))',
                }}
              >
                <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="text-green-400" size={32} />
                </div>
                <h2 className="text-white font-semibold text-3xl mb-3">
                  {t('support.escalation.successTitle')}
                </h2>
                <p className="text-slate-300 mb-3 leading-7">
                  {t('support.escalation.successMessage', { ticketId: successTicketId })}
                </p>
                <p className="text-slate-500 text-sm mb-8">
                  {t('support.escalation.successNextSteps')}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-8 text-left">
                  <StatPill icon={FileText} label={t('support.escalation.ticketIdLabel')} value={successTicketId || '—'} />
                  <StatPill icon={Mail} label={t('support.escalation.followUp')} value={t('support.escalation.email')} />
                  <StatPill icon={ShieldCheck} label={t('support.escalation.statusLabel')} value={t('support.escalation.escalated')} />
                </div>

                <button
                  onClick={handleClose}
                  className="inline-flex items-center justify-center gap-2 w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3 rounded-2xl transition"
                >
                  {t('common.close')}
                  <ArrowRight size={16} />
                </button>
              </section>
            </div>
          </PageFrame>
        )}
      </main>

      <Footer />
    </>
  );
}
