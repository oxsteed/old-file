import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import adminApi from '../../../lib/adminApi';
import { useAuth } from '../../../hooks/useAuth';

const EMPTY_FORM = {
  internal_name: '',
  security_key: '',
  operations_enabled: false,
  compliance_enabled: false,
  admin_portal_enabled: false,
  is_active: true,
};

function makeForm(record) {
  if (!record) return EMPTY_FORM;
  return {
    internal_name: record.internal_name || '',
    security_key: '',
    operations_enabled: !!record.operations_enabled,
    compliance_enabled: !!record.compliance_enabled,
    admin_portal_enabled: !!record.admin_portal_enabled,
    is_active: record.has_record ? !!record.is_active : true,
  };
}

export default function LogisticsInternalAccess() {
  const { user: me } = useAuth();
  const [records, setRecords] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const selectedRecord = useMemo(
    () => records.find((record) => record.user_id === selectedUserId) || null,
    [records, selectedUserId]
  );

  useEffect(() => {
    let active = true;
    adminApi.get('/admin/super/logistics-internal-access')
      .then(({ data }) => {
        if (!active) return;
        const nextRecords = data?.records || [];
        setRecords(nextRecords);
        const preferred = nextRecords.find((record) => record.user_id === me?.id) || nextRecords[0] || null;
        setSelectedUserId(preferred?.user_id || null);
        setForm(makeForm(preferred));
      })
      .catch((err) => {
        toast.error(err?.response?.data?.error || 'Failed to load internal access settings.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [me?.id]);

  useEffect(() => {
    setForm(makeForm(selectedRecord));
  }, [selectedRecord]);

  const updateField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const refreshRecords = async (targetUserId = selectedUserId) => {
    const { data } = await adminApi.get('/admin/super/logistics-internal-access');
    const nextRecords = data?.records || [];
    setRecords(nextRecords);
    const nextSelected = nextRecords.find((record) => record.user_id === targetUserId)
      || nextRecords.find((record) => record.user_id === me?.id)
      || nextRecords[0]
      || null;
    setSelectedUserId(nextSelected?.user_id || null);
    setForm(makeForm(nextSelected));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!selectedRecord) {
      toast.error('Choose an internal staff account first.');
      return;
    }

    setSaving(true);
    try {
      await adminApi.put(`/admin/super/logistics-internal-access/${selectedRecord.user_id}`, form);
      await refreshRecords(selectedRecord.user_id);
      toast.success('Internal access updated.');
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to save internal access settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-white">Internal Access Control</h1>
        <p className="text-sm text-gray-400 mt-1 max-w-4xl">
          Super-admins issue the internal name and security key pairs required before anyone can reach
          Operations, Compliance Workspace, or the Admin Portal password login. Each approved pair is bound
          to one specific OxSteed internal staff account.
        </p>
      </header>

      <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-5">
        {loading ? (
          <div className="text-sm text-gray-400">Loading internal access settings…</div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(320px,420px)_1fr] gap-6">
            <div className="rounded-xl border border-gray-800 bg-gray-950/40 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800">
                <h2 className="text-sm font-semibold text-white">Internal Staff Accounts</h2>
                <p className="text-xs text-gray-500 mt-1">Choose the employee, admin, or super-admin account that should own the internal access identity.</p>
              </div>
              <div className="divide-y divide-gray-800">
                {records.map((record) => {
                  const isSelected = record.user_id === selectedUserId;
                  const isSelf = record.user_id === me?.id;
                  return (
                    <button
                      key={record.user_id}
                      type="button"
                      onClick={() => setSelectedUserId(record.user_id)}
                      className={`w-full text-left px-4 py-4 transition ${isSelected ? 'bg-orange-500/10' : 'hover:bg-gray-900/60'}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-white">
                            {record.first_name} {record.last_name}
                            {isSelf && <span className="ml-2 text-xs text-orange-400">(you)</span>}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">{record.email}</div>
                        </div>
                        <div className="text-[11px] uppercase tracking-wide text-gray-500">{record.role}</div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                        <span className={`rounded-full px-2 py-1 border ${record.has_record ? 'border-emerald-500/40 text-emerald-300' : 'border-gray-700 text-gray-500'}`}>
                          {record.has_record ? `Name: ${record.internal_name}` : 'No internal record'}
                        </span>
                        <span className={`rounded-full px-2 py-1 border ${record.admin_portal_enabled ? 'border-orange-500/40 text-orange-300' : 'border-gray-700 text-gray-500'}`}>
                          Admin Portal
                        </span>
                        <span className={`rounded-full px-2 py-1 border ${record.operations_enabled ? 'border-blue-500/40 text-blue-300' : 'border-gray-700 text-gray-500'}`}>
                          Operations
                        </span>
                        <span className={`rounded-full px-2 py-1 border ${record.compliance_enabled ? 'border-purple-500/40 text-purple-300' : 'border-gray-700 text-gray-500'}`}>
                          Compliance
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <section className="rounded-xl border border-gray-800 bg-gray-950/40 p-5">
              {!selectedRecord ? (
                <div className="text-sm text-gray-400">Select an internal staff account to manage its internal access.</div>
              ) : (
                <form className="space-y-5" onSubmit={handleSubmit}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-200 mb-2">Linked account</label>
                      <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-4 py-3 text-sm text-gray-300">
                        <div>{selectedRecord.first_name} {selectedRecord.last_name}</div>
                        <div className="text-xs text-gray-500 mt-1">{selectedRecord.email}</div>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="internal_name" className="block text-sm font-medium text-gray-200 mb-2">
                        Internal name
                      </label>
                      <input
                        id="internal_name"
                        type="text"
                        value={form.internal_name}
                        onChange={(event) => updateField('internal_name', event.target.value)}
                        className="w-full rounded-lg border border-gray-700 bg-gray-950 px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
                        placeholder="Example: Emile"
                        required
                      />
                      <p className="text-xs text-gray-500 mt-2">
                        This must be unique. It becomes the first credential the operator types before password sign-in.
                      </p>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="security_key" className="block text-sm font-medium text-gray-200 mb-2">
                      {selectedRecord.has_record ? 'Replace security key' : 'Security key'}
                    </label>
                    <input
                      id="security_key"
                      type="password"
                      value={form.security_key}
                      onChange={(event) => updateField('security_key', event.target.value)}
                      className="w-full rounded-lg border border-gray-700 bg-gray-950 px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
                      placeholder={selectedRecord.has_record ? 'Leave blank to keep the current key' : 'Create a strong security key'}
                    />
                    <p className="text-xs text-gray-500 mt-2">
                      Keys are stored hashed and cannot be viewed later. If you rotate one, the linked person must use the new key immediately.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="rounded-lg border border-gray-800 bg-gray-950/60 px-4 py-4 flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.admin_portal_enabled}
                        onChange={(event) => updateField('admin_portal_enabled', event.target.checked)}
                        disabled={selectedRecord.role === 'employee'}
                        className="mt-1"
                      />
                      <div>
                        <div className="text-sm font-medium text-white">Enable Admin Portal gate</div>
                        <div className="text-xs text-gray-500 mt-1">
                          Requires this internal name + key before `/admin/login` can continue to password login for this account.
                        </div>
                        {selectedRecord.role === 'employee' && (
                          <div className="text-xs text-amber-400 mt-2">
                            Employee accounts cannot use the Admin Portal gate. This toggle is ignored for non-admin staff.
                          </div>
                        )}
                      </div>
                    </label>

                    <label className="rounded-lg border border-gray-800 bg-gray-950/60 px-4 py-4 flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.is_active}
                        onChange={(event) => updateField('is_active', event.target.checked)}
                        className="mt-1"
                      />
                      <div>
                        <div className="text-sm font-medium text-white">Record active</div>
                        <div className="text-xs text-gray-500 mt-1">
                          Turning this off immediately invalidates future internal-access verification for this identity.
                        </div>
                      </div>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="rounded-lg border border-gray-800 bg-gray-950/60 px-4 py-4 flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.operations_enabled}
                        onChange={(event) => updateField('operations_enabled', event.target.checked)}
                        className="mt-1"
                      />
                      <div>
                        <div className="text-sm font-medium text-white">Enable Operations gate</div>
                        <div className="text-xs text-gray-500 mt-1">
                          Allows this internal identity to unlock `/logistics/operations/login`.
                        </div>
                      </div>
                    </label>

                    <label className="rounded-lg border border-gray-800 bg-gray-950/60 px-4 py-4 flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.compliance_enabled}
                        onChange={(event) => updateField('compliance_enabled', event.target.checked)}
                        className="mt-1"
                      />
                      <div>
                        <div className="text-sm font-medium text-white">Enable Compliance gate</div>
                        <div className="text-xs text-gray-500 mt-1">
                          Allows this internal identity to unlock `/logistics/compliance-workspace/login`.
                        </div>
                      </div>
                    </label>
                  </div>

                  <div className="rounded-lg border border-blue-900/40 bg-blue-950/20 px-4 py-3 text-sm text-blue-100">
                    Corporate department dashboards now live on routes like <span className="font-semibold text-white">`/internal/finance`</span>, <span className="font-semibold text-white">`/internal/hr`</span>, and <span className="font-semibold text-white">`/internal/corporate-ops`</span>.
                    Employees do not need a separate per-department toggle here: once they have an active internal-access record and an active corporate assignment in that department, they can use the matching <span className="font-semibold text-white">`/internal/:workspace/login`</span> route.
                  </div>

                  {selectedRecord.has_record && (
                    <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-4 py-3 text-sm text-gray-400">
                      Current status:
                      <span className="text-white font-medium"> {selectedRecord.internal_name}</span>
                      {' · '}
                      Last check: <span className="text-gray-300">{selectedRecord.last_verified_at ? new Date(selectedRecord.last_verified_at).toLocaleString() : 'never'}</span>
                      {' · '}
                      Last route: <span className="text-gray-300">{selectedRecord.last_verified_route || 'n/a'}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-end">
                    <button
                      type="submit"
                      disabled={saving}
                      className="inline-flex items-center justify-center rounded-lg bg-orange-600 hover:bg-orange-700 disabled:opacity-50 px-5 py-3 text-sm font-semibold text-white transition"
                    >
                      {saving ? 'Saving…' : selectedRecord.has_record ? 'Update Internal Access' : 'Create Internal Access'}
                    </button>
                  </div>
                </form>
              )}
            </section>
          </div>
        )}
      </section>
    </div>
  );
}
