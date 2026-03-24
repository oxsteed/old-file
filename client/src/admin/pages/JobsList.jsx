import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Search, Filter, Briefcase, Download } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import adminApi from '../../lib/adminApi';

const STATUSES = ['', 'open', 'assigned', 'in_progress', 'completed', 'cancelled', 'disputed'];
const CATEGORIES = ['', 'moving', 'cleaning', 'handyman', 'delivery', 'other'];

export default function JobsList() {
  const { user: me } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    search: '', status: '', category: '', page: 1
  });

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const params = Object.fromEntries(
        Object.entries(filters).filter(([, v]) => v !== '')
      );
      const { data } = await adminApi.get('/admin/jobs', { params });
      setJobs(data.jobs || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to fetch jobs:', err);
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const updateFilter = (key, value) =>
    setFilters(prev => ({ ...prev, [key]: value, page: 1 }));

  const exportCSV = async () => {
    try {
      const { data } = await adminApi.get('/admin/jobs/export', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([data]));
      const a = document.createElement('a'); a.href = url;
      a.download = `jobs_export_${new Date().toISOString().slice(0,10)}.csv`;
      a.click(); window.URL.revokeObjectURL(url);
    } catch (err) { console.error('Export failed:', err); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Jobs</h1>
          <p className="text-gray-400 text-sm">{total} total jobs</p>
        </div>
        <button onClick={exportCSV}
          className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg text-sm">
          <Download size={16} /> Export CSV
        </button>
      </div>

      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input type="text" placeholder="Search jobs by title or ID..."
            value={filters.search} onChange={e => updateFilter('search', e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:border-orange-500 focus:outline-none" />
        </div>
        <select value={filters.status} onChange={e => updateFilter('status', e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg text-white text-sm px-3 py-2">
          <option value="">All Statuses</option>
          {STATUSES.filter(Boolean).map(s => <option key={s} value={s}>{s.replace('_',' ').replace(/\b\w/g,l=>l.toUpperCase())}</option>)}
        </select>
        <select value={filters.category} onChange={e => updateFilter('category', e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg text-white text-sm px-3 py-2">
          <option value="">All Categories</option>
          {CATEGORIES.filter(Boolean).map(c => <option key={c} value={c}>{c.replace(/\b\w/g,l=>l.toUpperCase())}</option>)}
        </select>
      </div>

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left text-gray-400 font-medium px-4 py-3">TITLE</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">CLIENT</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">HELPER</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">BUDGET</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">STATUS</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">CREATED</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center text-gray-400 py-12">Loading...</td></tr>
            ) : jobs.length === 0 ? (
              <tr><td colSpan={6} className="text-center text-gray-400 py-12">No jobs found.</td></tr>
            ) : jobs.map(job => (
              <tr key={job._id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                <td className="px-4 py-3 text-white">{job.title}</td>
                <td className="px-4 py-3 text-gray-300">{job.client?.name || 'N/A'}</td>
                <td className="px-4 py-3 text-gray-300">{job.helper?.name || 'Unassigned'}</td>
                <td className="px-4 py-3 text-white">${(job.budget || 0).toFixed(2)}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    job.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                    job.status === 'open' ? 'bg-blue-500/20 text-blue-400' :
                    job.status === 'in_progress' ? 'bg-yellow-500/20 text-yellow-400' :
                    job.status === 'cancelled' ? 'bg-red-500/20 text-red-400' :
                    job.status === 'disputed' ? 'bg-purple-500/20 text-purple-400' :
                    'bg-slate-500/20 text-slate-400'
                  }`}>{(job.status || 'unknown').replace('_',' ')}</span>
                </td>
                <td className="px-4 py-3 text-gray-400">{job.createdAt ? new Date(job.createdAt).toLocaleDateString() : 'N/A'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > 20 && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-400">
          <span>Page {filters.page}</span>
          <div className="flex gap-2">
            <button onClick={() => setFilters(p => ({...p, page: Math.max(1, p.page-1)}))}
              disabled={filters.page <= 1}
              className="px-3 py-1 bg-slate-800 border border-slate-700 rounded-lg disabled:opacity-50">
              &larr; Prev
            </button>
            <button onClick={() => setFilters(p => ({...p, page: p.page+1}))}
              className="px-3 py-1 bg-slate-800 border border-slate-700 rounded-lg">
              Next &rarr;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
