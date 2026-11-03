import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../../../lib/adminApi';
import { AdminActionDialog, useCreditDialog } from '../shared';
import {
  ActionButton, LICENCE_API, LicenceTable, Notices, Panel, requestOversight, useLicenceAction, useLicenceGet,
} from './licenceShared';

/**
 * Quarterly access review (§9): every admin role, permission grant and API
 * key is kept or revoked by an admin who is not the subject; completing the
 * review (which applies the revocations) needs a second admin.
 */
export default function AccessReviewSection() {
  const { t } = useTranslation('credit');
  const reviews = useLicenceGet('/access-reviews');
  const [openId, setOpenId] = useState(null);
  const action = useLicenceAction();
  const { dialog, requestDialog, resolveDialog } = useCreditDialog();

  const ensure = async () => {
    await action.run(() => adminApi.post(`${LICENCE_API}/access-reviews/ensure`), 'adminLicence.done');
    reviews.reload();
  };

  return (
    <div className="space-y-4">
      <Notices notice={action.notice} error={action.error || reviews.error} />
      <Panel
        title={t('adminLicence.reviewsTitle')}
        detail={t('adminLicence.reviewsDetail')}
        actions={<ActionButton disabled={action.busy} onClick={ensure}>{t('adminLicence.ensureReview')}</ActionButton>}
      >
        <LicenceTable
          rows={reviews.data?.reviews || []}
          columns={[
            { key: 'period_label', label: 'period' },
            { key: 'status' },
            { key: 'item_count', label: 'count' },
            { key: 'undecided' },
            { key: 'due_at', label: 'due', kind: 'date' },
            { key: 'completed_at', label: 'date', kind: 'date' },
          ]}
          actions={(row) => (
            <>
              <ActionButton onClick={() => setOpenId(openId === row.id ? null : row.id)}>{openId === row.id ? t('adminLicence.hide') : t('adminLicence.open')}</ActionButton>
              {row.status === 'open' && Number(row.undecided) === 0 && (
                <ActionButton tone="primary" disabled={action.busy} onClick={() => action.run(() => requestOversight('credit_access_review_complete', { reviewId: row.id }), 'adminLicence.requested')}>{t('adminLicence.requestCompletion')}</ActionButton>
              )}
            </>
          )}
        />
      </Panel>
      {openId && <ReviewItems reviewId={openId} action={action} requestDialog={requestDialog} onChanged={reviews.reload} />}
      <AdminActionDialog dialog={dialog} onResolve={resolveDialog} />
    </div>
  );
}

function ReviewItems({ reviewId, action, requestDialog, onChanged }) {
  const { t } = useTranslation('credit');
  const review = useLicenceGet(`/access-reviews/${encodeURIComponent(reviewId)}`);
  const decide = async (item, decision) => {
    let note = null;
    if (decision === 'revoke') {
      note = await requestDialog({ kind: 'text', title: t('adminLicence.revoke'), description: t('adminLicence.revokeHelp'), label: t('adminLicence.col.reason'), maxLength: 1000 });
      if (!note) return;
    }
    await action.run(() => adminApi.post(`${LICENCE_API}/access-reviews/${encodeURIComponent(reviewId)}/items/${encodeURIComponent(item.id)}/decision`, { decision, note }), 'adminLicence.done');
    review.reload();
    onChanged();
  };
  const open = review.data?.review?.status === 'open';
  return (
    <Panel title={t('adminLicence.reviewItemsTitle', { period: review.data?.review?.period_label || '' })}>
      <LicenceTable
        rows={review.data?.items || []}
        columns={[
          { key: 'subject_type', label: 'type' },
          { key: 'subject_email', label: 'user' },
          { key: 'snapshot', label: 'access', render: (v) => <code dir="ltr" className="break-all">{v?.role || v?.permission || v?.name || JSON.stringify(v)}</code> },
          { key: 'decision' },
          { key: 'note', label: 'reason' },
          { key: 'decided_at', label: 'date', kind: 'date' },
        ]}
        actions={(item) => open && (
          <>
            <ActionButton disabled={action.busy} onClick={() => decide(item, 'keep')}>{t('adminLicence.keep')}</ActionButton>
            <ActionButton tone="danger" disabled={action.busy} onClick={() => decide(item, 'revoke')}>{t('adminLicence.revoke')}</ActionButton>
          </>
        )}
      />
    </Panel>
  );
}
