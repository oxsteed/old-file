import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { createCampaign } from '../../api/logistics';
import PageShell from '../../components/PageShell';
import CampaignDraftForm from '../../components/logistics/CampaignDraftForm';
import '../../styles/logistics/LogisticsHomePage.css';

// Full-page campaign draft form (per spec: longer forms use full pages, not
// modals). Organizers save a working draft here; submission for Operations
// review happens from the campaign detail page / organizer workspace.
// The form itself lives in CampaignDraftForm, shared with the edit page.
export default function NewCampaignPage() {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const navigate = useNavigate();

  return (
    <PageShell>
      <CampaignDraftForm
        mode="create"
        onSubmit={createCampaign}
        onSuccess={(res) => navigate(`/logistics/campaigns/${res.data.id}`)}
        submitLabel={tx('logistics.campaigns.new.saveDraft', 'Save as draft')}
        heading={tx('logistics.campaigns.new.title', 'Start a new campaign')}
        subheading={tx('logistics.campaigns.new.subtitle',
          'Draft your pooled campaign. Review it and submit it for Operations approval when it is ready.')}
        backTo="/logistics/organizer"
        backLabel={tx('logistics.campaigns.new.back', 'Back to organizer workspace')}
        successMessage={tx('logistics.campaigns.new.draftSaved', 'Draft saved.')}
        errorMessage={tx('logistics.campaigns.new.createFailed', 'Could not save the draft. Please try again.')}
      />
    </PageShell>
  );
}
