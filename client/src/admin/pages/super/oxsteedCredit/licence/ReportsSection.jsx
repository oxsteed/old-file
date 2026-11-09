import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../../../lib/adminApi';
import {
  ActionButton, Field, LICENCE_API, LicenceTable, Notices, Panel, downloadLicenceFile, inputClass, useLicenceAction, useLicenceGet,
} from './licenceShared';

function isoDay(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

/**
 * Regulator report packs (§9) with a SHA-256 over every file, and the
 * daily external anchors of the audit hash chains with their last
 * verification result.
 */
export default function ReportsSection() {
  const { t } = useTranslation('credit');
  const packs = useLicenceGet('/report-packs', { limit: 100 });
  const anchors = useLicenceGet('/audit-anchors', { limit: 60 });
  const action = useLicenceAction();
  const [form, setForm] = useState({ packType: '', from: isoDay(-30), to: isoDay(0) });
  const [anchor, setAnchor] = useState(null);

  const generate = async (event) => {
    event.preventDefault();
    await action.run(() => adminApi.post(`${LICENCE_API}/report-packs`, form), 'adminLicence.generated');
    packs.reload();
  };
  const download = (pack, name) => action.run(() => downloadLicenceFile(`/report-packs/${encodeURIComponent(pack.id)}/files/${encodeURIComponent(name)}`, `${pack.pack_type}-${pack.period_from}-${pack.period_to}-${name}`));
  const anchorNow = async () => { await action.run(() => adminApi.post(`${LICENCE_API}/audit-anchors/run`), 'adminLicence.done'); anchors.reload(); };
  // Gap fill 10: open one day's anchor (GET /audit-anchors/:date) to read
  // the exact payload whose SHA-256 was sent out of band.
  const openAnchor = async (row) => {
    if (anchor?.anchor_date === row.anchor_date) { setAnchor(null); return; }
    const result = await action.run(() => adminApi.get(`${LICENCE_API}/audit-anchors/${encodeURIComponent(row.anchor_date)}`));
    if (result) setAnchor(result.data);
  };
  const verify = async () => { await action.run(() => adminApi.post(`${LICENCE_API}/audit-anchors/verify`, { limit: 30 }), 'adminLicence.done'); anchors.reload(); };

  return (
    <div className="space-y-4">
      <Notices notice={action.notice} error={action.error || packs.error || anchors.error} />
      <Panel title={t('adminLicence.packsTitle')} detail={t('adminLicence.packsDetail')}>
        <form onSubmit={generate} className="flex flex-wrap items-end gap-3">
          <Field label={t('adminLicence.col.type')}>
            <select required value={form.packType} onChange={(e) => setForm((f) => ({ ...f, packType: e.target.value }))} className={inputClass}>
              <option value="">{t('adminLicence.chooseType')}</option>
              {(packs.data?.types || []).map((type) => <option key={type} value={type}>{t(`adminLicence.pack.${type}`, { defaultValue: type })}</option>)}
            </select>
          </Field>
          <Field label={t('adminLicence.from')}><input type="date" required value={form.from} onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))} className={inputClass} /></Field>
          <Field label={t('adminLicence.to')}><input type="date" required value={form.to} onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))} className={inputClass} /></Field>
          <ActionButton type="submit" tone="primary" disabled={action.busy || !form.packType}>{t('adminLicence.generate')}</ActionButton>
        </form>
        <LicenceTable
          rows={packs.data?.packs || []}
          columns={[
            { key: 'pack_type', label: 'type', render: (v) => t(`adminLicence.pack.${v}`, { defaultValue: v }) },
            { key: 'period_from', label: 'from' },
            { key: 'period_to', label: 'to' },
            { key: 'sha256', label: 'sha', render: (v) => <code dir="ltr" className="break-all">{v}</code> },
            { key: 'generated_at', label: 'created', kind: 'date' },
          ]}
          actions={(pack) => (pack.files || []).map((name) => (
            <ActionButton key={name} disabled={action.busy} onClick={() => download(pack, name)}>{t('adminLicence.downloadFile', { file: name })}</ActionButton>
          ))}
        />
      </Panel>
      <Panel
        title={t('adminLicence.anchorsTitle')}
        detail={t('adminLicence.anchorsDetail')}
        actions={(
          <>
            <ActionButton disabled={action.busy} onClick={anchorNow}>{t('adminLicence.anchorNow')}</ActionButton>
            <ActionButton disabled={action.busy} onClick={verify}>{t('adminLicence.verifyAnchors')}</ActionButton>
          </>
        )}
      >
        <LicenceTable
          rows={anchors.data?.anchors || []}
          columns={[
            { key: 'anchor_date', label: 'date' },
            { key: 'payload_sha256', label: 'sha', render: (v) => <code dir="ltr" className="break-all">{v}</code> },
            { key: 'email_status', label: 'emailCopy' },
            { key: 'r2_status', label: 'storageCopy' },
            { key: 'last_verification', label: 'result', render: (v) => (!v ? '—' : v.ok ? t('adminLicence.verifiedOk') : t('adminLicence.verifyProblems', { problems: (v.problems || []).join(', ') })) },
            { key: 'last_verified_at', label: 'checked', kind: 'date' },
          ]}
          actions={(row) => (
            <ActionButton disabled={action.busy} onClick={() => openAnchor(row)}>
              {anchor?.anchor_date === row.anchor_date ? t('adminLicence.hide') : t('adminLicence.viewAnchor')}
            </ActionButton>
          )}
        />
        {anchor && (
          <section aria-label={t('adminLicence.anchorDetailTitle', { date: anchor.anchor_date })} data-anchor={anchor.anchor_date} className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('adminLicence.anchorDetailTitle', { date: anchor.anchor_date })}</h3>
            <p className="text-xs text-gray-500">{t('adminLicence.anchorDetailHelp')}</p>
            <p className="text-xs"><span className="font-semibold">{t('adminLicence.col.sha')}</span> <code dir="ltr" className="break-all">{anchor.payload_sha256}</code></p>
            <pre dir="ltr" className="max-h-96 overflow-auto rounded-lg bg-gray-50 dark:bg-gray-950 p-3 text-start text-xs">{JSON.stringify(anchor.payload, null, 2)}</pre>
          </section>
        )}
      </Panel>
    </div>
  );
}
