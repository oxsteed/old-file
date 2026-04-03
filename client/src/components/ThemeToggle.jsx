import { useTheme } from '../context/ThemeContext';

export default function ThemeToggle() {
  const { isDark, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="p-2 rounded-lg hover:bg-white/10 transition-colors
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      title={isDark ? 'Light mode' : 'Dark mode'}
    >
      <span className="text-xl" aria-hidden="true">
                {isDark ? '☀️' : '🌙'}
      </span>
    </button>
  );
}
