/**
 * SopProcessMap.jsx - renders a guide's processMap as a responsive SVG flow
 * chart, with a <details> plain-text equivalent below for screen readers and
 * anyone who prefers text.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import '../sop.css';

const NODE_W = 168;
const NODE_H = 60;
const H_GAP = 28;
const V_GAP = 64;

function layoutNodes(nodes, edges) {
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (!incoming.has(edge.to) || !outgoing.has(edge.from)) continue;
    incoming.set(edge.to, incoming.get(edge.to) + 1);
    outgoing.get(edge.from).push(edge.to);
  }

  // Layered layout: BFS levels from entry nodes (no incoming edges).
  const level = new Map();
  const queue = nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  for (const id of queue) level.set(id, 0);
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    const nextLevel = (level.get(id) ?? 0) + 1;
    for (const target of outgoing.get(id) ?? []) {
      if (!level.has(target) || level.get(target) < nextLevel) {
        level.set(target, nextLevel);
        queue.push(target);
      }
    }
  }
  // Nodes unreachable from an entry (cycles) land on their own last layer.
  let maxLevel = 0;
  for (const node of nodes) {
    if (!level.has(node.id)) level.set(node.id, maxLevel + 1);
    maxLevel = Math.max(maxLevel, level.get(node.id));
  }

  const layers = new Map();
  for (const node of nodes) {
    const layer = level.get(node.id);
    if (!layers.has(layer)) layers.set(layer, []);
    layers.get(layer).push(node);
  }

  const widest = Math.max(...[...layers.values()].map((list) => list.length), 1);
  const width = widest * NODE_W + (widest - 1) * H_GAP;
  const height = (maxLevel + 1) * NODE_H + maxLevel * V_GAP;

  const positions = new Map();
  for (const [layer, list] of layers) {
    const rowWidth = list.length * NODE_W + (list.length - 1) * H_GAP;
    const offsetX = (width - rowWidth) / 2;
    list.forEach((node, index) => {
      positions.set(node.id, {
        x: offsetX + index * (NODE_W + H_GAP),
        y: layer * (NODE_H + V_GAP),
      });
    });
  }
  return { positions, width, height };
}

function wrapLabel(label, maxChars = 22) {
  const words = String(label).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = (line + ' ' + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

export default function SopProcessMap({ processMap, processMapText }) {
  const { t } = useTranslation();

  const { positions, width, height } = useMemo(
    () => layoutNodes(processMap.nodes, processMap.edges),
    [processMap],
  );

  return (
    <div className="sop-process-map">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={t('sop.guide.processMap')}
      >
        <defs>
          <marker
            id="sop-pm-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 9 5 L 0 9 z" fill="currentColor" className="sop-pm-edge" stroke="none" />
          </marker>
        </defs>

        {processMap.edges.map((edge, index) => {
          const from = positions.get(edge.from);
          const to = positions.get(edge.to);
          if (!from || !to) return null;
          const x1 = from.x + NODE_W / 2;
          const y1 = from.y + NODE_H;
          const x2 = to.x + NODE_W / 2;
          const y2 = to.y;
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;
          return (
            <g key={`edge-${index}`}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                className="sop-pm-edge"
                markerEnd="url(#sop-pm-arrow)"
              />
              {edge.label ? (
                <text x={midX + 6} y={midY - 4} className="sop-pm-edge-label" textAnchor="start">
                  {edge.label}
                </text>
              ) : null}
            </g>
          );
        })}

        {processMap.nodes.map((node) => {
          const pos = positions.get(node.id);
          if (!pos) return null;
          const lines = wrapLabel(node.label);
          const textY = pos.y + NODE_H / 2 - ((lines.length - 1) * 8);
          const label = (
            <text x={pos.x + NODE_W / 2} y={textY} textAnchor="middle" dominantBaseline="middle">
              {lines.map((line, lineIndex) => (
                <tspan key={lineIndex} x={pos.x + NODE_W / 2} dy={lineIndex === 0 ? 0 : 16}>
                  {line}
                </tspan>
              ))}
            </text>
          );
          if (node.type === 'decision') {
            const cx = pos.x + NODE_W / 2;
            const cy = pos.y + NODE_H / 2;
            return (
              <g key={node.id} className="sop-pm-node sop-pm-node-decision">
                <polygon
                  points={`${cx},${pos.y} ${pos.x + NODE_W},${cy} ${cx},${pos.y + NODE_H} ${pos.x},${cy}`}
                />
                {label}
              </g>
            );
          }
          const rx = node.type === 'terminal' ? NODE_H / 2 : 10;
          return (
            <g key={node.id} className={`sop-pm-node sop-pm-node-${node.type}`}>
              <rect x={pos.x} y={pos.y} width={NODE_W} height={NODE_H} rx={rx} />
              {label}
            </g>
          );
        })}
      </svg>

      <details className="sop-process-text">
        <summary>{t('sop.guide.processMapTextToggle')}</summary>
        <p>{processMapText}</p>
      </details>

      {/* Screen-reader list of nodes for assistive tech that skips SVG text. */}
      <ul className="sop-sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {processMap.nodes.map((node) => (
          <li key={node.id}>{node.label}</li>
        ))}
      </ul>
    </div>
  );
}
