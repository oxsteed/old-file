import { useState, useEffect, useCallback, useRef } from 'react';
import { MessageCircle, X, Plus, ArrowLeft, Send } from 'lucide-react';
import io from 'socket.io-client';
import api from '../../api/axios';
import './CustomerSupportWidget.css';

/**
 * CustomerSupportWidget
 * Real-time support widget with 3-layer routing
 * Uses WebSocket for real-time messaging
 */
export default function CustomerSupportWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState('main'); // 'main' | 'tickets' | 'chat' | 'create'
  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  // WebSocket refs
  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);

  // Form state
  const [formData, setFormData] = useState({
    visitorName: localStorage.getItem('oxs:visitorName') || '',
    visitorEmail: localStorage.getItem('oxs:visitorEmail') || '',
    category: 'general',
    message: '',
  });

  // Initialize WebSocket
  useEffect(() => {
    const socket = io(window.location.origin, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
    });

    socket.on('connect', () => {
      console.log('Support widget connected');
      // Join as customer
      const userId = localStorage.getItem('userId');
      const visitorEmail = formData.visitorEmail;
      const visitorName = formData.visitorName;

      socket.emit('customer:join', {
        userId,
        visitorEmail,
        visitorName,
      });
    });

    // New message received
    socket.on('message:new', (data) => {
      const { ticketId, sender, content, timestamp } = data;

      if (ticketId === selectedTicket?.id) {
        setMessages(prev => [...prev, {
          id: Date.now(),
          sender,
          content,
          timestamp,
        }]);

        // Scroll to bottom
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      }

      // Update unread count if not viewing this ticket
      if (ticketId !== selectedTicket?.id) {
        setUnreadCount(prev => prev + 1);
      }
    });

    // Agent joined
    socket.on('agent:joined', (data) => {
      const { ticketId, message, timestamp } = data;
      if (ticketId === selectedTicket?.id) {
        setMessages(prev => [...prev, {
          id: Date.now(),
          sender: { type: 'system' },
          content: message,
          timestamp,
        }]);
      }
    });

    // Ticket assigned
    socket.on('ticket:assigned', (data) => {
      const { ticketId, agentName } = data;
      if (ticketId === selectedTicket?.id) {
        setMessages(prev => [...prev, {
          id: Date.now(),
          sender: { type: 'system' },
          content: `${agentName} has been assigned to help you.`,
        }]);
      }
    });

    // Typing indicator
    socket.on('agent:typing-indicator', (data) => {
      // Could show "Agent is typing..." UI
      console.log('Agent typing:', data.isTyping);
    });

    // Ticket closed
    socket.on('ticket:closed', (data) => {
      const { ticketId, message } = data;
      if (ticketId === selectedTicket?.id) {
        setSelectedTicket(null);
        setView('tickets');
        setMessages([]);
      }
    });

    socket.on('disconnect', () => {
      console.log('Support widget disconnected');
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, [formData.visitorEmail, formData.visitorName]);

  // Load tickets
  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/support/conversations');
      setTickets(response.data.conversations || []);
    } catch (err) {
      console.error('Failed to load tickets:', err);
    }
    setLoading(false);
  }, []);

  // Load ticket messages
  const loadTicketMessages = useCallback(async (ticketId) => {
    try {
      const response = await api.get(`/api/support/conversations/${ticketId}`);
      setMessages(response.data.messages || []);
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
  }, []);

  // Create new ticket
  const handleCreateTicket = async (e) => {
    e.preventDefault();
    if (!formData.message.trim()) return;

    setLoading(true);
    try {
      const response = await api.post('/api/support/conversations', {
        customerId: localStorage.getItem('userId'),
        visitorEmail: formData.visitorEmail,
        visitorName: formData.visitorName,
        message: formData.message,
        category: formData.category,
        priority: 'normal',
      });

      const ticketId = response.data.ticketId;

      // Join ticket room
      socketRef.current.emit('ticket:join', {
        ticketId,
        userId: localStorage.getItem('userId'),
      });

      // Update state
      setSelectedTicket({ id: ticketId });
      setMessages([{
        id: 1,
        sender: { type: 'customer', name: formData.visitorName },
        content: formData.message,
      }]);
      setView('chat');
      setFormData(prev => ({ ...prev, message: '' }));

      // Reload tickets list
      loadTickets();

      // Show status
      if (response.data.routedTo === 'agent') {
        setMessages(prev => [...prev, {
          id: Date.now(),
          sender: { type: 'system' },
          content: `Connected with ${response.data.assignedAgent.name}!`,
        }]);
      } else if (response.data.routedTo === 'queue') {
        setMessages(prev => [...prev, {
          id: Date.now(),
          sender: { type: 'system' },
          content: 'Your request has been queued. An agent will help you shortly.',
        }]);
      }
    } catch (err) {
      console.error('Failed to create ticket:', err);
      alert('Failed to create support request');
    }
    setLoading(false);
  };

  // Send message
  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!formData.message.trim() || !selectedTicket) return;

    socketRef.current.emit('message:send', {
      ticketId: selectedTicket.id,
      content: formData.message,
      timestamp: new Date().toISOString(),
    });

    setFormData(prev => ({ ...prev, message: '' }));
  };

  // Handle open
  const handleOpen = () => {
    setIsOpen(!isOpen);
    if (!isOpen) {
      setUnreadCount(0);
      loadTickets();
    }
  };

  // Handle select ticket
  const handleSelectTicket = (ticket) => {
    setSelectedTicket(ticket);
    setView('chat');
    setUnreadCount(0);
    loadTicketMessages(ticket.id);

    // Join ticket room
    socketRef.current.emit('ticket:join', {
      ticketId: ticket.id,
      userId: localStorage.getItem('userId'),
    });
  };

  return (
    <div className="customer-support-widget-container">
      {/* Floating Launcher Button */}
      <button
        onClick={handleOpen}
        className="customer-support-launcher"
        aria-label="Open support"
        title="Support"
      >
        <MessageCircle size={24} />
        {unreadCount > 0 && (
          <span className="support-badge">{Math.min(unreadCount, 9)}</span>
        )}
      </button>

      {/* Widget Panel */}
      {isOpen && (
        <div className="customer-support-panel">
          <div className="support-header">
            <h3>Support Center</h3>
            <button
              onClick={() => setIsOpen(false)}
              className="support-close-btn"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>

          <div className="support-content">
            {/* Main View */}
            {view === 'main' && (
              <div className="support-main">
                <div className="support-welcome">
                  <h4>How can we help?</h4>
                  <p>Click below to create a support request or view your tickets</p>
                </div>
                <div className="support-actions">
                  <button
                    onClick={() => setView('create')}
                    className="support-action-btn primary"
                  >
                    <Plus size={18} />
                    New Support Request
                  </button>
                  <button
                    onClick={() => {
                      setView('tickets');
                      loadTickets();
                    }}
                    className="support-action-btn secondary"
                  >
                    View Your Tickets
                  </button>
                </div>
              </div>
            )}

            {/* Create Ticket View */}
            {view === 'create' && (
              <form onSubmit={handleCreateTicket} className="support-form">
                <button
                  type="button"
                  onClick={() => setView('main')}
                  className="support-back-btn"
                >
                  <ArrowLeft size={16} /> Back
                </button>

                <div className="form-group">
                  <label>Your Name</label>
                  <input
                    type="text"
                    required
                    value={formData.visitorName}
                    onChange={e => {
                      setFormData(prev => ({ ...prev, visitorName: e.target.value }));
                      localStorage.setItem('oxs:visitorName', e.target.value);
                    }}
                    placeholder="John Doe"
                    className="form-input"
                  />
                </div>

                <div className="form-group">
                  <label>Your Email</label>
                  <input
                    type="email"
                    required
                    value={formData.visitorEmail}
                    onChange={e => {
                      setFormData(prev => ({ ...prev, visitorEmail: e.target.value }));
                      localStorage.setItem('oxs:visitorEmail', e.target.value);
                    }}
                    placeholder="john@example.com"
                    className="form-input"
                  />
                </div>

                <div className="form-group">
                  <label>Category</label>
                  <select
                    value={formData.category}
                    onChange={e => setFormData(prev => ({ ...prev, category: e.target.value }))}
                    className="form-input"
                  >
                    <option value="general">General Inquiry</option>
                    <option value="technical">Technical Issue</option>
                    <option value="billing">Billing</option>
                    <option value="account">Account</option>
                    <option value="shipping">Shipping</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Message</label>
                  <textarea
                    required
                    value={formData.message}
                    onChange={e => setFormData(prev => ({ ...prev, message: e.target.value }))}
                    placeholder="Describe your issue..."
                    className="form-input"
                    rows={4}
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="support-submit-btn"
                >
                  {loading ? 'Creating...' : 'Submit Request'}
                </button>
              </form>
            )}

            {/* Tickets List View */}
            {view === 'tickets' && (
              <div className="support-tickets-list">
                <button
                  type="button"
                  onClick={() => setView('main')}
                  className="support-back-btn"
                >
                  <ArrowLeft size={16} /> Back
                </button>

                {tickets.length === 0 ? (
                  <p className="empty-state">No support requests yet</p>
                ) : (
                  <div className="tickets-grid">
                    {tickets.map(ticket => (
                      <button
                        key={ticket.id}
                        onClick={() => handleSelectTicket(ticket)}
                        className="ticket-card"
                      >
                        <div className="ticket-header">
                          <span className={`ticket-status status-${ticket.status}`}>
                            {ticket.status}
                          </span>
                        </div>
                        <h4>{ticket.subject}</h4>
                        <p className="ticket-category">{ticket.category}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Chat View */}
            {view === 'chat' && selectedTicket && (
              <div className="support-chat">
                <button
                  type="button"
                  onClick={() => {
                    setView('tickets');
                    setSelectedTicket(null);
                    setMessages([]);
                  }}
                  className="support-back-btn"
                >
                  <ArrowLeft size={16} /> Back
                </button>

                <div className="chat-messages">
                  {messages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`message message-${msg.sender.type || 'customer'}`}
                    >
                      <div className="message-content">
                        {msg.content}
                      </div>
                      {msg.timestamp && (
                        <span className="message-time">
                          {new Date(msg.timestamp).toLocaleTimeString()}
                        </span>
                      )}
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>

                <form onSubmit={handleSendMessage} className="chat-input-form">
                  <input
                    type="text"
                    value={formData.message}
                    onChange={e => setFormData(prev => ({ ...prev, message: e.target.value }))}
                    placeholder="Type your message..."
                    className="chat-input"
                  />
                  <button type="submit" disabled={loading} className="chat-send-btn">
                    <Send size={16} />
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
