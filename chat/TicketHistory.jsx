import { Calendar, AlertCircle, CheckCircle, Clock } from 'lucide-react';

export default function TicketHistory({ tickets, loading, onSelectTicket }) {
  const getStatusIcon = (status) => {
    switch (status) {
      case 'open':
        return <AlertCircle size={16} className="widget-status-icon open" />;
      case 'in_progress':
        return <Clock size={16} className="widget-status-icon in-progress" />;
      case 'resolved':
        return <CheckCircle size={16} className="widget-status-icon resolved" />;
      default:
        return null;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'open': return '#ef4444';
      case 'in_progress': return '#f59e0b';
      case 'resolved': return '#10b981';
      default: return '#6b7280';
    }
  };

  const getPriorityBadge = (priority) => {
    const colors = {
      low: '#3b82f6',
      normal: '#6b7280',
      high: '#f59e0b',
      urgent: '#ef4444',
    };
    return (
      <span
        className="widget-priority-badge"
        style={{ backgroundColor: `${colors[priority]}20`, color: colors[priority] }}
      >
        {priority}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="widget-loading">
        <div className="widget-spinner" />
      </div>
    );
  }

  if (tickets.length === 0) {
    return (
      <div className="widget-empty-state">
        <AlertCircle size={32} />
        <p>No tickets yet</p>
        <p className="widget-empty-state-hint">Create a new ticket to get support</p>
      </div>
    );
  }

  return (
    <div className="widget-ticket-list">
      {tickets.map((ticket) => (
        <button
          key={ticket.id}
          onClick={() => onSelectTicket(ticket)}
          className="widget-ticket-item"
        >
          <div className="widget-ticket-header">
            <div className="widget-ticket-status">
              {getStatusIcon(ticket.status)}
              <span className="widget-status-label">{ticket.status}</span>
            </div>
            {getPriorityBadge(ticket.priority)}
          </div>

          <h4 className="widget-ticket-title">{ticket.title}</h4>

          <p className="widget-ticket-category">{ticket.category}</p>

          <div className="widget-ticket-footer">
            <span className="widget-ticket-date">
              <Calendar size={12} />
              {new Date(ticket.created_at).toLocaleDateString()}
            </span>
            {ticket.unread_count > 0 && (
              <span className="widget-ticket-unread">{ticket.unread_count} new</span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
