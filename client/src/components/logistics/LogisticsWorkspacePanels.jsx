import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import '../../styles/logistics/LogisticsWorkspaces.css';

/**
 * WorkspaceDataErrorBanner - distinguishes "data unavailable" (load error)
 * from zero activity. Rendered when a workspace fetch fails; offers retry.
 */
export function WorkspaceDataErrorBanner({ onRetry }) {
  const { t } = useTranslation();
  return (
    <div className="lx-data-error-banner" role="alert">
      <div>
        <h2>{t('logistics.workspace.dataError.title')}</h2>
        <p>{t('logistics.workspace.dataError.body')}</p>
      </div>
      {onRetry && (
        <button type="button" className="lx-btn-secondary" onClick={onRetry}>
          {t('logistics.workspace.dataError.retry')}
        </button>
      )}
    </div>
  );
}

/**
 * WorkspaceOverviewStrip - the actionable overview shared by every customer
 * workspace dashboard: one clear next step plus a recent-activity panel.
 *
 * nextStep: { kind: 'link' | 'action', href?, onClick?, label, hint } | null
 * recentActivity: [{ key, label, href?, date }]
 */
export default function WorkspaceOverviewStrip({
  loading,
  loadError,
  nextStep,
  recentActivity = [],
  emptyActivityText,
}) {
  const { t } = useTranslation();

  const renderNextStep = () => {
    if (loading) {
      return <p className="lx-overview-empty">{t('logistics.modal.loading')}</p>;
    }
    if (loadError) {
      return <p className="lx-overview-empty">{t('logistics.workspace.dataError.body')}</p>;
    }
    if (!nextStep) return null;
    return (
      <>
        <p className="lx-next-step-hint">{nextStep.hint}</p>
        {nextStep.kind === 'action' ? (
          <button
            type="button"
            className="lx-btn-primary lx-next-step-action"
            onClick={nextStep.onClick}
          >
            {nextStep.label}
          </button>
        ) : (
          <Link to={nextStep.href} className="lx-btn-primary lx-next-step-action">
            {nextStep.label}
          </Link>
        )}
      </>
    );
  };

  const renderActivity = () => {
    if (loading) {
      return <p className="lx-overview-empty">{t('logistics.modal.loading')}</p>;
    }
    if (loadError) {
      return <p className="lx-overview-empty">{t('logistics.workspace.dataError.body')}</p>;
    }
    if (recentActivity.length > 0) {
      return (
        <div className="lx-activity-list">
          {recentActivity.map((item) => (
            <div key={item.key} className="lx-activity-item">
              <span className="lx-activity-label">
                {item.href ? (
                  <Link to={item.href} className="lx-link">{item.label}</Link>
                ) : (
                  item.label
                )}
              </span>
              <span className="lx-activity-date">
                {new Date(item.date).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      );
    }
    return (
      <p className="lx-overview-empty">
        {emptyActivityText || t('logistics.workspace.recentActivity.empty')}
      </p>
    );
  };

  return (
    <div className="lx-overview-strip">
      <div className="lx-card">
        <h2 className="lx-dashboard-panel-title">{t('logistics.workspace.nextStep.title')}</h2>
        <div className="lx-next-step-body">{renderNextStep()}</div>
      </div>
      <div className="lx-card">
        <h2 className="lx-dashboard-panel-title">{t('logistics.workspace.recentActivity.title')}</h2>
        {renderActivity()}
      </div>
    </div>
  );
}
