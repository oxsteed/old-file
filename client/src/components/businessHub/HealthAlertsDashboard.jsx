import React, { useState, useEffect } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { AlertTriangle, Info, CheckCircle, RefreshCw, X } from 'lucide-react';

const SEVERITY_CONFIG = {
  critical: { icon: AlertTriangle, color: '#ef4444', bg: '#ef444415', label: 'Critical' },
  warning:  { icon: AlertTriangle, color: '#f59e0b', bg: '#f59e0b15', label: 'Warning' },
  info:     { icon: Info, color: '#3b82f6', bg: '#3b82f615', label: 'Info' }
};

export function HealthAlertsDashboard({ businessId }) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);

  useEffect(() => { load(); }, [businessId, showDismissed]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/businesses/${businessId}/health-alerts`, { params: { dismissed: showDismissed ? 'true' : 'false' } });
      setAlerts(res.data || []);
    } catch { toast.error('Failed to load alerts'); }
    finally { setLoading(false); }
  };

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await api.post(`/businesses/${businessId}/health-alerts/generate`);
      setAlerts(res.data || []);
      toast.success('Alerts refreshed');
    } catch { toast.error('Failed to generate alerts'); }
    finally { setGenerating(false); }
  };

  const dismiss = async (id) => {
    try {
      await api.post(`/businesses/${businessId}/health-alerts/${id}/dismiss`);
      setAlerts(a => a.filter(x => x.id !== id));
      toast.success('Alert dismissed');
    } catch { toast.error('Failed to dismiss'); }
  };

  const criticalCount = alerts.filter(a => a.severity === 'critical').length;
  const warningCount = alerts.filter(a => a.severity === 'warning').length;

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>Business Health</h3>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--muted-text)', fontSize: '0.875rem' }}>Automated insights to keep your business on track</p>
        </div>
        <button onClick={generate} disabled={generating} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.6rem 1rem', cursor: 'pointer', color: 'var(--app-text)', fontSize: '0.875rem' }}>
          <RefreshCw size={14} style={{ animation: generating ? 'spin 1s linear infinite' : 'none' }} /> {generating ? 'Scanning...' : 'Scan Now'}
        </button>
      </div>

      {/* Score strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        {[
          ['Active Alerts', alerts.length, '#f97316'],
          ['Critical', criticalCount, '#ef4444'],
          ['Warnings', warningCount, '#f59e0b']
        ].map(([label, count, color]) => (
          <div key={label} style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.75rem', padding: '1rem', textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', fontWeight: 700, color }}>{count}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--muted-text)' }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', cursor: 'pointer', color: 'var(--muted-text)' }}>
          <input type="checkbox" checked={showDismissed} onChange={e => setShowDismissed(e.target.checked)} /> Show dismissed
        </label>
      </div>

      {loading ? <p style={{ color: 'var(--muted-text)' }}>Loading...</p> : alerts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted-text)' }}>
          <CheckCircle size={48} color="#10b981" style={{ marginBottom: '1rem', opacity: 0.7 }} />
          <p style={{ fontWeight: 600, color: '#10b981', marginBottom: '0.5rem' }}>All clear!</p>
          <p>No active alerts. Click "Scan Now" to check for new issues.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {['critical','warning','info'].map(severity =>
            alerts.filter(a => a.severity === severity).map(alert => {
              const cfg = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.info;
              const Icon = cfg.icon;
              return (
                <div key={alert.id} style={{ display: 'flex', gap: '1rem', background: cfg.bg, border: `1px solid ${cfg.color}44`, borderRadius: '0.75rem', padding: '1rem 1.25rem', opacity: alert.is_dismissed ? 0.5 : 1 }}>
                  <Icon size={20} color={cfg.color} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: cfg.color, fontSize: '0.875rem', marginBottom: '0.25rem' }}>{cfg.label}: {alert.title}</div>
                    <p style={{ margin: 0, fontSize: '0.875rem', lineHeight: 1.5 }}>{alert.message}</p>
                  </div>
                  {!alert.is_dismissed && (
                    <button onClick={() => dismiss(alert.id)} style={{ padding: '0.25rem', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--muted-text)', flexShrink: 0 }}>
                      <X size={16} />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
