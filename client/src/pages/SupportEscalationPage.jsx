import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle,
  Clock,
  FileText,
  Mail,
  MessageSquare,
  Phone,
  Send,
  ShieldCheck,
  Sparkles,
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
import './SupportEscalationPage.css';

const OXSTEED_SUPPORT_PHONE = '+1 (937) 408-5169';

function normalizeSupportMessages(messages = []) {
  return messages.map((message) => ({
    id: message.id,
    sender: { type: message.is_agent ? 'agent' : 'customer' },
    content: message.content,
    timestamp: message.created_at,
  }));
}

export default function SupportEscalationPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [phase, setPhase] = useState('checking'); // 'checking' | 'live-chat' | 'ticket' | 'success'
  const [agentsOnline, setAgentsOnline] = useState(0);
  const [ticketId, setTicketId] = useState(null);
  const [liveMessages, setLiveMessages] = useState([]);
  const [liveInput, setLiveInput] = useState('');
  const [liveSending, setLiveSending] = useState(false);
  const [assignedAgent, setAssignedAgent] = useState(null);
  const [connectionState, setConnectionState] = useState('checking');
  const [visitorName, setVisitorName] = useState(localStorage.getItem('oxs:visitorName') || '');
  const [visitorEmail, setVisitorEmail] = useState(localStorage.getItem('oxs:visitorEmail') || '');
  const [ticketMessage, setTicketMessage] = useState('');
  const [ticketSubmitting, setTicketSubmitting] = useState(false);
  const [successTicketId, setSuccessTicketId] = useState(null);

  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);
  const ticketIdRef = useRef(null);

  useEffect(() => {
    ticketIdRef.current = ticketId;
  }, [ticketId]);

  useEffect(() => {
    let active = true;
    const socket = io(realtimeNamespaceUrl('support'), {
      transports: ['websocket', 'polling'],
      reconnection: true,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('customer:join', {
        userId: localStorage.getItem('userId'),
        visitorEmail: localStorage.getItem('oxs:visitorEmail'),
        visitorName: localStorage.getItem('oxs:visitorName'),
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
      const { ticketId: messageTicketId, sender, content, timestamp } = data;
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
            timestamp,
          },
        ];
      });
    });

    const connect = async () => {
      try {
        const statusResponse = await api.get('/support-routing/status');
        if (!active) return;
        const onlineCount = statusResponse.data.agents || 0;
        setAgentsOnline(onlineCount);
        if (onlineCount < 1) {
          setPhase('ticket');
          setConnectionState('offline');
          return;
        }

        setPhase('live-chat');
        setConnectionState('connecting');
        const response = await api.post('/support-routing/connect');
        if (!active) return;

        const nextTicketId = response.data.ticketId;
        ticketIdRef.current = nextTicketId;
        setTicketId(nextTicketId);
        setAssignedAgent(response.data.assignedAgent || null);
        setLiveMessages(normalizeSupportMessages(response.data.messages));
        setConnectionState(response.data.routedTo === 'agent' ? 'connected' : 'queued');
        socket.emit('ticket:join', {
          ticketId: nextTicketId,
          userId: localStorage.getItem('userId'),
        });
      } catch (err) {
        console.error('Failed to establish live support session:', err);
        if (active) {
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
  }, []);

  useEffect(() => {
    if (!ticketId) return undefined;

    let active = true;
    const syncConversation = async () => {
      try {
        const response = await api.get(`/support/conversations/${ticketId}`);
        if (!active) return;
        const conversation = response.data.data;
        setLiveMessages(normalizeSupportMessages(conversation.messages));
        if (conversation.agent_id) {
          setAssignedAgent({
            id: conversation.agent_id,
            name: conversation.agent_name || t('support.escalation.specialistFallback'),
          });
          setConnectionState('connected');
        } else if (conversation.status === 'waiting_for_agent') {
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
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [liveMessages]);

  const handleSendLiveMessage = useCallback(async () => {
    const content = liveInput.trim();
    if (!content || !ticketId) return;

    setLiveSending(true);
    try {
      const response = await api.post(`/support/conversations/${ticketId}/message`, { message: content });

      setLiveMessages((prev) => [
        ...prev,
        {
          id: response.data.data?.id || `customer-${Date.now()}`,
          sender: { type: 'customer' },
          content,
          timestamp: response.data.data?.created_at || new Date().toISOString(),
        },
      ]);
      setLiveInput('');
    } catch (err) {
      console.error('Live support message failed:', err);
      toast.error(t('support.escalation.ticketError', { defaultValue: 'Could not send your support message.' }));
    } finally {
      setLiveSending(false);
    }
  }, [liveInput, ticketId, t]);

  const handleSubmitTicket = async (event) => {
    event.preventDefault();
    if (!visitorName.trim() || !visitorEmail.trim() || !ticketMessage.trim()) {
      toast.error(t('support.escalation.ticketError', { defaultValue: 'Please complete the required escalation fields.' }));
      return;
    }

    setTicketSubmitting(true);
    try {
      const response = await api.post('/support-routing/conversations', {
        customerId: localStorage.getItem('userId'),
        visitorEmail,
        visitorName,
        message: ticketMessage,
        category: 'support_request',
        priority: 'normal',
      });

      localStorage.setItem('oxs:visitorName', visitorName);
      localStorage.setItem('oxs:visitorEmail', visitorEmail);

      setSuccessTicketId(response.data.ticketId);
      setPhase('success');
    } catch (err) {
      console.error('Ticket error:', err);
      toast.error(t('support.escalation.ticketError'));
    } finally {
      setTicketSubmitting(false);
    }
  };

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
              <StatPill icon={Users} label={t('support.escalation.agentsOnline')} value={agentsOnline} />
              <StatPill icon={Clock} label={t('support.escalation.escalationMode')} value={t('support.escalation.autoRoute')} />
              <StatPill icon={ShieldCheck} label={t('support.escalation.coverage')} value={t('support.escalation.liveOrTicket')} />
            </div>
          </PageFrame>
        )}

        {phase === 'live-chat' && (
          <PageFrame>
            <Hero
              eyebrow={t('support.escalation.liveEyebrow')}
              title={t('support.escalation.liveTitle')}
              body={t('support.escalation.liveBody')}
              right={(
                <div className="grid gap-3">
                  <StatPill icon={Users} label={t('support.escalation.agentsOnline')} value={agentsOnline} />
                  <StatPill icon={MessageSquare} label={t('support.escalation.conversationType')} value={t('support.escalation.liveChat')} />
                  <StatPill icon={ShieldCheck} label={t('support.escalation.supportMode')} value={supportModeLabel} />
                </div>
              )}
            />

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
                  <button
                    onClick={handleClose}
                    className="p-2 text-slate-500 hover:text-white rounded-xl hover:bg-slate-800 transition"
                    aria-label={t('common.close')}
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="h-[520px] overflow-y-auto px-6 py-5 space-y-4 bg-slate-950/30">
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
                    liveMessages.map((msg, idx) => (
                      <div key={idx} className={`flex ${msg.sender.type === 'customer' ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-md px-4 py-3 rounded-2xl ${
                            msg.sender.type === 'customer'
                              ? 'bg-orange-600 text-white'
                              : msg.sender.type === 'system'
                              ? 'bg-slate-800 text-slate-300 italic'
                              : 'bg-slate-800 text-slate-100'
                          }`}
                        >
                          <p className="break-words leading-6">{msg.content}</p>
                          {msg.timestamp && (
                            <span className="text-xs opacity-70 mt-2 block">
                              {new Date(msg.timestamp).toLocaleTimeString(i18n.language || 'en', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleSendLiveMessage();
                  }}
                  className="px-6 py-4 border-t border-slate-700/70 flex gap-3 bg-slate-900/70"
                >
                  <input
                    type="text"
                    value={liveInput}
                    onChange={(event) => setLiveInput(event.target.value)}
                    placeholder={t('support.escalation.messagePlaceholder')}
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 transition"
                    disabled={liveSending || !ticketId}
                  />
                  <button
                    type="submit"
                    disabled={liveSending || !ticketId || !liveInput.trim()}
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
                  <StatPill icon={Users} label={t('support.escalation.agentsOnline')} value={agentsOnline} />
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
                      onChange={(event) => {
                        setVisitorName(event.target.value);
                        localStorage.setItem('oxs:visitorName', event.target.value);
                      }}
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
                      onChange={(event) => {
                        setVisitorEmail(event.target.value);
                        localStorage.setItem('oxs:visitorEmail', event.target.value);
                      }}
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
                      placeholder={t('support.escalation.messagePlaceholder')}
                      rows={7}
                      className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 transition resize-none"
                    />
                    <p className="text-slate-500 text-xs mt-2">
                      {ticketMessage.length}/2000 {t('common.characters')}
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
