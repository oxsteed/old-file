import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { getCampaign, updateCampaign } from '../../api/logistics';
import PageShell from '../../components/PageShell';
import CampaignDraftForm from '../../components/logistics/CampaignDraftForm';
import '../../styles/logistics/LogisticsHomePage.css';

// Guard outcomes for the client-side edit checks. These are advisory: the
// server re-checks ownership and approval state on PATCH.
const GUARD_REDIRECT_SECONDS = 5;
const EDITABLE_STATES = ['draft', 'revisions_requested'];

export default function EditCampaignPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const { user } = useAuth();
  const navigate = useNavigate();

  const [campaign, setCampaign] = useState(null);
  const [loading, setLoading] = useState(true);
  const [guard, setGuard] = useState(null); // 'loadError' | 'notFound' | 'notOwner' | 'notEditable'

  useEffect(() => {
    if (!user) { navigate('/login', { replace: true }); return undefined; }
    let cancelled = false;
    setLoading(true);
    setGuard(null);
    getCampaign(id)
      .then((r) => {
        if (cancelled) return;
        const loaded = r.data;
        if (!loaded) {
          setGuard('notFound');
        } else if (String(loaded.organizer_user_id) !== String(user.id)) {
          setGuard('notOwner');
        } else if (!EDITABLE_STATES.includes(loaded.approval_state || 'draft')) {
          setGuard('notEditable');
        } else {
          setCampaign(loaded);
        }
      })
      .catch(() => { if (!cancelled) setGuard('loadError'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, user, navigate]);

  // Show the guard message, then redirect so a blocked user is not stranded.
  useEffect(() => {
    if (!guard) return undefined;
    const timer = setTimeout(
      () => navigate('/logistics/organizer', { replace: true }),
      GUARD_REDIRECT_SECONDS * 1000
    );
    return () => clearTimeout(timer);
  }, [guard, navigate]);

  const guardCopy = {
    loadError: tx('logistics.campaigns.edit.loadError', 'Could not load the campaign. Please try again.'),
    notFound: tx('logistics.campaigns.edit.notFound', 'Campaign not found. It may have been deleted.'),
    notOwner: tx('logistics.campaigns.edit.notOwner', 'Only the campaign organizer can edit this draft.'),
    notEditable: tx('logistics.campaigns.edit.notEditable',
      'This campaign can no longer be edited. Only drafts and campaigns with requested revisions can be edited.'),
  };

  return (
    <PageShell>
      {loading && (
        <div className="lx-page" style={{ maxWidth: 720 }}>
          <p className="lx-t-muted">{tx('logistics.campaigns.edit.loading', 'Loading campaign draft…')}</p>
        </div>
      )}

      {!loading && guard && (
        <div className="lx-page" style={{ maxWidth: 720 }}>
          <div className="lx-card" role="alert">
            <h1 className="lx-page-title" style={{ fontSize: '1.25rem' }}>
              {tx('logistics.campaigns.edit.title', 'Edit campaign draft')}
            </h1>
            <p className="lx-t-muted" style={{ margin: '0.75rem 0 1.25rem', lineHeight: 1.6 }}>
              {guardCopy[guard]}
            </p>
            <Link to="/logistics/organizer" className="lx-btn-primary">
              {tx('logistics.campaigns.new.back', 'Back to organizer workspace')}
            </Link>
          </div>
        </div>
      )}

      {!loading && !guard && campaign && (
        <CampaignDraftForm
          mode="edit"
          initialCampaign={campaign}
          onSubmit={(payload) => updateCampaign(id, payload)}
          onSuccess={() => navigate(`/logistics/campaigns/${id}`)}
          submitLabel={tx('logistics.campaigns.edit.saveChanges', 'Save changes')}
          heading={tx('logistics.campaigns.edit.title', 'Edit campaign draft')}
          subheading={tx('logistics.campaigns.edit.subtitle',
            'Update your draft below. When it is ready, submit it for Operations review.')}
          backTo={`/logistics/campaigns/${id}`}
          backLabel={tx('logistics.campaigns.edit.backToCampaign', 'Back to campaign')}
          successMessage={tx('logistics.campaigns.edit.draftUpdated', 'Draft updated.')}
          errorMessage={tx('logistics.campaigns.edit.updateFailed', 'Could not update the draft. Please try again.')}
        />
      )}
    </PageShell>
  );
}
