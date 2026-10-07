import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import './MediaStyles.css';

const TABS = [
  { path: '/media', label: 'Home', icon: '🏠' },
  { path: '/media/search', label: 'Search', icon: '🔍' },
  { path: '/media/communities', label: 'Spaces', icon: '👥' },
  { path: '/media/notifications', label: 'Alerts', icon: '🔔' },
  { path: '/media/messages', label: 'Messages', icon: '✉️' },
];

export default function MediaShell({ children }) {
  const location = useLocation();
  return (
    <div className="media-shell">
      <div className="media-content">{children}</div>
      <nav className="media-bottom-nav">
        {TABS.map(tab => (
          <Link
            key={tab.path}
            to={tab.path}
            className={`media-nav-tab ${location.pathname === tab.path ? 'active' : ''}`}
          >
            <span className="media-nav-icon">{tab.icon}</span>
            <span className="media-nav-label">{tab.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
