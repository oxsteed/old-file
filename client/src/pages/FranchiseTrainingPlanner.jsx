import { useTranslation } from 'react-i18next';
import { GraduationCap } from 'lucide-react';
import './FranchiseApplicationDetail.css';

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Group 12 Slice 3h (638, D-338): the training resource planner — who
// needs what training by when, and how much of the required training is
// covered. Derived from the territory's training assignments, its
// roster, and the Learn program catalogue. Read-only: assignments are
// made from the training distribution surface (618).
export default function FranchiseTrainingPlanner({ planner = null }) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);

  const totals = planner?.totals || {};
  const members = planner?.members || [];
  const locations = planner?.locations || [];
  const modules = planner?.modules || [];
  const gaps = planner?.gaps || [];

  return (
    <section className="fr-detail-card">
      <div className="fr-detail-heading">
        <GraduationCap size={16} className="fr-detail-heading-icon" />
        <div>
          <h2 className="fr-detail-title">{copy('plannerTitle')}</h2>
          <p className="fr-detail-subtitle">{copy('plannerSubtitle')}</p>
        </div>
      </div>

      {!planner || members.length === 0 ? (
        <p className="fr-detail-empty">{copy('plannerEmpty')}</p>
      ) : (
        <>
          <p className="fr-doc-file-meta">
            {copy('plannerAssignments', { count: totals.assignments ?? 0 })}
            {' · '}
            {copy('plannerCompleted', { count: totals.completed ?? 0 })}
            {' · '}
            {copy('plannerOverdue', { count: totals.overdue ?? 0 })}
            {' · '}
            {copy('plannerNoTraining', { count: totals.members_without_training ?? 0 })}
          </p>

          {gaps.length > 0 && (
            <ul className="fr-doc-files">
              {gaps.map((gap, index) => (
                <li key={`${gap.user_id}-${gap.kind}-${index}`} className="fr-doc-file">
                  <div>
                    <div className="fr-doc-file-name">{gap.name}</div>
                    <div className="fr-doc-file-meta">
                      {gap.kind === 'overdue'
                        ? copy('plannerGapOverdue', { detail: gap.detail || '' })
                        : copy('plannerGapNoTraining')}
                    </div>
                  </div>
                  <span className="fr-status-badge fr-status-rejected">
                    {gap.kind === 'overdue' ? copy('plannerOverdueLabel') : copy('plannerGapLabel')}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="fr-detail-list-label">{copy('plannerMembers')}</p>
          <ul className="fr-doc-files">
            {members.map((member) => (
              <li key={member.user_id} className="fr-doc-file">
                <div>
                  <div className="fr-doc-file-name">{member.name}</div>
                  <div className="fr-doc-file-meta">
                    {copy('plannerMemberTraining', {
                      assigned: (member.assigned ?? 0) + (member.in_progress ?? 0),
                      completed: member.completed ?? 0,
                    })}
                    {' · '}
                    {member.overdue > 0
                      ? copy('plannerOverdue', { count: member.overdue })
                      : copy('plannerNextDue', { date: formatDate(member.next_due_date) })}
                  </div>
                  {(member.assignments || []).map((assignment) => (
                    <div key={assignment.id} className="fr-doc-file-meta">
                      {assignment.module_title}
                      {' · '}
                      {assignment.status}
                      {' · '}
                      {formatDate(assignment.due_date)}
                      {(assignment.learn_programs || []).length > 0
                        && ` · ${copy('plannerLearnPrograms', { programs: assignment.learn_programs.join(', ') })}`}
                    </div>
                  ))}
                </div>
                <span className={`fr-status-badge ${member.has_no_training ? 'fr-status-pending' : member.overdue > 0 ? 'fr-status-rejected' : 'fr-status-accepted'}`}>
                  {member.has_no_training
                    ? copy('plannerNoTrainingLabel')
                    : member.overdue > 0
                      ? copy('plannerOverdueLabel')
                      : copy('plannerOnTrack')}
                </span>
              </li>
            ))}
          </ul>

          <p className="fr-detail-list-label">{copy('plannerLocations')}</p>
          <ul className="fr-doc-files">
            {locations.map((location) => (
              <li key={location.location_id} className="fr-doc-file">
                <div>
                  <div className="fr-doc-file-name">{location.location_name}</div>
                  <div className="fr-doc-file-meta">
                    {copy('plannerTeam', { count: location.team_size ?? 0 })}
                    {' · '}
                    {location.completion_pct == null
                      ? copy('plannerNoAssignments')
                      : copy('plannerCompletion', { pct: location.completion_pct })}
                    {' · '}
                    {copy('plannerModulesRequired', { count: (location.modules || []).length })}
                  </div>
                  {(location.members_without_training || []).length > 0 && (
                    <div className="fr-doc-file-meta">
                      {copy('plannerMembersWithoutTraining', {
                        names: location.members_without_training.map((m) => m.name).join(', '),
                      })}
                    </div>
                  )}
                </div>
                <span className={`fr-status-badge ${location.completion_pct === 100 ? 'fr-status-accepted' : 'fr-status-pending'}`}>
                  {location.completion_pct == null ? '—' : `${location.completion_pct}%`}
                </span>
              </li>
            ))}
          </ul>

          {modules.length > 0 && (
            <>
              <p className="fr-detail-list-label">{copy('plannerModules')}</p>
              <ul className="fr-doc-files">
                {modules.map((module) => (
                  <li key={module.module_title} className="fr-doc-file">
                    <div>
                      <div className="fr-doc-file-name">{module.module_title}</div>
                      <div className="fr-doc-file-meta">
                        {copy('plannerModuleCoverage', {
                          assigned: module.assigned ?? 0,
                          pct: module.coverage_pct ?? 0,
                        })}
                        {(module.learn_programs || []).length > 0
                          && ` · ${copy('plannerLearnPrograms', { programs: module.learn_programs.join(', ') })}`}
                      </div>
                    </div>
                    <span className="fr-status-badge fr-status-pending">{module.category || '—'}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
