import React, { useState, useEffect } from 'react';
import api from '../api/axios';

/**
 * Task 4: Customer hold countdown + "Broadcast Now" button.
 * Task 6: Inline "Add to Fund" UI.
 * Render on each planned need card in PlannedNeedsPage.jsx:
 *   <PlannedNeedHoldStatus need={need} onUpdate={refreshNeeds} />
 */
export default function PlannedNeedHoldStatus({ need, onUpdate }) {
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
    if (!window.confirm('Cancel the hold and open this job to all helpers?')) return;
    setBusy(true);
    try {
      await api.post(`/api/planned-needs/${need.id}/broadcast`);
      onUpdate?.();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const handleAddFund = async (e) => {
    e.preventDefault();
    if (!fundAmount || parseFloat(fundAmount) <= 0) return;
    setBusy(true);
    try {
      await api.post(`/api/planned-needs/${need.id}/fund`, { amount: parseFloat(fundAmount) });
      setFundAmount('');
      setShowFund(false);
      onUpdate?.();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: '8px' }}>
      {/* Task 4: Hold countdown */}
      {need.preferred_helper_status === 'pending' && hoursLeft !== null && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '8px 12px', background: '#fefce8',
          border: '1px solid #fde68a', borderRadius: '6px',
          fontSize: '13px', marginBottom: '8px',
        }}>
          <span>
            Waiting for <strong>{need.preferred_helper_first_name || 'helper'}</strong>
            {' '}&mdash; <strong>{Math.round(hoursLeft)}h</strong> remaining
          </span>
          <button
            onClick={handleBroadcast}
            disabled={busy}
            style={{
              marginLeft: 'auto', background: '#dc2626', color: 'white',
              border: 'none', borderRadius: '4px', padding: '4px 10px',
              cursor: 'pointer', fontSize: '12px', fontWeight: 600,
            }}
          >{busy ? '...' : 'Broadcast Now'}</button>
        </div>
      )}

      {/* Task 6: Sinking fund update */}
      {!['cancelled', 'completed'].includes(need.status) && need.estimated_cost > 0 && (
        <div style={{ fontSize: '13px', color: '#6b7280' }}>
          <span>
            Fund: <strong>${parseFloat(need.reserved_amount || 0).toFixed(2)}</strong>
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
            >+ Add</button>
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
              }}>{busy ? '...' : 'Save'}</button>
              <button type="button" onClick={() => setShowFund(false)} style={{
                background: 'none', border: 'none', color: '#9ca3af',
                cursor: 'pointer', fontSize: '12px',
              }}>Cancel</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
