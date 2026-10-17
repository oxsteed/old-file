import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Building2, Crown, MapPin, Users as UsersIcon, UserX, UserPlus,
  ChevronDown, ChevronRight, Loader2, Filter,
} from 'lucide-react';
import { getCorporateOrgChart, getCorporateCatalog } from '../../../api/corporateRoles';
import OrgTreeView from './OrgTreeView';

function userName(row) {
  const f = row.first_name || '';
  const l = row.last_name  || '';
  const full = `${f} ${l}`.trim();
  return full || row.email || row.user_id;
}

function Avatar({ row, size = 36 }) {
  const initials = ((row.first_name?.[0] || '') + (row.last_name?.[0] || '')).toUpperCase() || '?';
  if (row.profile_photo_url) {
    return (
      <img src={row.profile_photo_url} alt=""
        style={{ width: size, height: size }}
        className="rounded-full object-cover" />
    );
  }
  return (
    <div
      style={{ width: size, height: size, fontSize: Math.floor(size * 0.4) }}
      className="rounded-full bg-gray-700 flex items-center justify-center text-gray-200 font-semibold"
    >
      {initials}
    </div>
  );
}

function DepartmentPositionSection({ department, titles }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const filled = titles.filter((x) => x.assignee).length;

  // Group positions by seniority within the department
  const groups = {};
  for (const x of titles) {
    const k = x.seniority_level;
    if (!groups[k]) groups[k] = [];
    groups[k].push(x);
  }
  const seniorityKeys = Object.keys(groups).map(Number).sort((a, b) => b - a);

  return (
    <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-950"
        style={{ borderLeft: `4px solid ${department.color || '#7c3aed'}` }}
      >
        <div className="flex items-center gap-3">
          <Building2 size={18} style={{ color: department.color || '#7c3aed' }} />
          <div>
            <div className="text-gray-900 dark:text-white font-semibold">{department.name}</div>
            <div className="text-xs text-gray-500">{t('adminOrgChart.filledStats', { filled, total: titles.length })}</div>
          </div>
        </div>
        {open ? <ChevronDown size={18} className="text-gray-500" />
              : <ChevronRight size={18} className="text-gray-500" />}
      </button>

      {open && (
        <div className="p-5 space-y-4">
          {seniorityKeys.map(level => (
            <div key={level}>
              <div className="flex items-center gap-2 mb-2">
                <div className="text-xs uppercase text-gray-500 tracking-wide">
                  {t('adminOrgChart.level', { level })}
                </div>
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {groups[level].map(x => (
                  <div
                    key={x.id}
                    className="bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-3 flex gap-3"
                  >
                    {x.assignee ? (
                      <Avatar row={x.assignee} size={42} />
                    ) : (
                      <div
                        style={{ width: 42, height: 42 }}
                        className="rounded-full bg-gray-200 dark:bg-gray-800 flex items-center justify-center text-gray-400 flex-shrink-0"
                      >
                        <UserX size={18} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        {x.is_csuite && <Crown size={12} className="text-yellow-400 flex-shrink-0" />}
                        <div className="text-gray-900 dark:text-white text-sm font-medium truncate">
                          {x.name}
                        </div>
                      </div>
                      {x.assignee ? (
                        <>
                          <div className="text-xs text-gray-600 dark:text-gray-400 truncate">{userName(x.assignee)}</div>
                          <div className="text-xs text-gray-500 truncate mt-0.5 flex items-center gap-1">
                            <MapPin size={10} />
                            {x.assignee.country_code || t('adminOrgChart.global')}
                          </div>
                        </>
                      ) : (
                        <div className="text-xs text-gray-500 flex items-center gap-1.5 mt-0.5">
                          {t('adminOrgChart.vacant')}
                          <Link
                            to="/admin/corporate/assignments"
                            className="inline-flex items-center gap-0.5 text-orange-600 dark:text-orange-400 hover:text-orange-500 font-medium"
                          >
                            <UserPlus size={11} /> {t('adminOrgChart.assign')}
                          </Link>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function CorporateOrgChart() {
  const { t } = useTranslation();
  const [chart,   setChart]   = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [country, setCountry] = useState('');
  const [view, setView] = useState('tree');
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cat, c] = await Promise.all([
        getCorporateCatalog(),
        getCorporateOrgChart(country || null),
      ]);
      setCatalog(cat);
      setChart(c);
    } catch (e) {
      setError(e?.response?.data?.error || t('adminOrgChart.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [country]);

  useEffect(() => { load(); }, [load]);

  // Department view is position-based: group every title by department
  // so vacant roles render instead of vanishing.
  const deptGroups = useMemo(() => {
    const byDept = new Map();
    for (const x of (chart?.titles || [])) {
      if (!byDept.has(x.department_code)) {
        byDept.set(x.department_code, {
          code: x.department_code,
          name: x.department_name,
          color: x.department_color,
          titles: [],
        });
      }
      byDept.get(x.department_code).titles.push(x);
    }
    return [...byDept.values()];
  }, [chart]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
            <UsersIcon size={22} />
            {t('adminOrgChart.title')}
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            {t('adminOrgChart.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            role="tablist"
            aria-label={t('adminOrgChart.viewLabel')}
            className="flex bg-gray-800 border border-gray-700 rounded-lg p-0.5"
          >
            {['tree', 'department'].map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-sm rounded-md ${
                  view === v
                    ? 'bg-gray-700 text-white font-medium'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {t(`adminOrgChart.${v}View`)}
              </button>
            ))}
          </div>
          <Filter size={14} className="text-gray-500" />
          <input
            type="text"
            placeholder={t('adminOrgChart.countryPlaceholder')}
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
          />
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-900 rounded-lg px-4 py-3 mb-4 text-red-300 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="p-10 text-center text-gray-400">
          <Loader2 className="inline animate-spin mr-2" size={18} /> {t('adminOrgChart.loading')}
        </div>
      ) : view === 'tree' ? (
        chart?.titles?.length ? (
          <OrgTreeView titles={chart.titles} />
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center">
            <UsersIcon size={32} className="text-gray-600 mx-auto mb-3" />
            <p className="text-gray-300 font-medium mb-1">{t('adminOrgChart.emptyTitle')}</p>
            <p className="text-gray-500 text-sm">
              {t('adminOrgChart.emptyBody')}
            </p>
          </div>
        )
      ) : !deptGroups.length ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center">
          <UsersIcon size={32} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-300 font-medium mb-1">{t('adminOrgChart.emptyTitle')}</p>
          <p className="text-gray-500 text-sm">
            {t('adminOrgChart.emptyBody')}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {deptGroups.map(d => (
            <DepartmentPositionSection key={d.code} department={d} titles={d.titles} />
          ))}
        </div>
      )}
    </div>
  );
}
