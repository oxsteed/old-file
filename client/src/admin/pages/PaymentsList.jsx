import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import adminApi from '../../lib/adminApi';

const STATUSES = ['', 'pending', 'authorized', 'captured', 'released', 'refunded', 'failed', 'disputed'];

export default function PaymentsList() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await adminApi.get('/admin/payments', {
        params: { page, limit: 25, status: status || undefined },
      });
      setRows(data.payments || []);
      setTotal(data.total || 0);
    } catch (e) {
      const msg = e.response?.data?.error || 'Failed to load payments.';
      setError(msg);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-4 sm:p-8">
      <h1 className="text-2xl font-bold text-white mb-2">Payments</h1>
      <p className="text-gray-400 text-sm mb-6">
        Requires the <span className="text-gray-300">view_financials</span> permission grant (super-admins always have access).
      </p>

      <select
        value={status}
        onChange={(e) => { setStatus(e.target.value); setPage(1); }}
        className="mb-6 px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white text-sm"
      >
        {STATUSES.map((s) => (
          <option key={s || 'all'} value={s}>{s || 'All statuses'}</option>
        ))}
      </select>

      {error && (
        <div className="mb-4 rounded-lg border border-amber-800 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
          {error}
        </div>
      )}

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-left text-gray-400">
              <th className="px-4 py-3">Job</th>
              <th className="px-4 py-3">Payer</th>
              <th className="px-4 py-3">Payee</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">No payments.</td></tr>
            ) : (
              rows.map((p) => (
                <tr key={p.id} className="border-b border-slate-700/60 hover:bg-slate-700/20">
                  <td className="px-4 py-3">
                    {p.job_id ? (
                      <Link to={`/admin/jobs/${p.job_id}`} className="text-orange-400 hover:underline">
                        {p.job_title || p.job_id}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-300">
                    <div>{p.payer_name}</div>
                    <div className="text-xs text-gray-500">{p.payer_email}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-300">
                    <div>{p.payee_name}</div>
                    <div className="text-xs text-gray-500">{p.payee_email}</div>
                  </td>
                  <td className="px-4 py-3 text-white">${Number(p.amount).toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-1 rounded-full bg-slate-700 text-gray-300">{p.status}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {p.created_at ? new Date(p.created_at).toLocaleString() : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > 25 && !error?.includes('Permission') && (
        <div className="mt-4 flex justify-center gap-2">
          <button type="button" disabled={page <= 1} onClick={() => setPage((x) => x - 1)} className="px-3 py-1 rounded bg-slate-800 text-gray-300 disabled:opacity-40">Previous</button>
          <span className="text-gray-400 text-sm py-1">Page {page}</span>
          <button type="button" disabled={page * 25 >= total} onClick={() => setPage((x) => x + 1)} className="px-3 py-1 rounded bg-slate-800 text-gray-300 disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}
