import { useState, useRef }  from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth }   from '../../hooks/useAuth';
import { useTheme }  from '../../context/ThemeContext';
import useAdminSupportAvailability from '../hooks/useAdminSupportAvailability';
import {
  LayoutDashboard, Users, Briefcase,
  Flag, Shield, DollarSign, Settings,
  FileText, BarChart2, LogOut, TrendingUp,
  ScrollText, Wrench, Trash2, UserCog,
  Menu, X, Sun, Moon, HeadphonesIcon,
  Search, Key, ClipboardList, Building2, CreditCard, MessageSquare,
  HeartHandshake, Calendar, UserPlus, Map, MapPinned, ShoppingCart, Layers, Fingerprint,
  AlertTriangle, Crown, Globe, Network, Package, Truck, ShieldAlert, BookOpen, Link2,
} from 'lucide-react';

const ADMIN_NAV_MODE_KEY = 'oxsteed:admin-nav-mode';

const REGULAR_NAV = [
  { to: '/admin/dashboard',        icon: LayoutDashboard, label: 'Dashboard'        },
  { to: '/admin/users',            icon: Users,           label: 'Users'            },
  { to: '/admin/jobs',             icon: Briefcase,       label: 'Jobs'             },
  { to: '/admin/reports',          icon: Flag,            label: 'Reports'          },
  { to: '/admin/moderation',       icon: Shield,          label: 'Moderation'       },
  { to: '/admin/enforcement',      icon: AlertTriangle,   label: 'Enforcement'      },
  { to: '/admin/content-removals', icon: Trash2,          label: 'Content Removals' },
  { to: '/admin/skills',           icon: Wrench,          label: 'Skills'           },
  { to: '/admin/support',          icon: HeadphonesIcon,  label: 'Support Tickets'  },
  { to: '/admin/support/chat',     icon: MessageSquare,   label: 'Live Support'     },
  { to: '/admin/quote-requests',   icon: FileText,        label: 'Quote Requests'   },
  { to: '/direct/admin',           icon: HeartHandshake,   label: 'Direct Ops',        external: true },
  { to: '/admin/direct-service-areas', icon: MapPinned,    label: 'Direct Service Areas' },
  { to: '/admin/direct-catalog',       icon: Package,      label: 'Direct Catalog'       },
  { to: '/admin/messages',         icon: MessageSquare,   label: 'Messages'         },
  { to: '/admin/search',           icon: Search,          label: 'Search'           },
  { to: '/admin/businesses',       icon: Building2,       label: 'Businesses'       },
  { to: '/admin/tool-rentals',     icon: Wrench,          label: 'Tool Rentals'     },
  { to: '/admin/planned-needs',        icon: ClipboardList,      label: 'Planned Needs'    },
  { to: '/admin/payments',             icon: CreditCard,         label: 'Payments'         },
  { to: '/admin/orders',               icon: ShoppingCart,       label: 'Orders'           },
  { to: '/admin/templates',            icon: Layers,             label: 'Templates'        },
  { to: '/admin/consulting',           icon: HeartHandshake,     label: 'Consulting'       },
  { to: '/admin/consulting/payments',  icon: CreditCard,         label: 'Consulting Pay'   },
  { to: '/admin/consulting/scheduler', icon: Calendar,           label: 'Scheduling'       },
  { to: '/admin/consulting/business-launch', icon: Briefcase,    label: 'Business Launch'  },
  { to: '/admin/consulting/sessions',  icon: Calendar,           label: 'Consulting Sessions' },
  { to: '/admin/corporate/org-chart',  icon: Network,            label: 'Org Chart'        },
  { to: '/admin/corporate/assignments',icon: Crown,              label: 'Corporate Titles' },
  { to: '/admin/logistics',            icon: Truck,              label: 'Logistics Ops'    },
  { to: '/admin/learn/submissions',    icon: BookOpen,           label: 'Learn Submissions'},
  { to: '/admin/learn/product-links', icon: Link2,              label: 'Learn Product Links'},
];

const SUPER_NAV = [
  { to: '/admin/super/dashboard',      icon: BarChart2,     label: 'Super Dashboard'  },
  { to: '/admin/super/money',          icon: DollarSign,    label: 'Money'            },
  { to: '/admin/super/revenue',        icon: TrendingUp,    label: 'Revenue'          },
  { to: '/admin/super/fees',           icon: DollarSign,    label: 'Fee Config'        },
  { to: '/admin/super/pricing',        icon: DollarSign,    label: 'Pricing Config'    },
  { to: '/admin/super/pricing-overrides', icon: Globe,      label: 'Pricing Overrides' },
  { to: '/admin/super/financials',     icon: DollarSign,    label: 'Financials'       },
  { to: '/admin/super/payouts',          icon: FileText,       label: 'Payouts'          },
  { to: '/admin/super/conversations',   icon: MessageSquare,  label: 'Conversations'    },
  { to: '/admin/super/admin-accounts',  icon: UserCog,        label: 'Admin Accounts'   },
  { to: '/admin/super/permissions',    icon: Key,           label: 'Permissions'      },
  { to: '/admin/super/regions',        icon: Map,           label: 'Regions'          },
  { to: '/admin/super/logistics-internal-access', icon: Key, label: 'Internal Access' },
  { to: '/admin/super/access-gate-lockouts', icon: ShieldAlert, label: 'Gate Lockouts' },
  { to: '/admin/super/users/create',   icon: UserPlus,      label: 'Create User'      },
  { to: '/admin/super/search-logs',    icon: ClipboardList, label: 'Search Logs'      },
  { to: '/admin/super/settings',       icon: Settings,      label: 'Settings'         },
  { to: '/admin/super/audit-log',      icon: ScrollText,    label: 'Audit Log'        },
  { to: '/admin/super/audit-log/user-actions', icon: ScrollText,    label: 'User Action Log' },
  { to: '/admin/super/one-truth',              icon: Fingerprint,   label: 'One Truth'       },
  { to: '/admin/super/franchises',             icon: Globe,         label: 'Franchise HQ'    },
  { to: '/admin/super/country-packs',          icon: Globe,         label: 'Country Packs'   },
  { to: '/admin/super/corporate/departments',  icon: Building2,     label: 'Corporate Setup' },
  { to: '/admin/super/mode-policies',          icon: Key,           label: 'Mode Policies'   },
  { to: '/admin/super/mode-approvals',         icon: AlertTriangle, label: 'Mode Approvals'  },
];

// Simple mode keeps the operational paths close at hand without removing access
// to any route. Full mode remains the default for existing admin sessions.
const SIMPLE_REGULAR_NAV = [
  '/admin/dashboard',
  '/admin/users',
  '/admin/jobs',
  '/admin/support',
  '/admin/support/chat',
  '/direct/admin',
  '/admin/direct-service-areas',
  '/admin/direct-catalog',
  '/admin/payments',
];

const SIMPLE_SUPER_NAV = [
  '/admin/super/dashboard',
  '/admin/super/conversations',
  '/admin/super/settings',
  '/admin/super/audit-log',
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
  const { user, logout }        = useAuth();
  const navigate                = useNavigate();
  const { isDark, toggleTheme } = useTheme();
  const isSuper                 = user?.role === 'super_admin';
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [sidebarNavSearch, setSidebarNavSearch] = useState('');
  const [simpleMode, setSimpleMode] = useState(readAdminNavMode);
  const searchRef = useRef(null);
  const {
    availability: supportAvailable,
    liveReady: supportLiveReady,
    busy: supportAvailabilityBusy,
    setAvailability: setSupportAvailability,
  } = useAdminSupportAvailability({ autoOnline: true });

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
    const matches = ({ label, to }) => !query || `${label} ${to}`.toLowerCase().includes(query);
    const regularNav = simpleMode
      ? REGULAR_NAV.filter(({ to }) => SIMPLE_REGULAR_NAV.includes(to))
      : REGULAR_NAV;
    const superNav = simpleMode
      ? SUPER_NAV.filter(({ to }) => SIMPLE_SUPER_NAV.includes(to))
      : SUPER_NAV;
    const visibleRegularNav = regularNav.filter(matches);
    const visibleSuperNav = superNav.filter(matches);

    return (
      <>
      {/* Logo */}
      <div className="px-5 py-4 border-b border-gray-800 flex items-center
                      justify-between">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="" className="h-7 w-7" />
          <div>
            <p className="font-bold text-white text-sm">OxSteed Admin</p>
            <p className={`text-xs font-medium mt-0.5 ${
              isSuper ? 'text-orange-400' : 'text-gray-400'
            }`}>
              {isSuper ? '⭐ Super Admin' : 'Admin'}
            </p>
          </div>
        </div>
        {/* Close button - mobile only */}
        <button
          onClick={closeSidebar}
          className="lg:hidden text-gray-500 hover:text-white transition p-1"
        >
          <X size={18} />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        <div className="sticky top-0 z-10 -mx-3 bg-gray-900 px-3 pb-3">
          <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-gray-800 bg-gray-950/40 px-3 py-2">
            <span className="text-xs font-medium text-gray-300">Simple mode</span>
            <button
              type="button"
              role="switch"
              aria-checked={simpleMode}
              aria-label={simpleMode ? 'Turn off simple admin mode' : 'Turn on simple admin mode'}
              onClick={toggleSimpleMode}
              className={`relative h-5 w-9 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:ring-offset-gray-900 ${simpleMode ? 'bg-orange-500' : 'bg-gray-700'}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${simpleMode ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
          </div>
          <label className="relative block">
            <span className="sr-only">Find an admin tab</span>
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={sidebarNavSearch}
              onChange={(event) => setSidebarNavSearch(event.target.value)}
              placeholder="Find a tab..."
              aria-label="Find an admin tab"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 py-2 pl-9 pr-8 text-xs text-white placeholder-gray-500 focus:border-orange-500 focus:outline-none"
            />
            {sidebarNavSearch && (
              <button
                type="button"
                onClick={() => setSidebarNavSearch('')}
                aria-label="Clear admin tab search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-500 hover:text-white"
              >
                <X size={13} />
              </button>
            )}
          </label>
        </div>

        {visibleRegularNav.length > 0 && (
          <>
            <p className="text-xs font-semibold text-gray-500 uppercase
                          tracking-wider px-3 mb-2">
              Operations
            </p>
            {visibleRegularNav.map(({ to, icon: Icon, label, external }) => (
              external ? (
                <a key={to} href={to} className={navClass} onClick={closeSidebar}>
                  <Icon size={16} />
                  {label}
                </a>
              ) : (
                <NavLink key={to} to={to} end={to === '/admin/support'} className={navClass} onClick={closeSidebar}>
                  <Icon size={16} />
                  {label}
                </NavLink>
              )
            ))}
          </>
        )}

        {isSuper && visibleSuperNav.length > 0 && (
          <>
            <div className="pt-4 pb-2">
              <p className="text-xs font-semibold text-gray-500 uppercase
                            tracking-wider px-3">
                Super Admin
              </p>
            </div>
            {visibleSuperNav.map(({ to, icon: Icon, label }) => (
              <NavLink key={to} to={to} className={superNavClass} onClick={closeSidebar}>
                <Icon size={16} />
                {label}
              </NavLink>
            ))}
          </>
        )}
        {!visibleRegularNav.length && !visibleSuperNav.length && (
          <p className="px-3 py-4 text-xs text-gray-500">No admin tabs match.</p>
        )}
        {simpleMode && !query && (
          <p className="px-3 pt-4 text-[10px] leading-4 text-gray-500">
            Simple mode shows essential operations. Turn it off to access every admin tab.
          </p>
        )}
      </nav>

      {/* Bottom */}
      <div className="px-3 py-4 border-t border-gray-800">
        <button
          type="button"
          onClick={() => setSupportAvailability(!supportAvailable)}
          disabled={supportAvailabilityBusy || supportAvailable === null}
          title="Controls whether customers can start a live support conversation with this admin session."
          className={`mb-3 flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm font-medium transition disabled:opacity-50 ${
            supportLiveReady
              ? 'border-green-700/50 bg-green-500/10 text-green-300 hover:bg-green-500/15'
              : 'border-gray-700 bg-gray-950/40 text-gray-400 hover:border-gray-600 hover:text-white'
          }`}
        >
          <span className={`h-2.5 w-2.5 rounded-full ${supportLiveReady ? 'bg-green-400 shadow-[0_0_10px_rgba(74,222,128,0.6)]' : supportAvailable ? 'bg-amber-400' : 'bg-gray-600'}`} />
          <span className="min-w-0">
            <span className="block truncate">Live support: {supportLiveReady ? 'Ready' : supportAvailable ? 'Connecting' : 'Offline'}</span>
            <span className="block truncate text-[10px] font-normal opacity-70">
              {supportLiveReady ? 'Customers can reach you' : supportAvailable ? 'Connecting to realtime support' : 'Customer chats will queue'}
            </span>
          </span>
        </button>
        <div className="px-3 py-2 mb-2 flex items-center justify-between">
          <p className="text-xs text-gray-500 truncate">{user?.email}</p>
          <button
            onClick={toggleTheme}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white
                       hover:bg-gray-700 transition-all shrink-0 ml-2"
          >
            {isDark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg
                     text-sm font-medium text-red-400 hover:bg-red-950
                     hover:text-red-300 transition-all"
        >
          <LogOut size={16} />
          Sign Out
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
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-gray-900
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
            onClick={() => setSidebarOpen(true)}
            className="text-gray-400 hover:text-white transition"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="" className="h-6 w-6" />
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
                placeholder="Search…"
                className="w-full pl-8 pr-2 py-1.5 bg-gray-800 border border-gray-700
                           rounded-lg text-xs text-white placeholder-gray-500
                           focus:outline-none focus:border-orange-500"
              />
            </div>
          </form>
          <button
            onClick={toggleTheme}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
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
                placeholder="Search users, jobs, messages…"
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
