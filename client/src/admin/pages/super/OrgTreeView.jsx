import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Crown, ChevronDown, ChevronRight, UserX } from 'lucide-react';

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

function TreeNode({ node, depth, defaultOpen, ancestors }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(depth < 2 && defaultOpen !== false);
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
            aria-label={open ? t('adminOrgChart.collapse') : t('adminOrgChart.expand')}
            aria-expanded={open}
          >
            {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
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
              </span>
            )}
          </div>
        </div>
      </div>
      {open && hasKids && (
        <div>
          {node.children
            .filter((child) => !childAncestors.has(child.id))
            .map((child) => (
              <TreeNode
                key={child.id}
                node={child}
                depth={depth + 1}
                ancestors={childAncestors}
              />
            ))}
        </div>
      )}
    </div>
  );
}

export default function OrgTreeView({ titles }) {
  const { t } = useTranslation();
  const roots = useMemo(() => buildTree(titles || []), [titles]);

  if (!roots.length) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center">
        <p className="text-gray-300 font-medium mb-1">{t('adminOrgChart.emptyTitle')}</p>
        <p className="text-gray-500 text-sm">{t('adminOrgChart.emptyBody')}</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 overflow-x-auto">
      {roots.map((root) => (
        <TreeNode key={root.id} node={root} depth={0} />
      ))}
    </div>
  );
}
