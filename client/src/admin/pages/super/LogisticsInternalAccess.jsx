import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import adminApi from '../../../lib/adminApi';

const DEFAULT_FORM = {
  internal_name: '',
  security_key: '',
  operations_enabled: true,
  compliance_enabled: true,
};

export default function LogisticsInternalAccess() {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [existingRecord, setExistingRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    adminApi.get('/admin/super/logistics-internal-access/me')
      .then(({ data }) => {
        if (!active) return;
        const record = data?.record || null;
        setExistingRecord(record);
        if (record) {
          setForm({
            internal_name: record.internal_name || '',
            security_key: '',
            operations_enabled: !!record.operations_enabled,
            compliance_enabled: !!record.compliance_enabled,
          });
        }
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
  }, []);

  const updateField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const { data } = await adminApi.put('/admin/super/logistics-internal-access/me', form);
      const record = data?.record || null;
      setExistingRecord(record);
      setForm((current) => ({
        ...current,
        security_key: '',
      }));
      toast.success('Internal logistics access updated.');
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to save internal access settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-white">Logistics Internal Access</h1>
        <p className="text-sm text-gray-400 mt-1 max-w-3xl">
          Set the unique internal name and security key that must be entered before anyone can even reach the
          Operations or Compliance Workspace password login. This first phase only gates those two workspace login routes.
        </p>
      </header>

      <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-5">
        {loading ? (
          <div className="text-sm text-gray-400">Loading internal access settings…</div>
        ) : (
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-200 mb-2">Linked account</label>
                <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-4 py-3 text-sm text-gray-300">
                  {existingRecord?.email || 'This internal access record will be linked to your current super-admin account.'}
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
                  This must be unique. The Operations and Compliance login pages will ask for this name before password sign-in.
                </p>
              </div>
            </div>

            <div>
              <label htmlFor="security_key" className="block text-sm font-medium text-gray-200 mb-2">
                {existingRecord ? 'Replace security key' : 'Security key'}
              </label>
              <input
                id="security_key"
                type="password"
                value={form.security_key}
                onChange={(event) => updateField('security_key', event.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-950 px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
                placeholder={existingRecord ? 'Leave blank to keep the current key' : 'Create a strong security key'}
              />
              <p className="text-xs text-gray-500 mt-2">
                Keys are stored hashed and cannot be viewed later. If you change it, everyone using your internal access identity must use the new key.
              </p>
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
                    Allows this internal name + key pair to unlock `/logistics/operations/login`.
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
                    Allows this internal name + key pair to unlock `/logistics/compliance-workspace/login`.
                  </div>
                </div>
              </label>
            </div>

            {existingRecord && (
              <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-4 py-3 text-sm text-gray-400">
                Current status:
                <span className="text-white font-medium"> {existingRecord.internal_name}</span>
                {' · '}
                Operations: <span className={existingRecord.operations_enabled ? 'text-emerald-400' : 'text-gray-500'}>{existingRecord.operations_enabled ? 'enabled' : 'disabled'}</span>
                {' · '}
                Compliance: <span className={existingRecord.compliance_enabled ? 'text-emerald-400' : 'text-gray-500'}>{existingRecord.compliance_enabled ? 'enabled' : 'disabled'}</span>
              </div>
            )}

            <div className="flex items-center justify-end">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center justify-center rounded-lg bg-orange-600 hover:bg-orange-700 disabled:opacity-50 px-5 py-3 text-sm font-semibold text-white transition"
              >
                {saving ? 'Saving…' : existingRecord ? 'Update Internal Access' : 'Create Internal Access'}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
