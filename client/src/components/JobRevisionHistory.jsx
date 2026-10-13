import React, { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate, formatMoney } from '../lib/format';
import { revisionFieldKeys, revisionSourceKey, revisionValue } from '../utils/jobRevisionFormat';

/**
 * Change history for a posted job. Owners see every edit; bidders see the
 * material changes (the server filters private fields). Admin tools pass
 * `onRollback` to offer a rollback per revision.
 */
export default function JobRevisionHistory({ jobId, revision, version, load, onRollback = null, currency = 'USD', defaultOpen = false }) {
  const { t } = useTranslation();
  const headingId = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [state, setState] = useState({ status: 'idle', items: [], next: null });

  const fetchPage = useCallback(async (before = null) => {
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      const data = await load(jobId, before ? { before } : {});
      setState((s) => ({
        status: 'success',
        items: before ? [...s.items, ...(data.revisions || [])] : (data.revisions || []),
        next: data.next_before || null,
      }));
    } catch {
      setState((s) => ({ ...s, status: 'error' }));
    }
  }, [jobId, load]);

  useEffect(() => { if (open) void fetchPage(); }, [open, fetchPage, revision, version]);

  return (
    <section className="jdp-card jdp-revisions" aria-labelledby={headingId}>
      <h2 id={headingId} className="jdp-section-title">{t('jobEdit.historyTitle')}</h2>
      <button type="button" className="jdp-btn-ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? t('jobEdit.historyHide') : t('jobEdit.historyShow')}
      </button>
      {open && <div aria-live="polite" aria-busy={state.status === 'loading'}>
        {state.status === 'loading' && !state.items.length && <p role="status">{t('jobEdit.historyLoading')}</p>}
        {state.status === 'error' && <div role="alert"><p>{t('jobEdit.historyFailed')}</p>
          <button type="button" className="jdp-btn-ghost" onClick={() => fetchPage()}>{t('jobDetail.retry')}</button></div>}
        {state.status === 'success' && !state.items.length && <p>{t('jobEdit.historyEmpty')}</p>}
        {state.items.length > 0 && <ol className="jdp-revision-list">
          {state.items.map((item) => (
            <li key={item.id} className="jdp-revision-item">
              <p className="jdp-small-heading">
                <time dateTime={item.created_at}>{formatDate(item.created_at, { month: 'short', hour: 'numeric', minute: '2-digit' })}</time>
                {' · '}{t(`jobEdit.sources.${revisionSourceKey(item.source)}`)}
                {item.is_material && <> · <strong>{t('jobEdit.materialBadge')}</strong></>}
              </p>
              <ul>
                {Object.entries(item.changes || {}).map(([field, change]) => (
                  <li key={field}>
                    <span>{t(`jobEdit.fields.${revisionFieldKeys({ [field]: true })[0]}`)}</span>{': '}
                    <bdi>{revisionValue(field, change?.from, { formatMoney, formatDate, currency })}</bdi>{` ${t('jobEdit.changeArrow')} `}
                    <bdi>{revisionValue(field, change?.to, { formatMoney, formatDate, currency })}</bdi>
                  </li>
                ))}
              </ul>
              {item.reason && <p className="jdp-count">{t('jobEdit.reasonShown', { reason: item.reason })}</p>}
              {onRollback && <button type="button" className="jdp-btn-ghost" onClick={() => onRollback(item)}>{t('jobEdit.rollback')}</button>}
            </li>
          ))}
        </ol>}
        {state.next && <button type="button" className="jdp-btn-ghost" disabled={state.status === 'loading'} onClick={() => fetchPage(state.next)}>{t('jobEdit.historyMore')}</button>}
      </div>}
    </section>
  );
}
