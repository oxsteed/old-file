/**
 * Global command palette (Cmd+K / Ctrl+K). Fuzzy search over pages, admin
 * tabs, recent bookings/conversations, and common actions. Full keyboard
 * navigation (arrows + Enter + Escape). Mounted once in each app shell
 * (client App and admin AdminApp); the admin variant lists admin tabs with
 * the same grant gating as the admin sidebar.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { useMyScopes } from '../admin/lib/GrantGuard';
import './CommandPalette.css';

// PWA startup budget (2026-11-05): commandPaletteItems pulls in the admin
// layout (AdminLayout + adminRouteManifest, ~36KB) for the admin nav
// sections. The palette dialog already renders a loading state while items
// resolve, so the module loads on demand after the palette mounts instead
// of riding the startup bundle.
function usePaletteItemsModule() {
  const [module, setModule] = useState(null);
  useEffect(() => {
    let active = true;
    import('./commandPaletteItems')
      .then((loaded) => { if (active) setModule(loaded); })
      .catch(() => { /* Palette stays in its loading state. */ });
    return () => { active = false; };
  }, []);
  return module;
}

const MAX_VISIBLE = 30;

// UI gaps item 11: the palette was hotkey-only. Navbar trigger buttons
// dispatch this event; both palette variants listen, so the same button
// opens the palette in the client and admin shells.
export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent('oxsteed:open-command-palette'));
}

function usePaletteOpenEvent(onOpen) {
  useEffect(() => {
    window.addEventListener('oxsteed:open-command-palette', onOpen);
    return () => window.removeEventListener('oxsteed:open-command-palette', onOpen);
  }, [onOpen]);
}

function usePaletteHotkey(onToggle) {
  useEffect(() => {
    const handler = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onToggle();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onToggle]);
}

function PaletteDialog({ open, onClose, items, loading, itemsApi }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentIds, setRecentIds] = useState([]);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const activeRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      setRecentIds(itemsApi ? itemsApi.readRecentIds() : []);
      document.body.style.overflow = 'hidden';
      const frame = requestAnimationFrame(() => inputRef.current?.focus());
      return () => {
        document.body.style.overflow = '';
        cancelAnimationFrame(frame);
      };
    }
    return undefined;
  }, [open, itemsApi ]);

  const visibleItems = useMemo(() => {
    if (!itemsApi) return [];
    if (!query.trim()) return itemsApi.orderForEmptyQuery(items, recentIds).slice(0, MAX_VISIBLE);
    return itemsApi.searchItems(items, query).slice(0, MAX_VISIBLE);
  }, [items, query, recentIds, itemsApi]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const selectItem = useCallback((item) => {
    if (!item) return;
    itemsApi?.pushRecentId?.(item.id);
    onClose();
    navigate(item.path);
  }, [navigate, onClose, itemsApi]);

  const onInputKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (visibleItems.length ? (index + 1) % visibleItems.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (visibleItems.length ? (index - 1 + visibleItems.length) % visibleItems.length : 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      selectItem(visibleItems[activeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  if (!open) return null;

  let lastGroup = null;
  return (
    <div
      className="cmdk-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        className="cmdk-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('commandPalette.title')}
      >
        <div className="cmdk-input-row">
          <span className="cmdk-search-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.5" y2="16.5" />
            </svg>
          </span>
          <input
            ref={inputRef}
            autoFocus
            className="cmdk-input"
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={t('commandPalette.placeholder')}
            aria-label={t('commandPalette.placeholder')}
            aria-expanded="true"
            aria-controls="cmdk-list"
            role="combobox"
            autoComplete="off"
            spellCheck="false"
          />
          <button type="button" className="cmdk-close" aria-label={t('common.close')} onClick={onClose} data-track="pwa.close-command-palette"><kbd className="cmdk-kbd">esc</kbd></button>
        </div>

        <div id="cmdk-list" ref={listRef} className="cmdk-list" role="listbox" aria-label={t('commandPalette.title')}>
          {loading && visibleItems.length === 0 && (
            <div className="cmdk-empty" role="status">{t('commandPalette.loading')}</div>
          )}
          {!loading && visibleItems.length === 0 && (
            <div className="cmdk-empty">{t('commandPalette.noResults')}</div>
          )}
          {visibleItems.map((item, index) => {
            const showHeader = item.group !== lastGroup;
            lastGroup = item.group;
            const active = index === activeIndex;
            return (
              <div key={item.id}>
                {showHeader && (
                  <div className="cmdk-group-header">
                    {t(`commandPalette.groups.${item.group}`, item.group)}
                  </div>
                )}
                <button
                  ref={active ? activeRef : null}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`cmdk-item${active ? ' cmdk-item-active' : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectItem(item)} data-track="ui.74372074ef.1"
                >
                  <span className="cmdk-item-label">{item.label}</span>
                  {item.path && <span className="cmdk-item-path">{item.path}</span>}
                </button>
              </div>
            );
          })}
        </div>

        <div className="cmdk-footer">
          <span>{t('commandPalette.footer')}</span>
        </div>
      </div>
    </div>
  );
}

function ClientCommandPalette({initialOpen = false}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [open, setOpen] = useState(initialOpen);
  const [dynamicItems, setDynamicItems] = useState([]);
  const [dynamicLoading, setDynamicLoading] = useState(false);
  const fetchedRef = useRef(false);
  const itemsModule = usePaletteItemsModule();

  const toggle = useCallback(() => setOpen((value) => !value), []);
  usePaletteHotkey(toggle);
  const close = useCallback(() => setOpen(false), []);
  const openFromEvent = useCallback(() => setOpen(true), []);
  usePaletteOpenEvent(openFromEvent);

  const staticItems = useMemo(() => {
    if (!itemsModule) return [];
    const { pages, actions } = itemsModule.buildClientItems(t);
    return [...pages, ...actions];
  }, [itemsModule, t]);

  useEffect(() => {
    if (open && user && itemsModule && !fetchedRef.current) {
      fetchedRef.current = true;
      setDynamicLoading(true);
      itemsModule.fetchDynamicRecents(t)
        .then((items) => setDynamicItems(items))
        .finally(() => setDynamicLoading(false));
    }
  }, [open, user, t, itemsModule]);

  const items = useMemo(() => [...dynamicItems, ...staticItems], [dynamicItems, staticItems]);

  return <PaletteDialog open={open} onClose={close} items={items} loading={dynamicLoading || !itemsModule} itemsApi={itemsModule} />;
}

function AdminCommandPalette({initialOpen = false}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { scopes } = useMyScopes();
  const [open, setOpen] = useState(initialOpen);
  const itemsModule = usePaletteItemsModule();

  const toggle = useCallback(() => setOpen((value) => !value), []);
  usePaletteHotkey(toggle);
  const close = useCallback(() => setOpen(false), []);
  const openFromEvent = useCallback(() => setOpen(true), []);
  usePaletteOpenEvent(openFromEvent);

  const items = useMemo(() => itemsModule ? itemsModule.buildAdminItems(t, {
    isSuper: user?.role === 'super_admin',
    scopes: Array.isArray(scopes) ? scopes : [],
  }) : [], [itemsModule, t, user, scopes]);

  return <PaletteDialog open={open} onClose={close} items={items} loading={!itemsModule} itemsApi={itemsModule} />;
}

export default function CommandPalette({initialOpen = false}) {
  const { pathname } = useLocation();
  const isAdminShell = pathname.startsWith('/admin');
  return isAdminShell ? <AdminCommandPalette initialOpen={initialOpen} /> : <ClientCommandPalette initialOpen={initialOpen} />;
}
