import { useState, useRef, useEffect }  from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth }   from '../../hooks/useAuth';
import { useTheme }  from '../../context/ThemeContext';
import useAdminSupportAvailability from '../hooks/useAdminSupportAvailability';
import { useMyScopes } from '../lib/GrantGuard';
import { adminRoute } from '../adminRouteManifest';
import { OxSteedIcon } from '../../components/OxSteedIcon';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard, Users, Briefcase,
  Flag, Shield, DollarSign, Settings,
  FileText, BarChart2, LogOut, TrendingUp,
  ScrollText, Wrench, Trash2, UserCog,
  Menu, X, Sun, Moon, HeadphonesIcon,
  Search, Key, ClipboardList, Building2, CreditCard, MessageSquare,
  HeartHandshake, Calendar, UserPlus, Map, MapPinned, ShoppingCart, Layers, Fingerprint,
  AlertTriangle, Crown, Globe, Network, Package, Truck, ShieldAlert, BookOpen, Link2,
  Settings2, Check, Wallet, Activity, Eye, EyeOff, Sparkles, Scale, ShieldCheck,
} from 'lucide-react';

const ADMIN_NAV_MODE_KEY = 'oxsteed:admin-nav-mode';
const routePath = (key) => adminRoute(key).path;

export const REGULAR_NAV = [
  { tabKey: 'dashboard', to: routePath('dashboard'),        icon: LayoutDashboard, labelKey: 'adminNav.dashboard', grant: adminRoute('dashboard').grant },
  { tabKey: 'operations', to: routePath('operations'),       icon: Activity,        labelKey: 'adminNav.operationsOverview', grant: adminRoute('operations').grant },
  { tabKey: 'users', to: routePath('users'),            icon: Users,           labelKey: 'adminNav.users', grant: adminRoute('users').grant },
  { tabKey: 'jobs', to: routePath('jobs'),             icon: Briefcase,       labelKey: 'adminNav.jobs', grant: adminRoute('jobs').grant },
  { tabKey: 'reports', to: routePath('reports'),          icon: Flag,            labelKey: 'adminNav.reports'          },
  { tabKey: 'moderation', to: routePath('moderation'),       icon: Shield,          labelKey: 'adminNav.moderation'       },
  { tabKey: 'enforcement', to: routePath('enforcement'),      icon: AlertTriangle,   labelKey: 'adminNav.enforcement'      },
  { tabKey: 'contentRemovals', to: routePath('contentRemovals'), icon: Trash2,          labelKey: 'adminNav.contentRemovals' },
  { tabKey: 'skills', to: routePath('skills'),           icon: Wrench,          labelKey: 'adminNav.skills', grant: adminRoute('skills').grant },
  { tabKey: 'support', to: routePath('support'),          icon: HeadphonesIcon,  labelKey: 'adminNav.supportTickets', grant: adminRoute('support').grant  },
  { tabKey: 'supportChat', to: routePath('supportChat'),     icon: MessageSquare,   labelKey: 'adminNav.liveSupport'     },
  { tabKey: 'quoteRequests', to: routePath('quoteRequests'),   icon: FileText,        labelKey: 'adminNav.quoteRequests', grant: adminRoute('quoteRequests').grant   },
  { tabKey: 'directOps', to: routePath('directOps'),           icon: HeartHandshake,   labelKey: 'adminNav.directOps',        external: true },
  { tabKey: 'directServiceAreas', to: routePath('directServiceAreas'), icon: MapPinned,    labelKey: 'adminNav.directServiceAreas', grant: adminRoute('directServiceAreas').grant },
  { tabKey: 'directCatalog', to: routePath('directCatalog'),       icon: Package,      labelKey: 'adminNav.directCatalog', grant: adminRoute('directCatalog').grant       },
  { tabKey: 'messages', to: routePath('messages'),         icon: MessageSquare,   labelKey: 'adminNav.messages',         grant: adminRoute('messages').grant },
  { tabKey: 'search', to: routePath('search'),           icon: Search,          labelKey: 'adminNav.search'           },
  { tabKey: 'businesses', to: routePath('businesses'),       icon: Building2,       labelKey: 'adminNav.businesses', grant: adminRoute('businesses').grant       },
  { tabKey: 'toolRentals', to: routePath('toolRentals'),     icon: Wrench,          labelKey: 'adminNav.toolRentals', grant: adminRoute('toolRentals').grant     },
  { tabKey: 'plannedNeeds', to: routePath('plannedNeeds'),        icon: ClipboardList,      labelKey: 'adminNav.plannedNeeds', grant: adminRoute('plannedNeeds').grant    },
  { tabKey: 'payments', to: routePath('payments'),             icon: CreditCard,         labelKey: 'adminNav.payments',        grant: adminRoute('payments').grant },
  { tabKey: 'orders', to: routePath('orders'),               icon: ShoppingCart,       labelKey: 'adminNav.orders'           },
  { tabKey: 'templates', to: routePath('templates'),            icon: Layers,             labelKey: 'adminNav.templates'        },
  { tabKey: 'consulting', to: routePath('consulting'),           icon: HeartHandshake,     labelKey: 'adminNav.consulting'       },
  { tabKey: 'consultingPayments', to: routePath('consultingPayments'),  icon: CreditCard,         labelKey: 'adminNav.consultingPay'   },
  { tabKey: 'scheduling', to: routePath('scheduling'), icon: Calendar,           labelKey: 'adminNav.scheduling'       },
  { tabKey: 'businessLaunch', to: routePath('businessLaunch'), icon: Briefcase,    labelKey: 'adminNav.businessLaunch'  },
  { tabKey: 'consultingSessions', to: routePath('consultingSessions'),  icon: Calendar,           labelKey: 'adminNav.consultingSessions' },
  { tabKey: 'orgChart', to: routePath('orgChart'),  icon: Network,            labelKey: 'adminNav.orgChart'        },
  { tabKey: 'corporateAssignments', to: routePath('corporateAssignments'),icon: Crown,              labelKey: 'adminNav.corporateTitles' },
  { tabKey: 'logistics', to: routePath('logistics'),            icon: Truck,              labelKey: 'adminNav.logisticsOps'    },
  { tabKey: 'learnSubmissions', to: routePath('learnSubmissions'),    icon: BookOpen,           labelKey: 'adminNav.learnSubmissions'},
  { tabKey: 'learnProductLinks', to: routePath('learnProductLinks'), icon: Link2,              labelKey: 'adminNav.learnProductLinks'},
  { tabKey: 'learnAiSuggestions', to: routePath('learnAiSuggestions'), icon: Sparkles,          labelKey: 'adminNav.learnAiSuggestions'},
];

export const SUPER_NAV = [
  { tabKey: 'superDashboard', to: routePath('superDashboard'),      icon: BarChart2,     labelKey: 'adminNav.superDashboard'  },
  { tabKey: 'money', to: routePath('money'),          icon: DollarSign,    labelKey: 'adminNav.money',            grant: adminRoute('money').grant },
  { tabKey: 'restaurantCredit', to: routePath('restaurantCredit'), icon: Wallet,      labelKey: 'adminNav.restaurantCredit' },
  { tabKey: 'restaurantTopupApprovals', to: routePath('restaurantTopupApprovals'), icon: Wallet, labelKey: 'adminNav.restaurantTopupApprovals', grant: adminRoute('restaurantTopupApprovals').grant },
  { tabKey: 'oxsteedCredit', to: routePath('oxsteedCredit'), icon: Wallet,         labelKey: 'adminNav.oxsteedCredit'     },
  { tabKey: 'revenue', to: routePath('revenue'),        icon: TrendingUp,    labelKey: 'adminNav.revenue',          grant: adminRoute('revenue').grant },
  { tabKey: 'feeConfig', to: routePath('feeConfig'),           icon: DollarSign,    labelKey: 'adminNav.feeConfig'        },
  { tabKey: 'pricingConfig', to: routePath('pricingConfig'),        icon: DollarSign,    labelKey: 'adminNav.pricingConfig'    },
  { tabKey: 'pricingOverrides', to: routePath('pricingOverrides'), icon: Globe,      labelKey: 'adminNav.pricingOverrides' },
  { tabKey: 'financials', to: routePath('financials'),     icon: DollarSign,    labelKey: 'adminNav.financials',       grant: adminRoute('financials').grant },
  { tabKey: 'payouts', to: routePath('payouts'),          icon: FileText,       labelKey: 'adminNav.payouts',          grant: adminRoute('payouts').grant },
  { tabKey: 'treasury', to: routePath('treasury'),         icon: DollarSign,    labelKey: 'adminNav.treasury',         grant: adminRoute('treasury').grant },
  { tabKey: 'conversations', to: routePath('conversations'),   icon: MessageSquare,  labelKey: 'adminNav.conversations'    },
  { tabKey: 'adminAccounts', to: routePath('adminAccounts'),  icon: UserCog,        labelKey: 'adminNav.adminAccounts',   grant: adminRoute('adminAccounts').grant },
  { tabKey: 'permissions', to: routePath('permissions'),    icon: Key,           labelKey: 'adminNav.permissions',      grant: adminRoute('permissions').grant },
  { tabKey: 'workforce', to: routePath('workforce'),     icon: Users,         labelKey: 'adminNav.workforce',        grant: adminRoute('workforce').grant },
  { tabKey: 'regions', to: routePath('regions'),        icon: Map,           labelKey: 'adminNav.regions'          },
  { tabKey: 'internalAccess', to: routePath('internalAccess'), icon: Key, labelKey: 'adminNav.internalAccess' },
  { tabKey: 'gateLockouts', to: routePath('gateLockouts'), icon: ShieldAlert, labelKey: 'adminNav.gateLockouts' },
  { tabKey: 'createUser', to: routePath('createUser'),   icon: UserPlus,      labelKey: 'adminNav.createUser'      },
  { tabKey: 'searchLogs', to: routePath('searchLogs'),    icon: ClipboardList, labelKey: 'adminNav.searchLogs'      },
  { tabKey: 'settings', to: routePath('settings'),       icon: Settings,      labelKey: 'adminNav.settings',         grant: adminRoute('settings').grant },
  { tabKey: 'auditLog', to: routePath('auditLog'),      icon: ScrollText,    labelKey: 'adminNav.auditLog',        grant: adminRoute('auditLog').grant },
  { tabKey: 'userActionLog', to: routePath('userActionLog'), icon: ScrollText,    labelKey: 'adminNav.userActionLog', grant: adminRoute('userActionLog').grant },
  { tabKey: 'legalAcceptances', to: routePath('legalAcceptances'), icon: Scale,      labelKey: 'adminNav.legal'           },
  { tabKey: 'visitors', to: routePath('visitors'),    icon: Eye,         labelKey: 'adminNav.visitors',    grant: adminRoute('visitors').grant },
  { tabKey: 'profileVisibility', to: routePath('profileVisibility'), icon: EyeOff, labelKey: 'adminNav.profileVisibility', grant: adminRoute('profileVisibility').grant },
  { tabKey: 'oneTruth', to: routePath('oneTruth'),              icon: Fingerprint,   labelKey: 'adminNav.oneTruth'       },
  { tabKey: 'franchiseHq', to: routePath('franchiseHq'),             icon: Globe,         labelKey: 'adminNav.franchiseHq'    },
  { tabKey: 'careers', to: routePath('careers'),                icon: Briefcase,     labelKey: 'adminNav.careers'         },
  { tabKey: 'countryPacks', to: routePath('countryPacks'),          icon: Globe,         labelKey: 'adminNav.countryPacks'   },
  { tabKey: 'corporateSetup', to: routePath('corporateSetup'),  icon: Building2,     labelKey: 'adminNav.corporateSetup' },
  { tabKey: 'modePolicies', to: routePath('modePolicies'),          icon: Key,           labelKey: 'adminNav.modePolicies'   },
  { tabKey: 'modeApprovals', to: routePath('modeApprovals'),         icon: AlertTriangle, labelKey: 'adminNav.modeApprovals'  },
  { tabKey: 'governance', to: routePath('governance'),           icon: ShieldCheck,   labelKey: 'adminNav.governance'     },
  { tabKey: 'serviceOps', to: routePath('serviceOps'),          icon: Activity,      labelKey: 'adminNav.serviceOps',    grant: adminRoute('serviceOps').grant },
  { tabKey: 'reliability', to: routePath('reliability'),          icon: Activity,      labelKey: 'adminNav.reliability',    grant: adminRoute('reliability').grant },
];

// Simple mode keeps the operational paths close at hand without removing access
// to any route. Full mode remains the default for existing admin sessions.
const SIMPLE_REGULAR_NAV = [
  routePath('dashboard'),
  routePath('operations'),
  routePath('users'),
  routePath('jobs'),
  routePath('support'),
  routePath('supportChat'),
  routePath('directOps'),
  routePath('directServiceAreas'),
  routePath('directCatalog'),
  routePath('payments'),
];

const SIMPLE_SUPER_NAV = [
  routePath('superDashboard'),
  routePath('restaurantCredit'),
  routePath('oxsteedCredit'),
  routePath('conversations'),
  routePath('careers'),
  routePath('settings'),
  routePath('auditLog'),
];

function readAdminNavMode() {
  try {
    return localStorage.getItem(ADMIN_NAV_MODE_KEY) === 'simple';
  } catch {
    return false;
  }
}

const navClass = ({ isActive }) =>
  `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium
   transition-all ${
    isActive
      ? 'bg-orange-500 text-white'
      : 'text-gray-400 hover:text-white hover:bg-gray-800'
  }`;

const superNavClass = ({ isActive }) =>
  `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium
   transition-all ${
    isActive
      ? 'bg-purple-600 text-white'
      : 'text-gray-400 hover:text-white hover:bg-gray-800'
  }`;

export default function AdminLayout() {
  const { t } = useTranslation();
  const { user, logout }        = useAuth();
  const navigate                = useNavigate();
  const { isDark, toggleTheme } = useTheme();
  const isSuper                 = user?.role === 'super_admin';
  const { scopes: myScopes }    = useMyScopes();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [sidebarNavSearch, setSidebarNavSearch] = useState('');
  const [simpleMode, setSimpleMode] = useState(readAdminNavMode);
  const [tabSettingsOpen, setTabSettingsOpen] = useState(false);
  const [tabPrefs, setTabPrefs] = useState({});
  const searchRef = useRef(null);
  const {
    availability: supportAvailable,
    liveReady: supportLiveReady,
    busy: supportAvailabilityBusy,
    setAvailability: setSupportAvailability,
  } = useAdminSupportAvailability({ autoOnline: true });

  useEffect(() => {
    const syncAdminNavMode = (event) => {
      if (event.key === ADMIN_NAV_MODE_KEY) {
        setSimpleMode(event.newValue === 'simple');
      }
    };
    window.addEventListener('storage', syncAdminNavMode);
    return () => window.removeEventListener('storage', syncAdminNavMode);
  }, []);

  // Load per-admin tab preferences (essential vs hidden).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { default: api } = await import('../../api/axios');
        const { data } = await api.get('/admin/settings/me/tabs');
        if (!cancelled && data?.prefs) setTabPrefs(data.prefs);
      } catch {
        // Non-fatal; show all tabs by default.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleLogout = async () => {
    await setSupportAvailability(false, { silent: true }).catch(() => {});
    await logout();
    navigate('/admin/login');
  };

  const closeSidebar = () => setSidebarOpen(false);

  const toggleSimpleMode = () => {
    setSimpleMode((current) => {
      const next = !current;
      try {
        localStorage.setItem(ADMIN_NAV_MODE_KEY, next ? 'simple' : 'full');
      } catch {
        // Keep the switch usable when browser storage is unavailable.
      }
      return next;
    });
  };

  const setAdminNavMode = (nextSimpleMode) => {
    setSimpleMode(nextSimpleMode);
    try {
      localStorage.setItem(ADMIN_NAV_MODE_KEY, nextSimpleMode ? 'simple' : 'full');
    } catch {
      // Keep the preset usable when browser storage is unavailable.
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (q.length < 2) return;
    navigate(`/admin/search?q=${encodeURIComponent(q)}`);
    setSearchInput('');
    closeSidebar();
  };

  // Plain function (not a component) - avoids remount on every render
  const renderSidebar = () => {
    const query = sidebarNavSearch.trim().toLowerCase();
    const matches = ({ labelKey, to }) => !query || `${t(labelKey)} ${to}`.toLowerCase().includes(query);
    // Filter out tabs the admin marked as non-essential.
    const isEssential = ({ tabKey }) => !tabKey || tabPrefs[tabKey] !== false;
    const regularNav = simpleMode
      ? REGULAR_NAV.filter(({ to }) => SIMPLE_REGULAR_NAV.includes(to))
      : REGULAR_NAV;
    const fullSuperNav = simpleMode
      ? SUPER_NAV.filter(({ to }) => SIMPLE_SUPER_NAV.includes(to))
      : SUPER_NAV;
    // Super-admins see everything. Plain admins only see entries backed by
    // an explicit grant; super-admin-only pages have no grant and must not be
    // advertised to a regular admin who would be rejected after navigation.
    const superNav = fullSuperNav.filter(
      (item) => isSuper || (item.grant && myScopes.includes(item.grant))
    );
    const visibleRegularNav = regularNav.filter(
      (item) => (!item.grant || isSuper || myScopes.includes(item.grant)) && matches(item) && isEssential(item)
    );
    const visibleSuperNav = superNav.filter((item) => matches(item) && isEssential(item));
    const totalAdminTabs = regularNav.length + superNav.length;
    const visibleAdminTabs = visibleRegularNav.length + visibleSuperNav.length;

    return (
      <>
      {/* Logo */}
      <div className="px-5 py-4 border-b border-gray-800 flex items-center
                      justify-between">
        <div className="flex items-center gap-2">
          <OxSteedIcon size={28} />
          <div>
            <p className="font-bold text-white text-sm">OxSteed Admin</p>
            <p className={`text-xs font-medium mt-0.5 ${
              isSuper ? 'text-orange-400' : 'text-gray-400'
            }`}>
              {isSuper ? t('adminNav.roleSuper') : t('adminNav.roleAdmin')}
            </p>
          </div>
        </div>
        {/* Close button - mobile only */}
        <button
          type="button"
          onClick={closeSidebar}
          aria-label={t('closeMenu')}
          className="lg:hidden text-gray-500 hover:text-white transition p-1"
        >
          <X size={18} />
        </button>
      </div>

      {/* Nav */}
      <nav aria-label={t('adminNav.sidebarLabel', { defaultValue: 'Admin navigation' })} className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        <div className="sticky top-0 z-10 -mx-3 bg-gray-900 px-3 pb-3">
          <div className={`rounded-xl border bg-gray-950/50 transition-colors ${tabSettingsOpen ? 'border-gray-700' : 'border-gray-800'}`}>
            <div className="flex items-center justify-between gap-2 px-3 py-2.5">
              <button
                type="button"
                onClick={() => setTabSettingsOpen((open) => !open)}
                aria-expanded={tabSettingsOpen}
                aria-controls="admin-tab-settings"
                className="flex min-w-0 items-center gap-2 text-left text-xs font-semibold text-gray-200 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
              >
                <Settings2 size={14} className="shrink-0 text-orange-400" />
                <span className="truncate">{t('adminNav.tabSettings')}</span>
                <span className="rounded-full bg-gray-800 px-1.5 py-0.5 text-[10px] font-medium text-gray-400">
                  {simpleMode ? t('adminNav.modeEssential') : t('adminNav.modeAll')}
                </span>
              </button>
              <button
                type="button"
                role="switch"
                aria-checked={simpleMode}
                aria-label={simpleMode ? t('adminNav.switchToFullAria') : t('adminNav.switchToSimpleAria')}
                onClick={toggleSimpleMode}
                title={simpleMode ? t('adminNav.switchToFullTitle') : t('adminNav.switchToSimpleTitle')}
                className={`relative h-5 w-9 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 ${simpleMode ? 'bg-orange-500' : 'bg-gray-700'}`}
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${simpleMode ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
            </div>
            {tabSettingsOpen && (
              <div id="admin-tab-settings" className="border-t border-gray-800 px-3 pb-3 pt-2">
                <p className="mb-2 text-[10px] leading-4 text-gray-500">
                  {t('adminNav.tabSettingsHelp')}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: true, labelKey: 'adminNav.presetEssential', detailKey: 'adminNav.presetEssentialDetail' },
                    { value: false, labelKey: 'adminNav.presetAll', detailKey: 'adminNav.presetAllDetail' },
                  ].map(({ value, labelKey, detailKey }) => (
                    <button
                      key={value ? 'essential' : 'all'}
                      type="button"
                      onClick={() => setAdminNavMode(value)}
                      aria-pressed={simpleMode === value}
                      className={`rounded-lg border px-2 py-2 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${simpleMode === value ? 'border-orange-500/70 bg-orange-500/10 text-white' : 'border-gray-800 bg-gray-900/60 text-gray-400 hover:border-gray-700 hover:text-gray-200'}`}
                    >
                      <span className="flex items-center justify-between gap-1 text-[11px] font-semibold">
                        {t(labelKey)}
                        {simpleMode === value && <Check size={12} className="text-orange-400" />}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-gray-500">{t(detailKey)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <label className="relative block">
            <span className="sr-only">{t('adminNav.findTabSr')}</span>
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={sidebarNavSearch}
              onChange={(event) => setSidebarNavSearch(event.target.value)}
              placeholder={t('adminNav.findTabPlaceholder')}
              aria-label={t('adminNav.findTabSr')}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 py-2 pl-9 pr-8 text-xs text-white placeholder-gray-500 focus:border-orange-500 focus:outline-none"
            />
            {sidebarNavSearch && (
              <button
                type="button"
                onClick={() => setSidebarNavSearch('')}
                aria-label={t('adminNav.clearTabSearch')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-500 hover:text-white"
              >
                <X size={13} />
              </button>
            )}
          </label>
          {query && (
            <p className="mt-1.5 px-1 text-[10px] text-gray-500">
              {t('adminNav.tabsFound', { count: visibleAdminTabs })}
            </p>
          )}
          {!query && (
            <p className="mt-1.5 px-1 text-[10px] text-gray-600">
              {t('adminNav.showingTabs', { count: totalAdminTabs })}
            </p>
          )}
        </div>

        {visibleRegularNav.length > 0 && (
          <>
            <p className="text-xs font-semibold text-gray-500 uppercase
                          tracking-wider px-3 mb-2">
              {t('adminNav.operations')}
            </p>
            {visibleRegularNav.map(({ to, icon: Icon, labelKey, external }) => (
              external ? (
                <a key={to} href={to} className={navClass({ isActive: false })} onClick={closeSidebar}>
                  <Icon size={16} />
                  {t(labelKey)}
                </a>
              ) : (
                <NavLink key={to} to={to} end={to === routePath('support')} className={navClass} onClick={closeSidebar}>
                  <Icon size={16} />
                  {t(labelKey)}
                </NavLink>
              )
            ))}
          </>
        )}

        {visibleSuperNav.length > 0 && (
          <>
            <div className="pt-4 pb-2">
              <p className="text-xs font-semibold text-gray-500 uppercase
                            tracking-wider px-3">
                {t('adminNav.superAdmin')}
              </p>
            </div>
            {visibleSuperNav.map(({ to, icon: Icon, labelKey }) => (
              <NavLink key={to} to={to} className={superNavClass} onClick={closeSidebar}>
                <Icon size={16} />
                {t(labelKey)}
              </NavLink>
            ))}
          </>
        )}
        {!visibleRegularNav.length && !visibleSuperNav.length && (
          <p className="px-3 py-4 text-xs text-gray-500">{t('adminNav.noMatch')}</p>
        )}
        {simpleMode && !query && (
          <p className="px-3 pt-4 text-[10px] leading-4 text-gray-500">
            {t('adminNav.simpleHint')}
          </p>
        )}
      </nav>

      {/* Bottom */}
      <div className="px-3 py-4 border-t border-gray-800">
        <button
          type="button"
          onClick={() => setSupportAvailability(!supportAvailable)}
          disabled={supportAvailabilityBusy || supportAvailable === null}
          title={t('adminNav.liveSupportTitle')}
          className={`mb-3 flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm font-medium transition disabled:opacity-50 ${
            supportLiveReady
              ? 'border-green-700/50 bg-green-500/10 text-green-300 hover:bg-green-500/15'
              : 'border-gray-700 bg-gray-950/40 text-gray-400 hover:border-gray-600 hover:text-white'
          }`}
        >
          <span className={`h-2.5 w-2.5 rounded-full ${supportLiveReady ? 'bg-green-400 shadow-[0_0_10px_rgba(74,222,128,0.6)]' : supportAvailable ? 'bg-amber-400' : 'bg-gray-600'}`} />
          <span className="min-w-0">
            <span className="block truncate">{t('adminNav.liveSupport')}: {supportLiveReady ? t('adminNav.liveReady') : supportAvailable ? t('adminNav.liveConnecting') : t('adminNav.liveOffline')}</span>
            <span className="block truncate text-[10px] font-normal opacity-70">
              {supportLiveReady ? t('adminNav.liveReadyHint') : supportAvailable ? t('adminNav.liveConnectingHint') : t('adminNav.liveOfflineHint')}
            </span>
          </span>
        </button>
        <div className="px-3 py-2 mb-2 flex items-center justify-between">
          <p className="text-xs text-gray-500 truncate">{user?.email}</p>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={isDark ? t('adminNav.lightMode') : t('adminNav.darkMode')}
            title={isDark ? t('adminNav.lightMode') : t('adminNav.darkMode')}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white
                       hover:bg-gray-700 transition-all shrink-0 ml-2"
          >
            {isDark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          aria-label={t('adminNav.signOut')}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg
                     text-sm font-medium text-red-400 hover:bg-red-950
                     hover:text-red-300 transition-all"
        >
          <LogOut size={16} />
          {t('adminNav.signOut')}
        </button>
      </div>
      </>
    );
  };

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">

      {/* ── Desktop sidebar ── */}
      <aside className="hidden lg:flex w-60 bg-gray-900 border-r border-gray-800
                        flex-col shrink-0">
        {renderSidebar()}
      </aside>

      {/* ── Mobile sidebar overlay ── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={closeSidebar}
        />
      )}
      <aside id="admin-mobile-sidebar" aria-label={t('adminNav.sidebarLabel', { defaultValue: 'Admin navigation' })} aria-hidden={!sidebarOpen} inert={!sidebarOpen ? '' : undefined} className={`fixed inset-y-0 left-0 z-50 w-64 bg-gray-900
                         border-r border-gray-800 flex flex-col
                         transition-transform duration-200 lg:hidden ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        {renderSidebar()}
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Mobile top bar */}
        <header className="lg:hidden flex items-center gap-3 px-4 py-3
                            bg-gray-900 border-b border-gray-800 shrink-0">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-expanded={sidebarOpen}
            aria-controls="admin-mobile-sidebar"
            aria-label={t('openMenu')}
            className="text-gray-400 hover:text-white transition"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <OxSteedIcon size={24} />
            <span className="font-bold text-white text-sm">OxSteed Admin</span>
          </div>
          {/* Mobile search bar */}
          <form onSubmit={handleSearchSubmit} className="flex-1 mx-1">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2
                                           text-gray-500 pointer-events-none" />
              <input
                ref={searchRef}
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder={t('adminNav.searchMobile')}
                className="w-full pl-8 pr-2 py-1.5 bg-gray-800 border border-gray-700
                           rounded-lg text-xs text-white placeholder-gray-500
                           focus:outline-none focus:border-orange-500"
              />
            </div>
          </form>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={isDark ? t('adminNav.lightMode') : t('adminNav.darkMode')}
            title={isDark ? t('adminNav.lightMode') : t('adminNav.darkMode')}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white
                       hover:bg-gray-700 transition-all"
          >
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </header>

        {/* Desktop search bar */}
        <div className="hidden lg:flex items-center px-4 py-2.5 bg-gray-900
                        border-b border-gray-800 shrink-0">
          <form onSubmit={handleSearchSubmit} className="w-full max-w-sm">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2
                                           text-gray-500 pointer-events-none" />
              <input
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder={t('adminNav.searchDesktop')}
                className="w-full pl-9 pr-3 py-2 bg-gray-800 border border-gray-700
                           rounded-lg text-xs text-white placeholder-gray-500
                           focus:outline-none focus:border-orange-500"
              />
            </div>
          </form>
        </div>

        <main className="flex-1 overflow-y-auto bg-gray-950">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
