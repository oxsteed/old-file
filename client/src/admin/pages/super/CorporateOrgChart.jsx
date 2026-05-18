import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Building2, Crown, MapPin, Users as UsersIcon,
  ChevronDown, ChevronRight, Loader2, Filter,
} from 'lucide-react';
import { getCorporateOrgChart, getCorporateCatalog } from '../../../api/corporateRoles';

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

function DepartmentSection({ block }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const { department, assignments } = block;

  // Group by seniority within department for cleaner display
  const groups = {};
  for (const a of assignments) {
    const k = a.seniority_level;
    if (!groups[k]) groups[k] = [];
    groups[k].push(a);
  }
  const seniorityKeys = Object.keys(groups).map(Number).sort((a, b) => b - a);

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-950"
        style={{ borderLeft: `4px solid ${department.color || '#7c3aed'}` }}
      >
        <div className="flex items-center gap-3">
          <Building2 size={18} style={{ color: department.color || '#7c3aed' }} />
          <div>
            <div className="text-white font-semibold">{department.name}</div>
            <div className="text-xs text-gray-500">{t('corporateOrg.orgChart.activeAssignments', { count: assignments.length })}</div>
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
                  {t('corporateOrg.orgChart.level', { level })}
                </div>
                <div className="flex-1 h-px bg-gray-800" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {groups[level].map(a => (
                  <div
                    key={a.id}
                    className="bg-gray-950 border border-gray-800 rounded-lg p-3 flex gap-3"
                  >
                    <Avatar row={a} size={42} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        {a.is_csuite && <Crown size={12} className="text-yellow-400 flex-shrink-0" />}
                        <div className="text-white text-sm font-medium truncate">
                          {a.title_name}
                        </div>
                      </div>
                      <div className="text-xs text-gray-400 truncate">{userName(a)}</div>
                      <div className="text-xs text-gray-500 truncate mt-0.5 flex items-center gap-1">
                        <MapPin size={10} />
                        {a.country_code || t('corporateOrg.orgChart.scopeGlobal')}
                      </div>
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
      setError(e?.response?.data?.error || 'Failed to load org chart.');
    } finally {
      setLoading(false);
    }
  }, [country]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
            <UsersIcon size={22} />
            {t('corporateOrg.orgChart.title')}
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            {t('corporateOrg.orgChart.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-gray-500" />
          <input
            type="text"
            placeholder={t('corporateOrg.orgChart.filterPlaceholder')}
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
          <Loader2 className="inline animate-spin mr-2" size={18} /> {t('corporateOrg.orgChart.loading')}
        </div>
      ) : !chart || chart.total_assignments === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center">
          <UsersIcon size={32} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-300 font-medium mb-1">{t('corporateOrg.orgChart.emptyTitle')}</p>
          <p className="text-gray-500 text-sm">
            {t('corporateOrg.orgChart.emptyBody')}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {(chart.by_department || []).map(block => (
            <DepartmentSection key={block.department.code} block={block} />
          ))}
        </div>
      )}
    </div>
  );
}
