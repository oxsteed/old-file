// OxSteed Invest "My investments".
//
// Separate sections for pending commitments, completed investments,
// cancelled or unsuccessful commitments, entity updates, distributions
// and adjustments, agreements and statements, and support requests.
// No live portfolio market value is shown anywhere: there is no
// defensible methodology for one, so only committed and distributed
// amounts appear. A suspended account renders its own records read-only
// with a clear notice; writes show the server's 403.
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/PageShell';
import EmptyState from '../../components/EmptyState';
import { Inbox } from 'lucide-react';
import { getMyInvestments, cancelCommitment, createSupportRequest, reconfirmAmendment } from '../../api/invest';
import { formatInvestCents, applicationStatusLabel } from '../../utils/invest';
import { InvestError, InvestLoading, InvestNotice, InvestSection, InvestField, formatInvestDate, investButtonClassName, investInputClassName, investSecondaryButtonClassName } from './InvestShared';

function MoneyList({ items, emptyTitle, emptyCopy, renderItem }) {
  if (!items || items.length === 0) {
    return <EmptyState icon={Inbox} title={emptyTitle} copy={emptyCopy} />;
  }
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.id} className="rounded-xl border border-gray-800 bg-gray-800/50 px-4 py-3">
          {renderItem(item)}
        </li>
      ))}
    </ul>
  );
}

export default function InvestMyInvestmentsPage() {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [supportSubject, setSupportSubject] = useState('');
  const [supportDetails, setSupportDetails] = useState('');
  const [supportCategory, setSupportCategory] = useState('investment');
  const [supportError, setSupportError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getMyInvestments());
    } catch (e) {
      setError(e?.response?.data?.error || e.message || t('invest.my.error.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const cancel = async (commitmentId) => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await cancelCommitment(commitmentId);
      setNotice(t('invest.my.cancelledNotice'));
      await load();
    } catch (e) {
      setError(e?.response?.data?.error || e.message || t('invest.my.error.cancelFailed'));
    } finally {
      setBusy(false);
    }
  };

  const reconfirm = async (amendment) => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await reconfirmAmendment(amendment.opportunityId, amendment.id);
      setNotice(t('invest.my.reconfirmed'));
      await load();
    } catch (e) {
      setError(e?.response?.data?.error || e.message || t('invest.my.error.reconfirmFailed'));
    } finally {
      setBusy(false);
    }
  };

  const submitSupport = async (event) => {
    event.preventDefault();
    setSupportError(null);
    if (!supportSubject.trim() || !supportDetails.trim()) {
      setSupportError(t('invest.my.support.required'));
      return;
    }
    setBusy(true);
    try {
      await createSupportRequest({ category: supportCategory, subject: supportSubject.trim(), details: supportDetails.trim() });
      setSupportSubject('');
      setSupportDetails('');
      setNotice(t('invest.my.support.sent'));
      await load();
    } catch (e) {
      setSupportError(e?.response?.data?.error || e.message || t('invest.my.support.failed'));
    } finally {
      setBusy(false);
    }
  };

  const readOnly = !!data?.restrictedRead || !!data?.suspended;

  return (
    <PageShell>
      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold text-white">{t('invest.my.title')}</h1>
        <p className="mt-2 text-sm text-gray-400 leading-relaxed">{t('invest.my.intro')}</p>

        {loading ? <InvestLoading label={t('invest.common.loading')} /> : null}
        {error ? <div className="mt-6"><InvestError message={error} retryLabel={t('invest.common.retry')} onRetry={load} /></div> : null}
        {notice ? <div className="mt-6"><InvestNotice tone="ok">{notice}</InvestNotice></div> : null}

        {!loading && !error && data ? (
          <div className="mt-6 flex flex-col gap-6">
            {readOnly ? (
              <InvestNotice tone="warn">{t('invest.my.suspendedNotice')}</InvestNotice>
            ) : null}
            {typeof data.eligibleCreditCents === 'number' ? (
              <p className="text-sm text-gray-300">
                {t('invest.my.eligibleBalance', { amount: formatInvestCents(data.eligibleCreditCents, 'USD') })}
              </p>
            ) : null}

            {(data.reconfirmationRequired || []).length > 0 ? (
              <InvestSection title={t('invest.my.reconfirmation.title')} hint={t('invest.my.reconfirmation.hint')}>
                {data.reconfirmationRequired.map((item) => (
                  <div key={`${item.amendmentId}-${item.commitmentId}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
                    <p className="text-sm text-amber-200">{t('invest.my.reconfirmation.item')}</p>
                    <button
                      type="button"
                      disabled={busy || readOnly}
                      onClick={() => reconfirm({ id: item.amendmentId, opportunityId: item.opportunityId })}
                      className={investButtonClassName}
                    >
                      {t('invest.my.reconfirmation.button')}
                    </button>
                  </div>
                ))}
              </InvestSection>
            ) : null}

            <InvestSection title={t('invest.my.pending.title')} hint={t('invest.my.pending.hint')}>
              <MoneyList
                items={data.pending}
                emptyTitle={t('invest.my.pending.empty.title')}
                emptyCopy={t('invest.my.pending.empty.copy')}
                renderItem={(item) => (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-white">{item.opportunityTitle}</p>
                      <p className="mt-1 text-sm text-gray-300">
                        {formatInvestCents(item.amountCents, item.currencyCode || 'USD')}
                        {' - '}
                        {t('invest.my.pending.status')}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        {t('invest.my.agreementVersion', { version: item.agreementVersionNumber })}
                      </p>
                    </div>
                    {!readOnly ? (
                      <button type="button" disabled={busy} onClick={() => cancel(item.id)} className={investSecondaryButtonClassName}>
                        {t('invest.my.pending.cancel')}
                      </button>
                    ) : null}
                  </div>
                )}
              />
            </InvestSection>

            <InvestSection title={t('invest.my.completed.title')} hint={t('invest.my.completed.hint')}>
              <MoneyList
                items={[...(data.positions || []), ...(data.completed || [])]}
                emptyTitle={t('invest.my.completed.empty.title')}
                emptyCopy={t('invest.my.completed.empty.copy')}
                renderItem={(item) => (
                  <div>
                    <p className="text-sm font-medium text-white">{item.opportunityTitle}</p>
                    <p className="mt-1 text-sm text-gray-300">
                      {formatInvestCents(item.amountCents, item.currencyCode || 'USD')}
                      {' - '}
                      {t('invest.my.completed.status')}
                    </p>
                    {item.acquiredAt ? (
                      <p className="mt-1 text-xs text-gray-500">{formatInvestDate(item.acquiredAt)}</p>
                    ) : null}
                  </div>
                )}
              />
            </InvestSection>

            <InvestSection title={t('invest.my.cancelled.title')} hint={t('invest.my.cancelled.hint')}>
              <MoneyList
                items={data.cancelled}
                emptyTitle={t('invest.my.cancelled.empty.title')}
                emptyCopy={t('invest.my.cancelled.empty.copy')}
                renderItem={(item) => (
                  <div>
                    <p className="text-sm font-medium text-white">{item.opportunityTitle}</p>
                    <p className="mt-1 text-sm text-gray-300">{formatInvestCents(item.amountCents, item.currencyCode || 'USD')}</p>
                    {item.cancellationReason ? <p className="mt-1 text-xs text-gray-500">{item.cancellationReason}</p> : null}
                  </div>
                )}
              />
            </InvestSection>

            <InvestSection title={t('invest.my.applications.title')}>
              <MoneyList
                items={data.applications}
                emptyTitle={t('invest.my.applications.empty.title')}
                emptyCopy={t('invest.my.applications.empty.copy')}
                renderItem={(item) => (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-white">{item.opportunityTitle}</p>
                      <p className="mt-1 text-sm text-gray-300">{applicationStatusLabel(item.status, t)}</p>
                      {item.reviewNote ? <p className="mt-1 text-xs text-amber-200">{item.reviewNote}</p> : null}
                    </div>
                    <Link to={`/invest/apply?opportunityId=${item.opportunityId}`} className={investSecondaryButtonClassName}>
                      {t('invest.my.applications.view')}
                    </Link>
                  </div>
                )}
              />
            </InvestSection>

            <InvestSection title={t('invest.my.updates.title')} hint={t('invest.my.updates.hint')}>
              <MoneyList
                items={data.updates}
                emptyTitle={t('invest.my.updates.empty.title')}
                emptyCopy={t('invest.my.updates.empty.copy')}
                renderItem={(item) => (
                  <div>
                    <p className="text-sm font-medium text-white">{item.title}</p>
                    <p className="mt-1 text-sm text-gray-300 leading-relaxed">{item.body}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {item.status === 'overdue' ? t('invest.my.updates.overdue') : formatInvestDate(item.dueAt) || formatInvestDate(item.publishedAt) || ''}
                    </p>
                  </div>
                )}
              />
            </InvestSection>

            <InvestSection title={t('invest.my.distributions.title')} hint={t('invest.my.distributions.hint')}>
              <MoneyList
                items={data.distributions}
                emptyTitle={t('invest.my.distributions.empty.title')}
                emptyCopy={t('invest.my.distributions.empty.copy')}
                renderItem={(item) => (
                  <div>
                    <p className="text-sm font-medium text-white">{item.opportunityTitle}</p>
                    <p className="mt-1 text-sm text-gray-300">
                      {formatInvestCents(item.amountCents, item.currencyCode || 'USD')}
                      {' - '}
                      {item.status}
                    </p>
                  </div>
                )}
              />
            </InvestSection>

            <InvestSection title={t('invest.my.agreements.title')} hint={t('invest.my.agreements.hint')}>
              <MoneyList
                items={data.agreements}
                emptyTitle={t('invest.my.agreements.empty.title')}
                emptyCopy={t('invest.my.agreements.empty.copy')}
                renderItem={(item) => (
                  <div>
                    <p className="text-sm font-medium text-white">
                      {t('invest.my.agreementVersion', { version: item.versionNumber })}
                    </p>
                    <p className="mt-1 break-all font-mono text-xs text-gray-400">{item.contentHash}</p>
                    {item.createdAt ? <p className="mt-1 text-xs text-gray-500">{formatInvestDate(item.createdAt)}</p> : null}
                  </div>
                )}
              />
            </InvestSection>

            <InvestSection title={t('invest.my.support.title')} hint={t('invest.my.support.hint')}>
              <form onSubmit={submitSupport} className="flex flex-col gap-3">
                <InvestField label={t('invest.my.support.category')}>
                  <select value={supportCategory} onChange={(e) => setSupportCategory(e.target.value)} className={investInputClassName} disabled={readOnly}>
                    <option value="investment">{t('invest.my.support.categoryInvestment')}</option>
                    <option value="complaint">{t('invest.my.support.categoryComplaint')}</option>
                    <option value="distribution">{t('invest.my.support.categoryDistribution')}</option>
                    <option value="agreement">{t('invest.my.support.categoryAgreement')}</option>
                  </select>
                </InvestField>
                <InvestField label={t('invest.my.support.subject')}>
                  <input type="text" value={supportSubject} onChange={(e) => setSupportSubject(e.target.value)} className={investInputClassName} disabled={readOnly} />
                </InvestField>
                <InvestField label={t('invest.my.support.details')}>
                  <textarea rows={4} value={supportDetails} onChange={(e) => setSupportDetails(e.target.value)} className={investInputClassName} disabled={readOnly} />
                </InvestField>
                {supportError ? <p className="text-sm text-red-300" role="alert">{supportError}</p> : null}
                <div>
                  <button type="submit" disabled={busy || readOnly} className={investButtonClassName}>
                    {t('invest.my.support.submit')}
                  </button>
                </div>
              </form>
              <MoneyList
                items={data.support}
                emptyTitle={t('invest.my.support.empty.title')}
                emptyCopy={t('invest.my.support.empty.copy')}
                renderItem={(item) => (
                  <div>
                    <p className="text-sm font-medium text-white">{item.subject}</p>
                    <p className="mt-1 text-sm text-gray-300">
                      {t('invest.my.support.ticket', { number: item.ticketNumber, status: item.status })}
                    </p>
                  </div>
                )}
              />
            </InvestSection>

            <div>
              <Link to="/invest" className={investSecondaryButtonClassName}>{t('invest.directory.title')}</Link>
            </div>
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}
