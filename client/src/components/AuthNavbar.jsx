import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ThemeToggle from './ThemeToggle';
import LanguageSelector from './LanguageSelector';
import { OxSteedIcon } from './Navbar';

export default function AuthNavbar({ links = [], cta = null }) {
  const { t } = useTranslation();

  return (
    <nav
      className="sticky top-0 z-50 border-b border-[var(--color-nav-border)] bg-[var(--color-nav-bg)] backdrop-blur-sm"
      aria-label={t('nav.mainNavigation', { defaultValue: 'Authentication navigation' })}
    >
      <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/"
          className="inline-flex min-h-11 items-center gap-2 text-xl sm:text-2xl font-bold text-[var(--color-text)] no-underline"
        >
          <OxSteedIcon size={28} />
          <span>OxSteed</span>
        </Link>

        <div className="flex items-center gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-4">
            {links.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={`${link.hideOnSmall ? 'hidden sm:inline-flex' : 'inline-flex'} min-h-11 items-center text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition no-underline`}
              >
                {link.label}
              </Link>
            ))}
            {cta && (
              <Link
                to={cta.to}
                className="inline-flex min-h-11 items-center rounded-lg border border-orange-500 px-3 py-1.5 text-sm text-orange-500 hover:bg-orange-500 hover:text-white transition-all duration-300 no-underline"
              >
                {cta.label}
              </Link>
            )}
          </div>
          <LanguageSelector />
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}
