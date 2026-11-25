import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';
import PageMeta from '../../components/PageMeta';
import AuditRequestDetail from '../../components/statements/AuditRequestDetail';
import api from '../../api/axios';

// Group 14 Slice 5d (716-720): the requester's audit-request home — file
// a request, watch the queue of your own requests, and open a request to
// approve evidence, share it with an auditor, follow up, and see receipts.
// Admins reach the same workflow from the admin audit-requests queue;
// auditors see only requests where they hold an active grant.
export default function AuditRequestsPage() {
  const { t, i18n } = useTranslation('credit');
  const text = (key, options = {}) => t(`statements.auditRequests.${key}`, options);
  const [requests, setRequests] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [title, setTitle] = useState('');
  const [auditType, setAuditType] = useState('financial');
  const [scope, setScope] = useState('');
  const [auditorEmail, setAuditorEmail] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const res = await api.get('/audit-requests', { params: { page: 1, pageSize: 20 } });
      setRequests(res.data?.requests || []);
      setStatus('ready');
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || text('loadError'));
      setStatus('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await api.post('/audit-requests', {
        title: title.trim(),
        auditType,
        scope: scope.trim(),
        auditorEmail: auditorEmail.trim() || undefined,
      });
      setTitle('');
      setScope('');
      setAuditorEmail('');
      setNotice(text('requestCreated'));
      setSelectedId(res.data?.request?.id || null);
      await load();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || text('loadError'));
    } finally {
      setBusy(false);
    }
  };

  const statusLabel = (value) => text(value === 'open' ? 'statusOpen' : value === 'in_review' ? 'statusInReview' : 'statusClosed');
  const formatDate = (value) => {
    if (!value) return '';
    try {
      return new Intl.DateTimeFormat(i18n.language || 'en', { dateStyle: 'medium' }).format(new Date(value));
    } catch {
      return String(value);
    }
  };

  return <div dir={i18n.dir()}>
    <PageMeta title={text('title')} description={text('description')} noIndex />
    <Navbar />
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-orange-600">{text('eyebrow')}</p>
        <h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{text('title')}</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{text('description')}</p>
        <p className="mt-2 text-sm"><Link className="font-semibold text-sky-600 hover:underline dark:text-sky-400" to="/statements">{text('backToStatements')}</Link></p>
      </header>
      {notice && <p role="status" className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">{notice}</p>}
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</p>}
      {selectedId ? <div className="mt-6">
        <AuditRequestDetail apiClient={api} requestId={selectedId} onBack={() => { setSelectedId(null); load(); }} />
      </div> : <>
        <section aria-labelledby="audit-create-heading" className="mt-6 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
          <h2 id="audit-create-heading" className="text-sm font-bold text-gray-900 dark:text-white">{text('createTitle')}</h2>
          <form className="mt-3 space-y-3" onSubmit={create}>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">{text('titleLabel')}
              <input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal dark:border-gray-700 dark:bg-gray-900" />
            </label>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">{text('typeLabel')}
              <select value={auditType} onChange={(event) => setAuditType(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal dark:border-gray-700 dark:bg-gray-900">
                <option value="financial">{text('typeFinancial')}</option>
                <option value="compliance">{text('typeCompliance')}</option>
                <option value="tax">{text('typeTax')}</option>
                <option value="operational">{text('typeOperational')}</option>
                <option value="other">{text('typeOther')}</option>
              </select>
            </label>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">{text('scopeLabel')}
              <textarea value={scope} onChange={(event) => setScope(event.target.value)} required maxLength={2000} rows={3}
                placeholder={text('scopePlaceholder')}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal dark:border-gray-700 dark:bg-gray-900" />
            </label>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">{text('auditorEmailLabel')}
              <input type="email" value={auditorEmail} onChange={(event) => setAuditorEmail(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal dark:border-gray-700 dark:bg-gray-900" />
              <span className="mt-1 block font-normal text-gray-500">{text('auditorEmailHelp')}</span>
            </label>
            <button type="submit" disabled={busy || !title.trim() || !scope.trim()} className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{text('create')}</button>
          </form>
        </section>
        <section aria-labelledby="audit-queue-heading" className="mt-6 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
          <h2 id="audit-queue-heading" className="text-sm font-bold text-gray-900 dark:text-white">{text('queueTitle')}</h2>
          {status === 'loading' && <p role="status" className="mt-3 text-sm text-gray-500">{text('loading')}</p>}
          {status === 'error' && <button type="button" onClick={load} className="mt-3 rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold dark:border-gray-700">{text('retry')}</button>}
          {status === 'ready' && !requests.length && <p className="mt-3 text-sm text-gray-500">{text('noRequests')}</p>}
          {status === 'ready' && requests.length > 0 && <ul className="mt-3 space-y-2">
            {requests.map((item) => <li key={item.id}>
              <button type="button" onClick={() => setSelectedId(item.id)}
                className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-3 text-left text-sm hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-800">
                <span><strong><bdi>{item.title}</bdi></strong><span className="block text-xs text-gray-500">{text(`type${item.auditType.charAt(0).toUpperCase()}${item.auditType.slice(1)}`)} · {formatDate(item.createdAt)}{item.viaGrant ? ` · ${text('viaGrant')}` : ''}</span></span>
                <span className="text-xs text-gray-500">{statusLabel(item.status)} · {item.approvedCount}/{item.evidenceCount} {text('evidenceApprovedShort')}</span>
              </button>
            </li>)}
          </ul>}
        </section>
      </>}
    </main>
    <Footer />
  </div>;
}
