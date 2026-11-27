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
import useAccessProjection from '../hooks/useAccessProjection';
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

function PaletteDialog({ open, onClose, items, loading, itemsApi, fetchDiscover }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentIds, setRecentIds] = useState([]);
  const [discoverItems, setDiscoverItems] = useState([]);
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

  // Palette item 4 (D-724): live Discover results, debounced 300ms, only
  // while the palette is open and the query is non-empty. A stale response
  // for an older query is discarded by the cleanup flag. D-728: the empty
  // branch keeps the previous array when it is already empty, so the
  // setter never re-renders on its own (same guard class as the live
  // fetch below: a fresh [] every run would loop if a dep ever churned).
  useEffect(() => {
    if (!open || !fetchDiscover) { setDiscoverItems((prev) => (prev.length === 0 ? prev : [])); return undefined; }
    const q = query.trim();
    if (!q) { setDiscoverItems((prev) => (prev.length === 0 ? prev : [])); return undefined; }
    let active = true;
    const timer = setTimeout(() => {
      fetchDiscover(q)
        .then((found) => { if (active) setDiscoverItems(found); })
        .catch(() => { if (active) setDiscoverItems([]); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [open, query, fetchDiscover]);

  const visibleItems = useMemo(() => {
    if (!itemsApi) return [];
    const own = !query.trim()
      ? itemsApi.orderForEmptyQuery(items, recentIds).slice(0, MAX_VISIBLE)
      : itemsApi.searchItems(items, query).slice(0, MAX_VISIBLE);
    if (!query.trim() || !discoverItems.length) return own;
    // Palette item 4 (D-724): Discover results rank after the user's own
    // stuff, capped at 5, never duplicating an own destination.
    return itemsApi.mergeDiscoverResults(own, itemsApi.searchItems(discoverItems, query));
  }, [items, discoverItems, query, recentIds, itemsApi]);

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
  // Universal finder step 1: the palette index is projection-only, the same
  // projection the navbar renders from. While it loads, the index fails
  // closed to the customer baseline.
  const projection = useAccessProjection(user);
  const [open, setOpen] = useState(initialOpen);
  const [dynamicItems, setDynamicItems] = useState([]);
  const [dynamicLoading, setDynamicLoading] = useState(false);
  const itemsModule = usePaletteItemsModule();

  const toggle = useCallback(() => setOpen((value) => !value), []);
  usePaletteHotkey(toggle);
  const close = useCallback(() => setOpen(false), []);
  const openFromEvent = useCallback(() => setOpen(true), []);
  usePaletteOpenEvent(openFromEvent);

  const staticItems = useMemo(() => {
    if (!itemsModule) return [];
    const { pages, actions } = itemsModule.buildClientItems(t, projection);
    return [...pages, ...actions];
  }, [itemsModule, t, projection]);

  // Palette item 3 (D-723): live items are fetched fresh on every open,
  // not once per mount, so an order placed or a booking accepted since
  // the last open shows up. Recents ride along; live wins on id clashes.
  // D-728: the fetch is guarded to once per open session. The effect's
  // deps include `user` by object identity, and a caller may hand back a
  // fresh user object on every render (the first-click fixture's useAuth
  // mock does exactly that). Without the guard, each fetch's setState
  // re-renders, the user identity changes, and the effect re-runs forever,
  // starving the main thread so the palette never opens. The guard resets
  // on close, so every open still gets fresh data, and a late module load
  // still fetches because the guard is only set once a fetch starts.
  const fetchedForOpenRef = useRef(false);
  useEffect(() => {
    if (!open) { fetchedForOpenRef.current = false; return undefined; }
    if (!user || !itemsModule) return undefined;
    if (fetchedForOpenRef.current) return undefined;
    fetchedForOpenRef.current = true;
    setDynamicLoading(true);
    Promise.all([
      itemsModule.fetchLiveItems(t),
      itemsModule.fetchDynamicRecents(t),
    ])
      .then(([live, recents]) => {
        if (!fetchedForOpenRef.current) return;
        const seen = new Set();
        setDynamicItems([...live, ...recents].filter((item) => {
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        }));
      })
      .finally(() => { if (fetchedForOpenRef.current) setDynamicLoading(false); });
    return undefined;
  }, [open, user, t, itemsModule]);

  const items = useMemo(() => [...dynamicItems, ...staticItems], [dynamicItems, staticItems]);

  // Palette item 4 (D-724): the client palette also searches Discover live.
  // The admin palette passes no fetcher and stays tabs-only.
  const fetchDiscover = useCallback(
    (q) => (itemsModule ? itemsModule.fetchDiscoverItems(t, q) : Promise.resolve([])),
    [itemsModule, t],
  );

  return <PaletteDialog open={open} onClose={close} items={items} loading={dynamicLoading || !itemsModule} itemsApi={itemsModule} fetchDiscover={fetchDiscover} />;
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
