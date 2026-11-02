import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../lib/adminApi';
import { useAbortableFetch } from '../../lib/useAbortableFetch';
import AdminErrorState from '../../lib/AdminErrorState';
import ConfirmDialog from '../../lib/ConfirmDialog';
import RsdPager from '../../lib/RsdPager';
import { adminDateTime, adminMoney } from '../../lib/formatters';

// Stripe chargebacks (super-admin only). The list endpoint returns open
// chargebacks by default; all=true returns every row. Submitting evidence is
// a manual action here: an auto-submit-before-deadline job already exists on
// the server, so this page is for visibility and manual submission, and the
// server returns 409 when evidence was already submitted.
const PAGE_LIMIT = 100;

function serverErrorMessage(err, fallback) {
  const serverError = err?.response?.data?.error;
  if (typeof serverError === 'string' && serverError) return serverError;
  if (serverError?.message) return serverError.message;
  return err?.message || fallback;
}

export default function Chargebacks() {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState(null);
  const [note, setNote] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');

  const { data, loading, error: loadError, reload } = useAbortableFetch(async (signal) => {
    const { data: body } = await adminApi.get('/admin/super/chargebacks', {
      signal,
      timeout: 15000,
      params: { ...(showAll ? { all: 'true' } : {}), limit: PAGE_LIMIT, offset },
    });
    return { chargebacks: body?.chargebacks || [], total: body?.total ?? 0 };
  }, [showAll, offset]);

  const chargebacks = data?.chargebacks || [];
  const total = data?.total ?? 0;

  const startSubmit = (chargeback) => {
    setSelected(chargeback);
    setNote('');
    setNotice('');
    setActionError('');
  };

  const submitEvidence = async () => {
    if (!selected) return;
    setBusyId(selected.id);
    setNotice('');
    setActionError('');
    try {
      await adminApi.post(`/admin/super/chargebacks/${selected.id}/submit`, { note });
      setConfirmOpen(false);
      setSelected(null);
      setNotice(t('adminChargebacks.submittedNotice', { id: selected.stripe_dispute_id }));
      reload();
    } catch (err) {
      setActionError(serverErrorMessage(err, t('adminChargebacks.submitFailed')));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-white text-xl font-bold mb-1">
        {t('adminChargebacks.title')}
      </h1>
      <p className="text-gray-400 text-sm mb-1">
        {t('adminChargebacks.subtitle')}
      </p>
      <p className="text-gray-400 text-sm mb-4">
        {t('adminChargebacks.autoSubmitNote')}
      </p>

      <div className="flex gap-2 mb-4 flex-wrap">
        <button
          type="button"
          onClick={() => { setShowAll(false); setOffset(0); setSelected(null); }}
          className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${!showAll ? 'bg-orange-500 text-white' : 'bg-slate-800 text-gray-300 hover:bg-slate-700'}`}
        >
          {t('adminChargebacks.showOpen')}
        </button>
        <button
          type="button"
          onClick={() => { setShowAll(true); setOffset(0); setSelected(null); }}
          className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${showAll ? 'bg-orange-500 text-white' : 'bg-slate-800 text-gray-300 hover:bg-slate-700'}`}
        >
          {t('adminChargebacks.showAll')}
        </button>
      </div>

      {loading && <p className="text-gray-400">{t('common.loading')}</p>}
      {loadError && !loading && (
        <AdminErrorState message={serverErrorMessage(loadError, t('adminChargebacks.loadFailed'))} onRetry={reload} />
      )}
      {actionError && (
        <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {actionError}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          {notice}
        </div>
      )}
      {!loading && !loadError && chargebacks.length === 0 && (
        <p className="text-gray-500">{t('adminChargebacks.empty')}</p>
      )}

      {!loading && !loadError && chargebacks.length > 0 && (
        <div className="space-y-3">
          {chargebacks.map((chargeback) => {
            const submitted = !!chargeback.evidence_submitted_at;
            const isSelected = selected?.id === chargeback.id;
            return (
              <div key={chargeback.id} className="bg-slate-900 border border-slate-700 rounded-xl p-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-white font-semibold">
                      {t('adminChargebacks.dispute', { id: chargeback.stripe_dispute_id })}
                      {' · '}
                      {chargeback.stripe_status}
                    </p>
                    <p className="text-gray-400 text-sm mt-1">
                      {t('adminChargebacks.amount', {
                        amount: adminMoney(Number(chargeback.amount_cents || 0) / 100, chargeback.currency_code || 'USD'),
                      })}
                      {chargeback.reason ? ` · ${t('adminChargebacks.reason', { reason: chargeback.reason })}` : ''}
                      {chargeback.stripe_charge_id ? ` · ${chargeback.stripe_charge_id}` : ''}
                    </p>
                    <p className="text-gray-400 text-sm">
                      {t('adminChargebacks.dueBy', { date: adminDateTime(chargeback.evidence_due_by) })}
                      {' · '}
                      {submitted
                        ? t('adminChargebacks.submittedAt', { date: adminDateTime(chargeback.evidence_submitted_at) })
                        : t('adminChargebacks.notSubmitted')}
                      {' · '}
                      {t('adminChargebacks.submissions', { count: chargeback.submission_count || 0 })}
                      {chargeback.auto_submitted ? ` · ${t('adminChargebacks.autoSubmitted')}` : ''}
                    </p>
                    {chargeback.last_error && (
                      <p className="text-red-400 text-sm mt-1">
                        {t('adminChargebacks.lastError', { error: chargeback.last_error })}
                      </p>
                    )}
                  </div>
                  {!submitted && (
                    <button
                      type="button"
                      onClick={() => (isSelected ? setSelected(null) : startSubmit(chargeback))}
                      className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-orange-500 text-white shrink-0"
                    >
                      {isSelected ? t('adminChargebacks.cancelSubmit') : t('adminChargebacks.submit')}
                    </button>
                  )}
                </div>

                {isSelected && !submitted && (
                  <div className="mt-4 border-t border-slate-700 pt-4 space-y-3">
                    <h2 className="text-white font-semibold text-sm">{t('adminChargebacks.submitTitle')}</h2>
                    <label className="block text-sm text-gray-300">
                      {t('adminChargebacks.noteLabel')}
                      <textarea
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        placeholder={t('adminChargebacks.notePlaceholder')}
                        rows={3}
                        className="mt-1 block w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-white"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={busyId === chargeback.id}
                      onClick={() => setConfirmOpen(true)}
                      className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-orange-500 text-white disabled:opacity-50"
                    >
                      {busyId === chargeback.id ? t('adminChargebacks.submitting') : t('adminChargebacks.reviewSubmit')}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && !loadError && (
        <RsdPager offset={offset} limit={PAGE_LIMIT} total={total} onPage={setOffset} />
      )}

      <ConfirmDialog
        open={confirmOpen && !!selected}
        title={t('adminChargebacks.submitConfirmTitle')}
        message={selected ? t('adminChargebacks.submitConfirmBody', { id: selected.stripe_dispute_id }) : ''}
        confirmLabel={t('adminChargebacks.submit')}
        onConfirm={submitEvidence}
        onClose={() => setConfirmOpen(false)}
      />
    </div>
  );
}
