import { Suspense, cloneElement, isValidElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink, X } from 'lucide-react';
import { getTaskComponent, getTaskComponentProps } from './taskRegistry';

function buildFullPageUrl(destination) {
  const params = new URLSearchParams();
  const raw = destination?.params;
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw)) {
      if (value !== undefined && value !== null) params.set(key, String(value));
    }
  }
  const query = params.toString();
  return `${destination.route}${query ? `?${query}` : ''}`;
}

function TaskBody({ task, onAttentionAction }) {
  const { t, i18n } = useTranslation('attention');
  const destination = task?.taskDestination;

  if (destination?.type === 'route' && destination.route) {
    return (
      <div className="attention-state">
        <p className="attention-state__text">{t('taskView.routeOnly')}</p>
        <OpenFullPageButton task={task} />
      </div>
    );
  }

  if (destination?.type === 'component' && destination.component) {
    const Component = getTaskComponent(destination.component);
    const derivedProps = getTaskComponentProps(destination.component, task);
    if (Component && derivedProps) {
      const element = (
        <Component
          {...derivedProps}
          attentionTask={task}
          onAttentionAction={onAttentionAction}
        />
      );
      return (
        <Suspense
          fallback={(
            <div className="attention-state" role="status" aria-live="polite">
              <div className="attention-spinner" aria-hidden="true" />
              <p className="attention-state__text">{t('list.loading')}</p>
            </div>
          )}
        >
          {isValidElement(element) ? cloneElement(element, {}) : element}
        </Suspense>
      );
    }
    // Unknown component name or missing required props: never render a broken
    // workflow. Fall back to the route destination when one exists.
    if (destination.route) {
      return (
        <div className="attention-state">
          <p className="attention-state__text">{t('taskView.routeOnly')}</p>
          <OpenFullPageButton task={task} />
        </div>
      );
    }
  }

  return (
    <div className="attention-state">
      <p className="attention-state__text">{t('reasons.other')}</p>
    </div>
  );
}

export function OpenFullPageButton({ task }) {
  const { t } = useTranslation('attention');
  const navigate = useNavigate();
  const destination = task?.taskDestination;
  if (!destination?.route) return null;
  return (
    <button
      type="button"
      className="attention-btn attention-btn--primary"
      onClick={() => navigate(buildFullPageUrl(destination))}
    >
      <ExternalLink size={16} aria-hidden="true" /> {t('actions.openFullPage')}
    </button>
  );
}

function taskTitle(task, t, i18n) {
  const reasonSuffix = String(task?.reason || '').replace(/^attention\./, '');
  return i18n.exists(reasonSuffix, { ns: 'attention' })
    ? t(reasonSuffix, task?.reasonParams || {})
    : t('reasons.other');
}

// Replaces the modal body with the registered workflow for the selected task.
// Header: Back to attention | business + restaurant + task title | Open full
// page | Close. Must render inside a DirtyFormProvider (provided by
// AttentionModal) so workflows can flag unsaved edits via useDirtyForm().
export default function AttentionTaskView({ task, onBack, onRequestClose, onAttentionAction }) {
  const { t, i18n } = useTranslation('attention');
  const crumbs = [task?.businessName, task?.restaurantName].filter(Boolean).join(' · ');

  return (
      <div className="attention-task">
        <div className="attention-task__header">
          <button type="button" className="attention-btn" onClick={onBack}>
            <ArrowLeft size={16} aria-hidden="true" /> {t('actions.backToAttention')}
          </button>
          <div className="attention-task__crumbs" title={`${crumbs} — ${taskTitle(task, t, i18n)}`}>
            {crumbs && <span>{crumbs} · </span>}
            <strong>{taskTitle(task, t, i18n)}</strong>
          </div>
          <OpenFullPageButton task={task} />
          <button
            type="button"
            className="attention-btn attention-btn--icon"
            onClick={onRequestClose}
            aria-label={t('actions.close')}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="attention-task__body">
          <TaskBody task={task} onAttentionAction={onAttentionAction} />
        </div>
      </div>
  );
}
