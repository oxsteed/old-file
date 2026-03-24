import { useState, useEffect, useRef } from 'react';
import { Bell }                        from 'lucide-react';
import { Link }                        from 'react-router-dom';
import { formatDistanceToNow }         from 'date-fns';
import { useSocket }                   from '../../hooks/useSocket';
import api                             from '../../api/axios';

export default function NotificationCenter() {
  const [open,         setOpen]    = useState(false);
  const [notifs,       setNotifs]  = useState([]);
  const [unreadCount,  setUnread]  = useState(0);
  const [loading,      setLoading] = useState(false);
  const panelRef                   = useRef(null);
  const { socket }                 = useSocket();

  // Fetch on open
  useEffect(() => {
    if (open) fetchNotifications();
  }, [open]);

  // Real-time new notifications
  useEffect(() => {
    if (!socket) return;
    socket.on('notification:new', (notif) => {
      setNotifs(prev => [notif, ...prev]);
      setUnread(c => c + 1);
    });
    return () => socket.off('notification:new');
  }, [socket]);

  // Fetch unread count on mount
  useEffect(() => {
    const fetchCount = async () => {
      try {
        const { data } = await api.get('/notifications?limit=1');
        setUnread(data.unread_count);
      } catch (err) {
        console.error(err);
      }
    };
    fetchCount();
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/notifications?limit=20');
      setNotifs(data.notifications);
      setUnread(data.unread_count);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const markAllRead = async () => {
    try {
      await api.post('/notifications/mark-read', { ids: 'all' });
      setNotifs(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnread(0);
    } catch (err) {
      console.error(err);
    }
  };

  const markOneRead = async (id) => {
    try {
      await api.post('/notifications/mark-read', { ids: [id] });
      setNotifs(prev =>
        prev.map(n => n.id === id ? { ...n, is_read: true } : n)
      );
      setUnread(c => Math.max(0, c - 1));
    } catch (err) {
      console.error(err);
    }
  };

  const NOTIF_ICONS = {
    new_bid:            '🎯',
    bid_accepted:       '✅',
    job_started:        '🔨',
    job_completed:      '🏁',
    payment_released:   '💰',
    payout_deposited:   '🏦',
    new_review:         '⭐',
    dispute_update:     '⚠️',
    subscription_renewed:'🔄',
    subscription_cancelled:'❌',
    broker_claimed:     '🤝',
    new_job_nearby:     '📍',
    onboarding_complete:'🎉',
    default:            '🔔'
  };

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 text-gray-500 hover:text-gray-700
                   hover:bg-gray-100 rounded-xl transition"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px]
                           h-[18px] bg-orange-500 text-white text-xs
                           font-bold rounded-full flex items-center
                           justify-center px-1">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-12 w-96 bg-white border
                        border-gray-200 rounded-2xl shadow-xl z-50
                        overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3
                          border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-orange-500 hover:text-orange-600
                           font-medium transition"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[420px] overflow-y-auto">
            {loading ? (
              <div className="py-12 text-center text-gray-400 text-sm">
                Loading...
              </div>
            ) : notifs.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-3xl mb-2">🔔</p>
                <p className="text-gray-400 text-sm">
                  You're all caught up!
                </p>
              </div>
            ) : notifs.map(notif => (
              <div
                key={notif.id}
                onClick={() => !notif.is_read && markOneRead(notif.id)}
                className={`flex items-start gap-3 px-4 py-3.5
                            border-b border-gray-50 cursor-pointer
                            transition hover:bg-gray-50 ${
                  !notif.is_read ? 'bg-orange-50/40' : ''
                }`}
              >
                <span className="text-xl shrink-0 mt-0.5">
                  {NOTIF_ICONS[notif.type] || NOTIF_ICONS.default}
                </span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm leading-snug ${
                    !notif.is_read
                      ? 'font-semibold text-gray-900'
                      : 'font-medium text-gray-700'
                  }`}>
                    {notif.title}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                    {notif.body}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {formatDistanceToNow(
                      new Date(notif.created_at), { addSuffix: true }
                    )}
                  </p>
                </div>
                {!notif.is_read && (
                                    <div className="w-2 h-2 bg-orange-500 rounded-full
                                  shrink-0 mt-1.5" />
                )}
              </div>
            ))}
          </div>

          {/* Footer */}
          {notifs.length > 0 && (
            <div className="px-4 py-3 border-t border-gray-100 text-center">
              <Link
                to="/notifications"
                onClick={() => setOpen(false)}
                className="text-sm text-orange-500 hover:text-orange-600
                           font-medium transition"
              >
                View all notifications
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
