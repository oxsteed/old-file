export default function StatCard({ label, value, icon: Icon, color }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-medium text-gray-400 uppercase
                      tracking-wider">
          {label}
        </p>
        <Icon size={15} className={color} />
      </div>
      <p className="text-2xl font-bold text-white">
        {typeof value === 'number'
          ? value.toLocaleString()
          : value ?? '—'
        }
      </p>
    </div>
  );
}
