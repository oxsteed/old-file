import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, Briefcase, FileText, WalletCards } from 'lucide-react';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';
import PageMeta from '../../components/PageMeta';
import StatementSearch from '../../components/statements/StatementSearch';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/axios';
import { buildStatementAccounts, statementAccountPath, statementScopeAccountId } from '../../lib/statementAccounts';
import './StatementCenterPage.css';

const CreditStatementsPage = lazy(() => import('./CreditStatementsPage'));
const StatementArchivePage = lazy(() => import('./StatementArchivePage'));

export default function StatementCenterPage() {
  const { t, i18n } = useTranslation('credit');
  const { user } = useAuth();
  const userId = user?.id ? String(user.id) : '';
  const [params, setParams] = useSearchParams();
  const text = (key, options = {}) => t(`statements.center.${key}`, options);
  const [center, setCenter] = useState({ owner: null, status: 'loading', products: null });
  const [retry, setRetry] = useState(0);
  const heading = useRef(null);
  const accountButtons = useRef(new Map());
  const lastAccount = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    setCenter({ owner: userId, status: 'loading', products: null });
    if (!userId) return () => controller.abort();
    api.get('/statements/center', { signal: controller.signal }).then(response => {
      if (controller.signal.aborted) return;
      const products = response.data?.products;
      if (!products || typeof products !== 'object' || Array.isArray(products)) throw new Error('Invalid statement center');
      setCenter({ owner: userId, status: 'ready', products });
    }).catch(() => {
      if (!controller.signal.aborted) setCenter({ owner: userId, status: 'error', products: null });
    });
    return () => controller.abort();
  }, [userId, retry]);

  const current = center.owner === userId ? center : { status: 'loading', products: null };
  const accounts = useMemo(() => buildStatementAccounts(current.products), [current.products]);
  const account = accounts.find(item => item.key === params.get('statementAccount'));
  const record = account?.records.find(item => item.key === params.get('statementRecord')) || account?.records[0];
  const scope = record?.scopes.find(item => item.scopeKey === params.get('statementScope')) || record?.scopes[0];
  const archive = !record?.personal || params.get('statementView') === 'archive';
  const failures = Object.values(current.products || {}).some(item => item?.loadError);
  const accountLabel = item => item.labelKey ? text(item.labelKey) : item.label;

  useEffect(() => {
    if (account) heading.current?.focus();
    else if (lastAccount.current) accountButtons.current.get(lastAccount.current)?.focus();
    lastAccount.current = account?.key;
  }, [account?.key]);

  const fullPage = record && scope ? new URL(statementAccountPath(record, scope, userId, archive), 'https://oxsteed.com') : null;
  for (const key of ['from', 'to', 'year', 'month']) {
    if (fullPage && params.has(key)) fullPage.searchParams.set(key, params.get(key));
  }

  function choose(nextAccount, nextRecord, nextScope, showArchive = false) {
    const next = new URLSearchParams();
    if (nextAccount) {
      const selectedRecord = nextRecord || nextAccount.records[0];
      const selectedScope = nextScope || selectedRecord.scopes[0];
      next.set('statementAccount', nextAccount.key);
      next.set('statementRecord', selectedRecord.key);
      next.set('statementScope', selectedScope.scopeKey);
      if (showArchive) next.set('statementView', 'archive');
      if (nextAccount.key === account?.key) {
        for (const key of ['from', 'to', 'year', 'month']) {
          if (params.has(key)) next.set(key, params.get(key));
        }
      }
    }
    setParams(next);
  }

  return <div className="statement-center-shell" dir={i18n.dir()}>
    <PageMeta title={text('title')} description={text('accountFlowDescription')} noIndex />
    <Navbar />
    <main className="statement-center-page">
      <header className="statement-center-header">
        <FileText size={34} aria-hidden="true" />
        <div><p className="statement-center-eyebrow">{text('eyebrow')}</p>
          <h1>{text('title')}</h1><p>{text('accountFlowDescription')}</p></div>
      </header>
      <p className="statement-center-scope" role="note">{text('separateAccountsNote')}</p>
      {current.status === 'loading' && <div className="statement-center-state" role="status">{text('loading')}</div>}
      {(current.status === 'error' || failures) && <div className="statement-center-state" role="alert">
        <p>{text(current.status === 'error' ? 'loadError' : 'partialLoadError')}</p>
        <button type="button" className="statement-center-preview-btn" onClick={() => setRetry(value => value + 1)}>{text('retry')}</button>
      </div>}
      {current.status === 'ready' && !account && <>
        <h2 className="statement-center-section-title">{text('accountsTitle')}</h2>
        {params.has('statementAccount') && <p role="status">{text('accountUnavailable')}</p>}
        {!accounts.length && !failures && <div className="statement-center-state" role="status"><p>{text('noAccountsYet')}</p></div>}
        <div className="statement-center-groups">
          {['personal', 'work'].map(group => {
            const visible = accounts.filter(item => item.group === group);
            if (!visible.length) return null;
            const Icon = group === 'personal' ? WalletCards : Briefcase;
            return <section key={group} className="statement-center-group" aria-labelledby={`statement-${group}`}>
              <div className="statement-center-group-heading"><div>
                <h3 id={`statement-${group}`}>{text(`${group}Title`)}</h3><p>{text(`${group}Description`)}</p>
              </div></div>
              <div className="statement-center-grid">{visible.map(item => <button key={item.key} type="button"
                className="statement-center-account" onClick={() => choose(item)}
                ref={node => { if (node) accountButtons.current.set(item.key, node); else accountButtons.current.delete(item.key); }}>
                <Icon size={24} aria-hidden="true" /><span><strong><bdi>{accountLabel(item)}</bdi></strong>
                  <span>{item.records.map(value => text(`record_${value.product}`)).join(' · ')}</span>
                  <span><bdi>{[...new Set(item.records.flatMap(value => value.scopes.map(value => value.currency)).filter(Boolean))].join(' · ')}</bdi></span>
                </span><ArrowRight size={20} aria-hidden="true" />
              </button>)}</div>
            </section>;
          })}
        </div>
        <details className="statement-center-search"><summary>{text('searchAllRecords')}</summary><StatementSearch key={userId} /></details>
      </>}
      {current.status === 'ready' && account && record && scope && <section className="statement-center-selected" aria-labelledby="statement-account-heading">
        <button type="button" className="statement-center-preview-btn" onClick={() => choose(null)}><ArrowLeft size={16} aria-hidden="true" />{text('changeAccount')}</button>
        <div className="statement-center-selected-heading"><h2 id="statement-account-heading" tabIndex={-1} ref={heading}><bdi>{accountLabel(account)}</bdi></h2>
          <Link className="statement-center-secondary" to={`${fullPage.pathname}${fullPage.search}`}>{text('openFullPage')}<ArrowRight size={16} aria-hidden="true" /></Link>
        </div>
        <div className="statement-center-records" role="group" aria-label={text('recordType')}>
          {account.records.map(item => <button key={item.key} type="button" className="statement-center-preview-btn"
            aria-pressed={item.key === record.key} onClick={() => choose(account, item)}>{text(`record_${item.product}`)}</button>)}
        </div>
        {record.scopes.length > 1 && <div className="statement-center-scope-picker"><label htmlFor="statement-center-scope">{text('accountCurrency')}</label>
          <select id="statement-center-scope" value={scope.scopeKey} onChange={event => choose(account, record, record.scopes.find(item => item.scopeKey === event.target.value), archive)}>
            {record.scopes.map(item => <option key={item.scopeKey} value={item.scopeKey}>{[account.labelKey ? accountLabel(account) : item.label, item.currency].filter(Boolean).join(' · ')}</option>)}
          </select></div>}
        {record.scopes.length === 1 && scope.currency && <p className="statement-center-currency"><bdi>{scope.currency}</bdi></p>}
        {record.personal && <div className="statement-center-records" role="group" aria-label={text('statementView')}>
          <button type="button" className="statement-center-preview-btn" aria-pressed={!archive} onClick={() => choose(account, record, scope)}>{text('periodActivity')}</button>
          <button type="button" className="statement-center-preview-btn" aria-pressed={archive} onClick={() => choose(account, record, scope, true)}>{text('archive')}</button>
        </div>}
        <Suspense fallback={<p role="status">{text('loading')}</p>}>
          {archive ? <StatementArchivePage key={`${userId}/${record.key}/${scope.scopeKey}/archive`} embedded product={record.product}
            accountScope={{ accountId: statementScopeAccountId(record, scope, userId), restaurantId: scope.restaurantId, currency: scope.currency, name: scope.label }} />
            : <CreditStatementsPage key={`${userId}/${record.key}/${scope.scopeKey}`} embedded product={record.product} accountScope={scope} />}
        </Suspense>
      </section>}
    </main>
    <Footer />
  </div>;
}
