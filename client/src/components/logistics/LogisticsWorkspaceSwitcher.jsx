import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Star } from 'lucide-react';
import {
  getFavoriteLogisticsWorkspaceKey,
  getLogisticsEndUserWorkspaces,
  setFavoriteLogisticsWorkspaceKey,
} from '../../utils/logisticsWorkspaces';

export default function LogisticsWorkspaceSwitcher({
  currentKey,
  availability = {},
  onFavoriteChange,
}) {
  const favoriteKey = useMemo(() => getFavoriteLogisticsWorkspaceKey(), [currentKey]);
  const workspaces = useMemo(() => getLogisticsEndUserWorkspaces(), []);

  const handleFavorite = (key) => {
    const nextKey = favoriteKey === key ? null : key;
    setFavoriteLogisticsWorkspaceKey(nextKey);
    if (typeof onFavoriteChange === 'function') {
      onFavoriteChange(nextKey);
    }
  };

  return (
    <div className="lx-card" style={{ marginBottom: '1.5rem' }}>
      <div className="lx-section-header">
        <h2 style={{ margin: 0 }}>Logistics End-User Dashboards</h2>
        <Link to="/logistics" className="lx-link">Open logistics hub</Link>
      </div>
      <div className="lx-nav-grid">
        {workspaces.map((workspace) => {
          const enabled = availability[workspace.key] !== false;
          const isCurrent = workspace.key === currentKey;
          const isFavorite = favoriteKey === workspace.key;
          return (
            <div
              key={workspace.key}
              className="lx-nav-tile"
              style={{
                alignItems: 'flex-start',
                textAlign: 'left',
                border: isCurrent ? '1px solid #f97316' : undefined,
                boxShadow: isCurrent ? '0 0 0 1px rgba(249,115,22,0.18) inset' : undefined,
              }}
            >
              <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', gap: '.75rem', alignItems: 'flex-start' }}>
                <div>
                  <div className="lx-nav-icon">{workspace.icon}</div>
                  <div className="lx-nav-label" style={{ marginTop: '.35rem' }}>{workspace.label}</div>
                </div>
                {enabled && (
                  <button
                    type="button"
                    onClick={() => handleFavorite(workspace.key)}
                    className="lx-btn-secondary"
                    style={{ padding: '.35rem .55rem', minWidth: 'unset' }}
                    title={isFavorite ? 'Unset favorite workspace' : 'Set as favorite workspace'}
                  >
                    <Star size={14} fill={isFavorite ? 'currentColor' : 'none'} />
                  </button>
                )}
              </div>
              <div style={{ fontSize: '.82rem', color: '#64748b', lineHeight: 1.6 }}>
                {workspace.description}
              </div>
              <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginTop: '.5rem' }}>
                {enabled ? (
                  <Link to={workspace.path} className="lx-link">
                    {isCurrent ? 'Current dashboard' : 'Open dashboard'}
                  </Link>
                ) : (
                  <span style={{ fontSize: '.74rem', fontWeight: 700, color: '#f97316' }}>
                    Not enabled for this account
                  </span>
                )}
                {isFavorite && (
                  <span style={{ fontSize: '.74rem', fontWeight: 700, color: '#f97316' }}>
                    Favorite for Logistics mode
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
