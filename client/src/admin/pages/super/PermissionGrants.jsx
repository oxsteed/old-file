import { useEffect, useState } from 'react';
import { Shield, Plus, X, Check, AlertCircle, Loader2, ChevronDown } from 'lucide-react';
import adminApi from '../../../lib/adminApi';

function ts(d, fallback = '—') {
  if (!d) return fallback;
  return new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function dateOnly(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function isExpired(grant) {
  return !grant.revoked_at && new Date(grant.expires_at) <= new Date();
}

function GrantStatusBadge({ grant }) {
  if (grant.revoked_at) {
    return (
      <span className="px-2 py-0.5 text-xs rounded-full bg-red-900 text-red-300 font-medium">
        Revoked
      </span>
    );
  }
  if (isExpired(grant)) {
    return (
      <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-900 text-yellow-300 font-medium">
        Expired
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 text-xs rounded-full bg-green-900 text-green-300 font-medium">
      Active
    </span>
  );
}

// ── Create Grant Modal ────────────────────────────────────────────────────────

function CreateGrantModal({ scopes, onClose, onCreated }) {
  const [admins,    setAdmins]    = useState([]);
  const [form,      setForm]      = useState({
    grantee_id:  '',
    permissions: [],
    expires_at:  '',
    notes:       '',
  });
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState(null);

  // Fetch admin list on mount
  useEffect(() => {
    adminApi.get('/admin/super/admin-accounts')
      .then(({ data }) => {
        // Filter to active regular admins only
        const list = (data.admins || data.accounts || [])
          .filter(a => a.role === 'admin' && a.is_active !== false);
        setAdmins(list);
      })
      .catch(() => setAdmins([]));
  }, []);

  const togglePerm = (key) => {
    setForm(f => ({
      ...f,
      permissions: f.permissions.includes(key)
        ? f.permissions.filter(p => p !== key)
        : [...f.permissions, key],
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const { data } = await adminApi.post('/admin/super/permission-grants', form);
      onCreated(data.grant);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create grant.');
    } finally {
      setSaving(false);
    }
  };

  // Minimum date for expiry: tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().slice(0, 16);

  const maxDate = new Date();
  maxDate.setFullYear(maxDate.getFullYear() + 1);
  const maxDateStr = maxDate.toISOString().slice(0, 16);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="w-full max-w-lg bg-gray-900 border border-gray-700
                      rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4
                        border-b border-gray-800">
          <h2 className="font-semibold text-white flex items-center gap-2">
            <Shield size={16} className="text-purple-400" />
            Grant Permission
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition p-1"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Grantee */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">
              Admin to Grant Access To
            </label>
            {admins.length === 0 ? (
              <p className="text-xs text-gray-500">No active regular admins found.</p>
            ) : (
              <select
                required
                value={form.grantee_id}
                onChange={e => setForm(f => ({ ...f, grantee_id: e.target.value }))}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700
                           rounded-lg text-sm text-white focus:outline-none
                           focus:border-purple-500"
              >
                <option value="">Select admin…</option>
                {admins.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.first_name} {a.last_name} ({a.email})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Permissions */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">
              Permissions <span className="text-gray-600">(select one or more)</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-52 overflow-y-auto
                            pr-1">
              {scopes.map(s => {
                const checked = form.permissions.includes(s.key);
                return (
                  <label
                    key={s.key}
                    className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer
                                transition text-xs ${
                      checked
                        ? 'bg-purple-900/40 border-purple-700 text-purple-200'
                        : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:border-gray-600'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePerm(s.key)}
                      className="mt-0.5 shrink-0 accent-purple-500"
                    />
                    <div>
                      <p className="font-mono font-medium">{s.key}</p>
                      <p className="text-gray-500 mt-0.5">{s.description}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Expiry */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">
              Expires At <span className="text-gray-600">(max 1 year)</span>
            </label>
            <input
              type="datetime-local"
              required
              min={minDate}
              max={maxDateStr}
              value={form.expires_at}
              onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700
                         rounded-lg text-sm text-white focus:outline-none
                         focus:border-purple-500"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">
              Notes <span className="text-gray-600">(optional)</span>
            </label>
            <input
              type="text"
              placeholder="Reason for granting access…"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700
                         rounded-lg text-sm text-white placeholder-gray-500
                         focus:outline-none focus:border-purple-500"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-950 border border-red-800
                            rounded-lg text-red-300 text-xs">
              <AlertCircle size={13} className="shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300
                         text-sm rounded-lg transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !form.grantee_id || form.permissions.length === 0}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white
                         text-sm font-semibold rounded-lg transition
                         disabled:opacity-40 disabled:cursor-not-allowed
                         flex items-center gap-2"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              Grant Access
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PermissionGrants() {
  const [grants,      setGrants]      = useState([]);
  const [scopes,      setScopes]      = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [showCreate,  setShowCreate]  = useState(false);
  const [revoking,    setRevoking]    = useState(null);
  const [flash,       setFlash]       = useState(null);
  const [showExpired, setShowExpired] = useState(false);

  const showMsg = (type, text) => {
    setFlash({ type, text });
    setTimeout(() => setFlash(null), 4000);
  };

  const fetchGrants = async () => {
    setLoading(true);
    try {
      const [grantsRes, scopesRes] = await Promise.all([
        adminApi.get('/admin/permission-grants', {
          params: { include_expired: showExpired ? 'true' : 'false' },
        }),
        adminApi.get('/admin/permission-scopes'),
      ]);
      setGrants(grantsRes.data.grants || []);
      setScopes(scopesRes.data.scopes || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGrants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showExpired]);

  const handleRevoke = async (grantId) => {
    if (!window.confirm('Revoke this grant? The admin will immediately lose this access.')) return;
    setRevoking(grantId);
    try {
      await adminApi.delete(`/admin/super/permission-grants/${grantId}`);
      showMsg('success', 'Grant revoked.');
      fetchGrants();
    } catch (err) {
      showMsg('error', err.response?.data?.error || 'Failed to revoke grant.');
    } finally {
      setRevoking(null);
    }
  };

  const activeGrants  = grants.filter(g => !g.revoked_at && !isExpired(g));
  const inactiveGrants = grants.filter(g => g.revoked_at || isExpired(g));

  return (
    <div className="p-4 sm:p-8 max-w-5xl">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Shield size={20} className="text-purple-400" />
            Permission Grants
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Grant regular admins time-limited access to specific capabilities.
            Super-admins always have full access and don't need grants.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700
                     text-white text-sm font-semibold rounded-lg transition shrink-0"
        >
          <Plus size={14} />
          Grant Access
        </button>
      </div>

      {/* Flash message */}
      {flash && (
        <div className={`flex items-center gap-2 p-3 rounded-xl mb-4 text-sm border ${
          flash.type === 'success'
            ? 'bg-green-950 border-green-800 text-green-300'
            : 'bg-red-950 border-red-800 text-red-300'
        }`}>
          {flash.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
          {flash.text}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-5">
        <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={showExpired}
            onChange={e => setShowExpired(e.target.checked)}
            className="accent-purple-500"
          />
          Show expired &amp; revoked grants
        </label>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-purple-400" />
        </div>
      ) : (
        <>
          {/* Active grants */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl
                          overflow-hidden mb-4">
            <div className="px-4 py-3 border-b border-gray-800 flex items-center
                            justify-between">
              <h2 className="text-sm font-semibold text-white">
                Active Grants
                <span className="ml-2 text-xs text-gray-500 font-normal">
                  ({activeGrants.length})
                </span>
              </h2>
            </div>

            {activeGrants.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-8">
                No active grants. Use the button above to grant access.
              </p>
            ) : (
              <div className="divide-y divide-gray-800">
                {activeGrants.map(g => (
                  <GrantRow
                    key={g.id}
                    grant={g}
                    onRevoke={handleRevoke}
                    revoking={revoking === g.id}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Expired / revoked */}
          {showExpired && inactiveGrants.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl
                            overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800">
                <h2 className="text-sm font-semibold text-gray-500">
                  Expired / Revoked
                  <span className="ml-2 text-xs font-normal">({inactiveGrants.length})</span>
                </h2>
              </div>
              <div className="divide-y divide-gray-800">
                {inactiveGrants.map(g => (
                  <GrantRow key={g.id} grant={g} onRevoke={null} revoking={false} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {showCreate && (
        <CreateGrantModal
          scopes={scopes}
          onClose={() => setShowCreate(false)}
          onCreated={(grant) => {
            setShowCreate(false);
            showMsg('success', 'Access granted successfully.');
            fetchGrants();
          }}
        />
      )}
    </div>
  );
}

// ── Grant row ─────────────────────────────────────────────────────────────────

function GrantRow({ grant, onRevoke, revoking }) {
  const [expanded, setExpanded] = useState(false);
  const perms = Array.isArray(grant.permissions) ? grant.permissions : [];

  const inactive = grant.revoked_at || isExpired(grant);

  return (
    <div className={`px-4 py-3 ${inactive ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-white">{grant.grantee_name}</p>
            <span className="text-xs text-gray-500">{grant.grantee_email}</span>
            <GrantStatusBadge grant={grant} />
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {perms.slice(0, expanded ? perms.length : 3).map(p => (
              <span key={p}
                className="px-1.5 py-0.5 bg-purple-900/50 text-purple-300
                           text-xs rounded font-mono">
                {p}
              </span>
            ))}
            {!expanded && perms.length > 3 && (
              <button
                onClick={() => setExpanded(true)}
                className="text-xs text-gray-500 hover:text-gray-300 flex items-center
                           gap-0.5 transition"
              >
                +{perms.length - 3} more <ChevronDown size={10} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
            <span>Granted by {grant.grantor_name}</span>
            <span>·</span>
            <span>Expires {dateOnly(grant.expires_at)}</span>
            {grant.notes && (
              <>
                <span>·</span>
                <span className="italic">{grant.notes}</span>
              </>
            )}
          </div>
        </div>

        {onRevoke && !inactive && (
          <button
            onClick={() => onRevoke(grant.id)}
            disabled={revoking}
            className="px-3 py-1.5 bg-red-900/50 hover:bg-red-900 text-red-400
                       hover:text-red-300 text-xs font-medium rounded-lg transition
                       shrink-0 disabled:opacity-40 flex items-center gap-1.5"
          >
            {revoking ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
            Revoke
          </button>
        )}
      </div>
    </div>
  );
}
