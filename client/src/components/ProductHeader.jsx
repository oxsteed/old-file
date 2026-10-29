import { Link } from 'react-router-dom';

/**
 * Shared public-product header. Food and Direct keep their own brand artwork
 * and translated actions, but use the same landmark, spacing, focus treatment,
 * and responsive navigation structure.
 */
export default function ProductHeader({
  brand,
  brandHref = '/',
  items = [],
  children,
  ariaLabel,
  className = '',
}) {
  return (
    <header className={`product-header ${className}`.trim()}>
      <Link to={brandHref} className="product-header-brand">
        {brand}
      </Link>
      <nav className="product-header-nav" aria-label={ariaLabel}>
        <div className="product-header-links">
          {items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              reloadDocument={item.reloadDocument}
              className="product-header-link"
              aria-current={item.current ? 'page' : undefined}
            >
              {item.label}
              {item.icon}
            </Link>
          ))}
        </div>
        {children && <div className="product-header-actions">{children}</div>}
      </nav>
    </header>
  );
}
