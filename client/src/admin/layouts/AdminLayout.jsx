import { useState, useRef }  from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth }   from '../../hooks/useAuth';
import { useTheme }  from '../../context/ThemeContext';
import {
  LayoutDashboard, Users, Briefcase,
  Flag, Shield, DollarSign, Settings,
  FileText, BarChart2, LogOut, TrendingUp,
  ScrollText, Wrench, Trash2, UserCog,
  Menu, X, Sun, Moon, HeadphonesIcon,
  Search, Key, ClipboardList, Building2, CreditCard, MessageSquare,
  HeartHandshake, Calendar, UserPlus, Map, ShoppingCart, Layers, Fingerprint,
  AlertTriangle, Crown, Globe, Network, Package, Truck, ShieldAlert, BookOpen, Link2,
} from 'lucide-react';

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
  { to: '/admin/super/corporate/departments',  icon: Building2,     label: 'Corporate Setup' },
  { to: '/admin/super/mode-policies',          icon: Key,           label: 'Mode Policies'   },
  { to: '/admin/super/mode-approvals',         icon: AlertTriangle, label: 'Mode Approvals'  },
];

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
  const searchRef = useRef(null);

  const handleLogout = async () => {
    await logout();
    navigate('/admin/login');
  };

  const closeSidebar = () => setSidebarOpen(false);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (q.length < 2) return;
    navigate(`/admin/search?q=${encodeURIComponent(q)}`);
    setSearchInput('');
    closeSidebar();
  };

  // Plain function (not a component) - avoids remount on every render
  const renderSidebar = () => (
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
        <p className="text-xs font-semibold text-gray-500 uppercase
                      tracking-wider px-3 mb-2">
          Operations
        </p>
        {REGULAR_NAV.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} className={navClass} onClick={closeSidebar}>
            <Icon size={16} />
            {label}
          </NavLink>
        ))}

        {isSuper && (
          <>
            <div className="pt-4 pb-2">
              <p className="text-xs font-semibold text-gray-500 uppercase
                            tracking-wider px-3">
                Super Admin
              </p>
            </div>
            {SUPER_NAV.map(({ to, icon: Icon, label }) => (
              <NavLink key={to} to={to} className={superNavClass} onClick={closeSidebar}>
                <Icon size={16} />
                {label}
              </NavLink>
            ))}
          </>
        )}
      </nav>

      {/* Bottom */}
      <div className="px-3 py-4 border-t border-gray-800">
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
