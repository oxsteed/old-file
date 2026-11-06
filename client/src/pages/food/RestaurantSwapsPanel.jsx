// Shift swaps — Phase 3 Track C. Request a swap for one of my
// published shifts with a chosen staff member of the same restaurant,
// answer swaps that name me as target, and follow my outgoing
// requests. A request waits on the target first: only after the
// target accepts does it wait on a manager, and a target decline
// closes it. Manager approval stays in the existing manager surfaces;
// this panel never approves or rejects. No conflict validation runs
// at request or approval time (overlap, time-off, availability, minor
// checks are Phase 4).
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import { listMembers } from '../../api/businesses';
import { useAuth } from '../../context/AuthContext';
import { apiErrorMessage } from './foodShared';
import { formatPortalDay, todayIso } from './RestaurantEmployeePortalShared';

function memberName(member) {
  const name = [member?.first_name, member?.last_name].filter(Boolean).join(' ').trim();
  return name || member?.member_email || '';
}

function formatWallTime(value, locale) {
  if (!value) return '';
  const text = String(value).slice(0, 5);
  const d = new Date(`2000-01-01T${text}:00`);
  if (Number.isNaN(d.getTime())) return text;
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(d);
}

export default function RestaurantSwapsPanel({ restaurant }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const businessId = restaurant?.business_id;
  const base = `/businesses/${businessId}/staff`;
  const [shifts, setShifts] = useState([]);
  const [members, setMembers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ shiftId: '', targetUserId: '', note: '' });
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError('');
    try {
      const [shiftRes, swapRes, memberRows] = await Promise.all([
        api.get(`${base}/shifts`, { params: { user_id: user?.id, from: todayIso() } }),
        api.get(`${base}/shift-swaps`),
        listMembers(businessId),
      ]);
      const shiftRows = Array.isArray(shiftRes.data) ? shiftRes.data : (shiftRes.data?.shifts || []);
      setShifts(shiftRows.filter((s) => !user?.id || String(s.user_id) === String(user.id)));
      setRequests(Array.isArray(swapRes.data?.requests) ? swapRes.data.requests : []);
      setMembers((Array.isArray(memberRows) ? memberRows : []).filter((m) => (
        m.status === 'active' && m.user_id && String(m.user_id) !== String(user?.id)
      )));
    } catch (err) {
      setError(apiErrorMessage(err, t('food.employeePortal.shared.loadError')));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, user?.id]);

  useEffect(() => { load(); }, [load]);

  const names = new Map(members.map((m) => [String(m.user_id), memberName(m)]));
  const nameOf = (userId) => names.get(String(userId)) || '';
  const shiftLabel = (request) => {
    const date = formatPortalDay(request.shift_date, i18n.language);
    const times = `${formatWallTime(request.start_time, i18n.language)} - ${formatWallTime(request.end_time, i18n.language)}`;
    return request.role_label ? `${date}, ${times} (${request.role_label})` : `${date}, ${times}`;
  };

  const submitRequest = async (event) => {
    event.preventDefault();
    if (!form.shiftId || !form.targetUserId) return;
    setSubmitting(true);
    setNotice('');
    setError('');
    try {
      await api.post(`${base}/shifts/${form.shiftId}/swap-requests`, {
        target_user_id: form.targetUserId,
        note: form.note.trim() || undefined,
      });
      setNotice(t('food.employeePortal.swaps.requestSuccess', { name: nameOf(form.targetUserId) }));
      setForm({ shiftId: '', targetUserId: '', note: '' });
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, t('food.employeePortal.swaps.requestError')));
    } finally {
      setSubmitting(false);
    }
  };

  const respond = async (requestId, action) => {
    setBusyId(requestId);
    setNotice('');
    setError('');
    try {
      await api.post(`${base}/shift-swaps/${requestId}/respond`, { action });
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, t('food.employeePortal.swaps.respondError')));
    } finally {
      setBusyId(null);
    }
  };

  const inbox = requests.filter((r) => String(r.target_user_id) === String(user?.id) && r.status === 'requested');
  const mine = requests.filter((r) => String(r.requester_user_id) === String(user?.id));

  if (loading) {
    return (
      <div className="ep-panel">
        <p className="ep-empty">{t('food.common.loading')}</p>
      </div>
    );
  }

  return (
    <div className="ep-panel">
      {error && <p className="ep-empty" role="alert">{error}</p>}

      <section className="ep-section">
        <h2>{t('food.employeePortal.swaps.requestTitle')}</h2>
        {shifts.length === 0 ? (
          <p className="ep-empty">{t('food.employeePortal.swaps.noShifts')}</p>
        ) : (
          <form onSubmit={submitRequest} className="ep-form">
            <label className="ep-field">
              <span>{t('food.employeePortal.swaps.myShift')}</span>
              <select
                value={form.shiftId}
                onChange={(event) => setForm((prev) => ({ ...prev, shiftId: event.target.value }))}
                required
              >
                <option value="">{t('food.employeePortal.swaps.myShift')}</option>
                {shifts.map((shift) => (
                  <option key={shift.id} value={shift.id}>
                    {shiftLabel({ ...shift, shift_date: shift.shift_date, start_time: shift.start_time, end_time: shift.end_time })}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field">
              <span>{t('food.employeePortal.swaps.target')}</span>
              <select
                value={form.targetUserId}
                onChange={(event) => setForm((prev) => ({ ...prev, targetUserId: event.target.value }))}
                required
              >
                <option value="">{t('food.employeePortal.swaps.target')}</option>
                {members.map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {memberName(member)}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field">
              <span>{t('food.employeePortal.swaps.note')}</span>
              <input
                type="text"
                value={form.note}
                maxLength={500}
                onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
              />
            </label>
            <div>
              <button type="submit" className="fd-btn" disabled={submitting}>
                {t('food.employeePortal.swaps.submit')}
              </button>
            </div>
          </form>
        )}
        {notice && <p className="ep-notice" role="status">{notice}</p>}
      </section>

      <section className="ep-section">
        <h2>{t('food.employeePortal.swaps.inboxTitle')}</h2>
        {inbox.length === 0 ? (
          <p className="ep-empty">{t('food.employeePortal.swaps.noInbox')}</p>
        ) : (
          <ul className="ep-list">
            {inbox.map((request) => (
              <li key={request.id} className="ep-list-row">
                <span>{shiftLabel(request)} ({t('food.employeePortal.swaps.requestedBy', { name: nameOf(request.requester_user_id) })})</span>
                <button
                  type="button"
                  className="fd-btn"
                  disabled={busyId === request.id}
                  onClick={() => respond(request.id, 'accept')}
                >
                  {t('food.employeePortal.swaps.accept')}
                </button>
                <button
                  type="button"
                  className="fd-btn fd-btn-secondary"
                  disabled={busyId === request.id}
                  onClick={() => respond(request.id, 'decline')}
                >
                  {t('food.employeePortal.swaps.decline')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ep-section">
        <h2>{t('food.employeePortal.swaps.myRequestsTitle')}</h2>
        {mine.length === 0 ? (
          <p className="ep-empty">{t('food.employeePortal.swaps.noRequests')}</p>
        ) : (
          <ul className="ep-list">
            {mine.map((request) => (
              <li key={request.id} className="ep-list-row">
                <span>{shiftLabel(request)} ({t('food.employeePortal.swaps.offeredTo', { name: nameOf(request.target_user_id) })})</span>
                <span className={`ep-status ep-status-${request.status}`}>
                  {t(`food.employeePortal.swaps.status.${request.status}`, { name: nameOf(request.target_user_id) })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
