import { useState, useEffect, useCallback, useRef } from 'react';
import { MessageCircle, X, Send, PhoneOff, Clock, AlertCircle } from 'lucide-react';
import io from 'socket.io-client';
import api from '../../api/axios';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { realtimeNamespaceUrl } from '../../lib/realtime';
import './HybridSupportWidget.css';

/**
 * HybridSupportWidget
 * AI Chat → Escalate to Live Agent → Queue/Ticket Fallback
 */
export default function HybridSupportWidget() {
  const { t } = useTranslation('common');
  const [isOpen, setIsOpen] = useState(false);
  const [phase, setPhase] = useState('ai'); // 'ai' | 'escalating' | 'live-chat' | 'queue' | 'ticket'
  const [unreadCount, setUnreadCount] = useState(0);

  // AI Chat state
  const [aiMessages, setAiMessages] = useState([
    { role: 'assistant', content: t('hybridSupportWidget.aiGreeting'), ts: new Date().toISOString() },
  ]);
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  // Escalation state
  const [agentsOnline, setAgentsOnline] = useState(0);
  const [escalatingLoading, setEscalatingLoading] = useState(false);

  // Live chat state
  const [ticketId, setTicketId] = useState(null);
  const [liveMessages, setLiveMessages] = useState([]);
  const [liveInput, setLiveInput] = useState('');
  const [liveSending, setLiveSending] = useState(false);
  const [assignedAgent, setAssignedAgent] = useState(null);

  // Queue state
  const [queuePosition, setQueuePosition] = useState(null);
  const [queueWaitTime, setQueueWaitTime] = useState(null);

  // Ticket fallback state
  const [visitorName, setVisitorName] = useState(localStorage.getItem('oxs:visitorName') || '');
  const [visitorEmail, setVisitorEmail] = useState(localStorage.getItem('oxs:visitorEmail') || '');
  const [ticketMessage, setTicketMessage] = useState('');

  // WebSocket ref
  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);
  const aiMessagesEndRef = useRef(null);

  // Initialize WebSocket
  useEffect(() => {
    const socket = io(realtimeNamespaceUrl('support'), {
      transports: ['websocket', 'polling'],
      reconnection: true,
    });

    socket.on('connect', () => {
      console.log('Support widget connected');
      // Emit initial status check
      socket.emit('customer:join', {
        userId: localStorage.getItem('userId'),
        visitorEmail,
      });
    });

    // Check agent availability
    socket.on('agent:status-changed', (data) => {
      console.log('Agent status:', data);
      // Trigger availability check
      checkAgentAvailability();
    });

    // Assigned to agent
    socket.on('ticket:assigned', (data) => {
      const { ticketId: assignedTicketId, agentName } = data;
      if (assignedTicketId === ticketId) {
        setAssignedAgent({ name: agentName });
        setPhase('live-chat');
        setLiveMessages(prev => [...prev, {
          id: Date.now(),
          sender: { type: 'system' },
          content: t('hybridSupportWidget.connectedWith', { name: agentName }),
        }]);
      }
    });

    // New message from agent
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

    // Agent typing
    socket.on('agent:typing-indicator', (data) => {
      // Could show "Agent is typing..." UI
      console.log('Agent typing:', data.isTyping);
    });

    socket.on('disconnect', () => {
      console.log('Support widget disconnected');
    });

    socketRef.current = socket;
    return () => socket.disconnect();
  }, [visitorEmail, ticketId]);

  // Auto scroll AI messages
  useEffect(() => {
    aiMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [aiMessages]);

  // Auto scroll live chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [liveMessages]);

  // Check agent availability
  const checkAgentAvailability = useCallback(async () => {
    try {
      const response = await api.get('/support-routing/status');
      setAgentsOnline(response.data.agents || 0);
    } catch (err) {
      console.error('Failed to check agent availability:', err);
      setAgentsOnline(0);
    }
  }, []);

  useEffect(() => {
    if (isOpen && phase === 'ai') {
      checkAgentAvailability();
    }
  }, [isOpen, phase, checkAgentAvailability]);

  // Send AI message
  const handleSendAiMessage = useCallback(async () => {
    if (!aiInput.trim() || aiLoading) return;

    const userMsg = { role: 'user', content: aiInput.trim(), ts: new Date().toISOString() };
    setAiMessages(prev => [...prev, userMsg]);
    setAiInput('');
    setAiLoading(true);

    try {
      const response = await api.post('/chat/message', {
        messages: [...aiMessages, userMsg].map(m => ({ role: m.role, content: m.content })),
        pageContext: { path: window.location.pathname },
        language: localStorage.getItem('oxs:language') || 'en',
      });

      const assistantMsg = {
        role: 'assistant',
        content: response.data.reply,
        ts: new Date().toISOString(),
      };
      setAiMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      console.error('AI error:', err);
      setAiMessages(prev => [...prev, {
        role: 'assistant',
        content: t('hybridSupportWidget.escalationFailed'),
        ts: new Date().toISOString(),
      }]);
    } finally {
      setAiLoading(false);
    }
  }, [aiInput, aiMessages, aiLoading]);

  // Escalate to live agent
  const handleEscalate = async () => {
    setEscalatingLoading(true);
    setPhase('escalating');

    try {
      await checkAgentAvailability();

      // Create ticket with AI history
      const aiHistory = aiMessages
        .map(m => `${m.role === 'user' ? 'Customer' : 'AI'}: ${m.content}`)
        .join('\n');

      const response = await api.post('/support-routing/conversations', {
        customerId: localStorage.getItem('userId'),
        visitorEmail,
        visitorName,
        message: `User wants to talk to agent.\n\nAI Chat History:\n${aiHistory}`,
        category: 'escalation',
        priority: 'normal',
      });

      const newTicketId = response.data.ticketId;
      setTicketId(newTicketId);

      // Join ticket room
      socketRef.current.emit('ticket:join', {
        ticketId: newTicketId,
        userId: localStorage.getItem('userId'),
      });

      if (response.data.routedTo === 'agent') {
        // Agent available - live chat
        setAssignedAgent(response.data.assignedAgent);
        setPhase('live-chat');
        setLiveMessages([{
          id: 1,
          sender: { type: 'system' },
          content: t('hybridSupportWidget.connectedWith', { name: response.data.assignedAgent.name }),
        }]);
      } else if (response.data.routedTo === 'queue') {
        // Agents busy - show queue
        setPhase('queue');
        setQueuePosition(1);
        setQueueWaitTime(5); // 5 minutes estimate
      }
    } catch (err) {
      console.error('Escalation error:', err);
      toast.error(t('hybridSupportWidget.escalationFailed', { defaultValue: 'Could not connect you to support right now. Please try again.' }));
      setPhase('ai');
    } finally {
      setEscalatingLoading(false);
    }
  };

  // Send live message
  const handleSendLiveMessage = useCallback(() => {
    if (!liveInput.trim() || !ticketId) return;

    socketRef.current.emit('message:send', {
      ticketId,
      content: liveInput.trim(),
      timestamp: new Date().toISOString(),
    });

    setLiveMessages(prev => [...prev, {
      id: Date.now(),
      sender: { type: 'customer' },
      content: liveInput.trim(),
    }]);
    setLiveInput('');
  }, [liveInput, ticketId]);

  // Submit ticket
  const handleSubmitTicket = async () => {
    if (!visitorName.trim() || !visitorEmail.trim() || !ticketMessage.trim()) {
      toast.error(t('hybridSupportWidget.ticketFailed', { defaultValue: 'Add your name, email, and message before sending.' }));
      return;
    }

    try {
      const response = await api.post('/support-routing/conversations', {
        customerId: localStorage.getItem('userId'),
        visitorEmail,
        visitorName,
        message: ticketMessage,
        category: 'support_request',
        priority: 'normal',
      });

      // Save name/email
      localStorage.setItem('oxs:visitorName', visitorName);
      localStorage.setItem('oxs:visitorEmail', visitorEmail);

      setPhase('ai');
      setTicketMessage('');
      toast.success(t('hybridSupportWidget.ticketSubmitted', { defaultValue: 'Support ticket created. We will follow up soon.' }));
    } catch (err) {
      console.error('Ticket error:', err);
      toast.error(t('hybridSupportWidget.ticketSubmitFailed', { defaultValue: 'Could not submit your ticket. Please try again.' }));
    }
  };

  // Handle open
  const handleOpen = () => {
    setIsOpen(!isOpen);
    if (!isOpen) {
      setUnreadCount(0);
      checkAgentAvailability();
    }
  };

  const handleBackToAI = () => {
    setPhase('ai');
    setTicketId(null);
    setLiveMessages([]);
    setAssignedAgent(null);
  };

  return (
    <div className="hybrid-support-widget-container">
      {/* Launcher Button */}
      <button
        onClick={handleOpen}
        className="hybrid-support-launcher"
        aria-label={t('hybridSupportWidget.launcherAriaLabel') || t('supportWidget.launcherAriaLabel')}
        title={t('hybridSupportWidget.talkToSomeone') || t('supportWidget.launcher')}
      >
        <MessageCircle size={24} />
        {unreadCount > 0 && <span className="support-badge">{Math.min(unreadCount, 9)}</span>}
      </button>

      {/* Widget Panel */}
      {isOpen && (
        <div className="hybrid-support-panel">
          <div className="support-header">
            <h3>
              {phase === 'ai' && t('hybridSupportWidget.titleAi')}
              {phase === 'escalating' && t('hybridSupportWidget.titleEscalating')}
              {phase === 'live-chat' &&
                t('hybridSupportWidget.titleLiveChat', {
                  agentName: assignedAgent ? ` ${assignedAgent.name}` : '',
                })}
              {phase === 'queue' && t('hybridSupportWidget.titleQueue')}
              {phase === 'ticket' && t('hybridSupportWidget.titleTicket')}
            </h3>
            <button
              onClick={() => setIsOpen(false)}
              className="support-close-btn"
              aria-label={t('supportWidget.back')}
            >
              <X size={20} />
            </button>
          </div>

          <div className="support-content">
            {/* AI Phase */}
            {phase === 'ai' && (
              <div className="ai-chat-phase">
                <div className="ai-messages">
                  {aiMessages.map((msg, idx) => (
                    <div key={idx} className={`ai-message ai-${msg.role}`}>
                      <div className="message-bubble">{msg.content}</div>
                      <span className="message-time">
                        {new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))}
                  {aiLoading && (
                    <div className="ai-message ai-assistant">
                      <div className="message-bubble typing">
                        <span></span><span></span><span></span>
                      </div>
                    </div>
                  )}
                  <div ref={aiMessagesEndRef} />
                </div>

                <form onSubmit={(e) => { e.preventDefault(); handleSendAiMessage(); }} className="ai-input-form">
                  <input
                    type="text"
                    value={aiInput}
                    onChange={e => setAiInput(e.target.value)}
                    placeholder={t('supportWidget.typeMessage')}
                    className="ai-input"
                    disabled={aiLoading}
                  />
                  <button type="submit" disabled={aiLoading} className="ai-send-btn">
                    <Send size={16} />
                  </button>
                </form>

                <div className="escalate-section">
                  <p className="escalate-label">{t('hybridSupportWidget.talkToSomeone')}</p>
                  <button
                    onClick={handleEscalate}
                    disabled={escalatingLoading}
                    className="escalate-btn"
                  >
                    {agentsOnline > 0
                      ? t('hybridSupportWidget.talkToAgentWithCount', { count: agentsOnline })
                      : t('hybridSupportWidget.talkToSupportTeam')}
                  </button>
                </div>
              </div>
            )}

            {/* Escalating Phase */}
            {phase === 'escalating' && (
              <div className="escalating-phase">
                <div className="loading-spinner"></div>
                <p>{t('hybridSupportWidget.connectingText')}</p>
                <small>{t('hybridSupportWidget.connectingSubtext')}</small>
              </div>
            )}

            {/* Live Chat Phase */}
            {phase === 'live-chat' && (
              <div className="live-chat-phase">
                {assignedAgent && (
                  <div className="agent-info">
                    <span className="agent-status online"></span>
                    <span className="agent-name">{assignedAgent.name}</span>
                  </div>
                )}
                <div className="live-messages">
                  {liveMessages.map((msg, idx) => (
                    <div key={idx} className={`live-message live-${msg.sender.type || 'customer'}`}>
                      <div className="message-bubble">{msg.content}</div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>

                <form onSubmit={(e) => { e.preventDefault(); handleSendLiveMessage(); }} className="live-input-form">
                    <input
                      type="text"
                      value={liveInput}
                      onChange={e => setLiveInput(e.target.value)}
                      placeholder={t('supportWidget.typeMessage')}
                      className="live-input"
                      disabled={liveSending}
                    />
                  <button type="submit" disabled={liveSending} className="live-send-btn">
                    <Send size={16} />
                  </button>
                </form>

                <button onClick={handleBackToAI} className="back-to-ai-btn">
                  {t('hybridSupportWidget.backToAi')}
                </button>
              </div>
            )}

            {/* Queue Phase */}
            {phase === 'queue' && (
              <div className="queue-phase">
                <Clock size={48} className="queue-icon" />
                <h4>{t('hybridSupportWidget.queueTitle')}</h4>
                <p className="queue-position">
                  {t('hybridSupportWidget.queuePosition', { position: queuePosition })}
                </p>
                <p className="queue-wait">
                  {t('hybridSupportWidget.queueWait', { minutes: queueWaitTime })}
                </p>
                <p className="queue-message">{t('hybridSupportWidget.queueMessage')}</p>

                <div className="queue-actions">
                  <button
                    onClick={() => {
                      setPhase('ticket');
                      setTicketMessage(t('hybridSupportWidget.ticketQueueMessage'));
                    }}
                    className="queue-action-btn"
                  >
                    <AlertCircle size={16} />
                    {t('hybridSupportWidget.createTicketInstead')}
                  </button>
                </div>
              </div>
            )}

            {/* Ticket Fallback Phase */}
            {phase === 'ticket' && (
              <div className="ticket-phase">
                <form onSubmit={(e) => { e.preventDefault(); handleSubmitTicket(); }} className="ticket-form">
                  <div className="form-group">
                    <label>{t('hybridSupportWidget.ticketNameLabel')}</label>
                    <input
                      type="text"
                      value={visitorName}
                      onChange={e => {
                        setVisitorName(e.target.value);
                        localStorage.setItem('oxs:visitorName', e.target.value);
                      }}
                      placeholder={t('supportWidget.namePlaceholder')}
                      required
                      className="form-input"
                    />
                  </div>

                  <div className="form-group">
                    <label>{t('hybridSupportWidget.ticketEmailLabel')}</label>
                    <input
                      type="email"
                      value={visitorEmail}
                      onChange={e => {
                        setVisitorEmail(e.target.value);
                        localStorage.setItem('oxs:visitorEmail', e.target.value);
                      }}
                      placeholder={t('supportWidget.emailPlaceholder')}
                      required
                      className="form-input"
                    />
                  </div>

                  <div className="form-group">
                    <label>{t('hybridSupportWidget.ticketMessageLabel')}</label>
                    <textarea
                      value={ticketMessage}
                      onChange={e => setTicketMessage(e.target.value)}
                      placeholder={t('hybridSupportWidget.ticketMessagePlaceholder')}
                      required
                      className="form-input"
                      rows={4}
                    />
                  </div>

                  <button type="submit" className="ticket-submit-btn">
                    {t('hybridSupportWidget.submitTicket')}
                  </button>
                </form>

                <button onClick={handleBackToAI} className="back-to-ai-btn">
                  {t('hybridSupportWidget.back')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
