import { useState, useEffect, useCallback } from 'react';
import { MessageCircle, X, Plus, ArrowLeft } from 'lucide-react';
import './SupportWidget.css';
import WidgetPanel from './WidgetPanel';

/**
 * SupportWidget - Embeddable customer support widget
 * Usage: <SupportWidget apiBaseUrl="https://api.oxsteed.com" />
 */
export default function SupportWidget({ apiBaseUrl = window.location.origin, userId = null }) {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState('main'); // 'main' | 'tickets' | 'chat' | 'create'
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);

  const handleViewChange = useCallback((newView, ticket = null) => {
    setView(newView);
    if (ticket) setSelectedTicket(ticket);
  }, []);

  const handleBackToMain = useCallback(() => {
    setView('main');
    setSelectedTicket(null);
  }, []);

  const handleMarkAsRead = useCallback(() => {
    setUnreadCount(0);
  }, []);

  return (
    <div className="support-widget-container">
      {/* Floating Widget Launcher Button */}
      <button
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) handleMarkAsRead();
        }}
        className="support-widget-launcher"
        aria-label="Open support widget"
        title="Support"
      >
        <MessageCircle size={24} />
        {unreadCount > 0 && (
          <span className="support-widget-badge">{Math.min(unreadCount, 9)}+</span>
        )}
      </button>

      {/* Widget Panel */}
      {isOpen && (
        <div className="support-widget-panel-wrapper">
          <WidgetPanel
            apiBaseUrl={apiBaseUrl}
            userId={userId}
            view={view}
            onViewChange={handleViewChange}
            onBack={handleBackToMain}
            selectedTicket={selectedTicket}
            onClose={() => setIsOpen(false)}
            onNewMessage={(count) => setUnreadCount(count)}
          />
        </div>
      )}
    </div>
  );
}
