import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle,
  Clock,
  FileText,
  Mail,
  MessageSquare,
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
import './SupportEscalationPage.css';

export default function SupportEscalationPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [phase, setPhase] = useState('checking'); // 'checking' | 'live-chat' | 'ticket' | 'success'
  const [agentsOnline, setAgentsOnline] = useState(0);
  const [ticketId, setTicketId] = useState(null);
  const [liveMessages, setLiveMessages] = useState([]);
  const [liveInput, setLiveInput] = useState('');
  const [liveSending, setLiveSending] = useState(false);
  const [assignedAgent, setAssignedAgent] = useState(null);
  const [visitorName, setVisitorName] = useState(localStorage.getItem('oxs:visitorName') || '');
  const [visitorEmail, setVisitorEmail] = useState(localStorage.getItem('oxs:visitorEmail') || '');
  const [ticketMessage, setTicketMessage] = useState('');
  const [ticketSubmitting, setTicketSubmitting] = useState(false);
  const [successTicketId, setSuccessTicketId] = useState(null);

  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    const checkAvailability = async () => {
      try {
        const response = await api.get('/support-routing/status');
        const onlineCount = response.data.agents || 0;
        setAgentsOnline(onlineCount);

        if (onlineCount > 0) {
          setPhase('live-chat');
          initiateLiveChat();
        } else {
          setPhase('ticket');
        }
      } catch (err) {
        console.error('Failed to check agent availability:', err);
        setPhase('ticket');
      }
    };

    checkAvailability();
  }, []);

  const initiateLiveChat = useCallback(async () => {
    try {
      const socket = io(window.location.origin, {
        transports: ['websocket', 'polling'],
        reconnection: true,
      });

      socket.on('connect', () => {
        socket.emit('customer:join', {
          userId: localStorage.getItem('userId'),
          visitorEmail: localStorage.getItem('oxs:visitorEmail'),
        });

        setLiveMessages([
          {
            id: `system-connected-${Date.now()}`,
            sender: { type: 'system' },
            content: t('support.escalation.connecting', { defaultValue: 'Connecting you to the next available support specialist…' }),
            timestamp: new Date().toISOString(),
          },
        ]);
      });

      socket.on('ticket:assigned', (data) => {
        const { ticketId: nextTicketId, agentName } = data;
        setTicketId(nextTicketId);
        setAssignedAgent({ name: agentName });
        setLiveMessages((prev) => [
          ...prev,
          {
            id: `system-assigned-${Date.now()}`,
            sender: { type: 'system' },
            content: `Connected with ${agentName}.`,
            timestamp: new Date().toISOString(),
          },
        ]);
      });

      socket.on('message:new', (data) => {
        const { ticketId: msgTicketId, sender, content, timestamp } = data;
        if (msgTicketId === ticketId && sender.type === 'agent') {
          setLiveMessages((prev) => [
            ...prev,
            {
              id: `agent-${Date.now()}`,
              sender,
              content,
              timestamp,
            },
          ]);
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        }
      });

      socketRef.current = socket;
    } catch (err) {
      console.error('Failed to initiate live chat:', err);
      setPhase('ticket');
    }
  }, [ticketId, t]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [liveMessages]);

  const handleSendLiveMessage = useCallback(() => {
    if (!liveInput.trim() || !ticketId) return;

    socketRef.current?.emit('message:send', {
      ticketId,
      content: liveInput.trim(),
      timestamp: new Date().toISOString(),
    });

    setLiveMessages((prev) => [
      ...prev,
      {
        id: `customer-${Date.now()}`,
        sender: { type: 'customer' },
        content: liveInput.trim(),
        timestamp: new Date().toISOString(),
      },
    ]);
    setLiveInput('');
    setLiveSending(false);
  }, [liveInput, ticketId]);

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
              eyebrow="Support escalation"
              title={t('support.escalation.checking', { defaultValue: 'Checking specialist availability' })}
              body={t('support.escalation.checkingDesc', { defaultValue: 'We are checking whether a live support specialist is available right now or whether we should route this into a priority support ticket.' })}
              right={(
                <div className="rounded-3xl border p-5" style={{ borderColor: 'rgba(148,163,184,0.16)', background: 'rgba(255,255,255,0.03)' }}>
                  <div className="w-16 h-16 bg-orange-500/20 rounded-full flex items-center justify-center mb-4">
                    <div className="w-10 h-10 border-4 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
                  </div>
                  <p className="text-white font-semibold">Routing your escalation</p>
                  <p className="text-slate-400 text-sm mt-2 leading-6">
                    We prioritize fast human help for safety, payment, and time-sensitive support issues.
                  </p>
                </div>
              )}
            />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatPill icon={Users} label="Agents online" value={agentsOnline} />
              <StatPill icon={Clock} label="Escalation mode" value="Auto-route" />
              <StatPill icon={ShieldCheck} label="Coverage" value="Live or ticket" />
            </div>
          </PageFrame>
        )}

        {phase === 'live-chat' && (
          <PageFrame>
            <Hero
              eyebrow="Live escalation"
              title="Talk to a support specialist now."
              body="A live support specialist is available. Stay on this page to continue the escalation conversation and keep the issue attached to your support history."
              right={(
                <div className="grid gap-3">
                  <StatPill icon={Users} label="Agents online" value={agentsOnline} />
                  <StatPill icon={MessageSquare} label="Conversation type" value="Live chat" />
                  <StatPill icon={ShieldCheck} label="Support mode" value={assignedAgent ? 'Connected' : 'Matching'} />
                </div>
              )}
            />

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
              <section className="rounded-[28px] border overflow-hidden shadow-2xl" style={{ borderColor: 'rgba(148,163,184,0.16)', background: 'rgba(15,23,42,0.82)' }}>
                <div className="px-6 py-4 border-b border-slate-700/70 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse" />
                    <div>
                      <p className="text-white font-semibold">
                        {assignedAgent ? assignedAgent.name : t('support.escalation.agentWaiting')}
                      </p>
                      <p className="text-slate-400 text-xs">
                        {assignedAgent ? t('support.escalation.agentOnline') : t('support.escalation.connecting')}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleClose}
                    className="p-2 text-slate-500 hover:text-white rounded-xl hover:bg-slate-800 transition"
                    aria-label="Close"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="h-[520px] overflow-y-auto px-6 py-5 space-y-4 bg-slate-950/30">
                  {liveMessages.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-center">
                      <div>
                        <p className="text-slate-300 font-medium">{t('support.escalation.noMessages')}</p>
                        <p className="text-slate-500 text-sm mt-2">Send the first message so the specialist sees the issue context immediately.</p>
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
                              {new Date(msg.timestamp).toLocaleTimeString([], {
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
                    setLiveSending(true);
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
                    disabled={liveSending}
                  />
                  <button
                    type="submit"
                    disabled={liveSending || !liveInput.trim()}
                    className="bg-orange-600 hover:bg-orange-700 text-white p-3 rounded-2xl transition disabled:opacity-50 flex-shrink-0"
                    aria-label="Send"
                  >
                    <Send size={20} />
                  </button>
                </form>
              </section>

              <div className="grid gap-4">
                <SideCard icon={ShieldCheck} title="Best use of escalation" tint="text-orange-300">
                  <ul className="text-slate-300 text-sm leading-7 pl-5 list-disc">
                    <li>Payment or refund problems that need a human decision.</li>
                    <li>Safety or trust issues that should not wait in a normal queue.</li>
                    <li>Urgent booking or support failures where normal chat was not enough.</li>
                  </ul>
                </SideCard>

                <SideCard icon={FileText} title="How to get a faster answer" tint="text-sky-300">
                  <ul className="text-slate-400 text-sm leading-7 pl-5 list-disc">
                    <li>State the issue clearly in the first message.</li>
                    <li>Include order, booking, or job identifiers when possible.</li>
                    <li>Mention what already happened before you escalated.</li>
                  </ul>
                </SideCard>
              </div>
            </div>
          </PageFrame>
        )}

        {phase === 'ticket' && (
          <PageFrame>
            <Hero
              eyebrow="Escalation ticket"
              title={t('support.escalation.noAgentsTitle')}
              body={t('support.escalation.noAgentsMessage')}
              right={(
                <div className="grid gap-3">
                  <StatPill icon={Users} label="Agents online" value={agentsOnline} />
                  <StatPill icon={Clock} label="Routing mode" value="Ticket fallback" />
                  <StatPill icon={Mail} label="Response channel" value="Email updates" />
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
                <SideCard icon={ShieldCheck} title="What happens after you submit" tint="text-orange-300">
                  <ul className="text-slate-300 text-sm leading-7 pl-5 list-disc">
                    <li>Your escalation is converted into a tracked support ticket.</li>
                    <li>The support team can follow up with you by email if they need more detail.</li>
                    <li>You get a ticket identifier to reference if the issue continues.</li>
                  </ul>
                </SideCard>

                <SideCard icon={FileText} title="What to include" tint="text-sky-300">
                  <ul className="text-slate-400 text-sm leading-7 pl-5 list-disc">
                    <li>What happened, when it happened, and what you expected instead.</li>
                    <li>Any booking, order, invoice, or conversation IDs involved.</li>
                    <li>Why this issue needs escalation instead of normal support handling.</li>
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
                  <StatPill icon={FileText} label="Ticket ID" value={successTicketId || '—'} />
                  <StatPill icon={Mail} label="Follow-up" value="Email" />
                  <StatPill icon={ShieldCheck} label="Status" value="Escalated" />
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
