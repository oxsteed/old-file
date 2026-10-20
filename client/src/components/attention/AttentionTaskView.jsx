import { Suspense, cloneElement, isValidElement, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, X } from 'lucide-react';
import { getTaskComponent, getTaskComponentProps } from './taskRegistry';
import AttentionTaskErrorBoundary from './AttentionTaskErrorBoundary';

export function buildFullPageUrl(destination) {
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

function TaskErrorFallback({ task, onRetry, onRequestOpenFullPage }) {
  const { t } = useTranslation('attention');
  return (
    <div className="attention-state" role="alert">
      <AlertTriangle size={32} className="text-red-500" aria-hidden="true" />
      <p className="attention-state__title">{t('taskView.loadFailed')}</p>
      <p className="attention-state__text">{t('taskView.loadFailedBody')}</p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
        <button type="button" className="attention-btn" onClick={onRetry} data-track="ui.3a141f846f.1">
          {t('list.retry')}
        </button>
        <OpenFullPageButton task={task} onOpenFullPage={onRequestOpenFullPage} />
      </div>
    </div>
  );
}

function TaskBody({ task, onAttentionAction, onRequestOpenFullPage }) {
  const { t, i18n } = useTranslation('attention');
  const [retryKey, setRetryKey] = useState(0);
  const destination = task?.taskDestination;

  if (destination?.type === 'route' && destination.route) {
    return (
      <div className="attention-state">
        <p className="attention-state__text">{t('taskView.routeOnly')}</p>
        <OpenFullPageButton task={task} onOpenFullPage={onRequestOpenFullPage} />
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
      // Remount the boundary on retry or task change so a previous workflow
      // failure never sticks and each task starts from a clean state.
      const boundaryKey = `${task?.id ?? 'unknown'}:${retryKey}`;
      return (
        <AttentionTaskErrorBoundary
          key={boundaryKey}
          fallback={(
            <TaskErrorFallback
              task={task}
              onRetry={() => setRetryKey((k) => k + 1)}
              onRequestOpenFullPage={onRequestOpenFullPage}
            />
          )}
        >
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
        </AttentionTaskErrorBoundary>
      );
    }
    // Unknown component name or missing required props: never render a broken
    // workflow. Fall back to the route destination when one exists.
    if (destination.route) {
      return (
        <div className="attention-state">
          <p className="attention-state__text">{t('taskView.routeOnly')}</p>
          <OpenFullPageButton task={task} onOpenFullPage={onRequestOpenFullPage} />
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

// Routes through the modal's dirty-form guard when the caller supplies
// onOpenFullPage; falls back to a direct navigation for standalone use.
export function OpenFullPageButton({ task, onOpenFullPage }) {
  const { t } = useTranslation('attention');
  const navigate = useNavigate();
  const destination = task?.taskDestination;
  if (!destination?.route) return null;
  return (
    <button
      type="button"
      className="attention-btn attention-btn--primary"
      onClick={() => {
        if (onOpenFullPage) {
          onOpenFullPage();
        } else {
          navigate(buildFullPageUrl(destination));
        }
      }} data-track="ui.3a141f846f.2"
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

function ResolvedTaskState({ onBack }) {
  const { t } = useTranslation('attention');
  return (
    <div className="attention-task">
      <div className="attention-state" role="status">
        <CheckCircle2 size={32} className="text-green-500" aria-hidden="true" />
        <p className="attention-state__title">{t('taskView.resolvedTitle')}</p>
        <p className="attention-state__text">{t('taskView.resolvedBody')}</p>
        <button type="button" className="attention-btn" onClick={onBack} data-track="ui.3a141f846f.3">
          <ArrowLeft size={16} aria-hidden="true" /> {t('actions.backToAttention')}
        </button>
      </div>
    </div>
  );
}

// Replaces the modal body with the registered workflow for the selected task.
// Header: Back to attention | business + restaurant + task title | Open full
// page | Close. Must render inside a DirtyFormProvider (provided by
// AttentionModal) so workflows can flag unsaved edits via useDirtyForm().
// `resolved` renders an explicit resolved state when the task's underlying
// condition disappeared while the workflow was open.
export default function AttentionTaskView({
  task,
  onBack,
  onRequestClose,
  onRequestOpenFullPage,
  onAttentionAction,
  resolved = false,
}) {
  const { t, i18n } = useTranslation('attention');
  const crumbs = [task?.businessName, task?.restaurantName].filter(Boolean).join(' · ');

  if (resolved) {
    return <ResolvedTaskState onBack={onBack} />;
  }

  return (
      <div className="attention-task">
        <div className="attention-task__header">
          <button type="button" className="attention-btn" onClick={onBack} data-track="ui.3a141f846f.4">
            <ArrowLeft size={16} aria-hidden="true" /> {t('actions.backToAttention')}
          </button>
          <div className="attention-task__crumbs" title={`${crumbs} — ${taskTitle(task, t, i18n)}`}>
            {crumbs && <span>{crumbs} · </span>}
            <strong>{taskTitle(task, t, i18n)}</strong>
          </div>
          <OpenFullPageButton task={task} onOpenFullPage={onRequestOpenFullPage} />
          <button
            type="button"
            className="attention-btn attention-btn--icon"
            onClick={onRequestClose}
            aria-label={t('actions.close')} data-track="ui.3a141f846f.5"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="attention-task__body">
          <TaskBody task={task} onAttentionAction={onAttentionAction} onRequestOpenFullPage={onRequestOpenFullPage} />
        </div>
      </div>
  );
}
