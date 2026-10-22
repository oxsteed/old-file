import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  clearRestaurantLocationAccess,
  getRestaurantLocationAccess,
  replaceRestaurantLocationAccess,
} from '../../api/restaurants';
import { apiErrorMessage } from './foodShared';

const ROLE_OPTIONS = ['', 'manager', 'employee', 'representative', 'support_agent'];

function memberLabel(member) {
  return [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email || member.member_id;
}

export default function RestaurantLocationAccessPanel({ restaurant, t }) {
  const [data, setData] = useState(null);
  const [memberId, setMemberId] = useState('');
  const [locationIds, setLocationIds] = useState([]);
  const [roleOverride, setRoleOverride] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getRestaurantLocationAccess(restaurant.id);
      setData(next);
      setMemberId((current) => current || String(next.members?.[0]?.membership_id || ''));
    } catch (error) {
      // Staff without settings.view should not see a confusing empty card.
      setData(null);
      if (error?.response?.status !== 403) toast.error(apiErrorMessage(error, t('food.merchant.locationAccessLoadError')));
    } finally {
      setLoading(false);
    }
  }, [restaurant.id, t]);

  useEffect(() => { load(); }, [load]);

  const selectedMember = useMemo(
    () => data?.members?.find((member) => String(member.membership_id) === String(memberId)) || null,
    [data, memberId]
  );
  const assignments = useMemo(
    () => data?.assignments?.filter((assignment) => String(assignment.membership_id) === String(memberId) && assignment.status === 'active') || [],
    [data, memberId]
  );

  useEffect(() => {
    setLocationIds(assignments.map((assignment) => Number(assignment.location_id)));
    setRoleOverride(assignments[0]?.role_override || '');
  }, [assignments]);

  if (!data || !data.members?.length || !data.locations?.length) return null;

  const toggleLocation = (id) => {
    setLocationIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };

  const save = async () => {
    if (!memberId || locationIds.length === 0) return;
    setSaving(true);
    try {
      await replaceRestaurantLocationAccess(restaurant.id, memberId, { locationIds, roleOverride: roleOverride || null });
      toast.success(t('food.merchant.locationAccessSaved'));
      await load();
    } catch (error) {
      toast.error(apiErrorMessage(error, t('food.merchant.locationAccessError')));
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (!memberId) return;
    setSaving(true);
    try {
      await clearRestaurantLocationAccess(restaurant.id, memberId);
      toast.success(t('food.merchant.locationAccessCleared'));
      await load();
    } catch (error) {
      toast.error(apiErrorMessage(error, t('food.merchant.locationAccessError')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="fd-settings-note" aria-labelledby="fd-location-access-title">
      <h4 id="fd-location-access-title" className="fd-settings-subhead fd-settings-subhead--flush">
        {t('food.merchant.locationAccessTitle')}
      </h4>
      <p className="fd-card-meta">{t('food.merchant.locationAccessHint')}</p>
      {loading ? <p className="fd-card-meta">{t('food.common.loading')}</p> : (
        <>
          <div className="fd-row" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
            <div className="fd-field" style={{ flex: '1 1 220px' }}>
              <label htmlFor="fd-location-access-member">{t('food.merchant.locationAccessMember')}</label>
              <select id="fd-location-access-member" value={memberId} onChange={(event) => setMemberId(event.target.value)} data-track="ui.4f2a8c91e4.1">
                {data.members.map((member) => <option key={member.membership_id} value={member.membership_id}>{memberLabel(member)} · {member.role}</option>)}
              </select>
            </div>
            <div className="fd-field" style={{ flex: '0 1 190px' }}>
              <label htmlFor="fd-location-access-role">{t('food.merchant.locationAccessRole')}</label>
              <select id="fd-location-access-role" value={roleOverride} onChange={(event) => setRoleOverride(event.target.value)} data-track="ui.4f2a8c91e4.2">
                {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role || t('food.merchant.locationAccessInherit')}</option>)}
              </select>
            </div>
          </div>
          <fieldset style={{ border: 'none', padding: 0, margin: '0.75rem 0' }}>
            <legend className="fd-card-meta">{t('food.merchant.locationAccessStores')}</legend>
            <div className="fd-row" style={{ flexWrap: 'wrap', gap: '0.5rem 1rem' }}>
              {data.locations.map((location) => (
                <label key={location.id}>
                  <input
                    type="checkbox"
                    checked={locationIds.includes(Number(location.id))}
                    onChange={() => toggleLocation(Number(location.id))}
                    data-track="ui.4f2a8c91e4.3"
                  />{' '}{location.name}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="fd-row" style={{ gap: '0.5rem' }}>
            <button type="button" className="fd-btn fd-btn-sm" disabled={saving || !selectedMember || locationIds.length === 0} onClick={save} data-track="ui.4f2a8c91e4.4">
              {saving ? t('food.common.saving') : t('food.merchant.locationAccessSave')}
            </button>
            <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" disabled={saving || !selectedMember || assignments.length === 0} onClick={clear} data-track="ui.4f2a8c91e4.5">
              {t('food.merchant.locationAccessAllStores')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

