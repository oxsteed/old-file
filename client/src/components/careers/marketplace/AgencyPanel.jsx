import { useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { decideAgencyLink, listAgencyLinks, requestAgencyLink, revokeAgencyLink } from '../../../api/careers';
import { ActionButton, Check, Empty, Field, Loading, LoadError, useCareerErrors, useLoad } from '../ui';
import { AGENCY_PERMISSIONS } from '../../../features/careers/marketplaceModel';

/**
 * Recruiter / staffing-agency links. An agency asks a client business for
 * named permissions; the client's owner approves (and may narrow) them and
 * can revoke at any time. Every action is in both businesses' audit logs.
 */
export default function AgencyPanel({ ctx }) {
  const { t } = useTranslation();
  const errorText = useCareerErrors();
  const data = useLoad(() => listAgencyLinks(ctx.businessId), [ctx.businessId]);
  const [clientId, setClientId] = useState('');
  const [perms, setPerms] = useState(['post_openings', 'manage_pipeline']);
  const [decide, setDecide] = useState({});
  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <LoadError error={data.error} onRetry={data.reload} />;
  const links = data.data?.links || [];
  const permToggles = (value, onChange, prefix) => AGENCY_PERMISSIONS.map((p) => (
    <Check key={p} id={`${prefix}-${p}`} label={t(`careers.mk.agency.perm.${p}`)} checked={value.includes(p)} onChange={(on) => onChange(on ? [...value, p] : value.filter((x) => x !== p))} />
  ));
  return (
    <div className="ox-careers-grid">
      <p className="ox-careers-subtle">{t('careers.mk.agency.hint')}</p>
      <section className="ox-careers-section">
        <h3>{t('careers.mk.agency.links')}</h3>
        {!links.length ? <Empty>{t('careers.mk.agency.none')}</Empty> : null}
        {links.map((l) => (
          <article key={l.id} className="ox-careers-app">
            <div className="ox-careers-row">
              <strong>{l.my_side === 'agency' ? t('careers.mk.agency.client', { name: l.client_name }) : t('careers.mk.agency.agency', { name: l.agency_name })}</strong>
              <span className={`ox-careers-chip${l.status === 'active' ? ' ok' : ''}`}>{t(`careers.mk.agency.status.${l.status}`)}</span>
            </div>
            <p className="ox-careers-subtle">{(l.permissions || []).map((p) => t(`careers.mk.agency.perm.${p}`)).join(' · ')}</p>
            {l.my_side === 'client' && l.status === 'pending' ? (
              <>
                {permToggles(decide[l.id] || l.permissions || [], (v) => setDecide((d) => ({ ...d, [l.id]: v })), `dec-${l.id}`)}
                <div className="ox-careers-actions">
                  <ActionButton primary onClick={async () => { await decideAgencyLink(ctx.businessId, l.id, { decision: 'approve', permissions: decide[l.id] || l.permissions }); data.reload(); }}>{t('careers.mk.agency.approve')}</ActionButton>
                  <ActionButton danger onClick={async () => { await decideAgencyLink(ctx.businessId, l.id, { decision: 'decline' }); data.reload(); }}>{t('careers.mk.agency.decline')}</ActionButton>
                </div>
              </>
            ) : null}
            {['active', 'pending'].includes(l.status) ? (
              <ActionButton danger confirm={t('careers.mk.agency.revokeConfirm')} onClick={async () => { await revokeAgencyLink(ctx.businessId, l.id); data.reload(); }}>{t('careers.mk.agency.revoke')}</ActionButton>
            ) : null}
          </article>
        ))}
      </section>
      <form className="ox-careers-panel" onSubmit={async (e) => {
        e.preventDefault();
        try { await requestAgencyLink(ctx.businessId, { client_business_id: Number(clientId), permissions: perms }); setClientId(''); toast.success(t('careers.mk.agency.requested')); data.reload(); } catch (err) { toast.error(errorText(err)); }
      }}
      >
        <h3>{t('careers.mk.agency.requestTitle')}</h3>
        <p className="ox-careers-subtle">{t('careers.mk.agency.requestHint')}</p>
        <Field label={t('careers.mk.agency.clientId')} htmlFor="agency-client"><input id="agency-client" inputMode="numeric" dir="ltr" value={clientId} onChange={(e) => setClientId(e.target.value.replace(/\D/g, ''))} /></Field>
        {permToggles(perms, setPerms, 'req')}
        <button type="submit" className="ox-careers-btn primary" disabled={!clientId || !perms.length}>{t('careers.mk.agency.request')}</button>
      </form>
    </div>
  );
}
