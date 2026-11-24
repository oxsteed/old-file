import { useTranslation } from 'react-i18next';
import { CheckCircle2, Clock, ShieldCheck } from 'lucide-react';
import './FranchiseApplicationDetail.css';

// Group 12 Slice 3e (624, D-325): the operator-facing compliance
// checklist — standards-compliance items per territory, derived from
// the standards library, the acknowledgment state, and readiness. The
// operator checks a standard item by acknowledging its current version
// in the standards library above; readiness is HQ-owned. This is NOT
// the HQ intake checklist (603): those items stay admin-only.
export default function FranchiseComplianceChecklist({ checklist = null }) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);
  const items = checklist?.items || [];

  function itemTitle(item) {
    if (item.kind === 'standard') return item.guide_title;
    if (item.kind === 'team') return copy('complianceChecklistTeamTitle');
    return copy('complianceChecklistReadinessTitle');
  }

  function itemDetail(item) {
    if (item.kind === 'standard') {
      const counts = copy('complianceChecklistStandardCount', {
        count: item.acknowledged_count ?? 0,
        total: item.member_count ?? 0,
      });
      const version = copy('standardsVersion', { version: item.version });
      const hint = item.done ? '' : ` · ${copy('complianceChecklistAcknowledgeHint')}`;
      return `${version} · ${counts}${hint}`;
    }
    if (item.kind === 'team') {
      return item.done
        ? copy('complianceChecklistTeamDone')
        : copy('complianceChecklistTeamPending', { count: item.pending_standards ?? 0 });
    }
    return item.done
      ? copy('complianceChecklistReadinessDone')
      : copy('complianceChecklistReadinessPending');
  }

  return (
    <section className="fr-detail-card">
      <div className="fr-detail-heading">
        <ShieldCheck size={16} className="fr-detail-heading-icon" />
        <div>
          <h2 className="fr-detail-title">{copy('complianceChecklistTitle')}</h2>
          <p className="fr-detail-subtitle">{copy('complianceChecklistSubtitle')}</p>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="fr-detail-empty">{copy('complianceChecklistEmpty')}</p>
      ) : (
        <>
          <p className="fr-detail-empty">
            {copy('complianceChecklistProgress', { done: checklist.done ?? 0, total: checklist.total ?? items.length })}
          </p>
          <ul className="fr-doc-files">
            {items.map((item) => (
              <li key={item.code} className="fr-doc-file">
                <div>
                  <div className="fr-doc-file-name">{itemTitle(item)}</div>
                  <div className="fr-doc-file-meta">{itemDetail(item)}</div>
                </div>
                {item.done
                  ? <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                  : <Clock size={16} className="text-yellow-400 shrink-0" />}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
