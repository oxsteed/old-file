import React from 'react';
import { useTranslation } from 'react-i18next';

const CHANNEL_ORDER = ['in_app', 'push', 'email'];

function pct(value, language) {
  if (value == null) return null;
  return new Intl.NumberFormat(language || 'en', { style: 'percent', maximumFractionDigits: 1 }).format(Number(value) / 100);
}

/**
 * Delivery and engagement for one broadcast or a reporting window
 * (analytics decision 1). `channels` is { in_app|push|email: { sent, failed,
 * skipped, pending, opened, clicked, openRatePct, clickRatePct } }.
 */
export function BroadcastDeliveryStats({ channels = {}, unsubscribes = 0, compact = false, testId }) {
  const { t, i18n } = useTranslation();
  const n = (v) => new Intl.NumberFormat(i18n.language || 'en').format(Number(v || 0));
  const present = CHANNEL_ORDER.filter((ch) => channels[ch]);
  if (!present.length) return null;
  return (
    <div className="broadcast-delivery-stats" data-testid={testId} style={{ marginTop: compact ? '0.5rem' : 0 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', tableLayout: 'fixed' }}>
        <caption style={{ textAlign: 'start', fontWeight: 600, fontSize: '0.75rem', color: 'var(--muted-text)', paddingBottom: '0.25rem' }}>
          {t('businessHub.marketing.delivery.caption')}
        </caption>
        <colgroup><col style={{ width: '34%' }} /><col style={{ width: '22%' }} /><col style={{ width: '22%' }} /><col style={{ width: '22%' }} /></colgroup>
        <thead>
          <tr>
            <th scope="col" style={{ textAlign: 'start', fontWeight: 600, padding: '0.25rem' }}>{t('businessHub.marketing.channel')}</th>
            <th scope="col" style={{ textAlign: 'end', fontWeight: 600, padding: '0.25rem', overflowWrap: 'anywhere', hyphens: 'auto', verticalAlign: 'bottom' }}>{t('businessHub.marketing.delivery.sent')}</th>
            <th scope="col" style={{ textAlign: 'end', fontWeight: 600, padding: '0.25rem', overflowWrap: 'anywhere', hyphens: 'auto', verticalAlign: 'bottom' }}>{t('businessHub.marketing.delivery.opened')}</th>
            <th scope="col" style={{ textAlign: 'end', fontWeight: 600, padding: '0.25rem', overflowWrap: 'anywhere', hyphens: 'auto', verticalAlign: 'bottom' }}>{t('businessHub.marketing.delivery.clicked')}</th>
          </tr>
        </thead>
        <tbody>
          {present.map((ch) => {
            const c = channels[ch];
            const issues = Number(c.failed || 0) + Number(c.skipped || 0);
            return (
              <tr key={ch} data-channel={ch} style={{ borderTop: '1px solid var(--border-color)' }}>
                <th scope="row" style={{ textAlign: 'start', fontWeight: 500, padding: '0.25rem', overflowWrap: 'break-word', hyphens: 'auto' }}>
                  {t(`businessHub.marketing.channels.${ch}`)}
                  {Number(c.pending || 0) > 0 && <div style={{ fontWeight: 400, color: 'var(--muted-text)' }}>{t('businessHub.marketing.delivery.pending', { count: c.pending })}</div>}
                  {issues > 0 && <div style={{ fontWeight: 400, color: 'var(--muted-text)' }}>{t('businessHub.marketing.delivery.notDelivered', { count: issues })}</div>}
                </th>
                <td style={{ textAlign: 'end', padding: '0.25rem' }}>{n(c.sent)}</td>
                <td style={{ textAlign: 'end', padding: '0.25rem' }}>
                  {n(c.opened)}{c.openRatePct != null && <div style={{ color: 'var(--muted-text)' }}>{pct(c.openRatePct, i18n.language)}</div>}
                </td>
                <td style={{ textAlign: 'end', padding: '0.25rem' }}>
                  {ch === 'email' ? <>{n(c.clicked)}{c.clickRatePct != null && <div style={{ color: 'var(--muted-text)' }}>{pct(c.clickRatePct, i18n.language)}</div>}</> : <span aria-label={t('businessHub.marketing.delivery.notTracked')}>—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ margin: '0.35rem 0 0', fontSize: '0.7rem', color: 'var(--muted-text)', overflowWrap: 'anywhere' }}>
        {t('businessHub.marketing.delivery.unsubscribes', { count: unsubscribes || 0 })} · {t('businessHub.marketing.delivery.openNote')}
      </p>
    </div>
  );
}

export default BroadcastDeliveryStats;
