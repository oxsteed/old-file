import { memo } from 'react';
import { useTranslation } from 'react-i18next';

function TeamTab({ members, invitations, managedBiz, vortexTokens, tokenForm, onTokenFormChange, onGenerateToken, generatingToken, onRevokeToken, onInvite, onRevoke, onAccept, onDecline }) {
  const { t } = useTranslation();

  return (
    <div className="bh-team-tab">
      <button className="bh-btn primary" onClick={onInvite}>{t('businessHub.btnInviteMember')}</button>
      <p>{t('businessHub.teamPlaceholder')}</p>
    </div>
  );
}

export default memo(TeamTab);
