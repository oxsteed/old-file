import { memo } from 'react';
import { useTranslation } from 'react-i18next';

function GoalsTab({ goals, analytics, onNew, onEdit, onDelete }) {
  const { t } = useTranslation();

  return (
    <div className="bh-goals-tab">
      <button className="bh-btn primary" onClick={onNew}>{t('businessHub.btnAddGoal')}</button>
      <p>{t('businessHub.goalsPlaceholder')}</p>
    </div>
  );
}

export default memo(GoalsTab);
