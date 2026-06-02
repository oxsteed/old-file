import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../api/axios';

export default function PlannedNeedHoldStatus({ need, onUpdate }) {
  const { t } = useTranslation();
  const [hoursLeft, setHoursLeft] = useState(null);
  const [fundAmount, setFundAmount] = useState('');
  const [showFund, setShowFund] = useState(false);
  const [busy, setBusy] = useState(false);

  // Countdown timer
  useEffect(() => {
    if (need.preferred_helper_status !== 'pending' || !need.helper_notified_at) return;
    const calc = () => {
      const notified = new Date(need.helper_notified_at);
      const expires = new Date(notified.getTime() + 72 * 60 * 60 * 1000);
      const h = Math.max(0, (expires - new Date()) / (1000 * 60 * 60));
      setHoursLeft(Math.round(h * 10) / 10);
    };
    calc();
    const iv = setInterval(calc, 60000);
    return () => clearInterval(iv);
  }, [need]);

  const handleBroadcast = async () => {
    if (!window.confirm(t('preferredHelper.confirmBroadcast'))) return;
    setBusy(true);
    try {
      await api.post(`/planned-needs/${need.id}/broadcast`);
      onUpdate?.();
    } catch (err) {
      toast.error(err.response?.data?.error || t('common.failed'));
    } finally {
      setBusy(false);
    }
  };

  const handleAddFund = async (e) => {
    e.preventDefault();
    if (!fundAmount || parseFloat(fundAmount) <= 0) return;
    setBusy(true);
    try {
      await api.post(`/planned-needs/${need.id}/fund`, { amount: parseFloat(fundAmount) });
      setFundAmount('');
      setShowFund(false);
      onUpdate?.();
    } catch (err) {
      toast.error(err.response?.data?.error || t('common.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: '8px' }}>
      {/* Hold countdown */}
      {need.preferred_helper_status === 'pending' && hoursLeft !== null && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '8px 12px', background: '#fefce8',
          border: '1px solid #fde68a', borderRadius: '6px',
          fontSize: '13px', marginBottom: '8px',
        }}>
          <span>
            {t('preferredHelper.holdWaiting', {
              name: need.preferred_helper_display_name || need.preferred_helper_first_name || 'helper',
              hours: Math.round(hoursLeft),
            })}
          </span>
          <button
            onClick={handleBroadcast}
            disabled={busy}
            style={{
              marginLeft: 'auto', background: '#dc2626', color: 'white',
              border: 'none', borderRadius: '4px', padding: '4px 10px',
              cursor: 'pointer', fontSize: '12px', fontWeight: 600,
            }}
          >{busy ? '...' : t('preferredHelper.broadcastNow')}</button>
        </div>
      )}

      {/* Sinking fund update */}
      {!['cancelled', 'completed'].includes(need.status) && need.estimated_cost > 0 && (
        <div style={{ fontSize: '13px', color: '#6b7280' }}>
          <span>
            {t('preferredHelper.fundLabel')} <strong>${parseFloat(need.reserved_amount || 0).toFixed(2)}</strong>
            {' / $'}{parseFloat(need.estimated_cost).toFixed(2)}
            {' ('}{need.estimated_cost > 0 ? Math.min(100, Math.round((need.reserved_amount / need.estimated_cost) * 100)) : 0}%)
          </span>
          {!showFund ? (
            <button
              onClick={() => setShowFund(true)}
              style={{
                marginLeft: '8px', background: 'none', border: '1px solid #d1d5db',
                borderRadius: '4px', padding: '2px 8px', cursor: 'pointer',
                fontSize: '12px', color: '#2563eb',
              }}
            >{t('preferredHelper.addFund')}</button>
          ) : (
            <form onSubmit={handleAddFund} style={{ display: 'inline-flex', gap: '4px', marginLeft: '8px' }}>
              <input
                type="number" step="0.01" min="0.01" value={fundAmount}
                onChange={e => setFundAmount(e.target.value)}
                placeholder="$" style={{ width: '60px', padding: '2px 4px', fontSize: '12px', borderRadius: '4px', border: '1px solid #d1d5db' }}
                autoFocus
              />
              <button type="submit" disabled={busy} style={{
                background: '#16a34a', color: 'white', border: 'none',
                borderRadius: '4px', padding: '2px 8px', fontSize: '12px', cursor: 'pointer',
              }}>{busy ? '...' : t('preferredHelper.save')}</button>
              <button type="button" onClick={() => setShowFund(false)} style={{
                background: 'none', border: 'none', color: '#9ca3af',
                cursor: 'pointer', fontSize: '12px',
              }}>{t('preferredHelper.cancel')}</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
