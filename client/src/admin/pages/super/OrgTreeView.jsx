import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Crown, ChevronDown, ChevronRight, UserX, Search, ChevronsDownUp, ChevronsUpDown, UserPlus } from 'lucide-react';

// Build a parent -> children tree from the flat title list.
// Cycle-safe: a visited set prevents infinite loops on bad data.
function buildTree(titles) {
  const byId = new Map(titles.map((t) => [t.id, { ...t, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    const parentId = node.reports_to_title_id;
    const parent = parentId != null ? byId.get(parentId) : null;
    if (parent && parent.id !== node.id) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortFn = (a, b) =>
    b.seniority_level - a.seniority_level || (a.name < b.name ? -1 : 1);
  const sortDeep = (nodes, seen = new Set()) => {
    nodes.sort(sortFn);
    for (const n of nodes) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      sortDeep(n.children, seen);
    }
  };
  sortDeep(roots);
  return roots;
}

function personName(a) {
  if (!a) return '';
  const full = `${a.first_name || ''} ${a.last_name || ''}`.trim();
  return full || a.email || '';
}

function TreeNode({ node, depth, ancestors, expandCmd, forceOpen }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(depth < 2 || forceOpen === true);
  // Respond to Expand all / Collapse all commands from the toolbar.
  useEffect(() => {
    if (expandCmd.n > 0) setOpen(expandCmd.open);
  }, [expandCmd]);
  // While searching, everything in the filtered tree stays open.
  const isOpen = forceOpen === true ? true : open;
  // Cycle guard: never render a node inside its own subtree.
  const seen = ancestors || new Set();
  const hasKids = node.children.length > 0 && !seen.has(node.id);
  const childAncestors = new Set(seen);
  childAncestors.add(node.id);
  const assignee = node.assignee;
  const initials = assignee
    ? ((assignee.first_name?.[0] || '') + (assignee.last_name?.[0] || '')).toUpperCase() || '?'
    : '';

  return (
    <div>
      <div
        className="flex items-center gap-2 py-1.5 pr-2 rounded-lg hover:bg-gray-950"
        style={{ paddingLeft: `${depth * 22 + 8}px` }}
      >
        {hasKids ? (
          <button
            onClick={() => setOpen((o) => !o)}
            className="text-gray-500 hover:text-gray-300 flex-shrink-0"
            aria-label={isOpen ? t('adminOrgChart.collapse') : t('adminOrgChart.expand')}
            aria-expanded={isOpen}
          >
            {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
        ) : (
          <span className="w-[15px] flex-shrink-0" />
        )}
        <span
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ background: node.department_color || '#7c3aed' }}
          title={node.department_name}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            {node.is_csuite && <Crown size={12} className="text-yellow-400 flex-shrink-0" />}
            <span className="text-white text-sm font-medium truncate">{node.name}</span>
            <span className="text-[10px] text-gray-500 flex-shrink-0">
              {t('adminOrgChart.level', { level: node.seniority_level })}
            </span>
          </div>
          <div className="text-xs text-gray-500 truncate">
            {assignee ? (
              <span className="inline-flex items-center gap-1.5">
                {assignee.profile_photo_url ? (
                  <img
                    src={assignee.profile_photo_url}
                    alt=""
                    className="w-4 h-4 rounded-full object-cover inline"
                  />
                ) : (
                  <span className="w-4 h-4 rounded-full bg-gray-700 text-gray-300 text-[8px] font-semibold inline-flex items-center justify-center">
                    {initials}
                  </span>
                )}
                <span className="text-gray-400">{personName(assignee)}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-gray-600">
                <UserX size={11} /> {t('adminOrgChart.vacant')}
                <Link
                  to="/admin/corporate/assignments"
                  className="ml-1 inline-flex items-center gap-0.5 text-orange-400 hover:text-orange-300 font-medium"
                  onClick={(e) => e.stopPropagation()}
                >
                  <UserPlus size={11} /> {t('adminOrgChart.assign')}
                </Link>
              </span>
            )}
          </div>
        </div>
      </div>
      {isOpen && hasKids && (
        <div>
          {node.children
            .filter((child) => !childAncestors.has(child.id))
            .map((child) => (
              <TreeNode
                key={child.id}
                node={child}
                depth={depth + 1}
                ancestors={childAncestors}
                expandCmd={expandCmd}
                forceOpen={forceOpen}
              />
            ))}
        </div>
      )}
    </div>
  );
}

export default function OrgTreeView({ titles }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  // { open: bool, n: number } — n bumps on every toolbar command so repeated
  // "Expand all" clicks keep working after a manual collapse.
  const [expandCmd, setExpandCmd] = useState({ open: null, n: 0 });

  const searching = query.trim().length > 0;

  // Filter titles by name; keep ancestors of matches so the tree stays connected.
  const visibleTitles = useMemo(() => {
    const all = titles || [];
    if (!searching) return all;
    const q = query.trim().toLowerCase();
    const byId = new Map(all.map((x) => [x.id, x]));
    const keep = new Set();
    for (const x of all) {
      if (!x.name.toLowerCase().includes(q)) continue;
      keep.add(x.id);
      let cur = x;
      const guard = new Set([x.id]);
      while (cur.reports_to_title_id != null && !guard.has(cur.reports_to_title_id)) {
        guard.add(cur.reports_to_title_id);
        keep.add(cur.reports_to_title_id);
        cur = byId.get(cur.reports_to_title_id);
        if (!cur) break;
      }
    }
    return all.filter((x) => keep.has(x.id));
  }, [titles, query, searching]);

  const roots = useMemo(() => buildTree(visibleTitles), [visibleTitles]);

  const total = (titles || []).length;
  const filled = (titles || []).filter((x) => x.assignee).length;
  const pct = total > 0 ? Math.round((filled / total) * 100) : 0;

  if (!roots.length && !searching) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center">
        <p className="text-gray-300 font-medium mb-1">{t('adminOrgChart.emptyTitle')}</p>
        <p className="text-gray-500 text-sm">{t('adminOrgChart.emptyBody')}</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
      {/* Toolbar: fill stats, search, expand/collapse */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-900 dark:text-white whitespace-nowrap">
              {t('adminOrgChart.filledStats', { filled, total })}
            </p>
            <div className="h-1.5 w-28 bg-gray-200 dark:bg-gray-800 rounded-full mt-1 overflow-hidden">
              <div className="h-full bg-orange-500 rounded-full" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('adminOrgChart.searchPlaceholder')}
              className="pl-8 pr-3 py-1.5 text-sm rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder:text-gray-400 w-44 sm:w-52"
            />
          </div>
          <button
            type="button"
            onClick={() => setExpandCmd((c) => ({ open: true, n: c.n + 1 }))}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
            title={t('adminOrgChart.expandAll')}
            aria-label={t('adminOrgChart.expandAll')}
          >
            <ChevronsUpDown size={15} />
          </button>
          <button
            type="button"
            onClick={() => setExpandCmd((c) => ({ open: false, n: c.n + 1 }))}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
            title={t('adminOrgChart.collapseAll')}
            aria-label={t('adminOrgChart.collapseAll')}
          >
            <ChevronsDownUp size={15} />
          </button>
        </div>
      </div>

      {/* Tree body */}
      <div className="p-4 overflow-x-auto">
        {roots.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
            {t('adminOrgChart.noSearchResults', { query: query.trim() })}
          </p>
        ) : (
          roots.map((root) => (
            <TreeNode
              key={root.id}
              node={root}
              depth={0}
              expandCmd={expandCmd}
              forceOpen={searching ? true : null}
            />
          ))
        )}
      </div>
    </div>
  );
}
