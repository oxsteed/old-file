import { useState, useEffect, useCallback } from 'react';
import { X, Plus, ArrowLeft, Ticket, MessageSquare, History } from 'lucide-react';
import TicketCreationModal from './TicketCreationModal';
import TicketHistory from './TicketHistory';
import LiveChat from './LiveChat';

export default function WidgetPanel({
  apiBaseUrl,
  userId,
  view,
  onViewChange,
  onBack,
  selectedTicket,
  onClose,
  onNewMessage,
}) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/support/tickets`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('accessToken') || ''}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        setTickets(data.tickets || []);
      }
    } catch (err) {
      console.error('Failed to load tickets:', err);
    }
    setLoading(false);
  }, [apiBaseUrl]);

  useEffect(() => {
    if (view === 'main' || view === 'tickets') {
      loadTickets();
    }
  }, [view, loadTickets]);

  const handleCreateTicket = async (ticketData) => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/support/tickets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('accessToken') || ''}`,
        },
        body: JSON.stringify(ticketData),
      });
      if (response.ok) {
        const newTicket = await response.json();
        setTickets([newTicket.ticket, ...tickets]);
        setShowCreateModal(false);
        onViewChange('chat', newTicket.ticket);
      }
    } catch (err) {
      console.error('Failed to create ticket:', err);
    }
  };

  return (
    <div className="widget-panel">
      {/* Header */}
      <div className="widget-header">
        <div className="widget-header-content">
          {(view === 'chat' || view === 'tickets') && (
            <button onClick={onBack} className="widget-back-button" aria-label="Go back">
              <ArrowLeft size={18} />
            </button>
          )}
          <h2 className="widget-title">
            {view === 'main' && 'Support'}
            {view === 'tickets' && 'Your Tickets'}
            {view === 'chat' && selectedTicket?.title}
            {view === 'create' && 'Create Ticket'}
          </h2>
        </div>
        <button onClick={onClose} className="widget-close-button" aria-label="Close widget">
          <X size={18} />
        </button>
      </div>

      {/* Content */}
      <div className="widget-content">
        {view === 'main' && (
          <div className="widget-main-menu">
            <button
              onClick={() => onViewChange('tickets')}
              className="widget-menu-button"
            >
              <Ticket size={20} />
              <span>View Tickets</span>
              {tickets.length > 0 && <span className="widget-count">{tickets.length}</span>}
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="widget-menu-button primary"
            >
              <Plus size={20} />
              <span>Create Ticket</span>
            </button>
          </div>
        )}

        {view === 'tickets' && (
          <TicketHistory
            tickets={tickets}
            loading={loading}
            onSelectTicket={(ticket) => onViewChange('chat', ticket)}
          />
        )}

        {view === 'chat' && selectedTicket && (
          <LiveChat
            apiBaseUrl={apiBaseUrl}
            ticket={selectedTicket}
            onNewMessage={onNewMessage}
          />
        )}
      </div>

      {/* Create Ticket Modal */}
      {showCreateModal && (
        <TicketCreationModal
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreateTicket}
        />
      )}
    </div>
  );
}
