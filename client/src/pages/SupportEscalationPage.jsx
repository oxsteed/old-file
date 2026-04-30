import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Send, Clock, AlertCircle, CheckCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import io from 'socket.io-client';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import api from '../api/axios';
import PageMeta from '../components/PageMeta';

/**
 * SupportEscalationPage
 * Full-page escalation handler: Live Chat OR Ticket Form
 * Based on real-time agent availability
 */
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

  // Ticket form state
  const [visitorName, setVisitorName] = useState(localStorage.getItem('oxs:visitorName') || '');
  const [visitorEmail, setVisitorEmail] = useState(localStorage.getItem('oxs:visitorEmail') || '');
  const [ticketMessage, setTicketMessage] = useState('');
  const [ticketSubmitting, setTicketSubmitting] = useState(false);
  const [successTicketId, setSuccessTicketId] = useState(null);

  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);

  // Initialize WebSocket and check agent availability
  useEffect(() => {
    const checkAvailability = async () => {
      try {
        const response = await api.get('/api/support-routing/status');
        setAgentsOnline(response.data.agents || 0);

        // If agents available, show live chat
        if (response.data.agents > 0) {
          setPhase('live-chat');
          initiateLiveChat();
        } else {
          // No agents, show ticket form with apology message
          setPhase('ticket');
        }
      } catch (err) {
        console.error('Failed to check agent availability:', err);
        setPhase('ticket'); // Fallback to ticket if check fails
      }
    };

    checkAvailability();
  }, []);

  // Initialize WebSocket for live chat
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
      });

      socket.on('ticket:assigned', (data) => {
        const { ticketId: tId, agentName } = data;
        setTicketId(tId);
        setAssignedAgent({ name: agentName });
        setLiveMessages(prev => [...prev, {
          id: Date.now(),
          sender: { type: 'system' },
          content: `Connected with ${agentName}!`,
          timestamp: new Date().toISOString(),
        }]);
      });

      socket.on('message:new', (data) => {
        const { ticketId: msgTicketId, sender, content, timestamp } = data;
        if (msgTicketId === ticketId && sender.type === 'agent') {
          setLiveMessages(prev => [...prev, {
            id: Date.now(),
            sender,
            content,
            timestamp,
          }]);
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        }
      });

      socket.on('disconnect', () => {
        console.log('Support chat disconnected');
      });

      socketRef.current = socket;
    } catch (err) {
      console.error('Failed to initiate live chat:', err);
      setPhase('ticket');
    }
  }, [ticketId]);

  // Auto scroll live messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [liveMessages]);

  // Send live chat message
  const handleSendLiveMessage = useCallback(() => {
    if (!liveInput.trim() || !ticketId) return;

    socketRef.current?.emit('message:send', {
      ticketId,
      content: liveInput.trim(),
      timestamp: new Date().toISOString(),
    });

    setLiveMessages(prev => [...prev, {
      id: Date.now(),
      sender: { type: 'customer' },
      content: liveInput.trim(),
      timestamp: new Date().toISOString(),
    }]);
    setLiveInput('');
    setLiveSending(false);
  }, [liveInput, ticketId]);

  // Submit ticket form
  const handleSubmitTicket = async (e) => {
    e.preventDefault();
    if (!visitorName.trim() || !visitorEmail.trim() || !ticketMessage.trim()) {
      alert(t('common.confirmAction'));
      return;
    }

    setTicketSubmitting(true);
    try {
      const response = await api.post('/api/support-routing/conversations', {
        customerId: localStorage.getItem('userId'),
        visitorEmail,
        visitorName,
        message: ticketMessage,
        category: 'support_request',
        priority: 'normal',
      });

      // Save name/email for future
      localStorage.setItem('oxs:visitorName', visitorName);
      localStorage.setItem('oxs:visitorEmail', visitorEmail);

      setSuccessTicketId(response.data.ticketId);
      setPhase('success');
    } catch (err) {
      console.error('Ticket error:', err);
      alert(t('support.escalation.ticketError'));
    } finally {
      setTicketSubmitting(false);
    }
  };

  const handleClose = () => {
    if (socketRef.current) socketRef.current.disconnect();
    navigate(-1);
  };

  return (
    <>
      <PageMeta
        title={t('support.escalation.pageTitle')}
        description={t('support.escalation.pageDesc')}
      />
      <Navbar />

      <main className="flex-1 bg-gray-900 dark:bg-gray-950">
        {/* Checking phase */}
        {phase === 'checking' && (
          <div className="flex items-center justify-center min-h-[calc(100vh-140px)]">
            <div className="text-center">
              <div className="w-16 h-16 bg-orange-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <div className="w-12 h-12 border-4 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
              </div>
              <p className="text-white font-semibold text-lg">{t('support.escalation.checking')}</p>
              <p className="text-gray-400 text-sm mt-2">{t('support.escalation.checkingDesc')}</p>
            </div>
          </div>
        )}

        {/* Live Chat Phase */}
        {phase === 'live-chat' && (
          <div className="max-w-3xl mx-auto px-4 py-8 h-[calc(100vh-140px)] flex flex-col">
            {/* Header */}
            <div className="bg-gray-800 dark:bg-gray-800 rounded-t-2xl border border-gray-700 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse" />
                <div>
                  <p className="text-white font-semibold">
                    {assignedAgent ? assignedAgent.name : t('support.escalation.agentWaiting')}
                  </p>
                  <p className="text-gray-400 text-xs">
                    {assignedAgent ? t('support.escalation.agentOnline') : t('support.escalation.connecting')}
                  </p>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="p-2 text-gray-500 hover:text-white rounded-lg hover:bg-gray-700 transition"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto bg-gray-800/50 dark:bg-gray-800/50 px-6 py-4 space-y-4">
              {liveMessages.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <p className="text-gray-400">{t('support.escalation.noMessages')}</p>
                  </div>
                </div>
              ) : (
                liveMessages.map((msg, idx) => (
                  <div key={idx} className={`flex ${msg.sender.type === 'customer' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-xs px-4 py-2 rounded-lg ${
                        msg.sender.type === 'customer'
                          ? 'bg-orange-600 text-white'
                          : msg.sender.type === 'system'
                          ? 'bg-gray-700 text-gray-300 text-sm italic'
                          : 'bg-gray-700 text-gray-100'
                      }`}
                    >
                      <p className="break-words">{msg.content}</p>
                      {msg.timestamp && (
                        <span className="text-xs opacity-70 mt-1 block">
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

            {/* Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setLiveSending(true);
                handleSendLiveMessage();
              }}
              className="bg-gray-800 border-t border-gray-700 rounded-b-2xl px-6 py-4 flex gap-2"
            >
              <input
                type="text"
                value={liveInput}
                onChange={e => setLiveInput(e.target.value)}
                placeholder={t('support.escalation.messagePlaceholder')}
                className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 transition"
                disabled={liveSending}
              />
              <button
                type="submit"
                disabled={liveSending || !liveInput.trim()}
                className="bg-orange-600 hover:bg-orange-700 text-white p-2 rounded-lg transition disabled:opacity-50 flex-shrink-0"
                aria-label="Send"
              >
                <Send size={20} />
              </button>
            </form>
          </div>
        )}

        {/* Ticket Phase */}
        {phase === 'ticket' && (
          <div className="max-w-2xl mx-auto px-4 py-12 min-h-[calc(100vh-140px)] flex flex-col">
            {/* No Agents Message */}
            <div className="bg-gradient-to-br from-orange-500/10 to-orange-500/5 border border-orange-500/30 rounded-xl p-8 mb-8">
              <div className="flex items-start gap-4">
                <AlertCircle className="text-orange-500 flex-shrink-0 mt-1" size={24} />
                <div>
                  <h2 className="text-white font-semibold text-lg mb-2">
                    {t('support.escalation.noAgentsTitle')}
                  </h2>
                  <p className="text-gray-300 leading-relaxed">
                    {t('support.escalation.noAgentsMessage')}
                  </p>
                  <p className="text-gray-400 text-sm mt-3">
                    {t('support.escalation.ticketCTA')}
                  </p>
                </div>
              </div>
            </div>

            {/* Ticket Form */}
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-8 flex-1">
              <h3 className="text-white font-semibold text-lg mb-6">
                {t('support.escalation.ticketFormTitle')}
              </h3>

              <form onSubmit={handleSubmitTicket} className="space-y-5">
                {/* Name */}
                <div>
                  <label className="block text-gray-300 text-sm font-medium mb-2">
                    {t('support.escalation.nameLabel')} <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={visitorName}
                    onChange={e => {
                      setVisitorName(e.target.value);
                      localStorage.setItem('oxs:visitorName', e.target.value);
                    }}
                    placeholder={t('support.escalation.namePlaceholder')}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 transition"
                  />
                </div>

                {/* Email */}
                <div>
                  <label className="block text-gray-300 text-sm font-medium mb-2">
                    {t('support.escalation.emailLabel')} <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={visitorEmail}
                    onChange={e => {
                      setVisitorEmail(e.target.value);
                      localStorage.setItem('oxs:visitorEmail', e.target.value);
                    }}
                    placeholder={t('support.escalation.emailPlaceholder')}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 transition"
                  />
                </div>

                {/* Message */}
                <div>
                  <label className="block text-gray-300 text-sm font-medium mb-2">
                    {t('support.escalation.messageLabel')} <span className="text-red-400">*</span>
                  </label>
                  <textarea
                    required
                    value={ticketMessage}
                    onChange={e => setTicketMessage(e.target.value)}
                    placeholder={t('support.escalation.messagePlaceholder')}
                    rows={6}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 transition resize-none"
                  />
                  <p className="text-gray-500 text-xs mt-1">
                    {ticketMessage.length}/2000 {t('common.characters')}
                  </p>
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={ticketSubmitting}
                  className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
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

              {/* Close Button */}
              <button
                onClick={handleClose}
                className="w-full mt-4 px-4 py-2 text-gray-400 hover:text-gray-300 rounded-lg border border-gray-700 hover:border-gray-600 transition"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        )}

        {/* Success Phase */}
        {phase === 'success' && (
          <div className="flex items-center justify-center min-h-[calc(100vh-140px)]">
            <div className="text-center max-w-md mx-auto px-4">
              <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="text-green-400" size={32} />
              </div>
              <h2 className="text-white font-semibold text-2xl mb-2">
                {t('support.escalation.successTitle')}
              </h2>
              <p className="text-gray-400 mb-4">
                {t('support.escalation.successMessage', { ticketId: successTicketId })}
              </p>
              <p className="text-gray-500 text-sm mb-6">
                {t('support.escalation.successNextSteps')}
              </p>
              <button
                onClick={handleClose}
                className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3 rounded-lg transition"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        )}
      </main>

      <Footer />
    </>
  );
}
