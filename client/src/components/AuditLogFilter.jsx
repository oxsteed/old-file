import { useState, useEffect } from 'react';
import { Filter, X } from 'lucide-react';

/**
 * Filter bar for the user-action audit log.
 *
 * Props:
 *   value        – current filter object
 *   onChange     – called with new filter (debounced apply via Apply button)
 *   regions      – optional list of {id,name} for region dropdown
 */
const ACTION_TYPES = [
  '',
  'create_user',
  'edit_email',
  'edit_password',
  'edit_first_name',
  'edit_last_name',
  'edit_phone',
  'edit_role',
  'edit_membership_tier',
  'edit_subscription_status',
  'edit_is_active',
  'edit_email_verified',
  'edit_is_verified',
  'edit_background_check_passed',
  'edit_city',
  'edit_state',
  'edit_zip_code',
];

export default function AuditLogFilter({ value, onChange, regions = [] }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  const setField = (k, v) => setDraft(d => ({ ...d, [k]: v }));

  const apply = () => onChange({ ...draft });
  const clear = () => {
    const empty = {
      admin_id: '', target_user_id: '', action_type: '',
      region_id: '', from_date: '', to_date: '',
    };
    setDraft(empty);
    onChange(empty);
  };

  const inputCls =
    'w-full px-2 py-1.5 rounded bg-gray-900 border border-gray-700 ' +
    'text-gray-100 text-sm focus:outline-none focus:border-orange-500';
  const labelCls = 'block text-xs text-gray-500 mb-1';

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950 p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Filter size={14} className="text-gray-400" />
        <span className="text-sm font-medium text-gray-300">Filter</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div>
          <label className={labelCls}>Admin user ID</label>
          <input
            className={inputCls}
            value={draft.admin_id || ''}
            onChange={e => setField('admin_id', e.target.value)}
            placeholder="UUID or numeric"
          />
        </div>
        <div>
          <label className={labelCls}>Target user ID</label>
          <input
            className={inputCls}
            value={draft.target_user_id || ''}
            onChange={e => setField('target_user_id', e.target.value)}
            placeholder="UUID or numeric"
          />
        </div>
        <div>
          <label className={labelCls}>Action type</label>
          <select
            className={inputCls}
            value={draft.action_type || ''}
            onChange={e => setField('action_type', e.target.value)}
          >
            {ACTION_TYPES.map(a => (
              <option key={a} value={a}>{a || '- any -'}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Region</label>
          <select
            className={inputCls}
            value={draft.region_id || ''}
            onChange={e => setField('region_id', e.target.value)}
          >
            <option value="">- any -</option>
            {regions.map(r => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>From date</label>
          <input
            type="date"
            className={inputCls}
            value={draft.from_date || ''}
            onChange={e => setField('from_date', e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>To date</label>
          <input
            type="date"
            className={inputCls}
            value={draft.to_date || ''}
            onChange={e => setField('to_date', e.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 mt-3">
        <button
          onClick={clear}
          type="button"
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-xs text-gray-400 hover:text-white"
        >
          <X size={12} />
          Clear
        </button>
        <button
          onClick={apply}
          type="button"
          className="px-3 py-1.5 rounded text-xs font-medium bg-orange-600 hover:bg-orange-500 text-white"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
