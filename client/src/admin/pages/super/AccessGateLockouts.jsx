import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import adminApi from '../../../lib/adminApi';

/**
 * Super-admin view of currently-locked (IP, name) pairs from the access-gate
 * rate limiter. Each row shows when the lockout started, when it expires,
 * and a "Lift" button that takes a reason and clears the row.
 *
 * Also surfaces a small audit table of recent attempts (last 100) so the
 * super-admin can spot patterns before deciding whether to lift.
 */
export default function AccessGateLockouts() {
  const [lockouts, setLockouts] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [maxFails, setMaxFails] = useState(3);
  const [lockoutHours, setLockoutHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [showFailedOnly, setShowFailedOnly] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const [lockoutsRes, attemptsRes] = await Promise.all([
        adminApi.get('/admin/super/access-gate/lockouts'),
        adminApi.get('/admin/super/access-gate/attempts', {
          params: { limit: 100, success: showFailedOnly ? '0' : undefined },
        }),
      ]);
      setLockouts(lockoutsRes.data?.items || []);
      setMaxFails(lockoutsRes.data?.maxFails || 3);
      setLockoutHours(lockoutsRes.data?.lockoutHours || 24);
      setAttempts(attemptsRes.data?.items || []);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load lockouts.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFailedOnly]);

  async function handleLift(id) {
    const reason = window.prompt('Reason for lifting this lockout (optional):') || '';
    try {
      await adminApi.post(`/admin/super/access-gate/lockouts/${id}/lift`, { reason });
      toast.success('Lockout lifted.');
      refresh();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to lift lockout.');
    }
  }

  function relativeTime(value) {
    if (!value) return '-';
    const ms = new Date(value).getTime() - Date.now();
    if (Math.abs(ms) < 60_000) return `${Math.round(ms / 1000)}s`;
    if (Math.abs(ms) < 3_600_000) return `${Math.round(ms / 60_000)}m`;
    if (Math.abs(ms) < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
    return `${Math.round(ms / 86_400_000)}d`;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Access gate lockouts</h1>
        <p className="text-sm text-gray-500 mt-1">
          Threshold: {maxFails} failed verifies per (IP, name) within {lockoutHours}h. Locked pairs are blocked until
          you lift them here, the user uses an emailed recovery link, or the natural window expires.
        </p>
      </div>

      <section className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <h2 className="font-semibold">Currently locked</h2>
          <button
            type="button"
            onClick={refresh}
            className="text-sm text-orange-600 hover:text-orange-700 underline"
          >
            Refresh
          </button>
        </div>
        {loading ? (
          <div className="px-4 py-6 text-sm text-gray-500">Loading…</div>
        ) : lockouts.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-500">No active lockouts.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2">IP</th>
                <th className="px-4 py-2">Name (claimed)</th>
                <th className="px-4 py-2">Fails</th>
                <th className="px-4 py-2">First fail</th>
                <th className="px-4 py-2">Locked until</th>
                <th className="px-4 py-2">Time left</th>
                <th className="px-4 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {lockouts.map((row) => (
                <tr key={row.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-4 py-2 font-mono text-xs">{row.ip}</td>
                  <td className="px-4 py-2">{row.displayName} <span className="text-gray-400">({row.normalizedName})</span></td>
                  <td className="px-4 py-2">{row.failCount}</td>
                  <td className="px-4 py-2 text-gray-500">{new Date(row.firstFailAt).toLocaleString()}</td>
                  <td className="px-4 py-2 text-gray-500">{new Date(row.lockedUntil).toLocaleString()}</td>
                  <td className="px-4 py-2 text-orange-600">{relativeTime(row.lockedUntil)}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => handleLift(row.id)}
                      className="px-3 py-1 text-xs bg-orange-600 hover:bg-orange-700 text-white rounded"
                    >
                      Lift
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <h2 className="font-semibold">Recent attempts</h2>
          <label className="text-sm text-gray-500 flex items-center gap-2">
            <input
              type="checkbox"
              checked={showFailedOnly}
              onChange={(e) => setShowFailedOnly(e.target.checked)}
            />
            Failed only
          </label>
        </div>
        {attempts.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-500">No attempts logged yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">IP</th>
                <th className="px-4 py-2">Claimed name</th>
                <th className="px-4 py-2">Scope</th>
                <th className="px-4 py-2">Result</th>
                <th className="px-4 py-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((row) => (
                <tr key={row.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-4 py-2 text-gray-500">{new Date(row.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2 font-mono text-xs">{row.ip}</td>
                  <td className="px-4 py-2">{row.claimedName}</td>
                  <td className="px-4 py-2">{row.scope}</td>
                  <td className="px-4 py-2">
                    {row.success ? (
                      <span className="text-emerald-600">ok</span>
                    ) : (
                      <span className="text-rose-600">fail</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">{row.errorCode || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
