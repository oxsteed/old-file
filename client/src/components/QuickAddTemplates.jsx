import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';

/**
 * Task 9: Quick-add templates row for PlannedNeedsPage.
 * Renders a horizontal row of template tiles. Clicking one pre-fills the form.
 * Usage: <QuickAddTemplates onSelect={(template) => prefillForm(template)} />
 */
const ICONS = {
  'oil-can': '\u{1F6E2}', tire: '\u{1F6DE}', brake: '\u{1F6D1}',
  tooth: '\u{1F9B7}', heart: '\u{2764}', scissors: '\u{2702}',
  thermometer: '\u{1F321}', leaf: '\u{1F33F}',
};

export default function QuickAddTemplates({ onSelect }) {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState([]);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    setLoadError(false);
    api.get('/planned-needs/templates')
      .then(r => setTemplates(r.data.templates || []))
      .catch(() => setLoadError(true));
  }, []);

  useEffect(load, [load]);

  if (loadError) {
    return (
      <div style={{ marginBottom: '16px' }}>
        <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 8px' }}>{t('quickAddTemplates.quickAdd')}</p>
        <div
          role="alert"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
            padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: '8px', fontSize: '13px', color: '#991b1b',
          }}
        >
          <span>{t('quickAddTemplates.loadError', 'Could not load quick-add templates.')}</span>
          <button
            type="button"
            onClick={load}
            style={{
              flexShrink: 0, padding: '6px 14px', background: 'white',
              border: '1px solid #fca5a5', borderRadius: '6px', cursor: 'pointer',
              fontSize: '12px', fontWeight: 600, color: '#991b1b',
            }}
          >
            {t('common.retry', 'Retry')}
          </button>
        </div>
      </div>
    );
  }

  if (!templates.length) return null;

  return (
    <div style={{ marginBottom: '16px' }}>
      <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 8px' }}>{t('quickAddTemplates.quickAdd')}</p>
      <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
        {templates.map(t => (
          <button
            key={t.id}
            onClick={() => onSelect({
              title: t.default_title,
              description: t.default_description || '',
              category: t.category,
              estimated_cost: t.default_estimated_cost,
              recurrence_type: t.default_recurrence_type,
              recurrence_interval_days: t.default_recurrence_interval_days,
              lead_time_days: t.default_lead_time_days,
            })}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              minWidth: '80px', padding: '10px 8px',
              background: 'white', border: '1px solid #e5e7eb',
              borderRadius: '8px', cursor: 'pointer',
              fontSize: '12px', color: '#374151',
              transition: 'border-color 0.15s',
            }}
            onMouseOver={e => e.currentTarget.style.borderColor = '#3b82f6'}
            onMouseOut={e => e.currentTarget.style.borderColor = '#e5e7eb'}
          >
            <span style={{ fontSize: '20px', marginBottom: '4px' }}>
              {ICONS[t.icon] || '\u{1F4CB}'}
            </span>
            {t.name}
          </button>
        ))}
      </div>
    </div>
  );
}
