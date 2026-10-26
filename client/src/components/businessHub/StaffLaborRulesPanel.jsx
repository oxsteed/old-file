// S-20: minors and Fair Workweek for managers. Minor status is a band plus
// the date it ends (never a birth date); schedule changes to published
// shifts inside the notice window are listed as predictability pay owed.
import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../../api/axios';

export default function StaffLaborRulesPanel({ businessId, staffMembers, staffName }) {
  const { t, i18n } = useTranslation();
  const ids = { staff: useId(), band: useId(), until: useId() };
  const [userId, setUserId] = useState('');
  const [profile, setProfile] = useState({ minor_band: '', minor_until: '' });
  const [changes, setChanges] = useState([]);
  const [saving, setSaving] = useState(false);

  const loadChanges = useCallback(async () => {
    try { const res = await api.get(`/businesses/${businessId}/staff/schedule-changes`); setChanges(res.data?.changes || []); }
    catch { setChanges([]); }
  }, [businessId]);
  useEffect(() => { loadChanges(); }, [loadChanges]);
  useEffect(() => {
    if (!userId) { setProfile({ minor_band: '', minor_until: '' }); return; }
    api.get(`/businesses/${businessId}/staff/members/${userId}/labor-profile`)
      .then((res) => setProfile({ minor_band: res.data?.profile?.minor_band || '', minor_until: res.data?.profile?.minor_until || '' }))
      .catch(() => setProfile({ minor_band: '', minor_until: '' }));
  }, [businessId, userId]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put(`/businesses/${businessId}/staff/members/${userId}/labor-profile`, {
        minor_band: profile.minor_band || null,
        minor_until: profile.minor_band ? profile.minor_until || null : null,
      });
      toast.success(t('businessHub.staffScheduler.labor.saved'));
    } catch { toast.error(t('businessHub.staffScheduler.labor.saveFailed')); }
    finally { setSaving(false); }
  };

  const nameFor = (id) => { const m = staffMembers.find((x) => x.user_id === id); return m ? staffName(m) : t('businessHub.staffScheduler.labor.formerStaff'); };
  const when = (v) => { try { return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v)); } catch { return String(v); } };
  const field = { width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' };

  return (
    <div style={{ display: 'grid', gap: '1.5rem' }}>
      <section aria-labelledby={`${ids.staff}-title`} style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.75rem', padding: '1.25rem' }}>
        <h4 id={`${ids.staff}-title`} style={{ margin: '0 0 0.5rem' }}>{t('businessHub.staffScheduler.labor.minorsTitle')}</h4>
        <p style={{ margin: '0 0 1rem', color: 'var(--muted-text)', fontSize: '0.875rem' }}>{t('businessHub.staffScheduler.labor.minorsHelp')}</p>
        <form onSubmit={save} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: '0.75rem', alignItems: 'end' }} data-track="ui.352c7b6cea.1">
          <div>
            <label htmlFor={ids.staff}>{t('businessHub.staffScheduler.fields.staff')}</label>
            <select id={ids.staff} value={userId} onChange={(e) => setUserId(e.target.value)} style={field} data-track="business.staff.labor.staff">
              <option value="">{t('businessHub.staffScheduler.fields.staffPlaceholder')}</option>
              {staffMembers.map((m) => <option key={m.user_id} value={m.user_id}>{staffName(m)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={ids.band}>{t('businessHub.staffScheduler.labor.band')}</label>
            <select id={ids.band} value={profile.minor_band} disabled={!userId} onChange={(e) => setProfile((p) => ({ ...p, minor_band: e.target.value }))} style={field} data-track="business.staff.labor.band">
              <option value="">{t('businessHub.staffScheduler.labor.adult')}</option>
              <option value="under_16">{t('businessHub.staffScheduler.labor.under16')}</option>
              <option value="age_16_17">{t('businessHub.staffScheduler.labor.age1617')}</option>
            </select>
          </div>
          {profile.minor_band && (
            <div>
              <label htmlFor={ids.until}>{t('businessHub.staffScheduler.labor.until')}</label>
              <input id={ids.until} type="date" required value={profile.minor_until} onChange={(e) => setProfile((p) => ({ ...p, minor_until: e.target.value }))} style={field} data-track="business.staff.labor.until" />
            </div>
          )}
          <button type="submit" disabled={!userId || saving} style={{ padding: '0.6rem 1rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: 600 }} data-track="business.staff.labor.save">
            {t('businessHub.staffScheduler.labor.save')}
          </button>
        </form>
      </section>

      <section aria-labelledby={`${ids.until}-changes`}>
        <h4 id={`${ids.until}-changes`} style={{ margin: '0 0 0.5rem' }}>{t('businessHub.staffScheduler.labor.changesTitle')}</h4>
        <p style={{ margin: '0 0 1rem', color: 'var(--muted-text)', fontSize: '0.875rem' }}>{t('businessHub.staffScheduler.labor.changesHelp')}</p>
        {changes.length === 0 ? (
          <p style={{ color: 'var(--muted-text)' }}>{t('businessHub.staffScheduler.labor.noChanges')}</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.5rem' }}>
            {changes.map((c) => (
              <li key={c.id} style={{ border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.75rem', borderInlineStart: c.premium_due ? '4px solid #b45309' : '1px solid var(--border-color)' }}>
                <strong>{nameFor(c.user_id)}</strong> · {t(`businessHub.staffScheduler.labor.change.${c.change_type}`)} · {c.before_state?.shift_date} {c.before_state?.start_time}–{c.before_state?.end_time}
                {c.after_state && <> → {c.after_state.shift_date} {c.after_state.start_time}–{c.after_state.end_time}</>}
                <div style={{ fontSize: '0.8125rem', color: 'var(--muted-text)' }}>
                  {when(c.created_at)} · {c.premium_due
                    ? t('businessHub.staffScheduler.labor.premiumDue', { code: c.jurisdiction_code })
                    : c.employee_requested ? t('businessHub.staffScheduler.labor.employeeRequested') : t('businessHub.staffScheduler.labor.noPremium')}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
