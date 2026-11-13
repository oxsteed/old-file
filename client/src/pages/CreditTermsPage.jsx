import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import api from '../api/axios';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import '../components/paymentLayers/CreditLicencePanels.css';
import { CREDIT_TERMS_CURRENCIES, pendingLegalApproval } from '../lib/creditTerms';

/**
 * Gap fill 13: OxSteed Credit terms readable before signing in, from the
 * public GET /payment-layers/credit/disclosures (no account, nothing
 * recorded). Text that legal has not approved yet is clearly marked and the
 * page is kept out of search engines until every item is approved.
 */
export default function CreditTermsPage() {
  const { t, i18n } = useTranslation();
  const [currency, setCurrency] = useState('USD');
  const [state, setState] = useState({ status: 'loading', items: [] });
  const [retryNonce, setRetryNonce] = useState(0);
  const lang = i18n.resolvedLanguage || i18n.language || 'en';

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, status: 'loading' }));
    api.get('/payment-layers/credit/disclosures', { params: { lang, currency }, signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setState({ status: 'ready', items: data.disclosures || [] }); })
      .catch(() => { if (!controller.signal.aborted) setState({ status: 'error', items: [] }); });
    return () => controller.abort();
  }, [lang, currency, retryNonce]);

  const pending = pendingLegalApproval(state.items);
  return (
    <PageShell>
      <PageMeta title={t('creditTermsPage.metaTitle')} description={t('creditTermsPage.metaDescription')} noIndex={state.status !== 'ready' || pending} />
      <article className="ox-licence-panel mx-auto max-w-3xl px-4 py-10" dir={i18n.dir?.()} data-page="credit-terms">
        <h1 className="text-2xl font-bold">{t('creditTermsPage.title')}</h1>
        <p className="ox-licence-copy">{t('creditTermsPage.intro')}</p>
        <label className="mt-4 inline-flex items-center gap-2 text-sm">
          {t('creditTermsPage.currency')}
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} dir="ltr">
            {CREDIT_TERMS_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        {state.status === 'loading' && <p role="status" className="ox-licence-copy">{t('creditTermsPage.loading')}</p>}
        {state.status === 'error' && (
          <div>
            <p role="alert" className="ox-licence-copy">{t('creditTermsPage.loadFailed')}</p>
            <button type="button" className="ox-credit-refresh" onClick={() => setRetryNonce((n) => n + 1)}>{t('creditTermsPage.retry')}</button>
          </div>
        )}
        {state.status === 'ready' && pending && (
          <p role="note" data-pending-legal="true" className="ox-licence-terms mt-4">
            <strong>{t('creditTermsPage.pendingTitle')}</strong> {t('creditTermsPage.pendingBody')}
          </p>
        )}
        {state.status === 'ready' && (
          <div className="ox-licence-body ox-licence-body--flush mt-4">
            {state.items.length === 0 && <p role="status" className="ox-licence-copy">{t('creditTermsPage.noTerms')}</p>}
            {state.items.map((item) => (
              <section key={item.kind} className="ox-licence-terms" lang={item.language} data-kind={item.kind}>
                <h2 className="text-base font-semibold">
                  {item.title}
                  {(item.placeholder || !item.approved_reference) && <span className="ox-licence-status">{t('creditTermsPage.draftBadge')}</span>}
                </h2>
                <p>{item.body}</p>
                {item.version > 0 && <small className="ox-licence-copy">{t('creditTermsPage.version', { version: item.version })}</small>}
              </section>
            ))}
          </div>
        )}
        <p className="ox-licence-copy mt-6">
          {t('creditTermsPage.acceptNote')} <Link to="/login">{t('creditTermsPage.signIn')}</Link>
        </p>
      </article>
    </PageShell>
  );
}
