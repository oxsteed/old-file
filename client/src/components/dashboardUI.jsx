// Shared UI primitives used by HelperDashboard and EditProfileTab.

export const ProgressBar = ({ pct, color = 'bg-orange-500' }) => (
  <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
    <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
  </div>
);

export const Card = ({ children, className = '' }) => (
  <div className={`bg-gray-900/60 border border-gray-700/40 rounded-2xl p-5 ${className}`}>{children}</div>
);

// icon and right are optional — omitting them renders a plain title header.
export const CardHeader = ({ icon: Ic, title, right }) => (
  <div className="flex items-center justify-between mb-4">
    <div className="flex items-center gap-2.5">
      {Ic && <Ic size={18} cls="text-orange-400" />}
      <h3 className="font-semibold text-white text-sm">{title}</h3>
    </div>
    {right}
  </div>
);

export const Btn = ({ children, onClick, variant = 'primary', className = '', ...r }) => {
  const v = {
    primary: 'bg-orange-500 hover:bg-orange-600 text-white',
    secondary: 'bg-gray-800 hover:bg-gray-700 text-gray-300',
    danger: 'bg-red-500/20 hover:bg-red-500/30 text-red-400',
  };
  return (
    <button onClick={onClick} className={`text-xs font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50 ${v[variant]} ${className}`} {...r}>
      {children}
    </button>
  );
};

export const Input = ({ label, ...r }) => (
  <div>
    {label && <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">{label}</label>}
    <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition" {...r} />
  </div>
);

export const Textarea = ({ label, ...r }) => (
  <div>
    {label && <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">{label}</label>}
    <textarea className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition resize-none" {...r} />
  </div>
);

export const Select = ({ label, children, ...r }) => (
  <div>
    {label && <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">{label}</label>}
    <select className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none transition" {...r}>{children}</select>
  </div>
);
