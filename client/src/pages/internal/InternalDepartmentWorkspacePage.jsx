import { useEffect, useMemo, useState } from 'react';
import { Building2, Crown, LineChart, Loader2, Megaphone, ShieldCheck, Sparkles, Target, Users } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { getInternalWorkspaceDashboard } from '../../api/internalWorkspaces';
import { getInternalWorkspaceMeta, INTERNAL_ROLE_FOCUS, formatWorkspaceLabel } from '../../utils/internalWorkspaces';

const ICONS = {
  Building2,
  Crown,
  LineChart,
  Megaphone,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  Cpu: LineChart,
  BadgeDollarSign: Sparkles,
};

function IconForWorkspace({ icon }) {
  const Component = ICONS[icon] || Building2;
  return <Component className="h-5 w-5" />;
}

function formatDate(value) {
  if (!value) return 'Active';
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
  } catch {
    return value;
  }
}

export default function InternalDepartmentWorkspacePage() {
  const { workspace } = useParams();
  const meta = useMemo(() => getInternalWorkspaceMeta(workspace), [workspace]);
  const [state, setState] = useState({ loading: true, error: '', data: null });

  useEffect(() => {
    let active = true;
    setState({ loading: true, error: '', data: null });
    getInternalWorkspaceDashboard(meta.code)
      .then((data) => {
        if (!active) return;
        setState({ loading: false, error: '', data });
      })
      .catch((err) => {
        if (!active) return;
        setState({
          loading: false,
          error: err.response?.data?.error || 'Failed to load internal workspace dashboard.',
          data: null,
        });
      });
    return () => {
      active = false;
    };
  }, [meta.code]);

  if (state.loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-6">
        <div className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/5 px-6 py-4 text-slate-300">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading {meta.label} workspace…
        </div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="min-h-screen bg-slate-950 px-6 py-16 text-white">
        <div className="mx-auto max-w-3xl rounded-[2rem] border border-red-500/20 bg-red-500/10 p-8">
          <h1 className="text-2xl font-semibold">{meta.label} workspace unavailable</h1>
          <p className="mt-4 text-sm leading-7 text-red-100/90">{state.error}</p>
        </div>
      </div>
    );
  }

  const data = state.data;
  const assignments = Array.isArray(data?.assignments) ? data.assignments : [];
  const roster = Array.isArray(data?.roster) ? data.roster : [];
  const permissions = Array.isArray(data?.permissions) ? data.permissions : [];
  const titles = Array.isArray(data?.department_titles) ? data.department_titles : [];

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.08),_transparent_35%),linear-gradient(180deg,_#020617_0%,_#0f172a_45%,_#111827_100%)] text-white">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.04] shadow-2xl shadow-black/20">
          <div className={`bg-gradient-to-r ${meta.accent} p-[1px]`}>
            <div className="bg-slate-950/95 px-8 py-10 lg:px-10">
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div className="max-w-3xl">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1 text-xs uppercase tracking-[0.28em] text-slate-300">
                    <IconForWorkspace icon={meta.icon} />
                    Internal workspace
                  </div>
                  <h1 className="mt-5 text-4xl font-semibold tracking-tight">{data?.department?.name || meta.label}</h1>
                  <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
                    {data?.department?.description || meta.mission}
                  </p>
                  <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-400">
                    {meta.launchObjective}
                  </p>
                </div>
                <div className="grid min-w-[280px] gap-3 sm:grid-cols-2">
                  <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                    <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Your assignments</div>
                    <div className="mt-4 text-4xl font-semibold">{assignments.length}</div>
                    <div className="mt-2 text-sm text-slate-400">Active titles in this department.</div>
                  </div>
                  <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                    <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Effective permissions</div>
                    <div className="mt-4 text-4xl font-semibold">{permissions.length}</div>
                    <div className="mt-2 text-sm text-slate-400">Corporate capabilities currently resolved for your account.</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-[1.25fr_0.9fr]">
          <div className="space-y-6">
            <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-7">
              <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Department scope</div>
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                {meta.owns.map((item) => (
                  <div key={item} className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 text-sm leading-7 text-slate-300">
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-7">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Your current titles</div>
                  <h2 className="mt-3 text-2xl font-semibold text-white">Assigned leadership and focus</h2>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.22em] text-slate-400">
                  {formatWorkspaceLabel(meta.code)}
                </div>
              </div>
              <div className="mt-5 grid gap-4">
                {assignments.length ? assignments.map((assignment) => (
                  <div key={assignment.id} className="rounded-3xl border border-white/10 bg-slate-950/70 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-lg font-semibold text-white">{assignment.title_name}</div>
                        <div className="mt-1 text-sm text-slate-400">
                          {assignment.country_code ? `Country scope: ${assignment.country_code}` : 'Global scope'}
                        </div>
                      </div>
                      <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-300">
                        Since {formatDate(assignment.started_at)}
                      </div>
                    </div>
                    <p className="mt-4 text-sm leading-7 text-slate-300">
                      {INTERNAL_ROLE_FOCUS[assignment.title_code] || 'This title contributes to the department operating plan and launch readiness.'}
                    </p>
                  </div>
                )) : (
                  <div className="rounded-3xl border border-dashed border-white/10 bg-slate-950/40 p-5 text-sm text-slate-400">
                    No active title is assigned in this department yet.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-7">
              <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Department roster</div>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {roster.length ? roster.map((person) => (
                  <div key={`${person.user_id}-${person.title_code}-${person.started_at}`} className="rounded-3xl border border-white/10 bg-slate-950/70 p-5">
                    <div className="text-base font-semibold text-white">
                      {[person.first_name, person.last_name].filter(Boolean).join(' ') || person.email}
                    </div>
                    <div className="mt-1 text-sm text-slate-400">{person.title_name}</div>
                    <div className="mt-3 text-xs uppercase tracking-[0.18em] text-slate-500">
                      {person.country_code ? person.country_code : 'Global'} · {person.role}
                    </div>
                  </div>
                )) : (
                  <div className="rounded-3xl border border-dashed border-white/10 bg-slate-950/40 p-5 text-sm text-slate-400">
                    No active roster records yet for this department.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-7">
              <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Permission map</div>
              <h2 className="mt-3 text-2xl font-semibold text-white">Department defaults in play</h2>
              <div className="mt-5 flex flex-wrap gap-2">
                {(data?.department_default_permissions || []).length ? data.department_default_permissions.map((permission) => (
                  <span key={permission} className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200">
                    {permission}
                  </span>
                )) : (
                  <div className="rounded-3xl border border-dashed border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-slate-400">
                    No default department permissions are configured yet.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-7">
              <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Title library</div>
              <div className="mt-5 space-y-3">
                {titles.length ? titles.slice(0, 10).map((title) => (
                  <div key={title.id} className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium text-white">{title.name}</div>
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                        L{title.seniority_level}{title.is_csuite ? ' · C-suite' : ''}
                      </div>
                    </div>
                    <div className="mt-2 text-sm text-slate-400">
                      {INTERNAL_ROLE_FOCUS[title.code] || title.description || 'Department title available for assignment.'}
                    </div>
                  </div>
                )) : (
                  <div className="rounded-3xl border border-dashed border-white/10 bg-slate-950/40 p-5 text-sm text-slate-400">
                    No titles are configured for this department yet.
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
