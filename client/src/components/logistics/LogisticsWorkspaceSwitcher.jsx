import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
    <div className="lx-card lx-workspace-switcher" style={{ marginBottom: '1.5rem' }}>
      <div className="lx-section-header" style={{ marginBottom: '.85rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>{t('logisticsWorkspaceSwitcher.title')}</h2>
          <p className="lx-workspace-switcher-sub">{t('logisticsWorkspaceSwitcher.subtitle')}</p>
        </div>
        <Link to="/logistics" className="lx-link">{t('logisticsWorkspaceSwitcher.openHub')}</Link>
      </div>
      <div className="lx-workspace-switcher-grid">
        {workspaces.map((workspace) => {
          const enabled = availability[workspace.key] !== false;
          const isCurrent = workspace.key === currentKey;
          const isFavorite = favoriteKey === workspace.key;
          return (
            <div
              key={workspace.key}
              className="lx-workspace-switcher-tile"
              style={{
                border: isCurrent ? '1px solid #f97316' : undefined,
                boxShadow: isCurrent ? '0 0 0 1px rgba(249,115,22,0.18) inset' : undefined,
              }}
            >
              <div className="lx-workspace-switcher-top">
                <div className="lx-workspace-switcher-heading">
                  <div className="lx-workspace-switcher-icon">{workspace.icon}</div>
                  <div>
                    <div className="lx-workspace-switcher-label">{workspace.label}</div>
                    {isCurrent && <div className="lx-workspace-switcher-badge">{t('logisticsWorkspaceSwitcher.current')}</div>}
                    {!isCurrent && isFavorite && (
                      <div className="lx-workspace-switcher-badge">{t('logisticsWorkspaceSwitcher.favorite')}</div>
                    )}
                  </div>
                </div>
                {enabled && (
                  <button
                    type="button"
                    onClick={() => handleFavorite(workspace.key)}
                    className="lx-btn-secondary"
                    style={{ padding: '.3rem .5rem', minWidth: 'unset' }}
                    title={
                      isFavorite
                        ? t('logisticsWorkspaceSwitcher.unsetFavoriteWorkspace')
                        : t('logisticsWorkspaceSwitcher.setFavoriteWorkspace')
                    }
                  >
                    <Star size={14} fill={isFavorite ? 'currentColor' : 'none'} />
                  </button>
                )}
              </div>
              <div className="lx-workspace-switcher-copy">
                {workspace.description}
              </div>
              <div className="lx-workspace-switcher-actions">
                {enabled ? (
                  <Link to={workspace.path} className="lx-link">
                    {isCurrent
                      ? t('logisticsWorkspaceSwitcher.currentDashboard')
                      : t('logisticsWorkspaceSwitcher.openDashboard')}
                  </Link>
                ) : (
                  <span style={{ fontSize: '.74rem', fontWeight: 700, color: '#f97316' }}>
                    {t('logisticsWorkspaceSwitcher.notEnabled')}
                  </span>
                )}
                {isFavorite && !isCurrent && (
                  <span style={{ fontSize: '.74rem', fontWeight: 700, color: '#f97316' }}>
                    {t('logisticsWorkspaceSwitcher.opensFirst')}
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
