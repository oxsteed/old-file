import { useState }           from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth }   from '../../hooks/useAuth';
import { useTheme }  from '../../context/ThemeContext';
import {
  LayoutDashboard, Users, Briefcase,
  Flag, Shield, DollarSign, Settings,
  FileText, BarChart2, LogOut, TrendingUp,
  ScrollText, Wrench, Trash2, UserCog,
  Menu, X, Sun, Moon
} from 'lucide-react';

export default function AdminLayout() {
  const { user, logout }     = useAuth();
  const navigate             = useNavigate();
  const { isDark, toggleTheme } = useTheme();
  const isSuper              = user?.role === 'super_admin';
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/admin/login');
  };

  const regularNav = [
    { to: '/admin/dashboard',        icon: LayoutDashboard, label: 'Dashboard'        },
    { to: '/admin/users',            icon: Users,           label: 'Users'            },
    { to: '/admin/jobs',             icon: Briefcase,       label: 'Jobs'             },
    { to: '/admin/reports',          icon: Flag,            label: 'Reports'          },
    { to: '/admin/moderation',       icon: Shield,          label: 'Moderation'       },
    { to: '/admin/content-removals', icon: Trash2,          label: 'Content Removals' },
    { to: '/admin/skills',           icon: Wrench,          label: 'Skills'           },
  ];

  const superNav = [
    { to: '/admin/super/dashboard',      icon: BarChart2,    label: 'Super Dashboard'  },
    { to: '/admin/super/revenue',        icon: TrendingUp,   label: 'Revenue'          },
    { to: '/admin/super/financials',     icon: DollarSign,   label: 'Financials'       },
    { to: '/admin/super/payouts',        icon: FileText,     label: 'Payouts'          },
    { to: '/admin/super/admin-accounts', icon: UserCog,      label: 'Admin Accounts'   },
    { to: '/admin/super/settings',       icon: Settings,     label: 'Settings'         },
    { to: '/admin/super/audit-log',      icon: ScrollText,   label: 'Audit Log'        },
  ];

  const navLinkClass = ({ isActive }) =>
    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium
     transition-all ${
      isActive
        ? 'bg-orange-500 text-white'
        : 'text-gray-400 hover:text-white hover:bg-gray-800'
    }`;

  const superNavLinkClass = ({ isActive }) =>
    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium
     transition-all ${
      isActive
        ? 'bg-purple-600 text-white'
        : 'text-gray-400 hover:text-white hover:bg-gray-800'
    }`;

  const SidebarContent = () => (
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
        {/* Close button — mobile only */}
        <button
          onClick={() => setSidebarOpen(false)}
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
        {regularNav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={navLinkClass}
            onClick={() => setSidebarOpen(false)}
          >
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
            {superNav.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                className={superNavLinkClass}
                onClick={() => setSidebarOpen(false)}
              >
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
        <SidebarContent />
      </aside>

      {/* ── Mobile sidebar overlay ── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-gray-900
                         border-r border-gray-800 flex flex-col
                         transition-transform duration-200 lg:hidden ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <SidebarContent />
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
          <div className="flex items-center gap-2 flex-1">
            <img src="/logo.png" alt="" className="h-6 w-6" />
            <span className="font-bold text-white text-sm">OxSteed Admin</span>
          </div>
          <button
            onClick={toggleTheme}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white
                       hover:bg-gray-700 transition-all"
          >
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </header>

        <main className="flex-1 overflow-y-auto bg-gray-950">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
