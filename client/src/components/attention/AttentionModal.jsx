import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, X } from 'lucide-react';
import { getAttention } from '../../api/businesses';
import { DirtyFormProvider, useDirtyForm } from './useDirtyForm';
import { registerDialog, unregisterDialog, isTopDialog } from './dialogStack';
import AttentionList from './AttentionList';
import AttentionTaskView, { buildFullPageUrl } from './AttentionTaskView';
import './AttentionModal.css';

const PAGE_LIMIT = 20;

function serverErrorMessage(error) {
  const data = error?.response?.data;
  if (data && typeof data.error === 'string' && data.error.trim()) return data.error;
  if (data && typeof data.message === 'string' && data.message.trim()) return data.message;
  return null;
}

function focusableElements(root) {
  if (!root) return [];
  return [...root.querySelectorAll(
    'a[href], button:not([disabled]), select:not([disabled]), textarea:not([disabled]), ' +
    'input:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

// Nested confirm dialog for the dirty-form guard. Registers itself in the
// dialog stack so the focus trap and Escape handling move to it while open.
function ConfirmDiscardDialog({ onDiscard, onKeep }) {
  const { t } = useTranslation('attention');
  const id = useId();
  const dialogId = `attention-confirm-${id}`;
  const keepRef = useRef(null);

  useEffect(() => {
    registerDialog(dialogId);
    keepRef.current?.focus();
    return () => unregisterDialog(dialogId);
  }, [dialogId]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && isTopDialog(dialogId)) {
        event.stopPropagation();
        onKeep();
      }
      if (event.key === 'Tab' && isTopDialog(dialogId)) {
        const keep = keepRef.current;
        const discard = keep?.parentElement?.querySelector('[data-attention-discard]');
        const els = [keep, discard].filter(Boolean);
        if (els.length === 0) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [dialogId, onKeep]);

  return (
    <div className="attention-confirm-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onKeep();
    }}>
      <div className="attention-confirm" role="alertdialog" aria-modal="true" aria-labelledby={`${dialogId}-title`}>
        <p className="attention-confirm__title" id={`${dialogId}-title`}>{t('actions.confirmDiscard')}</p>
        <div className="attention-confirm__actions">
          <button type="button" className="attention-btn" ref={keepRef} onClick={onKeep}>
            {t('actions.keepEditing')}
          </button>
          <button type="button" className="attention-btn attention-btn--danger" data-attention-discard onClick={onDiscard}>
            {t('actions.discardChanges')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalContent({
  dialogId,
  dialogRef,
  titleId,
  businesses,
  initialBusinessId,
  fetchAttention,
  onClose,
  onAction,
}) {
  const { t } = useTranslation('attention');
  const { isDirty, clearDirty } = useDirtyForm();
  const navigate = useNavigate();

  const [view, setView] = useState('list');
  const [selectedTask, setSelectedTask] = useState(null);
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [resolvedNotice, setResolvedNotice] = useState(false);
  const [taskResolved, setTaskResolved] = useState(false);
  const [pendingNav, setPendingNav] = useState(null);
  const [filters, setFilters] = useState({
    businessId: initialBusinessId ? String(initialBusinessId) : '',
    category: '',
    urgency: '',
    page: 1,
  });

  const abortRef = useRef(null);
  const previousTaskRef = useRef(null);

  const fetchData = useCallback(async (nextFilters, { silent = false } = {}) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (!silent) {
      setStatus('loading');
      setError(null);
    }
    try {
      const params = {
        businessId: nextFilters.businessId || undefined,
        category: nextFilters.category || undefined,
        urgency: nextFilters.urgency || undefined,
        page: nextFilters.page || 1,
        limit: PAGE_LIMIT,
      };
      const result = await fetchAttention(params, controller.signal);
      if (controller.signal.aborted) return null;
      setData(result || null);
      setStatus('ready');
      return result;
    } catch (err) {
      if (controller.signal.aborted) return null;
      const httpStatus = err?.response?.status;
      if (httpStatus === 401 || httpStatus === 403) {
        setStatus('forbidden');
      } else {
        setStatus('error');
        setError(serverErrorMessage(err));
      }
      return null;
    }
  }, [fetchAttention]);

  // Initial load + refetch on filter change. Obsolete requests are aborted.
  useEffect(() => {
    fetchData(filters);
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.businessId, filters.category, filters.urgency, filters.page]);

  const go = useCallback((nav) => {
    if (nav === 'close') {
      onClose();
    } else if (nav === 'back') {
      previousTaskRef.current = selectedTask;
      setSelectedTask(null);
      setView('list');
      setTaskResolved(false);
      // Refresh so a task resolved inside the workflow surfaces as resolved
      // instead of lingering in the list.
      fetchData(filters, { silent: true }).then((result) => {
        const prev = previousTaskRef.current;
        const items = result?.items || [];
        if (prev && !items.some((item) => item.id === prev.id)) {
          setResolvedNotice(true);
        }
      });
    } else if (nav && nav.openFullPage && nav.task?.taskDestination?.route) {
      // "Open full page" travels the same dirty-form guard as Close/Back:
      // callers route through attemptNav, so a dirty workflow confirms before
      // discarding. Navigation replaces the page, unmounting the modal.
      navigate(buildFullPageUrl(nav.task.taskDestination));
    } else if (nav && nav.task) {
      setResolvedNotice(false);
      setTaskResolved(false);
      setSelectedTask(nav.task);
      setView('task');
    }
  }, [fetchData, filters, navigate, onClose, selectedTask]);

  const attemptNav = useCallback((nav) => {
    // Never silently discard: a dirty workflow must confirm first.
    if (isDirty) {
      setPendingNav(nav);
      return;
    }
    go(nav);
  }, [go, isDirty]);

  const handleConfirmDiscard = useCallback(() => {
    const nav = pendingNav;
    setPendingNav(null);
    clearDirty();
    go(nav);
  }, [clearDirty, go, pendingNav]);

  const handleKeepEditing = useCallback(() => setPendingNav(null), []);

  const handleTaskAction = useCallback(() => {
    // A workflow reported a successful action: refresh totals for the parent
    // and reload the list so resolved items disappear. If the open task's
    // underlying condition is gone from the refreshed list, surface an
    // explicit resolved state in the task view instead of letting the
    // workflow linger or vanish silently.
    onAction?.();
    const openTask = selectedTask;
    const taskViewOpen = view === 'task';
    fetchData(filters, { silent: true }).then((result) => {
      if (!taskViewOpen || !openTask) return;
      const items = result?.items || [];
      if (!items.some((item) => item.id === openTask.id)) {
        setTaskResolved(true);
      }
    });
  }, [fetchData, filters, onAction, selectedTask, view]);

  // Focus trap + Escape, scoped to the topmost dialog so nested confirmations
  // (e.g. financial confirm dialogs inside workflows) keep keyboard control.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (!isTopDialog(dialogId)) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        attemptNav('close');
        return;
      }
      if (event.key === 'Tab') {
        const els = focusableElements(dialogRef.current);
        if (els.length === 0) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [attemptNav, dialogId, dialogRef]);

  const onBackdropMouseDown = (event) => {
    if (event.target === event.currentTarget) attemptNav('close');
  };

  const totals = data?.totals || null;
  const items = data?.items || [];

  return (
    <div className="attention-backdrop" onMouseDown={onBackdropMouseDown}>
      <div
        ref={dialogRef}
        className="attention-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        {status === 'forbidden' ? (
          <>
            <div className="attention-modal__header">
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 id={titleId} className="attention-modal__title">{t('list.title')}</h2>
              </div>
              <button
                type="button"
                className="attention-btn attention-btn--icon"
                onClick={() => attemptNav('close')}
                aria-label={t('actions.close')}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="attention-modal__body">
              <div className="attention-state" role="alert">
                <ShieldAlert size={32} className="text-red-500" aria-hidden="true" />
                <p className="attention-state__title">{t('actions.accessRevoked')}</p>
                <button type="button" className="attention-btn" onClick={() => attemptNav('close')}>
                  {t('actions.close')}
                </button>
              </div>
            </div>
          </>
        ) : view === 'list' ? (
          <>
            <div className="attention-modal__header">
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 id={titleId} className="attention-modal__title">{t('list.title')}</h2>
                <p className="attention-modal__subtitle">{t('list.subtitle')}</p>
              </div>
              <button
                type="button"
                className="attention-btn attention-btn--icon"
                onClick={() => attemptNav('close')}
                aria-label={t('actions.close')}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="attention-modal__body">
              {resolvedNotice && (
                <div className="attention-banner attention-banner--info" role="status">
                  <span>{t('actions.resolvedTask')}</span>
                </div>
              )}
              <AttentionList
                items={items}
                totals={totals}
                freshness={data?.freshness}
                partialFailures={data?.partialFailures}
                businesses={businesses}
                filters={filters}
                onFilterChange={(next) => { setResolvedNotice(false); setFilters(next); }}
                page={data?.page || filters.page || 1}
                totalPages={data?.totalPages || 1}
                onPageChange={(page) => setFilters((prev) => ({ ...prev, page }))}
                onSelectTask={(task) => attemptNav({ task })}
                status={status}
                error={error}
                onRetry={() => fetchData(filters)}
              />
            </div>
          </>
        ) : (
          <div className="attention-modal__body attention-task__wrapper">
            <AttentionTaskView
              task={selectedTask}
              resolved={taskResolved}
              onBack={() => attemptNav('back')}
              onRequestClose={() => attemptNav('close')}
              onRequestOpenFullPage={() => attemptNav({ openFullPage: true, task: selectedTask })}
              onAttentionAction={handleTaskAction}
            />
          </div>
        )}
        {pendingNav && (
          <ConfirmDiscardDialog onDiscard={handleConfirmDiscard} onKeep={handleKeepEditing} />
        )}
      </div>
    </div>
  );
}

function ModalShell(props) {
  const dialogId = useId();
  const dialogRef = useRef(null);
  const titleId = `${dialogId}-title`;
  const returnFocusRef = useRef(null);

  useEffect(() => {
    registerDialog(`attention-modal-${dialogId}`);
    returnFocusRef.current = document.activeElement;
    // Move focus into the dialog; return it when the modal unmounts.
    const frame = requestAnimationFrame(() => {
      const els = focusableElements(dialogRef.current);
      (els[0] || dialogRef.current)?.focus?.();
    });
    return () => {
      cancelAnimationFrame(frame);
      unregisterDialog(`attention-modal-${dialogId}`);
      const returnTo = returnFocusRef.current;
      if (returnTo && typeof returnTo.focus === 'function') {
        try { returnTo.focus({ preventScroll: true }); } catch { /* noop */ }
      }
    };
  }, [dialogId]);

  return (
    <DirtyFormProvider>
      <ModalContent dialogId={`attention-modal-${dialogId}`} dialogRef={dialogRef} titleId={titleId} {...props} />
    </DirtyFormProvider>
  );
}

// Reusable dialog: large on desktop, full-screen on mobile. Backdrop click and
// Escape close it (with a dirty-form confirm when a workflow has unsaved
// edits). Focus is trapped, returned on close, and background scroll is locked
// via the dialog stack (nested dialogs keep working).
export default function AttentionModal({
  open,
  onClose,
  businesses = [],
  initialBusinessId = '',
  fetchAttention = getAttention,
  onAction,
}) {
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <ModalShell
      businesses={businesses}
      initialBusinessId={initialBusinessId}
      fetchAttention={fetchAttention}
      onClose={onClose}
      onAction={onAction}
    />,
    document.body,
  );
}
